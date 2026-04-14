use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use anyhow::Result;
use font_kit::font::Font;
use font_kit::source::SystemSource;
use harfbuzz_sys::*;
use serde::{Deserialize, Serialize};
use ttf_parser::{Face, GlyphId, OutlineBuilder};

use crate::render::PathVerb2D;

const TEXT_HOST_CACHE_COUNT_LIMIT: usize = 2048;
const TEXT_HOST_CACHE_SIZE_LIMIT: usize = 2 * 1024 * 1024;

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

#[derive(Clone)]
struct CacheEntry<T> {
    value: T,
    last_used: u64,
    byte_size: usize,
}

struct TextHostState {
    source: SystemSource,
    family_names: Vec<String>,
    typefaces: HashMap<u64, TypefaceState>,
    family_match_cache: HashMap<String, Option<u64>>,
    shape_cache: HashMap<ShapeCacheKey, CacheEntry<ShapedRunState>>,
    shape_cache_bytes: usize,
    glyph_path_cache: HashMap<GlyphOutlineCacheKey, CacheEntry<Vec<PathVerb2D>>>,
    glyph_path_cache_bytes: usize,
    glyph_mask_cache: HashMap<GlyphBitmapCacheKey, CacheEntry<GlyphBitmap>>,
    glyph_mask_cache_bytes: usize,
    glyph_sdf_cache: HashMap<GlyphSdfCacheKey, CacheEntry<GlyphBitmap>>,
    glyph_sdf_cache_bytes: usize,
    next_cache_access: u64,
    next_typeface_handle: u64,
}

struct TypefaceState {
    font_data: Arc<Vec<u8>>,
    face_index: u32,
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

fn empty_shaped_run_state(input: &ShapeTextInput, script_tag: u32) -> ShapedRunState {
    ShapedRunState {
        glyph_ids: Vec::new(),
        positions: vec![0.0, 0.0],
        offsets: vec![0.0, 0.0],
        cluster_indices: vec![if matches!(input.direction, TextDirection::Rtl) {
            0
        } else {
            input.text.len() as u32
        }],
        bidi_level: input.direction.bidi_level(),
        direction: input.direction,
        script_tag,
        advance_x: 0.0,
        advance_y: 0.0,
        utf8_range_start: 0,
        utf8_range_end: input.text.len() as u32,
    }
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
        shape_cache_bytes: 0,
        glyph_path_cache: HashMap::new(),
        glyph_path_cache_bytes: 0,
        glyph_mask_cache: HashMap::new(),
        glyph_mask_cache_bytes: 0,
        glyph_sdf_cache: HashMap::new(),
        glyph_sdf_cache_bytes: 0,
        next_cache_access: 1,
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

fn next_cache_access(state: &mut TextHostState) -> u64 {
    let access = state.next_cache_access;
    state.next_cache_access = state.next_cache_access.saturating_add(1);
    access
}

fn shaped_run_byte_size(run: &ShapedRunState) -> usize {
    std::mem::size_of::<ShapedRunState>()
        + run.glyph_ids.len() * std::mem::size_of::<u32>()
        + run.positions.len() * std::mem::size_of::<f32>()
        + run.offsets.len() * std::mem::size_of::<f32>()
        + run.cluster_indices.len() * std::mem::size_of::<u32>()
}

fn glyph_path_byte_size(verbs: &[PathVerb2D]) -> usize {
    std::mem::size_of::<Vec<PathVerb2D>>() + verbs.len() * std::mem::size_of::<PathVerb2D>()
}

fn glyph_bitmap_byte_size(bitmap: &GlyphBitmap) -> usize {
    std::mem::size_of::<GlyphBitmap>() + bitmap.pixels.len()
}

fn purge_lru_cache<K: Clone + Eq + std::hash::Hash, V>(
    cache: &mut HashMap<K, CacheEntry<V>>,
    total_bytes: &mut usize,
) {
    while cache.len() > TEXT_HOST_CACHE_COUNT_LIMIT || *total_bytes > TEXT_HOST_CACHE_SIZE_LIMIT {
        let Some(oldest_key) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        let Some(entry) = cache.remove(&oldest_key) else {
            break;
        };
        *total_bytes = total_bytes.saturating_sub(entry.byte_size);
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
    let contours = build_glyph_raster_contours(typeface, glyph_id, size, subpixel_x, subpixel_y)?;
    Some(rasterize_glyph_contours(&contours))
}

const GLYPH_EPSILON: f32 = 1e-5;
const GLYPH_RASTER_SUBPIXEL_ROWS: usize = 4;
const GLYPH_SKIA_AA_SHIFT: i32 = 2;
const GLYPH_SKIA_CURVE_MAX_SHIFT: i32 = 6;

struct GlyphMaskContourBuilder {
    contours: Vec<Vec<[f32; 2]>>,
    current_contour: Vec<[f32; 2]>,
    scale: f32,
    translate_x: f32,
    translate_y: f32,
}

impl GlyphMaskContourBuilder {
    fn new(scale: f32, translate_x: f32, translate_y: f32) -> Self {
        Self {
            contours: Vec::new(),
            current_contour: Vec::new(),
            scale,
            translate_x,
            translate_y,
        }
    }

    fn point(&self, x: f32, y: f32) -> (f32, f32) {
        (
            x * self.scale + self.translate_x,
            -y * self.scale + self.translate_y,
        )
    }

    fn append_point(&mut self, point: [f32; 2]) {
        if self.current_contour.last().copied() != Some(point) {
            self.current_contour.push(point);
        }
    }

    fn finish_contour(&mut self) {
        if self.current_contour.len() < 2 {
            self.current_contour.clear();
            return;
        }
        let first = self.current_contour[0];
        if self.current_contour.last().copied() != Some(first) {
            self.current_contour.push(first);
        }
        self.contours
            .push(std::mem::take(&mut self.current_contour));
    }

    fn finish(mut self) -> Vec<Vec<[f32; 2]>> {
        self.finish_contour();
        self.contours
    }
}

impl OutlineBuilder for GlyphMaskContourBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish_contour();
        let (x, y) = self.point(x, y);
        self.current_contour.push([x, y]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.point(x, y);
        self.append_point([x, y]);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (x1, y1) = self.point(x1, y1);
        let (x, y) = self.point(x, y);
        let Some(from) = self.current_contour.last().copied() else {
            self.current_contour.push([x, y]);
            return;
        };
        flatten_quadratic_skia_curve(&mut self.current_contour, from, [x1, y1], [x, y]);
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (x1, y1) = self.point(x1, y1);
        let (x2, y2) = self.point(x2, y2);
        let (x, y) = self.point(x, y);
        let Some(from) = self.current_contour.last().copied() else {
            self.current_contour.push([x, y]);
            return;
        };
        flatten_cubic_skia_curve(&mut self.current_contour, from, [x1, y1], [x2, y2], [x, y]);
    }

    fn close(&mut self) {
        self.finish_contour();
    }
}

fn build_glyph_raster_contours(
    typeface: &TypefaceState,
    glyph_id: u32,
    size: f32,
    subpixel_x: f32,
    subpixel_y: f32,
) -> Option<Vec<Vec<[f32; 2]>>> {
    let face = Face::parse(typeface.font_data.as_slice(), typeface.face_index).ok()?;
    let units_per_em = face.units_per_em();
    if units_per_em == 0 {
        return None;
    }
    let mut builder =
        GlyphMaskContourBuilder::new(size / units_per_em as f32, subpixel_x, subpixel_y);
    face.outline_glyph(GlyphId(glyph_id as u16), &mut builder)?;
    Some(builder.finish())
}

fn append_unique_contour_point(contour: &mut Vec<[f32; 2]>, point: [f32; 2]) {
    if contour.last().copied() != Some(point) {
        contour.push(point);
    }
}

fn flatten_quadratic_skia_curve(
    contour: &mut Vec<[f32; 2]>,
    from: [f32; 2],
    control: [f32; 2],
    to: [f32; 2],
) {
    let steps = glyph_skia_quadratic_segments(from, control, to);
    for index in 1..=steps {
        let t = index as f32 / steps as f32;
        append_unique_contour_point(contour, evaluate_quadratic_curve(from, control, to, t));
    }
}

fn flatten_cubic_skia_curve(
    contour: &mut Vec<[f32; 2]>,
    from: [f32; 2],
    control1: [f32; 2],
    control2: [f32; 2],
    to: [f32; 2],
) {
    let steps = glyph_skia_cubic_segments(from, control1, control2, to);
    for index in 1..=steps {
        let t = index as f32 / steps as f32;
        append_unique_contour_point(
            contour,
            evaluate_cubic_curve(from, control1, control2, to, t),
        );
    }
}

fn glyph_skia_quadratic_segments(from: [f32; 2], control: [f32; 2], to: [f32; 2]) -> usize {
    let x0 = glyph_to_skia_subpixel(from[0]);
    let y0 = glyph_to_skia_subpixel(from[1]);
    let x1 = glyph_to_skia_subpixel(control[0]);
    let y1 = glyph_to_skia_subpixel(control[1]);
    let x2 = glyph_to_skia_subpixel(to[0]);
    let y2 = glyph_to_skia_subpixel(to[1]);
    let dx = (((x1 as i64) << 1) - x0 as i64 - x2 as i64) >> 2;
    let dy = (((y1 as i64) << 1) - y0 as i64 - y2 as i64) >> 2;
    let shift =
        glyph_diff_to_shift(dx, dy, GLYPH_SKIA_AA_SHIFT).clamp(1, GLYPH_SKIA_CURVE_MAX_SHIFT);
    1usize << shift
}

fn glyph_skia_cubic_segments(
    from: [f32; 2],
    control1: [f32; 2],
    control2: [f32; 2],
    to: [f32; 2],
) -> usize {
    let x0 = glyph_to_skia_subpixel(from[0]);
    let y0 = glyph_to_skia_subpixel(from[1]);
    let x1 = glyph_to_skia_subpixel(control1[0]);
    let y1 = glyph_to_skia_subpixel(control1[1]);
    let x2 = glyph_to_skia_subpixel(control2[0]);
    let y2 = glyph_to_skia_subpixel(control2[1]);
    let x3 = glyph_to_skia_subpixel(to[0]);
    let y3 = glyph_to_skia_subpixel(to[1]);
    let dx = glyph_cubic_delta_from_line(x0, x1, x2, x3);
    let dy = glyph_cubic_delta_from_line(y0, y1, y2, y3);
    let shift =
        (glyph_diff_to_shift(dx, dy, GLYPH_SKIA_AA_SHIFT) + 1).clamp(1, GLYPH_SKIA_CURVE_MAX_SHIFT);
    1usize << shift
}

fn glyph_to_skia_subpixel(value: f32) -> i64 {
    (value * ((1 << (GLYPH_SKIA_AA_SHIFT + 6)) as f32)).round() as i64
}

fn glyph_cubic_delta_from_line(a: i64, b: i64, c: i64, d: i64) -> i64 {
    let one_third = (a * 8 - b * 15 + 6 * c + d) * 19 >> 9;
    let two_third = (a + 6 * b - c * 15 + d * 8) * 19 >> 9;
    one_third.abs().max(two_third.abs())
}

fn glyph_diff_to_shift(dx: i64, dy: i64, shift_aa: i32) -> i32 {
    let dist = glyph_cheap_distance(dx, dy);
    let shifted = (dist + (1i64 << (2 + shift_aa))) >> (3 + shift_aa);
    if shifted <= 0 {
        return 0;
    }
    ((64 - shifted.leading_zeros() as i32) >> 1).max(0)
}

fn glyph_cheap_distance(dx: i64, dy: i64) -> i64 {
    let dx = dx.abs();
    let dy = dy.abs();
    if dx > dy {
        dx + (dy >> 1)
    } else {
        dy + (dx >> 1)
    }
}

fn evaluate_quadratic_curve(from: [f32; 2], control: [f32; 2], to: [f32; 2], t: f32) -> [f32; 2] {
    let omt = 1.0 - t;
    [
        omt * omt * from[0] + 2.0 * omt * t * control[0] + t * t * to[0],
        omt * omt * from[1] + 2.0 * omt * t * control[1] + t * t * to[1],
    ]
}

fn evaluate_cubic_curve(
    from: [f32; 2],
    control1: [f32; 2],
    control2: [f32; 2],
    to: [f32; 2],
    t: f32,
) -> [f32; 2] {
    let omt = 1.0 - t;
    let omt2 = omt * omt;
    let omt3 = omt2 * omt;
    let t2 = t * t;
    let t3 = t2 * t;
    [
        omt3 * from[0] + 3.0 * omt2 * t * control1[0] + 3.0 * omt * t2 * control2[0] + t3 * to[0],
        omt3 * from[1] + 3.0 * omt2 * t * control1[1] + 3.0 * omt * t2 * control2[1] + t3 * to[1],
    ]
}

fn rasterize_glyph_contours(contours: &[Vec<[f32; 2]>]) -> GlyphBitmap {
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for contour in contours {
        for point in contour {
            min_x = min_x.min(point[0]);
            min_y = min_y.min(point[1]);
            max_x = max_x.max(point[0]);
            max_y = max_y.max(point[1]);
        }
    }
    if !min_x.is_finite() || !min_y.is_finite() || !max_x.is_finite() || !max_y.is_finite() {
        return GlyphBitmap {
            width: 0,
            height: 0,
            stride: 0,
            offset_x: 0,
            offset_y: 0,
            pixels: Vec::new(),
        };
    }

    let offset_x = min_x.floor() as i32;
    let offset_y = min_y.floor() as i32;
    let right = max_x.ceil() as i32;
    let bottom = max_y.ceil() as i32;
    if right <= offset_x || bottom <= offset_y {
        return GlyphBitmap {
            width: 0,
            height: 0,
            stride: 0,
            offset_x,
            offset_y,
            pixels: Vec::new(),
        };
    }

    let width = (right - offset_x) as u32;
    let height = (bottom - offset_y) as u32;
    let mut coverage = vec![0.0f32; (width * height) as usize];
    let subrow_height = 1.0 / GLYPH_RASTER_SUBPIXEL_ROWS as f32;
    let first_subrow = subrow_height * 0.5;
    let clip_left = offset_x as f32;
    let clip_right = clip_left + width as f32;
    let mut spans = Vec::new();

    for y in 0..height as usize {
        let row_offset = y * width as usize;
        for subrow in 0..GLYPH_RASTER_SUBPIXEL_ROWS {
            let sample_y =
                offset_y as f32 + y as f32 + first_subrow + subrow as f32 * subrow_height;
            spans.clear();
            collect_glyph_nonzero_spans(contours, sample_y, &mut spans);
            for &(span_left, span_right) in &spans {
                let left = span_left.max(clip_left);
                let right = span_right.min(clip_right);
                if right <= left {
                    continue;
                }
                accumulate_glyph_span(
                    &mut coverage[row_offset..row_offset + width as usize],
                    offset_x,
                    left,
                    right,
                    subrow_height,
                );
            }
        }
    }

    let pixels = coverage
        .into_iter()
        .map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect();

    GlyphBitmap {
        width,
        height,
        stride: width,
        offset_x,
        offset_y,
        pixels,
    }
}

fn collect_glyph_nonzero_spans(
    contours: &[Vec<[f32; 2]>],
    sample_y: f32,
    spans: &mut Vec<(f32, f32)>,
) {
    let mut events = Vec::new();
    for contour in contours {
        collect_glyph_scanline_intersections(contour, sample_y, |x, winding| {
            events.push((x, winding));
        });
    }
    events.sort_by(|left, right| left.0.total_cmp(&right.0));

    let mut index = 0;
    let mut winding = 0;
    let mut span_start = None;
    while index < events.len() {
        let x = events[index].0;
        let was_filled = winding != 0;
        while index < events.len() && (events[index].0 - x).abs() <= GLYPH_EPSILON {
            winding += events[index].1;
            index += 1;
        }
        let is_filled = winding != 0;
        if !was_filled && is_filled {
            span_start = Some(x);
        } else if was_filled && !is_filled {
            if let Some(start) = span_start.take() {
                if x > start {
                    spans.push((start, x));
                }
            }
        }
    }
}

fn collect_glyph_scanline_intersections(
    points: &[[f32; 2]],
    sample_y: f32,
    mut push: impl FnMut(f32, i32),
) {
    if points.len() < 2 {
        return;
    }
    let mut previous = points[points.len() - 1];
    for &point in points {
        if let Some((x, winding)) = glyph_scanline_intersection(previous, point, sample_y) {
            push(x, winding);
        }
        previous = point;
    }
}

fn glyph_scanline_intersection(from: [f32; 2], to: [f32; 2], sample_y: f32) -> Option<(f32, i32)> {
    if (from[1] - to[1]).abs() <= GLYPH_EPSILON {
        return None;
    }
    let min_y = from[1].min(to[1]);
    let max_y = from[1].max(to[1]);
    if sample_y < min_y || sample_y >= max_y {
        return None;
    }
    let t = (sample_y - from[1]) / (to[1] - from[1]);
    let x = from[0] + (to[0] - from[0]) * t;
    let winding = if to[1] > from[1] { 1 } else { -1 };
    Some((x, winding))
}

fn accumulate_glyph_span(
    row: &mut [f32],
    mask_left: i32,
    span_left: f32,
    span_right: f32,
    span_height: f32,
) {
    let start = span_left.floor() as i32;
    let end = span_right.ceil() as i32;
    for pixel_x in start..end {
        let left = span_left.max(pixel_x as f32);
        let right = span_right.min(pixel_x as f32 + 1.0);
        if right <= left {
            continue;
        }
        let index = pixel_x - mask_left;
        if index < 0 || index >= row.len() as i32 {
            continue;
        }
        row[index as usize] += (right - left) * span_height;
    }
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

fn inset_glyph_sdf(bitmap: &GlyphBitmap, inset: u32) -> GlyphBitmap {
    let inset = inset.clamp(1, SK_DISTANCE_FIELD_PAD);
    if inset == SK_DISTANCE_FIELD_PAD || bitmap.width == 0 || bitmap.height == 0 {
        return bitmap.clone();
    }

    let trim = (SK_DISTANCE_FIELD_PAD - inset) as usize;
    let trimmed_width = bitmap.width.saturating_sub((trim * 2) as u32);
    let trimmed_height = bitmap.height.saturating_sub((trim * 2) as u32);
    if trimmed_width == 0 || trimmed_height == 0 {
        return GlyphBitmap {
            width: 0,
            height: 0,
            stride: 0,
            offset_x: bitmap.offset_x + trim as i32,
            offset_y: bitmap.offset_y + trim as i32,
            pixels: Vec::new(),
        };
    }

    let mut pixels = Vec::with_capacity((trimmed_width * trimmed_height) as usize);
    let stride = bitmap.stride as usize;
    let trimmed_width_usize = trimmed_width as usize;
    for row in 0..trimmed_height as usize {
        let start = ((row + trim) * stride) + trim;
        let end = start + trimmed_width_usize;
        pixels.extend_from_slice(&bitmap.pixels[start..end]);
    }

    GlyphBitmap {
        width: trimmed_width,
        height: trimmed_height,
        stride: trimmed_width,
        offset_x: bitmap.offset_x + trim as i32,
        offset_y: bitmap.offset_y + trim as i32,
        pixels,
    }
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
    let language = input.language.clone().unwrap_or_default();
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
        let access = next_cache_access(state);
        let run = if let Some(cached) = state.shape_cache.get_mut(&cache_key) {
            cached.last_used = access;
            cached.value.clone()
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
                if glyph_count == 0 {
                    let resolved_script_tag = hb_buffer_get_script(buffer);
                    hb_buffer_destroy(buffer);
                    hb_font_destroy(hb_font);
                    empty_shaped_run_state(
                        &input,
                        if script_tag != 0 {
                            script_tag
                        } else {
                            resolved_script_tag
                        },
                    )
                } else if infos.is_null() || positions.is_null() {
                    hb_buffer_destroy(buffer);
                    hb_font_destroy(hb_font);
                    return Ok(None);
                } else {
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
                }
            };
            let byte_size = shaped_run_byte_size(&shaped_run);
            state.shape_cache_bytes += byte_size;
            state.shape_cache.insert(
                cache_key,
                CacheEntry {
                    value: shaped_run.clone(),
                    last_used: access,
                    byte_size,
                },
            );
            purge_lru_cache(&mut state.shape_cache, &mut state.shape_cache_bytes);
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
        let access = next_cache_access(state);
        if let Some(cached) = state.glyph_path_cache.get_mut(&cache_key) {
            cached.last_used = access;
            return Ok(Some(cached.value.clone()));
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
        let verbs = builder.verbs;
        let byte_size = glyph_path_byte_size(&verbs);
        state.glyph_path_cache_bytes += byte_size;
        state.glyph_path_cache.insert(
            cache_key,
            CacheEntry {
                value: verbs.clone(),
                last_used: access,
                byte_size,
            },
        );
        purge_lru_cache(
            &mut state.glyph_path_cache,
            &mut state.glyph_path_cache_bytes,
        );
        Ok(Some(verbs))
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
        let access = next_cache_access(state);
        if let Some(bitmap) = state.glyph_mask_cache.get_mut(&cache_key) {
            bitmap.last_used = access;
            return Ok(Some(GlyphMaskValue {
                cache_key: glyph_mask_cache_key_string(
                    typeface_handle,
                    glyph_id,
                    size,
                    subpixel_offset.x,
                    subpixel_offset.y,
                ),
                width: bitmap.value.width,
                height: bitmap.value.height,
                stride: bitmap.value.stride,
                format: "a8".to_string(),
                offset_x: bitmap.value.offset_x,
                offset_y: bitmap.value.offset_y,
                pixels: bitmap.value.pixels.clone(),
            }));
        }
        let bitmap = {
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
            bitmap
        };
        let byte_size = glyph_bitmap_byte_size(&bitmap);
        state.glyph_mask_cache_bytes += byte_size;
        state.glyph_mask_cache.insert(
            cache_key,
            CacheEntry {
                value: bitmap.clone(),
                last_used: access,
                byte_size,
            },
        );
        purge_lru_cache(
            &mut state.glyph_mask_cache,
            &mut state.glyph_mask_cache_bytes,
        );
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
    let inset = inset.unwrap_or(2).clamp(1, SK_DISTANCE_FIELD_PAD);
    let radius = radius.unwrap_or(4.0).max(1.0);
    with_state_mut(|state| {
        let cache_key = glyph_sdf_cache_key(typeface_handle, glyph_id, size, inset, radius);
        let access = next_cache_access(state);
        if let Some(bitmap) = state.glyph_sdf_cache.get_mut(&cache_key) {
            bitmap.last_used = access;
            return Ok(Some(GlyphMaskValue {
                cache_key: glyph_sdf_cache_key_string(
                    typeface_handle,
                    glyph_id,
                    size,
                    inset,
                    radius,
                ),
                width: bitmap.value.width,
                height: bitmap.value.height,
                stride: bitmap.value.stride,
                format: "a8".to_string(),
                offset_x: bitmap.value.offset_x,
                offset_y: bitmap.value.offset_y,
                pixels: bitmap.value.pixels.clone(),
            }));
        }
        let bitmap = {
            let Some(typeface) = state.typefaces.get(&typeface_handle) else {
                return Ok(None);
            };
            let Some(bitmap) = create_glyph_sdf(typeface, glyph_id, size) else {
                return Ok(None);
            };
            inset_glyph_sdf(&bitmap, inset)
        };
        let byte_size = glyph_bitmap_byte_size(&bitmap);
        state.glyph_sdf_cache_bytes += byte_size;
        state.glyph_sdf_cache.insert(
            cache_key,
            CacheEntry {
                value: bitmap.clone(),
                last_used: access,
                byte_size,
            },
        );
        purge_lru_cache(&mut state.glyph_sdf_cache, &mut state.glyph_sdf_cache_bytes);
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

#[cfg(test)]
mod tests {
    use super::{inset_glyph_sdf, rasterize_glyph_contours, GlyphBitmap};

    #[test]
    fn inset_glyph_sdf_trims_padding_and_offsets() {
        let bitmap = GlyphBitmap {
            width: 12,
            height: 10,
            stride: 12,
            offset_x: -4,
            offset_y: -3,
            pixels: (0..120).map(|value| value as u8).collect(),
        };

        let inset = inset_glyph_sdf(&bitmap, 2);

        assert_eq!(inset.width, 8);
        assert_eq!(inset.height, 6);
        assert_eq!(inset.stride, 8);
        assert_eq!(inset.offset_x, -2);
        assert_eq!(inset.offset_y, -1);
        assert_eq!(inset.pixels.len(), 48);
        assert_eq!(&inset.pixels[0..8], &bitmap.pixels[26..34]);
    }

    #[test]
    fn custom_rasterizer_fills_simple_square() {
        let bitmap = rasterize_glyph_contours(&[vec![
            [0.0, 0.0],
            [4.0, 0.0],
            [4.0, 4.0],
            [0.0, 4.0],
            [0.0, 0.0],
        ]]);

        assert_eq!(bitmap.width, 4);
        assert_eq!(bitmap.height, 4);
        assert_eq!(bitmap.offset_x, 0);
        assert_eq!(bitmap.offset_y, 0);
        assert_eq!(bitmap.stride, 4);
        assert_eq!(bitmap.pixels[5], 255);
        assert_eq!(bitmap.pixels[10], 255);
    }
}
