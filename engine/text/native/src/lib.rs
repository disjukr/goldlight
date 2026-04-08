use font_kit::canvas::{Canvas, Format, RasterizationOptions};
use font_kit::font::Font;
use font_kit::hinting::HintingOptions;
use font_kit::source::SystemSource;
use harfbuzz_sys::*;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
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

#[derive(Clone)]
struct GlyphBitmap {
    info: TextGlyphMaskInfo,
    pixels: Vec<u8>,
}

struct TextHostState {
    source: SystemSource,
    family_names: Vec<String>,
    typefaces: HashMap<u64, TypefaceState>,
    family_match_cache: HashMap<String, Option<u64>>,
    shaped_runs: HashMap<u64, ShapedRunState>,
    shape_cache: HashMap<ShapeCacheKey, ShapedRunState>,
    glyph_path_cache: HashMap<GlyphOutlineCacheKey, Vec<u8>>,
    glyph_mask_cache: HashMap<GlyphBitmapCacheKey, GlyphBitmap>,
    glyph_sdf_cache: HashMap<GlyphSdfCacheKey, GlyphBitmap>,
    next_typeface_handle: u64,
    next_shaped_run_handle: u64,
}

struct TypefaceState {
    font_data: Arc<Vec<u8>>,
    face_index: u32,
    font: Font,
}

#[derive(Clone)]
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

#[derive(Clone, Hash, PartialEq, Eq)]
struct ShapeCacheKey {
    typeface_handle: u64,
    text: String,
    size_bits: u32,
    direction: u8,
    language: String,
    script_tag: u32,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct GlyphOutlineCacheKey {
    typeface_handle: u64,
    glyph_id: u32,
    size_bits: u32,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct GlyphBitmapCacheKey {
    typeface_handle: u64,
    glyph_id: u32,
    size_bits: u32,
    subpixel_x_bits: u32,
    subpixel_y_bits: u32,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct GlyphSdfCacheKey {
    typeface_handle: u64,
    glyph_id: u32,
    size_bits: u32,
    inset: u32,
    radius_bits: u32,
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

fn shape_cache_key(
    typeface_handle: u64,
    text: &str,
    size: f32,
    direction: u8,
    language: &str,
    script_tag: u32,
) -> ShapeCacheKey {
    ShapeCacheKey {
        typeface_handle,
        text: text.to_owned(),
        size_bits: size.to_bits(),
        direction,
        language: language.to_owned(),
        script_tag,
    }
}

fn glyph_outline_cache_key(typeface_handle: u64, glyph_id: u32, size: f32) -> GlyphOutlineCacheKey {
    GlyphOutlineCacheKey {
        typeface_handle,
        glyph_id,
        size_bits: size.to_bits(),
    }
}

fn glyph_bitmap_cache_key_with_subpixel(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    subpixel_x: f32,
    subpixel_y: f32,
) -> GlyphBitmapCacheKey {
    GlyphBitmapCacheKey {
        typeface_handle,
        glyph_id,
        size_bits: size.to_bits(),
        subpixel_x_bits: subpixel_x.to_bits(),
        subpixel_y_bits: subpixel_y.to_bits(),
    }
}

fn glyph_sdf_cache_key(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    inset: u32,
    radius: f32,
) -> GlyphSdfCacheKey {
    GlyphSdfCacheKey {
        typeface_handle,
        glyph_id,
        size_bits: size.to_bits(),
        inset,
        radius_bits: radius.to_bits(),
    }
}

fn rasterize_glyph_mask(
    typeface: &TypefaceState,
    glyph_id: u32,
    size: f32,
    subpixel_x: f32,
    subpixel_y: f32,
) -> Option<GlyphBitmap> {
    let subpixel_x = if subpixel_x.is_finite() {
        subpixel_x.rem_euclid(1.0)
    } else {
        0.0
    };
    let subpixel_y = if subpixel_y.is_finite() {
        subpixel_y.rem_euclid(1.0)
    } else {
        0.0
    };
    let subpixel_translation = Transform2F::from_translation(Vector2F::new(subpixel_x, subpixel_y));
    let bounds = typeface
        .font
        .raster_bounds(
            glyph_id,
            size,
            subpixel_translation,
            HintingOptions::None,
            RasterizationOptions::GrayscaleAa,
        )
        .ok()?;

    let width = bounds.width().max(0) as u32;
    let height = bounds.height().max(0) as u32;
    let offset_x = bounds.origin_x();
    let offset_y = bounds.origin_y();

    if width == 0 || height == 0 {
        return Some(GlyphBitmap {
            info: TextGlyphMaskInfo {
                width,
                height,
                stride: 0,
                format: 1,
                offset_x,
                offset_y,
            },
            pixels: Vec::new(),
        });
    }

    let mut canvas = Canvas::new(Vector2I::new(width as i32, height as i32), Format::A8);
    let translation = Transform2F::from_translation(Vector2F::new(
        subpixel_x - offset_x as f32,
        subpixel_y - offset_y as f32,
    ));
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

    Some(GlyphBitmap {
        info: TextGlyphMaskInfo {
            width,
            height,
            stride: canvas.stride as u32,
            format: 1,
            offset_x,
            offset_y,
        },
        pixels: canvas.pixels,
    })
}

const SK_DISTANCE_FIELD_MAGNITUDE: f32 = 4.0;
const SK_DISTANCE_FIELD_PAD: u32 = 4;
const SK_SQRT_2: f32 = std::f32::consts::SQRT_2;

#[derive(Clone, Copy)]
struct DistanceFieldData {
    alpha: f32,
    dist_sq: f32,
    dist_vector: [f32; 2],
}

const K_LEFT_NEIGHBOR_FLAG: u32 = 0x01;
const K_RIGHT_NEIGHBOR_FLAG: u32 = 0x02;
const K_TOP_LEFT_NEIGHBOR_FLAG: u32 = 0x04;
const K_TOP_NEIGHBOR_FLAG: u32 = 0x08;
const K_TOP_RIGHT_NEIGHBOR_FLAG: u32 = 0x10;
const K_BOTTOM_LEFT_NEIGHBOR_FLAG: u32 = 0x20;
const K_BOTTOM_NEIGHBOR_FLAG: u32 = 0x40;
const K_BOTTOM_RIGHT_NEIGHBOR_FLAG: u32 = 0x80;
const K_ALL_NEIGHBOR_FLAGS: u32 = 0xff;

fn found_edge(image: &[u8], index: usize, width: usize, neighbor_flags: u32) -> bool {
    const OFFSETS: [(i32, u32); 8] = [
        (-1, K_LEFT_NEIGHBOR_FLAG),
        (1, K_RIGHT_NEIGHBOR_FLAG),
        (0, K_TOP_LEFT_NEIGHBOR_FLAG),
        (0, K_TOP_NEIGHBOR_FLAG),
        (0, K_TOP_RIGHT_NEIGHBOR_FLAG),
        (0, K_BOTTOM_LEFT_NEIGHBOR_FLAG),
        (0, K_BOTTOM_NEIGHBOR_FLAG),
        (0, K_BOTTOM_RIGHT_NEIGHBOR_FLAG),
    ];
    let dynamic_offsets = [
        -1isize,
        1isize,
        -(width as isize) - 1,
        -(width as isize),
        -(width as isize) + 1,
        width as isize - 1,
        width as isize,
        width as isize + 1,
    ];

    let curr_val = image[index];
    let curr_check = curr_val >> 7;
    for (neighbor_index, (_, flag)) in OFFSETS.iter().enumerate() {
        let neighbor_val = if (neighbor_flags & *flag) != 0 {
            image[(index as isize + dynamic_offsets[neighbor_index]) as usize]
        } else {
            0
        };
        let neighbor_check = neighbor_val >> 7;
        if curr_check != neighbor_check
            || (curr_check == 0 && neighbor_check == 0 && curr_val != 0 && neighbor_val != 0)
        {
            return true;
        }
    }
    false
}

fn normalize_fast(vector: &mut [f32; 2]) {
    let length_sq = vector[0] * vector[0] + vector[1] * vector[1];
    if length_sq > 0.0 {
        let inv_length = length_sq.sqrt().recip();
        vector[0] *= inv_length;
        vector[1] *= inv_length;
    } else {
        vector[0] = 0.0;
        vector[1] = 0.0;
    }
}

fn edge_distance(direction: [f32; 2], alpha: f32) -> f32 {
    let mut dx = direction[0];
    let mut dy = direction[1];
    if dx.abs() <= f32::EPSILON || dy.abs() <= f32::EPSILON {
        return 0.5 - alpha;
    }
    dx = dx.abs();
    dy = dy.abs();
    if dx < dy {
        std::mem::swap(&mut dx, &mut dy);
    }
    let a1_num = 0.5 * dy;
    if alpha * dx < a1_num {
        0.5 * (dx + dy) - (2.0 * dx * dy * alpha).sqrt()
    } else if alpha * dx < (dx - a1_num) {
        (0.5 - alpha) * dx
    } else {
        -0.5 * (dx + dy) + (2.0 * dx * dy * (1.0 - alpha)).sqrt()
    }
}

fn update_distance_field_data(
    data: &mut [DistanceFieldData],
    curr: usize,
    dist_vec: [f32; 2],
    dist_sq: f32,
) {
    if dist_sq < data[curr].dist_sq {
        data[curr].dist_sq = dist_sq;
        data[curr].dist_vector = dist_vec;
    }
}

fn f1(data: &mut [DistanceFieldData], curr: usize, width: usize) {
    let check = curr - width - 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq - 2.0 * (dist_vec[0] + dist_vec[1] - 1.0);
    dist_vec[0] -= 1.0;
    dist_vec[1] -= 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);

    let check = curr - width;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq - 2.0 * dist_vec[1] + 1.0;
    dist_vec[1] -= 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);

    let check = curr - width + 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq + 2.0 * (dist_vec[0] - dist_vec[1] + 1.0);
    dist_vec[0] += 1.0;
    dist_vec[1] -= 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);

    let check = curr - 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq - 2.0 * dist_vec[0] + 1.0;
    dist_vec[0] -= 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);
}

fn f2(data: &mut [DistanceFieldData], curr: usize) {
    let check = curr + 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq + 2.0 * dist_vec[0] + 1.0;
    dist_vec[0] += 1.0;
    if dist_sq < data[curr].dist_sq {
        data[curr].dist_sq = dist_sq;
        data[curr].dist_vector = dist_vec;
    }
}

fn b1(data: &mut [DistanceFieldData], curr: usize) {
    let check = curr - 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq - 2.0 * dist_vec[0] + 1.0;
    dist_vec[0] -= 1.0;
    if dist_sq < data[curr].dist_sq {
        data[curr].dist_sq = dist_sq;
        data[curr].dist_vector = dist_vec;
    }
}

fn b2(data: &mut [DistanceFieldData], curr: usize, width: usize) {
    let check = curr + 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq + 2.0 * dist_vec[0] + 1.0;
    dist_vec[0] += 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);

    let check = curr + width - 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq - 2.0 * (dist_vec[0] - dist_vec[1] - 1.0);
    dist_vec[0] -= 1.0;
    dist_vec[1] += 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);

    let check = curr + width;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq + 2.0 * dist_vec[1] + 1.0;
    dist_vec[1] += 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);

    let check = curr + width + 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq + 2.0 * (dist_vec[0] + dist_vec[1] + 1.0);
    dist_vec[0] += 1.0;
    dist_vec[1] += 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);
}

fn pack_distance_field_value(dist: f32) -> u8 {
    let clamped = (-dist).clamp(
        -SK_DISTANCE_FIELD_MAGNITUDE,
        SK_DISTANCE_FIELD_MAGNITUDE * 127.0 / 128.0,
    );
    let shifted = clamped + SK_DISTANCE_FIELD_MAGNITUDE;
    ((shifted / (2.0 * SK_DISTANCE_FIELD_MAGNITUDE) * 256.0).round() as i32).clamp(0, 255) as u8
}

fn generate_distance_field_from_a8_image(image: &[u8], width: usize, height: usize) -> Vec<u8> {
    let padded_width = width + 2;
    let padded_height = height + 2;
    let mut padded = vec![0u8; padded_width * padded_height];
    for y in 0..height {
        let src_start = y * width;
        let dst_start = (y + 1) * padded_width + 1;
        padded[dst_start..dst_start + width].copy_from_slice(&image[src_start..src_start + width]);
    }

    let pad = SK_DISTANCE_FIELD_PAD as usize + 1;
    let data_width = width + 2 * pad;
    let data_height = height + 2 * pad;
    let mut data = vec![
        DistanceFieldData {
            alpha: 0.0,
            dist_sq: 0.0,
            dist_vector: [0.0, 0.0],
        };
        data_width * data_height
    ];
    let mut edges = vec![0u8; data_width * data_height];

    for j in 0..padded_height {
        for i in 0..padded_width {
            let image_index = j * padded_width + i;
            let data_index = (j + SK_DISTANCE_FIELD_PAD as usize) * data_width
                + (i + SK_DISTANCE_FIELD_PAD as usize);
            let alpha = padded[image_index] as f32 * (1.0 / 255.0);
            data[data_index].alpha = alpha;

            let mut check_mask = K_ALL_NEIGHBOR_FLAGS;
            if i == 0 {
                check_mask &= !(K_LEFT_NEIGHBOR_FLAG
                    | K_TOP_LEFT_NEIGHBOR_FLAG
                    | K_BOTTOM_LEFT_NEIGHBOR_FLAG);
            }
            if i == padded_width - 1 {
                check_mask &= !(K_RIGHT_NEIGHBOR_FLAG
                    | K_TOP_RIGHT_NEIGHBOR_FLAG
                    | K_BOTTOM_RIGHT_NEIGHBOR_FLAG);
            }
            if j == 0 {
                check_mask &= !(K_TOP_LEFT_NEIGHBOR_FLAG
                    | K_TOP_NEIGHBOR_FLAG
                    | K_TOP_RIGHT_NEIGHBOR_FLAG);
            }
            if j == padded_height - 1 {
                check_mask &= !(K_BOTTOM_LEFT_NEIGHBOR_FLAG
                    | K_BOTTOM_NEIGHBOR_FLAG
                    | K_BOTTOM_RIGHT_NEIGHBOR_FLAG);
            }
            if found_edge(&padded, image_index, padded_width, check_mask) {
                edges[data_index] = 255;
            }
        }
    }

    for j in 0..data_height {
        for i in 0..data_width {
            let index = j * data_width + i;
            if edges[index] != 0 {
                let alpha_tl = data[index - data_width - 1].alpha;
                let alpha_t = data[index - data_width].alpha;
                let alpha_tr = data[index - data_width + 1].alpha;
                let alpha_l = data[index - 1].alpha;
                let alpha_r = data[index + 1].alpha;
                let alpha_bl = data[index + data_width - 1].alpha;
                let alpha_b = data[index + data_width].alpha;
                let alpha_br = data[index + data_width + 1].alpha;
                let mut grad = [
                    alpha_tr - alpha_tl + SK_SQRT_2 * alpha_r - SK_SQRT_2 * alpha_l + alpha_br
                        - alpha_bl,
                    alpha_bl - alpha_tl + SK_SQRT_2 * alpha_b - SK_SQRT_2 * alpha_t + alpha_br
                        - alpha_tr,
                ];
                normalize_fast(&mut grad);
                let dist = edge_distance(grad, data[index].alpha);
                data[index].dist_vector = [grad[0] * dist, grad[1] * dist];
                data[index].dist_sq = dist * dist;
            } else {
                data[index].dist_sq = 2_000_000.0;
                data[index].dist_vector = [1000.0, 1000.0];
            }
        }
    }

    for j in 1..data_height - 1 {
        for i in 1..data_width - 1 {
            let index = j * data_width + i;
            if edges[index] == 0 {
                f1(&mut data, index, data_width);
            }
        }
        for i in (1..data_width - 1).rev() {
            let index = j * data_width + i;
            if edges[index] == 0 {
                f2(&mut data, index);
            }
        }
    }

    for j in (1..data_height - 1).rev() {
        for i in 1..data_width - 1 {
            let index = j * data_width + i;
            if edges[index] == 0 {
                b1(&mut data, index);
            }
        }
        for i in (1..data_width - 1).rev() {
            let index = j * data_width + i;
            if edges[index] == 0 {
                b2(&mut data, index, data_width);
            }
        }
    }

    let mut distance_field = vec![0u8; (width + 2 * SK_DISTANCE_FIELD_PAD as usize)
        * (height + 2 * SK_DISTANCE_FIELD_PAD as usize)];
    let mut dst = 0usize;
    for j in 1..data_height - 1 {
        for i in 1..data_width - 1 {
            let index = j * data_width + i;
            let dist = if data[index].alpha > 0.5 {
                -data[index].dist_sq.sqrt()
            } else {
                data[index].dist_sq.sqrt()
            };
            distance_field[dst] = pack_distance_field_value(dist);
            dst += 1;
        }
    }
    distance_field
}

fn create_sdf_from_mask(bitmap: &GlyphBitmap, inset: u32, radius: f32) -> GlyphBitmap {
    if bitmap.info.width == 0 || bitmap.info.height == 0 {
        return GlyphBitmap {
            info: TextGlyphMaskInfo {
                width: 0,
                height: 0,
                stride: 0,
                format: 1,
                offset_x: bitmap.info.offset_x,
                offset_y: bitmap.info.offset_y,
            },
            pixels: Vec::new(),
        };
    }

    let _ = (inset, radius);
    let width = bitmap.info.width + SK_DISTANCE_FIELD_PAD * 2;
    let height = bitmap.info.height + SK_DISTANCE_FIELD_PAD * 2;
    let stride = width;
    let pixels = generate_distance_field_from_a8_image(
        &bitmap.pixels,
        bitmap.info.width as usize,
        bitmap.info.height as usize,
    );

    GlyphBitmap {
        info: TextGlyphMaskInfo {
            width,
            height,
            stride,
            format: 1,
            offset_x: bitmap.info.offset_x - SK_DISTANCE_FIELD_PAD as i32,
            offset_y: bitmap.info.offset_y - SK_DISTANCE_FIELD_PAD as i32,
        },
        pixels,
    }
}

fn create_glyph_sdf(
    typeface: &TypefaceState,
    glyph_id: u32,
    size: f32,
    inset: u32,
    radius: f32,
) -> Option<GlyphBitmap> {
    let bitmap = rasterize_glyph_mask(typeface, glyph_id, size, 0.0, 0.0)?;
    Some(create_sdf_from_mask(&bitmap, inset, radius))
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
            family_match_cache: HashMap::new(),
            shaped_runs: HashMap::new(),
            shape_cache: HashMap::new(),
            glyph_path_cache: HashMap::new(),
            glyph_mask_cache: HashMap::new(),
            glyph_sdf_cache: HashMap::new(),
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
        if let Some(cached) = state.family_match_cache.get(&family_name) {
            return cached.unwrap_or_default();
        }
        let Ok(family) = state.source.select_family_by_name(&family_name) else {
            state.family_match_cache.insert(family_name, None);
            return 0;
        };
        let Some(font_handle) = family.fonts().first() else {
            state.family_match_cache.insert(family_name, None);
            return 0;
        };
        let Ok(font) = Font::from_handle(font_handle) else {
            state.family_match_cache.insert(family_name, None);
            return 0;
        };
        let Some(typeface_state) = load_typeface_state_from_font(font) else {
            state.family_match_cache.insert(family_name, None);
            return 0;
        };

        if let Some((handle, _)) = state.typefaces.iter().find(|(_, existing)| {
            Arc::ptr_eq(&existing.font_data, &typeface_state.font_data)
                && existing.face_index == typeface_state.face_index
        }) {
            state.family_match_cache.insert(family_name, Some(*handle));
            return *handle;
        }

        let handle = state.next_typeface_handle;
        state.next_typeface_handle += 1;
        state.typefaces.insert(handle, typeface_state);
        state.family_match_cache.insert(family_name, Some(handle));
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
        let cache_key = shape_cache_key(typeface_handle, &text, size, direction, &language, script_tag);
        if let Some(cached) = state.shape_cache.get(&cache_key) {
            let handle = state.next_shaped_run_handle;
            state.next_shaped_run_handle += 1;
            state.shaped_runs.insert(handle, cached.clone());
            return handle;
        }
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

        state.shape_cache.insert(cache_key, shaped_run.clone());

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
    with_state_mut(|state| {
        let cache_key = glyph_outline_cache_key(typeface_handle, glyph_id, size);
        if let Some(cached) = state.glyph_path_cache.get(&cache_key) {
            return write_bytes(cached, out_buffer, out_buffer_len);
        }
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

        let path_bytes = builder.path.into_bytes();
        let written = write_bytes(&path_bytes, out_buffer, out_buffer_len);
        state.glyph_path_cache.insert(cache_key, path_bytes);
        written
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_get_glyph_mask_info(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    subpixel_x: f32,
    subpixel_y: f32,
    out_info: *mut TextGlyphMaskInfo,
) -> u8 {
    if out_info.is_null() {
        return 0;
    }

    with_state_mut(|state| {
        let cache_key =
            glyph_bitmap_cache_key_with_subpixel(typeface_handle, glyph_id, size, subpixel_x, subpixel_y);
        if let Some(bitmap) = state.glyph_mask_cache.get(&cache_key) {
            unsafe {
                *out_info = bitmap.info;
            }
            return TEXT_HOST_RESULT_OK;
        }
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return 0;
        };
        let Some(bitmap) = rasterize_glyph_mask(typeface, glyph_id, size, subpixel_x, subpixel_y) else {
            return 0;
        };

        unsafe {
            *out_info = bitmap.info;
        }
        state.glyph_mask_cache.insert(cache_key, bitmap);
        TEXT_HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_copy_glyph_mask_pixels(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    subpixel_x: f32,
    subpixel_y: f32,
    out_buffer: *mut c_void,
    out_buffer_len: usize,
) -> usize {
    with_state_mut(|state| {
        let cache_key =
            glyph_bitmap_cache_key_with_subpixel(typeface_handle, glyph_id, size, subpixel_x, subpixel_y);
        if !state.glyph_mask_cache.contains_key(&cache_key) {
            let Some(typeface) = state.typefaces.get(&typeface_handle) else {
                return 0;
            };
            let Some(bitmap) = rasterize_glyph_mask(typeface, glyph_id, size, subpixel_x, subpixel_y) else {
                return 0;
            };
            state.glyph_mask_cache.insert(cache_key, bitmap);
        }
        let Some(bitmap) = state.glyph_mask_cache.get(&cache_key) else {
            return 0;
        };
        write_bytes(&bitmap.pixels, out_buffer, out_buffer_len)
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_get_glyph_sdf_info(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    inset: u32,
    radius: f32,
    out_info: *mut TextGlyphMaskInfo,
) -> u8 {
    if out_info.is_null() {
        return 0;
    }

    let inset = inset.max(1);
    let radius = radius.max(1.0);

    with_state_mut(|state| {
        let cache_key = glyph_sdf_cache_key(typeface_handle, glyph_id, size, inset, radius);
        if let Some(bitmap) = state.glyph_sdf_cache.get(&cache_key) {
            unsafe {
                *out_info = bitmap.info;
            }
            return TEXT_HOST_RESULT_OK;
        }
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return 0;
        };
        let Some(bitmap) = create_glyph_sdf(typeface, glyph_id, size, inset, radius) else {
            return 0;
        };

        unsafe {
            *out_info = bitmap.info;
        }
        state.glyph_sdf_cache.insert(cache_key, bitmap);
        TEXT_HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn text_host_copy_glyph_sdf_pixels(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    inset: u32,
    radius: f32,
    out_buffer: *mut c_void,
    out_buffer_len: usize,
) -> usize {
    let inset = inset.max(1);
    let radius = radius.max(1.0);

    with_state_mut(|state| {
        let cache_key = glyph_sdf_cache_key(typeface_handle, glyph_id, size, inset, radius);
        if !state.glyph_sdf_cache.contains_key(&cache_key) {
            let Some(typeface) = state.typefaces.get(&typeface_handle) else {
                return 0;
            };
            let Some(bitmap) = create_glyph_sdf(typeface, glyph_id, size, inset, radius) else {
                return 0;
            };
            state.glyph_sdf_cache.insert(cache_key, bitmap);
        }
        let Some(bitmap) = state.glyph_sdf_cache.get(&cache_key) else {
            return 0;
        };
        write_bytes(&bitmap.pixels, out_buffer, out_buffer_len)
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

#[napi(object)]
pub struct JsFontMetrics {
    pub units_per_em: u32,
    pub ascent: f64,
    pub descent: f64,
    pub line_gap: f64,
    pub x_height: f64,
    pub cap_height: f64,
    pub underline_position: f64,
    pub underline_thickness: f64,
    pub strikeout_position: f64,
    pub strikeout_thickness: f64,
}

#[napi(object)]
pub struct JsGlyphBitmap {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub format_code: u32,
    pub offset_x: i32,
    pub offset_y: i32,
    pub pixels: Buffer,
}

#[napi(object)]
pub struct JsShapedRun {
    pub glyph_count: u32,
    pub bidi_level: u32,
    pub direction: String,
    pub script_tag_code: u32,
    pub advance_x: f64,
    pub advance_y: f64,
    pub utf8_range_start: u32,
    pub utf8_range_end: u32,
    pub glyph_ids: Vec<u32>,
    pub positions: Vec<f64>,
    pub offsets: Vec<f64>,
    pub cluster_indices: Vec<u32>,
}

fn read_family_name_at(index: u32) -> Option<String> {
    let required_len = text_host_get_family_name(index, std::ptr::null_mut(), 0);
    if required_len == 0 {
        return None;
    }

    let mut buffer = vec![0u8; required_len];
    let written_len = text_host_get_family_name(
        index,
        buffer.as_mut_ptr() as *mut c_void,
        buffer.len(),
    );
    if written_len == 0 {
        return None;
    }
    buffer.truncate(written_len);
    String::from_utf8(buffer).ok()
}

fn decode_js_metrics(metrics: TextFontMetrics) -> JsFontMetrics {
    JsFontMetrics {
        units_per_em: metrics.units_per_em as u32,
        ascent: metrics.ascent as f64,
        descent: metrics.descent as f64,
        line_gap: metrics.line_gap as f64,
        x_height: metrics.x_height as f64,
        cap_height: metrics.cap_height as f64,
        underline_position: metrics.underline_position as f64,
        underline_thickness: metrics.underline_thickness as f64,
        strikeout_position: metrics.strikeout_position as f64,
        strikeout_thickness: metrics.strikeout_thickness as f64,
    }
}

fn copy_u32_buffer(
    length: usize,
    copy_fn: impl FnOnce(*mut c_void, usize) -> u8,
) -> Option<Vec<u32>> {
    let mut values = vec![0u32; length];
    let result = copy_fn(values.as_mut_ptr() as *mut c_void, values.len());
    if result != TEXT_HOST_RESULT_OK {
        return None;
    }
    Some(values)
}

fn copy_f32_buffer(
    length: usize,
    copy_fn: impl FnOnce(*mut c_void, usize) -> u8,
) -> Option<Vec<f64>> {
    let mut values = vec![0f32; length];
    let result = copy_fn(values.as_mut_ptr() as *mut c_void, values.len());
    if result != TEXT_HOST_RESULT_OK {
        return None;
    }
    Some(values.into_iter().map(|value| value as f64).collect())
}

fn read_svg_path(typeface_handle: u64, glyph_id: u32, size: f32) -> Option<String> {
    let required_len = text_host_get_glyph_svg_path(
        typeface_handle,
        glyph_id,
        size,
        std::ptr::null_mut(),
        0,
    );
    if required_len == 0 {
        return None;
    }

    let mut buffer = vec![0u8; required_len];
    let written_len = text_host_get_glyph_svg_path(
        typeface_handle,
        glyph_id,
        size,
        buffer.as_mut_ptr() as *mut c_void,
        buffer.len(),
    );
    if written_len == 0 {
        return None;
    }
    buffer.truncate(written_len);
    String::from_utf8(buffer).ok()
}

fn read_bitmap(
    info_result: u8,
    info: TextGlyphMaskInfo,
    copy_len: usize,
    copy_fn: impl FnOnce(*mut c_void, usize) -> usize,
) -> Option<JsGlyphBitmap> {
    if info_result != TEXT_HOST_RESULT_OK {
        return None;
    }

    let mut pixels = vec![0u8; copy_len];
    let written_len = copy_fn(pixels.as_mut_ptr() as *mut c_void, pixels.len());
    if written_len == 0 {
        return None;
    }
    pixels.truncate(written_len);

    Some(JsGlyphBitmap {
        width: info.width,
        height: info.height,
        stride: info.stride,
        format_code: info.format,
        offset_x: info.offset_x,
        offset_y: info.offset_y,
        pixels: pixels.into(),
    })
}

#[napi]
pub fn init_text_host() -> bool {
    text_host_init() == TEXT_HOST_INIT_OK
}

#[napi]
pub fn shutdown_text_host() {
    text_host_shutdown();
}

#[napi]
pub fn list_families() -> Vec<String> {
    let count = text_host_get_family_count();
    (0..count).filter_map(read_family_name_at).collect()
}

#[napi]
pub fn match_typeface(family: String) -> Option<String> {
    let bytes = family.into_bytes();
    let handle = text_host_match_typeface_by_family(bytes.as_ptr(), bytes.len());
    if handle == 0 {
        None
    } else {
        Some(handle.to_string())
    }
}

#[napi]
pub fn get_font_metrics(typeface_handle: String, size: f64) -> Option<JsFontMetrics> {
    let typeface_handle = typeface_handle.parse::<u64>().ok()?;
    let mut metrics = TextFontMetrics::default();
    let result = text_host_get_font_metrics(typeface_handle, size as f32, &mut metrics as *mut _);
    if result != TEXT_HOST_RESULT_OK {
        return None;
    }
    Some(decode_js_metrics(metrics))
}

#[napi]
pub fn shape_text(
    typeface_handle: String,
    text: String,
    size: f64,
    direction: u32,
    language: String,
    script_tag: u32,
) -> Option<JsShapedRun> {
    let typeface_handle = typeface_handle.parse::<u64>().ok()?;
    let text_bytes = text.into_bytes();
    let language_bytes = language.into_bytes();
    let handle = text_host_shape_text(
        typeface_handle,
        text_bytes.as_ptr(),
        text_bytes.len(),
        size as f32,
        direction as u8,
        language_bytes.as_ptr(),
        language_bytes.len(),
        script_tag,
    );
    if handle == 0 {
        return None;
    }

    let mut info = TextShapedRunInfo::default();
    let info_result = text_host_shaped_run_get_info(handle, &mut info as *mut _);
    if info_result != TEXT_HOST_RESULT_OK {
        text_host_shaped_run_destroy(handle);
        return None;
    }

    let glyph_ids =
        copy_u32_buffer(info.glyph_count as usize, |ptr, len| text_host_shaped_run_copy_glyph_ids(handle, ptr, len))?;
    let positions = copy_f32_buffer(
        ((info.glyph_count as usize) + 1) * 2,
        |ptr, len| text_host_shaped_run_copy_positions(handle, ptr, len),
    )?;
    let offsets = copy_f32_buffer(
        ((info.glyph_count as usize) + 1) * 2,
        |ptr, len| text_host_shaped_run_copy_offsets(handle, ptr, len),
    )?;
    let cluster_indices = copy_u32_buffer(
        (info.glyph_count as usize) + 1,
        |ptr, len| text_host_shaped_run_copy_cluster_indices(handle, ptr, len),
    )?;

    text_host_shaped_run_destroy(handle);

    Some(JsShapedRun {
        glyph_count: info.glyph_count,
        bidi_level: info.bidi_level as u32,
        direction: if info.direction == 2 { "rtl".into() } else { "ltr".into() },
        script_tag_code: info.script_tag,
        advance_x: info.advance_x as f64,
        advance_y: info.advance_y as f64,
        utf8_range_start: info.utf8_range_start,
        utf8_range_end: info.utf8_range_end,
        glyph_ids,
        positions,
        offsets,
        cluster_indices,
    })
}

#[napi]
pub fn get_glyph_svg_path(typeface_handle: String, glyph_id: u32, size: f64) -> Option<String> {
    let typeface_handle = typeface_handle.parse::<u64>().ok()?;
    read_svg_path(typeface_handle, glyph_id, size as f32)
}

#[napi]
pub fn get_glyph_mask(
    typeface_handle: String,
    glyph_id: u32,
    size: f64,
    subpixel_x: f64,
    subpixel_y: f64,
) -> Option<JsGlyphBitmap> {
    let typeface_handle = typeface_handle.parse::<u64>().ok()?;
    let mut info = TextGlyphMaskInfo::default();
    let info_result = text_host_get_glyph_mask_info(
        typeface_handle,
        glyph_id,
        size as f32,
        subpixel_x as f32,
        subpixel_y as f32,
        &mut info as *mut _,
    );
    read_bitmap(info_result, info, (info.stride * info.height) as usize, |ptr, len| {
        text_host_copy_glyph_mask_pixels(
            typeface_handle,
            glyph_id,
            size as f32,
            subpixel_x as f32,
            subpixel_y as f32,
            ptr,
            len,
        )
    })
}

#[napi]
pub fn get_glyph_sdf(
    typeface_handle: String,
    glyph_id: u32,
    size: f64,
    inset: u32,
    radius: f64,
) -> Option<JsGlyphBitmap> {
    let typeface_handle = typeface_handle.parse::<u64>().ok()?;
    let mut info = TextGlyphMaskInfo::default();
    let info_result = text_host_get_glyph_sdf_info(
        typeface_handle,
        glyph_id,
        size as f32,
        inset,
        radius as f32,
        &mut info as *mut _,
    );
    read_bitmap(info_result, info, (info.stride * info.height) as usize, |ptr, len| {
        text_host_copy_glyph_sdf_pixels(
            typeface_handle,
            glyph_id,
            size as f32,
            inset,
            radius as f32,
            ptr,
            len,
        )
    })
}
