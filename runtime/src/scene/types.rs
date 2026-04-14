use glam::Mat4;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorValue {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    #[serde(default = "default_alpha")]
    pub a: f32,
}

fn default_alpha() -> f32 {
    1.0
}

impl Default for ColorValue {
    fn default() -> Self {
        Self {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GradientTileMode2D {
    Clamp,
    Repeat,
    Mirror,
    Decal,
}

impl Default for GradientTileMode2D {
    fn default() -> Self {
        Self::Clamp
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop2D {
    pub offset: f32,
    pub color: ColorValue,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PathShader2D {
    #[serde(rename = "linear-gradient")]
    LinearGradient {
        start: [f32; 2],
        end: [f32; 2],
        stops: Vec<GradientStop2D>,
        #[serde(default)]
        tile_mode: GradientTileMode2D,
    },
    #[serde(rename = "radial-gradient")]
    RadialGradient {
        center: [f32; 2],
        radius: f32,
        stops: Vec<GradientStop2D>,
        #[serde(default)]
        tile_mode: GradientTileMode2D,
    },
    #[serde(rename = "two-point-conical-gradient")]
    TwoPointConicalGradient {
        #[serde(rename = "startCenter")]
        start_center: [f32; 2],
        #[serde(rename = "startRadius")]
        start_radius: f32,
        #[serde(rename = "endCenter")]
        end_center: [f32; 2],
        #[serde(rename = "endRadius")]
        end_radius: f32,
        stops: Vec<GradientStop2D>,
        #[serde(default)]
        tile_mode: GradientTileMode2D,
    },
    #[serde(rename = "sweep-gradient")]
    SweepGradient {
        center: [f32; 2],
        #[serde(rename = "startAngle")]
        start_angle: f32,
        #[serde(rename = "endAngle")]
        end_angle: f32,
        stops: Vec<GradientStop2D>,
        #[serde(default)]
        tile_mode: GradientTileMode2D,
    },
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Scene2DHandle {
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Rect2DHandle {
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Path2DHandle {
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Text2DHandle {
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Group2DHandle {
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Scene3DHandle {
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Triangle3DHandle {
    pub id: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene2DOptions {
    #[serde(default)]
    pub clear_color: ColorValue,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group2DOptions {
    #[serde(default = "default_affine_transform_2d")]
    pub transform: [f32; 6],
}

pub type Group2DUpdate = Group2DOptions;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect2DOptions {
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
    #[serde(default = "default_rect_width")]
    pub width: f32,
    #[serde(default = "default_rect_height")]
    pub height: f32,
    #[serde(default = "default_rect_color")]
    pub color: ColorValue,
    #[serde(default = "default_affine_transform_2d")]
    pub transform: [f32; 6],
}

fn default_rect_width() -> f32 {
    100.0
}

fn default_rect_height() -> f32 {
    100.0
}

fn default_rect_color() -> ColorValue {
    ColorValue {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect2DUpdate {
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub width: Option<f32>,
    pub height: Option<f32>,
    pub color: Option<ColorValue>,
    pub transform: Option<[f32; 6]>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PathVerb2D {
    MoveTo {
        to: [f32; 2],
    },
    LineTo {
        to: [f32; 2],
    },
    QuadTo {
        control: [f32; 2],
        to: [f32; 2],
    },
    ConicTo {
        control: [f32; 2],
        to: [f32; 2],
        weight: f32,
    },
    CubicTo {
        control1: [f32; 2],
        control2: [f32; 2],
        to: [f32; 2],
    },
    ArcTo {
        center: [f32; 2],
        radius: f32,
        #[serde(rename = "startAngle")]
        start_angle: f32,
        #[serde(rename = "endAngle")]
        end_angle: f32,
        #[serde(rename = "counterClockwise", default)]
        counter_clockwise: bool,
    },
    Close,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathFillRule2D {
    Nonzero,
    Evenodd,
}

impl Default for PathFillRule2D {
    fn default() -> Self {
        Self::Nonzero
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathStyle2D {
    Fill,
    Stroke,
}

impl Default for PathStyle2D {
    fn default() -> Self {
        Self::Fill
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathStrokeJoin2D {
    Miter,
    Bevel,
    Round,
}

impl Default for PathStrokeJoin2D {
    fn default() -> Self {
        Self::Miter
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathStrokeCap2D {
    Butt,
    Square,
    Round,
}

impl Default for PathStrokeCap2D {
    fn default() -> Self {
        Self::Butt
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Path2DOptions {
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
    #[serde(default)]
    pub verbs: Vec<PathVerb2D>,
    #[serde(default)]
    pub fill_rule: PathFillRule2D,
    #[serde(default)]
    pub style: PathStyle2D,
    #[serde(default = "default_rect_color")]
    pub color: ColorValue,
    #[serde(default)]
    pub shader: Option<PathShader2D>,
    #[serde(default = "default_path_stroke_width")]
    pub stroke_width: f32,
    #[serde(default)]
    pub stroke_join: PathStrokeJoin2D,
    #[serde(default)]
    pub stroke_cap: PathStrokeCap2D,
    #[serde(default)]
    pub dash_array: Vec<f32>,
    #[serde(default)]
    pub dash_offset: f32,
    #[serde(default = "default_affine_transform_2d")]
    pub transform: [f32; 6],
}

fn default_path_stroke_width() -> f32 {
    1.0
}

fn default_affine_transform_2d() -> [f32; 6] {
    [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
}

pub type Path2DUpdate = Path2DOptions;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphMask2DOptions {
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
pub struct DirectMaskGlyph2DOptions {
    pub glyph_id: u32,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub mask: Option<GlyphMask2DOptions>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformedMaskGlyph2DOptions {
    pub glyph_id: u32,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub mask: Option<GlyphMask2DOptions>,
    pub strike_to_source_scale: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdfGlyph2DOptions {
    pub glyph_id: u32,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub mask: Option<GlyphMask2DOptions>,
    #[serde(default)]
    pub sdf: Option<GlyphMask2DOptions>,
    pub sdf_inset: u32,
    pub sdf_radius: f32,
    #[serde(default = "default_text_strike_to_source_scale")]
    pub strike_to_source_scale: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathTextGlyph2DOptions {
    pub glyph_id: u32,
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
    #[serde(default)]
    pub verbs: Vec<PathVerb2D>,
}

fn default_text_strike_to_source_scale() -> f32 {
    1.0
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Text2DOptions {
    #[serde(rename = "direct-mask")]
    DirectMask {
        #[serde(default)]
        x: f32,
        #[serde(default)]
        y: f32,
        #[serde(default = "default_rect_color")]
        color: ColorValue,
        #[serde(default)]
        glyphs: Vec<DirectMaskGlyph2DOptions>,
        #[serde(default = "default_affine_transform_2d")]
        transform: [f32; 6],
    },
    #[serde(rename = "transformed-mask")]
    TransformedMask {
        #[serde(default)]
        x: f32,
        #[serde(default)]
        y: f32,
        #[serde(default = "default_rect_color")]
        color: ColorValue,
        #[serde(default)]
        glyphs: Vec<TransformedMaskGlyph2DOptions>,
        #[serde(default = "default_affine_transform_2d")]
        transform: [f32; 6],
    },
    #[serde(rename = "sdf")]
    Sdf {
        #[serde(default)]
        x: f32,
        #[serde(default)]
        y: f32,
        #[serde(default = "default_rect_color")]
        color: ColorValue,
        #[serde(default)]
        glyphs: Vec<SdfGlyph2DOptions>,
        #[serde(default = "default_affine_transform_2d")]
        transform: [f32; 6],
    },
    #[serde(rename = "path")]
    Path {
        #[serde(default)]
        x: f32,
        #[serde(default)]
        y: f32,
        #[serde(default = "default_rect_color")]
        color: ColorValue,
        #[serde(default)]
        glyphs: Vec<PathTextGlyph2DOptions>,
        #[serde(default = "default_affine_transform_2d")]
        transform: [f32; 6],
    },
    #[serde(rename = "composite")]
    Composite {
        #[serde(default)]
        runs: Vec<Text2DOptions>,
    },
}

pub type Text2DUpdate = Text2DOptions;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DOptions {
    #[serde(default)]
    pub clear_color: ColorValue,
    #[serde(default)]
    pub camera: Camera3DOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera3DOptions {
    #[serde(default = "default_camera_view_projection_matrix")]
    pub view_projection_matrix: [f32; 16],
}

fn default_camera_view_projection_matrix() -> [f32; 16] {
    Mat4::IDENTITY.to_cols_array()
}

impl Default for Camera3DOptions {
    fn default() -> Self {
        Self {
            view_projection_matrix: default_camera_view_projection_matrix(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Triangle3DOptions {
    #[serde(default = "default_triangle_positions")]
    pub positions: [[f32; 3]; 3],
    #[serde(default = "default_triangle_color")]
    pub color: ColorValue,
}

fn default_triangle_positions() -> [[f32; 3]; 3] {
    [[0.0, 100.0, 0.0], [100.0, 100.0, 0.0], [50.0, 0.0, 0.0]]
}

fn default_triangle_color() -> ColorValue {
    ColorValue {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Triangle3DUpdate {
    pub positions: Option<[[f32; 3]; 3]>,
    pub color: Option<ColorValue>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneClearColorOptions {
    pub color: ColorValue,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneCameraUpdate {
    pub view_projection_matrix: Option<[f32; 16]>,
}
