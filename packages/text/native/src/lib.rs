use font_kit::canvas::{Canvas, Format, RasterizationOptions};
use font_kit::font::Font;
use font_kit::hinting::HintingOptions;
use font_kit::source::SystemSource;
use harfbuzz_sys::*;
use pathfinder_geometry::transform2d::Transform2F;
use pathfinder_geometry::vector::{Vector2F, Vector2I};
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::ffi::{c_char, c_void};
use std::sync::Arc;
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

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct TextGlyphMaskInfo {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub format: u32,
    pub offset_x: i32,
    pub offset_y: i32,
}

struct TextHostState {
    source: SystemSource,
    family_names: Vec<String>,
    typefaces: HashMap<u64, TypefaceState>,
    shaped_runs: HashMap<u64, ShapedRunState>,
    next_typeface_handle: u64,
    next_shaped_run_handle: u64,
}

struct TypefaceState {
    font_data: Arc<Vec<u8>>,
    face_index: u32,
    font: Font,
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

fn scale_hb_position(value: i32, units_per_em: u16, size: f32) -> f32 {
    if units_per_em == 0 {
        return 0.0;
    }
    (value as f32 / units_per_em as f32) * size
}

fn family_names_from_source(source: &SystemSource) -> Vec<String> {
    let mut family_names = BTreeSet::new();
    if let Ok(families) = source.all_families() {
        for family_name in families {
            if !family_name.is_empty() {
                family_names.insert(family_name);
            }
        }
    }
    family_names.into_iter().collect()
}

fn load_typeface_state_from_font(font: Font) -> Option<TypefaceState> {
    let handle = font.handle()?;
    let face_index = match handle {
        font_kit::handle::Handle::Path { font_index, .. }
        | font_kit::handle::Handle::Memory { font_index, .. } => font_index,
    };
    let font_data = font.copy_font_data()?;
    Some(TypefaceState {
        font_data,
        face_index,
        font,
    })
}

fn rasterize_glyph_mask(
    typeface: &TypefaceState,
    glyph_id: u32,
    size: f32,
) -> Option<(TextGlyphMaskInfo, Vec<u8>)> {
    let bounds = typeface
        .font
        .raster_bounds(
            glyph_id,
            size,
            Transform2F::default(),
            HintingOptions::None,
            RasterizationOptions::GrayscaleAa,
        )
        .ok()?;

    let width = bounds.width().max(0) as u32;
    let height = bounds.height().max(0) as u32;
    let offset_x = bounds.origin_x();
    let offset_y = bounds.origin_y();

    if width == 0 || height == 0 {
        return Some((
            TextGlyphMaskInfo {
                width,
                height,
                stride: 0,
                format: 1,
                offset_x,
                offset_y,
            },
            Vec::new(),
        ));
    }

    let mut canvas = Canvas::new(Vector2I::new(width as i32, height as i32), Format::A8);
    let translation =
        Transform2F::from_translation(Vector2F::new(-offset_x as f32, -offset_y as f32));
    typeface
        .font
        .rasterize_glyph(
            &mut canvas,
            glyph_id,
            size,
            translation,
            HintingOptions::None,
            RasterizationOptions::GrayscaleAa,
        )
        .ok()?;

    Some((
        TextGlyphMaskInfo {
            width,
            height,
            stride: canvas.stride as u32,
            format: 1,
            offset_x,
            offset_y,
        },
        canvas.pixels,
    ))
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
pub extern "C" fn text_host_init() -> u8 {
    TEXT_HOST_STATE.with(|state| {
        if state.borrow().is_some() {
            return TEXT_HOST_INIT_OK;
        }

        let source = SystemSource::new();
        let family_names = family_names_from_source(&source);

        *state.borrow_mut() = Some(TextHostState {
            source,
            family_names,
            typefaces: HashMap::new(),
            shaped_runs: HashMap::new(),
            next_typeface_handle: 1,
            next_shaped_run_handle: 1,
        });
        TEXT_HOST_INIT_OK
    })
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
        let Ok(family) = state.source.select_family_by_name(&family_name) else {
            return 0;
        };
        let Some(font_handle) = family.fonts().first() else {
            return 0;
        };
        let Ok(font) = Font::from_handle(font_handle) else {
            return 0;
        };
        let Some(typeface_state) = load_typeface_state_from_font(font) else {
            return 0;
        };

        if let Some((handle, _)) = state.typefaces.iter().find(|(_, existing)| {
            Arc::ptr_eq(&existing.font_data, &typeface_state.font_data)
                && existing.face_index == typeface_state.face_index
        }) {
            return *handle;
        }

        let handle = state.next_typeface_handle;
        state.next_typeface_handle += 1;
        state.typefaces.insert(handle, typeface_state);
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
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return 0;
        };

        let Ok(face) = Face::parse(typeface.font_data.as_slice(), typeface.face_index) else {
            return 0;
        };
        let units_per_em = face.units_per_em();
        let underline = face.underline_metrics();
        let strikeout = face.strikeout_metrics();
        let metrics = TextFontMetrics {
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
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return 0;
        };

        let Ok(face) = Face::parse(typeface.font_data.as_slice(), typeface.face_index) else {
            return 0;
        };
        let units_per_em = face.units_per_em();

        let shaped_run = unsafe {
            let blob = hb_blob_create(
                typeface.font_data.as_ptr() as *const c_char,
                typeface.font_data.len() as u32,
                HB_MEMORY_MODE_READONLY,
                std::ptr::null_mut(),
                None,
            );
            if blob.is_null() {
                return 0;
            }

            let hb_face = hb_face_create(blob, typeface.face_index);
            hb_blob_destroy(blob);
            if hb_face.is_null() {
                return 0;
            }
            hb_face_set_upem(hb_face, units_per_em as u32);

            let hb_font = hb_font_create(hb_face);
            hb_face_destroy(hb_face);
            if hb_font.is_null() {
                return 0;
            }

            hb_ot_font_set_funcs(hb_font);
            hb_font_set_scale(hb_font, units_per_em as i32, units_per_em as i32);

            let buffer = hb_buffer_create();
            if buffer.is_null() {
                hb_font_destroy(hb_font);
                return 0;
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
                return 0;
            }

            let infos_slice = std::slice::from_raw_parts(infos, glyph_count as usize);
            let positions_slice = std::slice::from_raw_parts(positions, glyph_count as usize);

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
                glyph_offsets.push(scale_hb_position(position.x_offset, units_per_em, size));
                glyph_offsets.push(scale_hb_position(position.y_offset, units_per_em, size));
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

            ShapedRunState {
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
            }
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
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return 0;
        };
        let Ok(face) = Face::parse(typeface.font_data.as_slice(), typeface.face_index) else {
            return 0;
        };
        let units_per_em = face.units_per_em();
        if units_per_em == 0 {
            return 0;
        }

        let mut builder = SvgPathBuilder::new(size / units_per_em as f32);
        if face
            .outline_glyph(GlyphId(glyph_id as u16), &mut builder)
            .is_none()
        {
            return 0;
        }

        write_bytes(builder.path.as_bytes(), out_buffer, out_buffer_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_get_glyph_mask_info(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    out_info: *mut TextGlyphMaskInfo,
) -> u8 {
    if out_info.is_null() {
        return 0;
    }

    with_state(|state| {
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return 0;
        };
        let Some((info, _)) = rasterize_glyph_mask(typeface, glyph_id, size) else {
            return 0;
        };

        unsafe {
            *out_info = info;
        }
        TEXT_HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_copy_glyph_mask_pixels(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    out_buffer: *mut c_void,
    out_buffer_len: usize,
) -> usize {
    with_state(|state| {
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return 0;
        };
        let Some((_, pixels)) = rasterize_glyph_mask(typeface, glyph_id, size) else {
            return 0;
        };
        write_bytes(&pixels, out_buffer, out_buffer_len)
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
