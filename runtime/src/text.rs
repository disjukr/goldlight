use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use anyhow::Result;
use font_kit::canvas::{Canvas, Format, RasterizationOptions};
use font_kit::font::Font;
use font_kit::hinting::HintingOptions;
use font_kit::source::SystemSource;
use harfbuzz_sys::*;
use pathfinder_geometry::transform2d::Transform2F;
use pathfinder_geometry::vector::{Vector2F, Vector2I};
use serde::{Deserialize, Serialize};
use ttf_parser::{Face, GlyphId, OutlineBuilder};

use crate::render::PathVerb2D;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetricsValue {
    pub units_per_em: u16,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphMaskValue {
    pub cache_key: String,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub format: String,
    pub offset_x: i32,
    pub offset_y: i32,
    pub pixels: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSubpixelOffsetInput {
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextDirection {
    Ltr,
    Rtl,
}

impl Default for TextDirection {
    fn default() -> Self {
        Self::Ltr
    }
}

impl TextDirection {
    fn as_harfbuzz(self) -> hb_direction_t {
        match self {
            Self::Ltr => HB_DIRECTION_LTR,
            Self::Rtl => HB_DIRECTION_RTL,
        }
    }

    fn bidi_level(self) -> u8 {
        match self {
            Self::Ltr => 0,
            Self::Rtl => 1,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeTextInput {
    pub typeface: String,
    pub text: String,
    pub size: f32,
    #[serde(default)]
    pub direction: TextDirection,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub script_tag: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapedRunValue {
    pub typeface: String,
    pub text: String,
    pub size: f32,
    pub direction: String,
    pub bidi_level: u8,
    pub script_tag: String,
    pub language: String,
    pub glyph_ids: Vec<u32>,
    pub positions: Vec<f32>,
    pub offsets: Vec<f32>,
    pub cluster_indices: Vec<u32>,
    pub advance_x: f32,
    pub advance_y: f32,
    pub utf8_range_start: u32,
    pub utf8_range_end: u32,
}

#[derive(Clone)]
struct GlyphBitmap {
    width: u32,
    height: u32,
    stride: u32,
    offset_x: i32,
    offset_y: i32,
    pixels: Vec<u8>,
}

struct TextHostState {
    source: SystemSource,
    family_names: Vec<String>,
    typefaces: HashMap<u64, TypefaceState>,
    family_match_cache: HashMap<String, Option<u64>>,
    shape_cache: HashMap<ShapeCacheKey, ShapedRunState>,
    glyph_path_cache: HashMap<GlyphOutlineCacheKey, Vec<PathVerb2D>>,
    glyph_mask_cache: HashMap<GlyphBitmapCacheKey, GlyphBitmap>,
    glyph_sdf_cache: HashMap<GlyphSdfCacheKey, GlyphBitmap>,
    next_typeface_handle: u64,
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
    bidi_level: u8,
    direction: TextDirection,
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

fn with_state<T>(callback: impl FnOnce(&TextHostState) -> Result<T>) -> Result<T> {
    TEXT_HOST_STATE.with(|state| {
        if state.borrow().is_none() {
            *state.borrow_mut() = Some(create_text_host_state());
        }
        callback(
            state
                .borrow()
                .as_ref()
                .expect("text host state initialized"),
        )
    })
}

fn with_state_mut<T>(callback: impl FnOnce(&mut TextHostState) -> Result<T>) -> Result<T> {
    TEXT_HOST_STATE.with(|state| {
        if state.borrow().is_none() {
            *state.borrow_mut() = Some(create_text_host_state());
        }
        callback(
            state
                .borrow_mut()
                .as_mut()
                .expect("text host state initialized"),
        )
    })
}

fn create_text_host_state() -> TextHostState {
    let source = SystemSource::new();
    TextHostState {
        family_names: family_names_from_source(&source),
        source,
        typefaces: HashMap::new(),
        family_match_cache: HashMap::new(),
        shape_cache: HashMap::new(),
        glyph_path_cache: HashMap::new(),
        glyph_mask_cache: HashMap::new(),
        glyph_sdf_cache: HashMap::new(),
        next_typeface_handle: 1,
    }
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

fn scale_metric(metric: i16, units_per_em: u16, size: f32) -> f32 {
    if units_per_em == 0 {
        return 0.0;
    }
    metric as f32 / units_per_em as f32 * size
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
    value as f32 / units_per_em as f32 * size
}

fn shape_cache_key(
    typeface_handle: u64,
    text: &str,
    size: f32,
    direction: TextDirection,
    language: &str,
    script_tag: u32,
) -> ShapeCacheKey {
    ShapeCacheKey {
        typeface_handle,
        text: text.to_owned(),
        size_bits: size.to_bits(),
        direction: direction.bidi_level(),
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

fn typeface_handle_to_string(handle: u64) -> String {
    handle.to_string()
}

fn parse_typeface_handle(handle: &str) -> Result<u64> {
    Ok(handle.parse::<u64>()?)
}

fn fourcc_from_script_tag(script_tag: Option<&str>) -> u32 {
    let Some(script_tag) = script_tag else {
        return 0;
    };
    if script_tag.is_empty() {
        return 0;
    }
    let bytes = script_tag.as_bytes();
    unsafe { hb_tag_from_string(bytes.as_ptr() as *const i8, bytes.len() as i32) }
}

fn script_tag_to_string(script_tag: u32) -> String {
    if script_tag == 0 {
        return String::new();
    }
    let bytes = [
        ((script_tag >> 24) & 0xff) as u8,
        ((script_tag >> 16) & 0xff) as u8,
        ((script_tag >> 8) & 0xff) as u8,
        (script_tag & 0xff) as u8,
    ];
    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn glyph_mask_cache_key_string(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    subpixel_x: f32,
    subpixel_y: f32,
) -> String {
    format!(
        "{typeface_handle}:{glyph_id}:{}:{}:{}",
        size.to_bits(),
        subpixel_x.to_bits(),
        subpixel_y.to_bits()
    )
}

fn glyph_sdf_cache_key_string(
    typeface_handle: u64,
    glyph_id: u32,
    size: f32,
    inset: u32,
    radius: f32,
) -> String {
    format!(
        "{typeface_handle}:{glyph_id}:{}:{inset}:{}",
        size.to_bits(),
        radius.to_bits()
    )
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
            width,
            height,
            stride: 0,
            offset_x,
            offset_y,
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
        width,
        height,
        stride: canvas.stride as u32,
        offset_x,
        offset_y,
        pixels: canvas.pixels,
    })
}

const SK_DISTANCE_FIELD_MAGNITUDE: f32 = 4.0;
const SK_DISTANCE_FIELD_PAD: u32 = 4;
const SK_SQRT_2: f32 = std::f32::consts::SQRT_2;
const K_LEFT_NEIGHBOR_FLAG: u32 = 0x01;
const K_RIGHT_NEIGHBOR_FLAG: u32 = 0x02;
const K_TOP_LEFT_NEIGHBOR_FLAG: u32 = 0x04;
const K_TOP_NEIGHBOR_FLAG: u32 = 0x08;
const K_TOP_RIGHT_NEIGHBOR_FLAG: u32 = 0x10;
const K_BOTTOM_LEFT_NEIGHBOR_FLAG: u32 = 0x20;
const K_BOTTOM_NEIGHBOR_FLAG: u32 = 0x40;
const K_BOTTOM_RIGHT_NEIGHBOR_FLAG: u32 = 0x80;
const K_ALL_NEIGHBOR_FLAGS: u32 = 0xff;

#[derive(Clone, Copy)]
struct DistanceFieldData {
    alpha: f32,
    dist_sq: f32,
    dist_vector: [f32; 2],
}

fn found_edge(image: &[u8], index: usize, width: usize, neighbor_flags: u32) -> bool {
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
    let flags = [
        K_LEFT_NEIGHBOR_FLAG,
        K_RIGHT_NEIGHBOR_FLAG,
        K_TOP_LEFT_NEIGHBOR_FLAG,
        K_TOP_NEIGHBOR_FLAG,
        K_TOP_RIGHT_NEIGHBOR_FLAG,
        K_BOTTOM_LEFT_NEIGHBOR_FLAG,
        K_BOTTOM_NEIGHBOR_FLAG,
        K_BOTTOM_RIGHT_NEIGHBOR_FLAG,
    ];
    let curr_val = image[index];
    let curr_check = curr_val >> 7;
    for (neighbor_index, flag) in flags.iter().enumerate() {
        let neighbor_val = if neighbor_flags & *flag != 0 {
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
    } else if alpha * dx < dx - a1_num {
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

fn pack_distance_field_value(dist: f32) -> u8 {
    let clamped = (-dist).clamp(
        -SK_DISTANCE_FIELD_MAGNITUDE,
        SK_DISTANCE_FIELD_MAGNITUDE * 127.0 / 128.0,
    );
    let shifted = clamped + SK_DISTANCE_FIELD_MAGNITUDE;
    ((shifted / (2.0 * SK_DISTANCE_FIELD_MAGNITUDE) * 256.0).round() as i32).clamp(0, 255) as u8
}

fn distance_passes(
    data: &mut [DistanceFieldData],
    edges: &[u8],
    data_width: usize,
    data_height: usize,
) {
    for j in 1..data_height - 1 {
        for i in 1..data_width - 1 {
            let index = j * data_width + i;
            if edges[index] == 0 {
                f1(data, index, data_width);
            }
        }
        for i in (1..data_width - 1).rev() {
            let index = j * data_width + i;
            if edges[index] == 0 {
                f2(data, index);
            }
        }
    }
    for j in (1..data_height - 1).rev() {
        for i in 1..data_width - 1 {
            let index = j * data_width + i;
            if edges[index] == 0 {
                b1(data, index);
            }
        }
        for i in (1..data_width - 1).rev() {
            let index = j * data_width + i;
            if edges[index] == 0 {
                b2(data, index, data_width);
            }
        }
    }
}

struct PathVerbBuilder {
    verbs: Vec<PathVerb2D>,
    scale: f32,
}

impl PathVerbBuilder {
    fn new(scale: f32) -> Self {
        Self {
            verbs: Vec::new(),
            scale,
        }
    }

    fn point(&self, x: f32, y: f32) -> [f32; 2] {
        [x * self.scale, -y * self.scale]
    }
}

impl OutlineBuilder for PathVerbBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        self.verbs.push(PathVerb2D::MoveTo {
            to: self.point(x, y),
        });
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.verbs.push(PathVerb2D::LineTo {
            to: self.point(x, y),
        });
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.verbs.push(PathVerb2D::QuadTo {
            control: self.point(x1, y1),
            to: self.point(x, y),
        });
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.verbs.push(PathVerb2D::CubicTo {
            control1: self.point(x1, y1),
            control2: self.point(x2, y2),
            to: self.point(x, y),
        });
    }

    fn close(&mut self) {
        self.verbs.push(PathVerb2D::Close);
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
    update_distance_field_data(data, curr, dist_vec, dist_sq);
}

fn b1(data: &mut [DistanceFieldData], curr: usize) {
    let check = curr - 1;
    let mut dist_vec = data[check].dist_vector;
    let dist_sq = data[check].dist_sq - 2.0 * dist_vec[0] + 1.0;
    dist_vec[0] -= 1.0;
    update_distance_field_data(data, curr, dist_vec, dist_sq);
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
                check_mask &=
                    !(K_TOP_LEFT_NEIGHBOR_FLAG | K_TOP_NEIGHBOR_FLAG | K_TOP_RIGHT_NEIGHBOR_FLAG);
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

    distance_passes(&mut data, &edges, data_width, data_height);

    let mut distance_field = vec![
        0u8;
        (width + 2 * SK_DISTANCE_FIELD_PAD as usize)
            * (height + 2 * SK_DISTANCE_FIELD_PAD as usize)
    ];
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

fn create_sdf_from_mask(bitmap: &GlyphBitmap) -> GlyphBitmap {
    if bitmap.width == 0 || bitmap.height == 0 {
        return GlyphBitmap {
            width: 0,
            height: 0,
            stride: 0,
            offset_x: bitmap.offset_x,
            offset_y: bitmap.offset_y,
            pixels: Vec::new(),
        };
    }
    let width = bitmap.width + SK_DISTANCE_FIELD_PAD * 2;
    let height = bitmap.height + SK_DISTANCE_FIELD_PAD * 2;
    GlyphBitmap {
        width,
        height,
        stride: width,
        offset_x: bitmap.offset_x - SK_DISTANCE_FIELD_PAD as i32,
        offset_y: bitmap.offset_y - SK_DISTANCE_FIELD_PAD as i32,
        pixels: generate_distance_field_from_a8_image(
            &bitmap.pixels,
            bitmap.width as usize,
            bitmap.height as usize,
        ),
    }
}

fn create_glyph_sdf(typeface: &TypefaceState, glyph_id: u32, size: f32) -> Option<GlyphBitmap> {
    let bitmap = rasterize_glyph_mask(typeface, glyph_id, size, 0.0, 0.0)?;
    Some(create_sdf_from_mask(&bitmap))
}

pub fn list_families() -> Result<Vec<String>> {
    with_state(|state| Ok(state.family_names.clone()))
}

pub fn match_typeface(family: &str) -> Result<Option<String>> {
    with_state_mut(|state| {
        if let Some(cached) = state.family_match_cache.get(family) {
            return Ok(cached.map(typeface_handle_to_string));
        }
        let Ok(family_handle) = state.source.select_family_by_name(family) else {
            state.family_match_cache.insert(family.to_owned(), None);
            return Ok(None);
        };
        let Some(font_handle) = family_handle.fonts().first() else {
            state.family_match_cache.insert(family.to_owned(), None);
            return Ok(None);
        };
        let Ok(font) = Font::from_handle(font_handle) else {
            state.family_match_cache.insert(family.to_owned(), None);
            return Ok(None);
        };
        let Some(typeface_state) = load_typeface_state_from_font(font) else {
            state.family_match_cache.insert(family.to_owned(), None);
            return Ok(None);
        };
        if let Some((handle, _)) = state.typefaces.iter().find(|(_, existing)| {
            Arc::ptr_eq(&existing.font_data, &typeface_state.font_data)
                && existing.face_index == typeface_state.face_index
        }) {
            state
                .family_match_cache
                .insert(family.to_owned(), Some(*handle));
            return Ok(Some(typeface_handle_to_string(*handle)));
        }
        let handle = state.next_typeface_handle;
        state.next_typeface_handle += 1;
        state.typefaces.insert(handle, typeface_state);
        state
            .family_match_cache
            .insert(family.to_owned(), Some(handle));
        Ok(Some(typeface_handle_to_string(handle)))
    })
}

pub fn get_font_metrics(typeface: &str, size: f32) -> Result<Option<FontMetricsValue>> {
    let typeface_handle = parse_typeface_handle(typeface)?;
    with_state(|state| {
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return Ok(None);
        };
        let Ok(face) = Face::parse(typeface.font_data.as_slice(), typeface.face_index) else {
            return Ok(None);
        };
        let units_per_em = face.units_per_em();
        let underline = face.underline_metrics();
        let strikeout = face.strikeout_metrics();
        Ok(Some(FontMetricsValue {
            units_per_em,
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
        }))
    })
}

pub fn shape_text(input: ShapeTextInput) -> Result<Option<ShapedRunValue>> {
    let typeface_handle = parse_typeface_handle(&input.typeface)?;
    let language = input.language.unwrap_or_default();
    let script_tag = fourcc_from_script_tag(input.script_tag.as_deref());
    with_state_mut(|state| {
        let cache_key = shape_cache_key(
            typeface_handle,
            &input.text,
            input.size,
            input.direction,
            &language,
            script_tag,
        );
        let run = if let Some(cached) = state.shape_cache.get(&cache_key) {
            cached.clone()
        } else {
            let Some(typeface) = state.typefaces.get(&typeface_handle) else {
                return Ok(None);
            };
            let Ok(face) = Face::parse(typeface.font_data.as_slice(), typeface.face_index) else {
                return Ok(None);
            };
            let units_per_em = face.units_per_em();
            let shaped_run = unsafe {
                let blob = hb_blob_create(
                    typeface.font_data.as_ptr() as *const i8,
                    typeface.font_data.len() as u32,
                    HB_MEMORY_MODE_READONLY,
                    std::ptr::null_mut(),
                    None,
                );
                if blob.is_null() {
                    return Ok(None);
                }
                let hb_face = hb_face_create(blob, typeface.face_index);
                hb_blob_destroy(blob);
                if hb_face.is_null() {
                    return Ok(None);
                }
                hb_face_set_upem(hb_face, units_per_em as u32);
                let hb_font = hb_font_create(hb_face);
                hb_face_destroy(hb_face);
                if hb_font.is_null() {
                    return Ok(None);
                }
                hb_ot_font_set_funcs(hb_font);
                hb_font_set_scale(hb_font, units_per_em as i32, units_per_em as i32);
                let buffer = hb_buffer_create();
                if buffer.is_null() {
                    hb_font_destroy(hb_font);
                    return Ok(None);
                }
                hb_buffer_set_cluster_level(buffer, HB_BUFFER_CLUSTER_LEVEL_MONOTONE_GRAPHEMES);
                hb_buffer_add_utf8(
                    buffer,
                    input.text.as_ptr() as *const i8,
                    input.text.len() as i32,
                    0,
                    input.text.len() as i32,
                );
                hb_buffer_set_direction(buffer, input.direction.as_harfbuzz());
                if script_tag != 0 {
                    hb_buffer_set_script(buffer, script_tag);
                }
                if !language.is_empty() {
                    let hb_language = hb_language_from_string(
                        language.as_ptr() as *const i8,
                        language.len() as i32,
                    );
                    hb_buffer_set_language(buffer, hb_language);
                }
                hb_buffer_guess_segment_properties(buffer);
                hb_buffer_set_direction(buffer, input.direction.as_harfbuzz());
                if script_tag != 0 {
                    hb_buffer_set_script(buffer, script_tag);
                }
                hb_shape(hb_font, buffer, std::ptr::null(), 0);
                let mut glyph_count = 0u32;
                let infos = hb_buffer_get_glyph_infos(buffer, &mut glyph_count);
                let positions = hb_buffer_get_glyph_positions(buffer, &mut glyph_count);
                if infos.is_null() || positions.is_null() {
                    hb_buffer_destroy(buffer);
                    hb_font_destroy(hb_font);
                    return Ok(None);
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
                    glyph_offsets.push(scale_hb_position(
                        position.x_offset,
                        units_per_em,
                        input.size,
                    ));
                    glyph_offsets.push(scale_hb_position(
                        position.y_offset,
                        units_per_em,
                        input.size,
                    ));
                    cluster_indices.push(info.cluster);
                    pen_x += scale_hb_position(position.x_advance, units_per_em, input.size);
                    pen_y += scale_hb_position(position.y_advance, units_per_em, input.size);
                }
                glyph_positions.push(pen_x);
                glyph_positions.push(pen_y);
                glyph_offsets.push(0.0);
                glyph_offsets.push(0.0);
                cluster_indices.push(if matches!(input.direction, TextDirection::Rtl) {
                    0
                } else {
                    input.text.len() as u32
                });
                let resolved_script_tag = hb_buffer_get_script(buffer);
                hb_buffer_destroy(buffer);
                hb_font_destroy(hb_font);
                ShapedRunState {
                    glyph_ids,
                    positions: glyph_positions,
                    offsets: glyph_offsets,
                    cluster_indices,
                    bidi_level: input.direction.bidi_level(),
                    direction: input.direction,
                    script_tag: if script_tag != 0 {
                        script_tag
                    } else {
                        resolved_script_tag
                    },
                    advance_x: pen_x,
                    advance_y: pen_y,
                    utf8_range_start: 0,
                    utf8_range_end: input.text.len() as u32,
                }
            };
            state.shape_cache.insert(cache_key, shaped_run.clone());
            shaped_run
        };

        Ok(Some(ShapedRunValue {
            typeface: input.typeface,
            text: input.text,
            size: input.size,
            direction: match run.direction {
                TextDirection::Ltr => "ltr".to_string(),
                TextDirection::Rtl => "rtl".to_string(),
            },
            bidi_level: run.bidi_level,
            script_tag: script_tag_to_string(run.script_tag),
            language,
            glyph_ids: run.glyph_ids,
            positions: run.positions,
            offsets: run.offsets,
            cluster_indices: run.cluster_indices,
            advance_x: run.advance_x,
            advance_y: run.advance_y,
            utf8_range_start: run.utf8_range_start,
            utf8_range_end: run.utf8_range_end,
        }))
    })
}

pub fn get_glyph_path(typeface: &str, glyph_id: u32, size: f32) -> Result<Option<Vec<PathVerb2D>>> {
    let typeface_handle = parse_typeface_handle(typeface)?;
    with_state_mut(|state| {
        let cache_key = glyph_outline_cache_key(typeface_handle, glyph_id, size);
        if let Some(cached) = state.glyph_path_cache.get(&cache_key) {
            return Ok(Some(cached.clone()));
        }
        let Some(typeface) = state.typefaces.get(&typeface_handle) else {
            return Ok(None);
        };
        let Ok(face) = Face::parse(typeface.font_data.as_slice(), typeface.face_index) else {
            return Ok(None);
        };
        let units_per_em = face.units_per_em();
        if units_per_em == 0 {
            return Ok(None);
        }
        let mut builder = PathVerbBuilder::new(size / units_per_em as f32);
        if face
            .outline_glyph(GlyphId(glyph_id as u16), &mut builder)
            .is_none()
        {
            return Ok(None);
        }
        state
            .glyph_path_cache
            .insert(cache_key, builder.verbs.clone());
        Ok(Some(builder.verbs))
    })
}

pub fn get_glyph_mask(
    typeface: &str,
    glyph_id: u32,
    size: f32,
    subpixel_offset: Option<GlyphSubpixelOffsetInput>,
) -> Result<Option<GlyphMaskValue>> {
    let typeface_handle = parse_typeface_handle(typeface)?;
    let subpixel_offset = subpixel_offset.unwrap_or(GlyphSubpixelOffsetInput { x: 0.0, y: 0.0 });
    with_state_mut(|state| {
        let cache_key = glyph_bitmap_cache_key_with_subpixel(
            typeface_handle,
            glyph_id,
            size,
            subpixel_offset.x,
            subpixel_offset.y,
        );
        if !state.glyph_mask_cache.contains_key(&cache_key) {
            let Some(typeface) = state.typefaces.get(&typeface_handle) else {
                return Ok(None);
            };
            let Some(bitmap) = rasterize_glyph_mask(
                typeface,
                glyph_id,
                size,
                subpixel_offset.x,
                subpixel_offset.y,
            ) else {
                return Ok(None);
            };
            state.glyph_mask_cache.insert(cache_key, bitmap);
        }
        let Some(bitmap) = state.glyph_mask_cache.get(&cache_key) else {
            return Ok(None);
        };
        Ok(Some(GlyphMaskValue {
            cache_key: glyph_mask_cache_key_string(
                typeface_handle,
                glyph_id,
                size,
                subpixel_offset.x,
                subpixel_offset.y,
            ),
            width: bitmap.width,
            height: bitmap.height,
            stride: bitmap.stride,
            format: "a8".to_string(),
            offset_x: bitmap.offset_x,
            offset_y: bitmap.offset_y,
            pixels: bitmap.pixels.clone(),
        }))
    })
}

pub fn get_glyph_sdf(
    typeface: &str,
    glyph_id: u32,
    size: f32,
    inset: Option<u32>,
    radius: Option<f32>,
) -> Result<Option<GlyphMaskValue>> {
    let typeface_handle = parse_typeface_handle(typeface)?;
    let inset = inset.unwrap_or(2).max(1);
    let radius = radius.unwrap_or(4.0).max(1.0);
    with_state_mut(|state| {
        let cache_key = glyph_sdf_cache_key(typeface_handle, glyph_id, size, inset, radius);
        if !state.glyph_sdf_cache.contains_key(&cache_key) {
            let Some(typeface) = state.typefaces.get(&typeface_handle) else {
                return Ok(None);
            };
            let Some(bitmap) = create_glyph_sdf(typeface, glyph_id, size) else {
                return Ok(None);
            };
            state.glyph_sdf_cache.insert(cache_key, bitmap);
        }
        let Some(bitmap) = state.glyph_sdf_cache.get(&cache_key) else {
            return Ok(None);
        };
        Ok(Some(GlyphMaskValue {
            cache_key: glyph_sdf_cache_key_string(typeface_handle, glyph_id, size, inset, radius),
            width: bitmap.width,
            height: bitmap.height,
            stride: bitmap.stride,
            format: "a8".to_string(),
            offset_x: bitmap.offset_x,
            offset_y: bitmap.offset_y,
            pixels: bitmap.pixels.clone(),
        }))
    })
}
