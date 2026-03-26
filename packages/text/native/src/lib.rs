use fontdb::{Database, Family, Query, ID};
use harfbuzz_sys::*;
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::ffi::{c_char, c_void};
use ttf_parser::{Face, GlyphId, OutlineBuilder};

const TEXT_HOST_INIT_OK: u8 = 1;
const TEXT_HOST_RESULT_OK: u8 = 1;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct TextFontMetrics {
    pub units_per_em: u16,
    pub reserved: u16,
    pub ascent: f32,
    pub descent: f32,
    pub line_gap: f32,
    pub x_height: f32,
    pub cap_height: f32,
    pub underline_position: f32,
    pub underline_thickness: f32,
    pub strikeout_position: f32,
    pub strikeout_thickness: f32,
}

struct TextHostState {
    database: Database,
    family_names: Vec<String>,
    typeface_ids: HashMap<u64, ID>,
    shaped_runs: HashMap<u64, ShapedRunState>,
    next_typeface_handle: u64,
    next_shaped_run_handle: u64,
}

struct ShapedRunState {
    glyph_ids: Vec<u32>,
    positions: Vec<f32>,
    offsets: Vec<f32>,
    cluster_indices: Vec<u32>,
    glyph_count: u32,
    bidi_level: u8,
    direction: u8,
    script_tag: u32,
    advance_x: f32,
    advance_y: f32,
    utf8_range_start: u32,
    utf8_range_end: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct TextShapedRunInfo {
    pub glyph_count: u32,
    pub bidi_level: u8,
    pub direction: u8,
    pub reserved0: u16,
    pub script_tag: u32,
    pub advance_x: f32,
    pub advance_y: f32,
    pub utf8_range_start: u32,
    pub utf8_range_end: u32,
    pub reserved1: u32,
}

thread_local! {
    static TEXT_HOST_STATE: RefCell<Option<TextHostState>> = const { RefCell::new(None) };
}

fn with_state<T>(callback: impl FnOnce(&TextHostState) -> T) -> Option<T> {
    TEXT_HOST_STATE.with(|state| state.borrow().as_ref().map(callback))
}

fn with_state_mut<T>(callback: impl FnOnce(&mut TextHostState) -> T) -> Option<T> {
    TEXT_HOST_STATE.with(|state| state.borrow_mut().as_mut().map(callback))
}

fn read_utf8(bytes: *const u8, length: usize) -> Option<String> {
    if bytes.is_null() {
        return None;
    }

    let slice = unsafe { std::slice::from_raw_parts(bytes, length) };
    String::from_utf8(slice.to_vec()).ok()
}

fn write_bytes(bytes: &[u8], out_buffer: *mut c_void, out_buffer_len: usize) -> usize {
    if !out_buffer.is_null() && out_buffer_len != 0 {
        let copy_len = bytes.len().min(out_buffer_len);
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_buffer as *mut u8, copy_len);
        }
    }
    bytes.len()
}

fn write_copy_slice<T: Copy>(values: &[T], out_buffer: *mut c_void, out_len: usize) -> u8 {
    if out_buffer.is_null() || out_len < values.len() {
        return 0;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(values.as_ptr(), out_buffer as *mut T, values.len());
    }
    TEXT_HOST_RESULT_OK
}

fn family_names_from_database(database: &Database) -> Vec<String> {
    let mut family_names = BTreeSet::new();
    for face in database.faces() {
        for family in &face.families {
            family_names.insert(family.0.clone());
        }
        if !face.post_script_name.is_empty() {
            family_names.insert(face.post_script_name.clone());
        }
    }
    family_names.into_iter().collect()
}

fn scale_metric(metric: i16, units_per_em: u16, size: f32) -> f32 {
    if units_per_em == 0 {
        return 0.0;
    }
    (metric as f32 / units_per_em as f32) * size
}

fn scale_optional_metric(metric: Option<i16>, units_per_em: u16, size: f32) -> f32 {
    metric
        .map(|value| scale_metric(value, units_per_em, size))
        .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_init() -> u8 {
    TEXT_HOST_STATE.with(|state| {
        if state.borrow().is_some() {
            return TEXT_HOST_INIT_OK;
        }

        let mut database = Database::new();
        database.load_system_fonts();
        let family_names = family_names_from_database(&database);

        *state.borrow_mut() = Some(TextHostState {
            database,
            family_names,
            typeface_ids: HashMap::new(),
            shaped_runs: HashMap::new(),
            next_typeface_handle: 1,
            next_shaped_run_handle: 1,
        });
        TEXT_HOST_INIT_OK
    })
}

fn scale_hb_position(value: i32, units_per_em: u16, size: f32) -> f32 {
    if units_per_em == 0 {
        return 0.0;
    }
    (value as f32 / units_per_em as f32) * size
}

struct SvgPathBuilder {
    path: String,
    scale: f32,
}

impl SvgPathBuilder {
    fn new(scale: f32) -> Self {
        Self {
            path: String::new(),
            scale,
        }
    }

    fn push_point(&mut self, x: f32, y: f32) {
        self.path
            .push_str(&format!("{} {} ", x * self.scale, -y * self.scale));
    }
}

impl OutlineBuilder for SvgPathBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        self.path.push_str("M ");
        self.push_point(x, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.path.push_str("L ");
        self.push_point(x, y);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.path.push_str("Q ");
        self.push_point(x1, y1);
        self.push_point(x, y);
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.path.push_str("C ");
        self.push_point(x1, y1);
        self.push_point(x2, y2);
        self.push_point(x, y);
    }

    fn close(&mut self) {
        self.path.push_str("Z ");
    }
}

#[no_mangle]
pub extern "C" fn text_host_shutdown() {
    TEXT_HOST_STATE.with(|state| {
        state.borrow_mut().take();
    });
}

#[no_mangle]
pub extern "C" fn text_host_get_family_count() -> u32 {
    with_state(|state| state.family_names.len() as u32).unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_get_family_name(
    index: u32,
    out_buffer: *mut c_void,
    out_buffer_len: usize,
) -> usize {
    with_state(|state| {
        let Some(family_name) = state.family_names.get(index as usize) else {
            return 0;
        };
        write_bytes(family_name.as_bytes(), out_buffer, out_buffer_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_match_typeface_by_family(
    family_ptr: *const u8,
    family_len: usize,
) -> u64 {
    let Some(family_name) = read_utf8(family_ptr, family_len) else {
        return 0;
    };

    with_state_mut(|state| {
        let query = Query {
            families: &[Family::Name(&family_name)],
            ..Query::default()
        };
        let Some(id) = state.database.query(&query) else {
            return 0;
        };

        if let Some((handle, _)) = state
            .typeface_ids
            .iter()
            .find(|(_, existing_id)| **existing_id == id)
        {
            return *handle;
        }

        let handle = state.next_typeface_handle;
        state.next_typeface_handle += 1;
        state.typeface_ids.insert(handle, id);
        handle
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_get_font_metrics(
    typeface_handle: u64,
    size: f32,
    out_metrics: *mut TextFontMetrics,
) -> u8 {
    if out_metrics.is_null() {
        return 0;
    }

    with_state(|state| {
        let Some(id) = state.typeface_ids.get(&typeface_handle).copied() else {
            return 0;
        };

        let Some(metrics) = state
            .database
            .with_face_data(id, |data, face_index| {
                let face = Face::parse(data, face_index).ok()?;
                let units_per_em = face.units_per_em();
                let underline = face.underline_metrics();
                let strikeout = face.strikeout_metrics();
                Some(TextFontMetrics {
                    units_per_em,
                    reserved: 0,
                    ascent: -scale_metric(face.ascender(), units_per_em, size),
                    descent: scale_metric(-face.descender(), units_per_em, size),
                    line_gap: scale_metric(face.line_gap(), units_per_em, size),
                    x_height: scale_optional_metric(face.x_height(), units_per_em, size),
                    cap_height: scale_optional_metric(face.capital_height(), units_per_em, size),
                    underline_position: underline
                        .map(|metrics| scale_metric(metrics.position, units_per_em, size))
                        .unwrap_or_default(),
                    underline_thickness: underline
                        .map(|metrics| scale_metric(metrics.thickness, units_per_em, size))
                        .unwrap_or_default(),
                    strikeout_position: strikeout
                        .map(|metrics| scale_metric(metrics.position, units_per_em, size))
                        .unwrap_or_default(),
                    strikeout_thickness: strikeout
                        .map(|metrics| scale_metric(metrics.thickness, units_per_em, size))
                        .unwrap_or_default(),
                })
            })
            .flatten()
        else {
            return 0;
        };

        unsafe {
            *out_metrics = metrics;
        }
        TEXT_HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_shape_text(
    typeface_handle: u64,
    text_ptr: *const u8,
    text_len: usize,
    size: f32,
    direction: u8,
    language_ptr: *const u8,
    language_len: usize,
    script_tag: u32,
) -> u64 {
    let Some(text) = read_utf8(text_ptr, text_len) else {
        return 0;
    };
    let language = read_utf8(language_ptr, language_len).unwrap_or_default();

    with_state_mut(|state| {
        let Some(id) = state.typeface_ids.get(&typeface_handle).copied() else {
            return 0;
        };

        let Some(shaped_run) = state
            .database
            .with_face_data(id, |data, face_index| {
                let face = Face::parse(data, face_index).ok()?;
                let units_per_em = face.units_per_em();

                unsafe {
                    let blob = hb_blob_create(
                        data.as_ptr() as *const c_char,
                        data.len() as u32,
                        HB_MEMORY_MODE_READONLY,
                        std::ptr::null_mut(),
                        None,
                    );
                    if blob.is_null() {
                        return None;
                    }

                    let hb_face = hb_face_create(blob, face_index);
                    hb_blob_destroy(blob);
                    if hb_face.is_null() {
                        return None;
                    }
                    hb_face_set_upem(hb_face, units_per_em as u32);

                    let hb_font = hb_font_create(hb_face);
                    hb_face_destroy(hb_face);
                    if hb_font.is_null() {
                        return None;
                    }

                    hb_ot_font_set_funcs(hb_font);
                    hb_font_set_scale(hb_font, units_per_em as i32, units_per_em as i32);

                    let buffer = hb_buffer_create();
                    if buffer.is_null() {
                        hb_font_destroy(hb_font);
                        return None;
                    }

                    hb_buffer_set_cluster_level(buffer, HB_BUFFER_CLUSTER_LEVEL_MONOTONE_GRAPHEMES);
                    hb_buffer_add_utf8(
                        buffer,
                        text.as_ptr() as *const c_char,
                        text.len() as i32,
                        0,
                        text.len() as i32,
                    );

                    match direction {
                        2 => hb_buffer_set_direction(buffer, HB_DIRECTION_RTL),
                        _ => hb_buffer_set_direction(buffer, HB_DIRECTION_LTR),
                    }

                    if script_tag != 0 {
                        hb_buffer_set_script(buffer, script_tag);
                    }
                    if !language.is_empty() {
                        let hb_language = hb_language_from_string(
                            language.as_ptr() as *const c_char,
                            language.len() as i32,
                        );
                        hb_buffer_set_language(buffer, hb_language);
                    }

                    hb_buffer_guess_segment_properties(buffer);
                    match direction {
                        2 => hb_buffer_set_direction(buffer, HB_DIRECTION_RTL),
                        _ => hb_buffer_set_direction(buffer, HB_DIRECTION_LTR),
                    }
                    if script_tag != 0 {
                        hb_buffer_set_script(buffer, script_tag);
                    }
                    if !language.is_empty() {
                        let hb_language = hb_language_from_string(
                            language.as_ptr() as *const c_char,
                            language.len() as i32,
                        );
                        hb_buffer_set_language(buffer, hb_language);
                    }

                    hb_shape(hb_font, buffer, std::ptr::null(), 0);

                    let mut glyph_count = 0u32;
                    let infos = hb_buffer_get_glyph_infos(buffer, &mut glyph_count);
                    let positions = hb_buffer_get_glyph_positions(buffer, &mut glyph_count);
                    if infos.is_null() || positions.is_null() {
                        hb_buffer_destroy(buffer);
                        hb_font_destroy(hb_font);
                        return None;
                    }

                    let infos_slice = std::slice::from_raw_parts(infos, glyph_count as usize);
                    let positions_slice =
                        std::slice::from_raw_parts(positions, glyph_count as usize);

                    let mut glyph_ids = Vec::with_capacity(glyph_count as usize);
                    let mut glyph_positions = Vec::with_capacity((glyph_count as usize + 1) * 2);
                    let mut glyph_offsets = Vec::with_capacity((glyph_count as usize + 1) * 2);
                    let mut cluster_indices = Vec::with_capacity(glyph_count as usize + 1);
                    let mut pen_x = 0f32;
                    let mut pen_y = 0f32;
                    for index in 0..glyph_count as usize {
                        let info = infos_slice[index];
                        let position = positions_slice[index];
                        glyph_ids.push(info.codepoint);
                        glyph_positions.push(pen_x);
                        glyph_positions.push(pen_y);
                        glyph_offsets.push(scale_hb_position(
                            position.x_offset,
                            units_per_em,
                            size,
                        ));
                        glyph_offsets.push(scale_hb_position(
                            position.y_offset,
                            units_per_em,
                            size,
                        ));
                        cluster_indices.push(info.cluster);
                        pen_x += scale_hb_position(position.x_advance, units_per_em, size);
                        pen_y += scale_hb_position(position.y_advance, units_per_em, size);
                    }

                    glyph_positions.push(pen_x);
                    glyph_positions.push(pen_y);
                    glyph_offsets.push(0.0);
                    glyph_offsets.push(0.0);
                    cluster_indices.push(if direction == 2 { 0 } else { text.len() as u32 });

                    let script = hb_buffer_get_script(buffer);
                    hb_buffer_destroy(buffer);
                    hb_font_destroy(hb_font);

                    Some(ShapedRunState {
                        glyph_ids,
                        positions: glyph_positions,
                        offsets: glyph_offsets,
                        cluster_indices,
                        glyph_count,
                        bidi_level: if direction == 2 { 1 } else { 0 },
                        direction,
                        script_tag: if script_tag != 0 { script_tag } else { script },
                        advance_x: pen_x,
                        advance_y: pen_y,
                        utf8_range_start: 0,
                        utf8_range_end: text.len() as u32,
                    })
                }
            })
            .flatten()
        else {
            return 0;
        };

        let handle = state.next_shaped_run_handle;
        state.next_shaped_run_handle += 1;
        state.shaped_runs.insert(handle, shaped_run);
        handle
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_get_glyph_svg_path(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    out_buffer: *mut c_void,
    out_buffer_len: usize,
) -> usize {
    with_state(|state| {
        let Some(id) = state.typeface_ids.get(&typeface_handle).copied() else {
            return 0;
        };
        let Some(path) = state
            .database
            .with_face_data(id, |data, face_index| {
                let face = Face::parse(data, face_index).ok()?;
                let units_per_em = face.units_per_em();
                if units_per_em == 0 {
                    return None;
                }

                let mut builder = SvgPathBuilder::new(size / units_per_em as f32);
                face.outline_glyph(GlyphId(glyph_id as u16), &mut builder)?;
                Some(builder.path)
            })
            .flatten()
        else {
            return 0;
        };

        write_bytes(path.as_bytes(), out_buffer, out_buffer_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_shaped_run_get_info(
    shaped_run_handle: u64,
    out_info: *mut TextShapedRunInfo,
) -> u8 {
    if out_info.is_null() {
        return 0;
    }

    with_state(|state| {
        let Some(run) = state.shaped_runs.get(&shaped_run_handle) else {
            return 0;
        };
        unsafe {
            *out_info = TextShapedRunInfo {
                glyph_count: run.glyph_count,
                bidi_level: run.bidi_level,
                direction: run.direction,
                reserved0: 0,
                script_tag: run.script_tag,
                advance_x: run.advance_x,
                advance_y: run.advance_y,
                utf8_range_start: run.utf8_range_start,
                utf8_range_end: run.utf8_range_end,
                reserved1: 0,
            };
        }
        TEXT_HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_shaped_run_copy_glyph_ids(
    shaped_run_handle: u64,
    out_buffer: *mut c_void,
    out_len: usize,
) -> u8 {
    with_state(|state| {
        let Some(run) = state.shaped_runs.get(&shaped_run_handle) else {
            return 0;
        };
        write_copy_slice(&run.glyph_ids, out_buffer, out_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_shaped_run_copy_positions(
    shaped_run_handle: u64,
    out_buffer: *mut c_void,
    out_len: usize,
) -> u8 {
    with_state(|state| {
        let Some(run) = state.shaped_runs.get(&shaped_run_handle) else {
            return 0;
        };
        write_copy_slice(&run.positions, out_buffer, out_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_shaped_run_copy_offsets(
    shaped_run_handle: u64,
    out_buffer: *mut c_void,
    out_len: usize,
) -> u8 {
    with_state(|state| {
        let Some(run) = state.shaped_runs.get(&shaped_run_handle) else {
            return 0;
        };
        write_copy_slice(&run.offsets, out_buffer, out_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_shaped_run_copy_cluster_indices(
    shaped_run_handle: u64,
    out_buffer: *mut c_void,
    out_len: usize,
) -> u8 {
    with_state(|state| {
        let Some(run) = state.shaped_runs.get(&shaped_run_handle) else {
            return 0;
        };
        write_copy_slice(&run.cluster_indices, out_buffer, out_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_shaped_run_destroy(shaped_run_handle: u64) {
    let _ = with_state_mut(|state| {
        state.shaped_runs.remove(&shaped_run_handle);
    });
}
