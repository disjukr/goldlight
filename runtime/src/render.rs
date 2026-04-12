use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec4};
use serde::{Deserialize, Serialize};
use wgpu::TextureFormatFeatureFlags;
use wgpu::util::DeviceExt;
use winit::{dpi::PhysicalSize, window::Window};

use crate::drawing::{
    DRAWING_DEPTH_FORMAT, DawnSharedContext, encode_drawing_command_buffer,
    prepare_drawing_recording, record_scene_2d,
};

const SHADER_SOURCE: &str = r#"
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = position;
  output.color = color;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
"#;

fn preferred_backends() -> wgpu::Backends {
    #[cfg(target_os = "windows")]
    {
        return wgpu::Backends::DX12;
    }

    #[cfg(target_os = "macos")]
    {
        return wgpu::Backends::METAL;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        wgpu::Backends::VULKAN
    }
}

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

impl ColorValue {
    fn srgb_channel_to_linear(value: f32) -> f32 {
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    }

    pub(crate) fn to_srgb_array(self) -> [f32; 4] {
        [self.r, self.g, self.b, self.a]
    }

    pub(crate) fn to_wgpu(self) -> wgpu::Color {
        wgpu::Color {
            r: Self::srgb_channel_to_linear(self.r) as f64,
            g: Self::srgb_channel_to_linear(self.g) as f64,
            b: Self::srgb_channel_to_linear(self.b) as f64,
            a: self.a as f64,
        }
    }

    pub(crate) fn to_array(self) -> [f32; 4] {
        [
            Self::srgb_channel_to_linear(self.r),
            Self::srgb_channel_to_linear(self.g),
            Self::srgb_channel_to_linear(self.b),
            self.a,
        ]
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

#[derive(Clone, Debug)]
pub(crate) struct Rect2D {
    pub _scene_id: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub color: ColorValue,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub(crate) struct Path2D {
    pub _scene_id: u32,
    pub x: f32,
    pub y: f32,
    pub verbs: Vec<PathVerb2D>,
    pub fill_rule: PathFillRule2D,
    pub style: PathStyle2D,
    pub color: ColorValue,
    pub shader: Option<PathShader2D>,
    pub stroke_width: f32,
    pub stroke_join: PathStrokeJoin2D,
    pub stroke_cap: PathStrokeCap2D,
    pub dash_array: Vec<f32>,
    pub dash_offset: f32,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub(crate) struct GlyphMask2D {
    pub _cache_key: String,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub _format: String,
    pub offset_x: i32,
    pub offset_y: i32,
    pub pixels: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct DirectMaskGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub mask: Option<GlyphMask2D>,
}

#[derive(Clone, Debug)]
pub(crate) struct TransformedMaskGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub mask: Option<GlyphMask2D>,
    pub strike_to_source_scale: f32,
}

#[derive(Clone, Debug)]
pub(crate) struct SdfGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub _mask: Option<GlyphMask2D>,
    pub sdf: Option<GlyphMask2D>,
    pub sdf_inset: u32,
    pub _sdf_radius: f32,
    pub strike_to_source_scale: f32,
}

#[derive(Clone, Debug)]
pub(crate) enum Text2D {
    DirectMask {
        _scene_id: u32,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<DirectMaskGlyph2D>,
        transform: [f32; 6],
    },
    TransformedMask {
        _scene_id: u32,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<TransformedMaskGlyph2D>,
        transform: [f32; 6],
    },
    Sdf {
        _scene_id: u32,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<SdfGlyph2D>,
        transform: [f32; 6],
    },
}

#[derive(Clone, Debug)]
struct Triangle3D {
    scene_id: u32,
    positions: [[f32; 3]; 3],
    color: ColorValue,
}

#[derive(Clone, Debug)]
pub(crate) struct Scene2D {
    pub clear_color: ColorValue,
    pub rect_ids: Vec<u32>,
    pub path_ids: Vec<u32>,
    pub text_ids: Vec<u32>,
}

#[derive(Clone, Debug)]
struct Camera3D {
    view_projection_matrix: [f32; 16],
}

#[derive(Clone, Debug)]
struct Scene3D {
    clear_color: ColorValue,
    camera: Camera3D,
    triangle_ids: Vec<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActiveScene {
    TwoD(u32),
    ThreeD(u32),
}

#[derive(Clone)]
pub struct RenderModel {
    next_scene_id: u32,
    next_object_id: u32,
    active_scene: Option<ActiveScene>,
    scenes_2d: HashMap<u32, Scene2D>,
    rects_2d: HashMap<u32, Rect2D>,
    paths_2d: HashMap<u32, Path2D>,
    texts_2d: HashMap<u32, Text2D>,
    scenes_3d: HashMap<u32, Scene3D>,
    triangles_3d: HashMap<u32, Triangle3D>,
}

impl Default for RenderModel {
    fn default() -> Self {
        Self {
            next_scene_id: 1,
            next_object_id: 1,
            active_scene: None,
            scenes_2d: HashMap::new(),
            rects_2d: HashMap::new(),
            paths_2d: HashMap::new(),
            texts_2d: HashMap::new(),
            scenes_3d: HashMap::new(),
            triangles_3d: HashMap::new(),
        }
    }
}

impl RenderModel {
    pub fn create_scene_2d(&mut self, options: Scene2DOptions) -> Scene2DHandle {
        let id = self.next_scene_id;
        self.next_scene_id += 1;
        self.scenes_2d.insert(
            id,
            Scene2D {
                clear_color: options.clear_color,
                rect_ids: Vec::new(),
                path_ids: Vec::new(),
                text_ids: Vec::new(),
            },
        );
        Scene2DHandle { id }
    }

    pub fn scene_2d_set_clear_color(
        &mut self,
        scene_id: u32,
        options: SceneClearColorOptions,
    ) -> Result<()> {
        let scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        scene.clear_color = options.color;
        Ok(())
    }

    pub fn scene_2d_create_rect(
        &mut self,
        scene_id: u32,
        options: Rect2DOptions,
    ) -> Result<Rect2DHandle> {
        let scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.rects_2d.insert(
            id,
            Rect2D {
                _scene_id: scene_id,
                x: options.x,
                y: options.y,
                width: options.width,
                height: options.height,
                color: options.color,
                transform: options.transform,
            },
        );
        scene.rect_ids.push(id);
        Ok(Rect2DHandle { id })
    }

    pub fn rect_2d_update(&mut self, rect_id: u32, options: Rect2DUpdate) -> Result<()> {
        let rect = self
            .rects_2d
            .get_mut(&rect_id)
            .ok_or_else(|| anyhow!("unknown 2D rect {rect_id}"))?;
        if let Some(x) = options.x {
            rect.x = x;
        }
        if let Some(y) = options.y {
            rect.y = y;
        }
        if let Some(width) = options.width {
            rect.width = width;
        }
        if let Some(height) = options.height {
            rect.height = height;
        }
        if let Some(color) = options.color {
            rect.color = color;
        }
        if let Some(transform) = options.transform {
            rect.transform = transform;
        }
        Ok(())
    }

    pub fn scene_2d_create_path(
        &mut self,
        scene_id: u32,
        options: Path2DOptions,
    ) -> Result<Path2DHandle> {
        let scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.paths_2d.insert(
            id,
            Path2D {
                _scene_id: scene_id,
                x: options.x,
                y: options.y,
                verbs: options.verbs,
                fill_rule: options.fill_rule,
                style: options.style,
                color: options.color,
                shader: options.shader,
                stroke_width: options.stroke_width,
                stroke_join: options.stroke_join,
                stroke_cap: options.stroke_cap,
                dash_array: options.dash_array,
                dash_offset: options.dash_offset,
                transform: options.transform,
            },
        );
        scene.path_ids.push(id);
        Ok(Path2DHandle { id })
    }

    pub fn path_2d_update(&mut self, path_id: u32, options: Path2DUpdate) -> Result<()> {
        let path = self
            .paths_2d
            .get_mut(&path_id)
            .ok_or_else(|| anyhow!("unknown 2D path {path_id}"))?;
        path.x = options.x;
        path.y = options.y;
        path.verbs = options.verbs;
        path.fill_rule = options.fill_rule;
        path.style = options.style;
        path.color = options.color;
        path.shader = options.shader;
        path.stroke_width = options.stroke_width;
        path.stroke_join = options.stroke_join;
        path.stroke_cap = options.stroke_cap;
        path.dash_array = options.dash_array;
        path.dash_offset = options.dash_offset;
        path.transform = options.transform;
        Ok(())
    }

    pub fn scene_2d_create_text(
        &mut self,
        scene_id: u32,
        options: Text2DOptions,
    ) -> Result<Text2DHandle> {
        let scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.texts_2d
            .insert(id, text_from_options(scene_id, options));
        scene.text_ids.push(id);
        Ok(Text2DHandle { id })
    }

    pub fn text_2d_update(&mut self, text_id: u32, options: Text2DUpdate) -> Result<()> {
        let scene_id = match self.texts_2d.get(&text_id) {
            Some(Text2D::DirectMask { _scene_id, .. })
            | Some(Text2D::TransformedMask { _scene_id, .. })
            | Some(Text2D::Sdf { _scene_id, .. }) => *_scene_id,
            None => return Err(anyhow!("unknown 2D text {text_id}")),
        };
        self.texts_2d
            .insert(text_id, text_from_options(scene_id, options));
        Ok(())
    }

    pub fn create_scene_3d(&mut self, options: Scene3DOptions) -> Scene3DHandle {
        let id = self.next_scene_id;
        self.next_scene_id += 1;
        self.scenes_3d.insert(
            id,
            Scene3D {
                clear_color: options.clear_color,
                camera: Camera3D {
                    view_projection_matrix: options.camera.view_projection_matrix,
                },
                triangle_ids: Vec::new(),
            },
        );
        Scene3DHandle { id }
    }

    pub fn scene_3d_set_clear_color(
        &mut self,
        scene_id: u32,
        options: SceneClearColorOptions,
    ) -> Result<()> {
        let scene = self
            .scenes_3d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 3D scene {scene_id}"))?;
        scene.clear_color = options.color;
        Ok(())
    }

    pub fn scene_3d_set_camera(&mut self, scene_id: u32, options: SceneCameraUpdate) -> Result<()> {
        let scene = self
            .scenes_3d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 3D scene {scene_id}"))?;
        if let Some(view_projection_matrix) = options.view_projection_matrix {
            scene.camera.view_projection_matrix = view_projection_matrix;
        }
        Ok(())
    }

    pub fn scene_3d_create_triangle(
        &mut self,
        scene_id: u32,
        options: Triangle3DOptions,
    ) -> Result<Triangle3DHandle> {
        let scene = self
            .scenes_3d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 3D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.triangles_3d.insert(
            id,
            Triangle3D {
                scene_id,
                positions: options.positions,
                color: options.color,
            },
        );
        scene.triangle_ids.push(id);
        Ok(Triangle3DHandle { id })
    }

    pub fn triangle_3d_update(
        &mut self,
        triangle_id: u32,
        options: Triangle3DUpdate,
    ) -> Result<()> {
        let triangle = self
            .triangles_3d
            .get_mut(&triangle_id)
            .ok_or_else(|| anyhow!("unknown 3D triangle {triangle_id}"))?;
        if let Some(positions) = options.positions {
            triangle.positions = positions;
        }
        if let Some(color) = options.color {
            triangle.color = color;
        }
        Ok(())
    }

    pub fn present_scene_2d(&mut self, scene_id: u32) -> Result<()> {
        if !self.scenes_2d.contains_key(&scene_id) {
            return Err(anyhow!("unknown 2D scene {scene_id}"));
        }
        self.active_scene = Some(ActiveScene::TwoD(scene_id));
        Ok(())
    }

    pub fn present_scene_3d(&mut self, scene_id: u32) -> Result<()> {
        if !self.scenes_3d.contains_key(&scene_id) {
            return Err(anyhow!("unknown 3D scene {scene_id}"));
        }
        self.active_scene = Some(ActiveScene::ThreeD(scene_id));
        Ok(())
    }
}

fn glyph_mask_from_options(options: GlyphMask2DOptions) -> GlyphMask2D {
    GlyphMask2D {
        _cache_key: options.cache_key,
        width: options.width,
        height: options.height,
        stride: options.stride,
        _format: options.format,
        offset_x: options.offset_x,
        offset_y: options.offset_y,
        pixels: options.pixels,
    }
}

fn text_from_options(scene_id: u32, options: Text2DOptions) -> Text2D {
    match options {
        Text2DOptions::DirectMask {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::DirectMask {
            _scene_id: scene_id,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| DirectMaskGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    mask: glyph.mask.map(glyph_mask_from_options),
                })
                .collect(),
            transform,
        },
        Text2DOptions::TransformedMask {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::TransformedMask {
            _scene_id: scene_id,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| TransformedMaskGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    mask: glyph.mask.map(glyph_mask_from_options),
                    strike_to_source_scale: glyph.strike_to_source_scale,
                })
                .collect(),
            transform,
        },
        Text2DOptions::Sdf {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::Sdf {
            _scene_id: scene_id,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| SdfGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    _mask: glyph.mask.map(glyph_mask_from_options),
                    sdf: glyph.sdf.map(glyph_mask_from_options),
                    sdf_inset: glyph.sdf_inset,
                    _sdf_radius: glyph.sdf_radius,
                    strike_to_source_scale: glyph.strike_to_source_scale,
                })
                .collect(),
            transform,
        },
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    position: [f32; 4],
    color: [f32; 4],
}

impl Vertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

pub struct RendererState {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    msaa_sample_count: u32,
    msaa_color_target: Option<MsaaColorTarget>,
    drawing_depth_target: DepthTarget,
    drawing_msaa_depth_target: Option<DepthTarget>,
    drawing_context: DawnSharedContext,
    geometry_pipeline: wgpu::RenderPipeline,
    size: PhysicalSize<u32>,
}

pub struct RendererBootstrap {
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    size: PhysicalSize<u32>,
}

struct MsaaColorTarget {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}

struct DepthTarget {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}

struct SceneCommandBuffer<'a> {
    device: &'a wgpu::Device,
    encoder: &'a mut wgpu::CommandEncoder,
    target_view: &'a wgpu::TextureView,
    drawing_context: &'a DawnSharedContext,
    geometry_pipeline: &'a wgpu::RenderPipeline,
}

impl<'a> SceneCommandBuffer<'a> {
    fn encode_drawing(
        &mut self,
        prepared: &crate::drawing::DrawingPreparedRecording,
        msaa_target_view: Option<&'a wgpu::TextureView>,
        depth_target_view: Option<&'a wgpu::TextureView>,
        msaa_depth_target_view: Option<&'a wgpu::TextureView>,
    ) -> Result<()> {
        encode_drawing_command_buffer(
            self.drawing_context,
            prepared,
            self.encoder,
            self.target_view,
            msaa_target_view,
            depth_target_view,
            msaa_depth_target_view,
        )
    }

    fn encode_geometry_3d(&mut self, clear_color: ColorValue, vertices: &[Vertex]) {
        let vertex_buffer = if vertices.is_empty() {
            None
        } else {
            Some(
                self.device
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("goldlight geometry vertex buffer"),
                        contents: bytemuck::cast_slice(vertices),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
            )
        };

        let mut pass = self.encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("goldlight geometry render pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: self.target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear_color.to_wgpu()),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });

        if let Some(vertex_buffer) = &vertex_buffer {
            pass.set_pipeline(self.geometry_pipeline);
            pass.set_vertex_buffer(0, vertex_buffer.slice(..));
            pass.draw(0..vertices.len() as u32, 0..1);
        }
    }

    fn encode_clear(&mut self, clear_color: ColorValue) {
        let _ = self.encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("goldlight clear pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: self.target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear_color.to_wgpu()),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });
    }
}

impl RendererState {
    fn choose_sample_count(adapter: &wgpu::Adapter, format: wgpu::TextureFormat) -> u32 {
        let color_features = adapter.get_texture_format_features(format).flags;
        let depth_features = adapter
            .get_texture_format_features(DRAWING_DEPTH_FORMAT)
            .flags;
        if !color_features.contains(TextureFormatFeatureFlags::MULTISAMPLE_RESOLVE) {
            return 1;
        }
        for sample_count in [4, 2] {
            if color_features.sample_count_supported(sample_count)
                && depth_features.sample_count_supported(sample_count)
            {
                return sample_count;
            }
        }
        1
    }

    fn create_msaa_color_target(
        device: &wgpu::Device,
        config: &wgpu::SurfaceConfiguration,
        sample_count: u32,
    ) -> Option<MsaaColorTarget> {
        if sample_count <= 1 {
            return None;
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("goldlight msaa color target"),
            size: wgpu::Extent3d {
                width: config.width.max(1),
                height: config.height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count,
            dimension: wgpu::TextureDimension::D2,
            format: config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Some(MsaaColorTarget {
            _texture: texture,
            view,
        })
    }

    fn create_depth_target(
        device: &wgpu::Device,
        config: &wgpu::SurfaceConfiguration,
        sample_count: u32,
    ) -> DepthTarget {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("goldlight drawing depth target"),
            size: wgpu::Extent3d {
                width: config.width.max(1),
                height: config.height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count,
            dimension: wgpu::TextureDimension::D2,
            format: DRAWING_DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        DepthTarget {
            _texture: texture,
            view,
        }
    }

    pub fn new(bootstrap: RendererBootstrap) -> Result<Self> {
        let RendererBootstrap {
            instance,
            surface,
            size,
        } = bootstrap;
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .context("failed to acquire GPU adapter")?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("goldlight device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .context("failed to acquire GPU device")?;

        let surface_caps = surface.get_capabilities(&adapter);
        let format = surface_caps
            .formats
            .iter()
            .copied()
            .find(|format| format.is_srgb())
            .or_else(|| surface_caps.formats.first().copied())
            .ok_or_else(|| anyhow!("surface has no supported formats"))?;

        let present_mode = surface_caps
            .present_modes
            .iter()
            .copied()
            .find(|mode| *mode == wgpu::PresentMode::Fifo)
            .or_else(|| surface_caps.present_modes.first().copied())
            .ok_or_else(|| anyhow!("surface has no supported present modes"))?;

        let alpha_mode = surface_caps
            .alpha_modes
            .first()
            .copied()
            .ok_or_else(|| anyhow!("surface has no supported alpha modes"))?;

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);
        let msaa_sample_count = Self::choose_sample_count(&adapter, format);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight geometry shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER_SOURCE.into()),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("goldlight pipeline layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let geometry_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("goldlight pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[Vertex::layout()],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });
        let msaa_color_target = Self::create_msaa_color_target(&device, &config, msaa_sample_count);
        let drawing_depth_target = Self::create_depth_target(&device, &config, 1);
        let drawing_msaa_depth_target = (msaa_sample_count > 1)
            .then(|| Self::create_depth_target(&device, &config, msaa_sample_count));
        let drawing_context = DawnSharedContext::new(&device, &queue, format, msaa_sample_count);

        Ok(Self {
            surface,
            device,
            queue,
            config,
            msaa_sample_count,
            msaa_color_target,
            drawing_depth_target,
            drawing_msaa_depth_target,
            drawing_context,
            geometry_pipeline,
            size,
        })
    }

    pub fn resize(&mut self, new_size: PhysicalSize<u32>) {
        if new_size.width == 0 || new_size.height == 0 {
            self.size = new_size;
            return;
        }
        self.size = new_size;
        self.config.width = new_size.width;
        self.config.height = new_size.height;
        self.surface.configure(&self.device, &self.config);
        self.msaa_color_target =
            Self::create_msaa_color_target(&self.device, &self.config, self.msaa_sample_count);
        self.drawing_depth_target = Self::create_depth_target(&self.device, &self.config, 1);
        self.drawing_msaa_depth_target = (self.msaa_sample_count > 1)
            .then(|| Self::create_depth_target(&self.device, &self.config, self.msaa_sample_count));
    }

    pub fn render_clear(&mut self, clear_color: ColorValue) -> Result<bool> {
        if self.config.width == 0 || self.config.height == 0 {
            return Ok(false);
        }

        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                match self.surface.get_current_texture() {
                    Ok(frame) => frame,
                    Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                        return Ok(false);
                    }
                    Err(wgpu::SurfaceError::Timeout) => return Ok(false),
                    Err(error) => {
                        return Err(anyhow!(
                            "failed to acquire clear frame after surface reconfigure: {error}"
                        ));
                    }
                }
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(false),
            Err(error) => return Err(anyhow!("failed to acquire clear frame: {error}")),
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("goldlight clear encoder"),
            });
        let mut command_buffer = SceneCommandBuffer {
            device: &self.device,
            encoder: &mut encoder,
            target_view: &view,
            drawing_context: &self.drawing_context,
            geometry_pipeline: &self.geometry_pipeline,
        };
        command_buffer.encode_clear(clear_color);

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(true)
    }

    pub fn render(&mut self, model: &RenderModel) -> Result<bool> {
        if self.config.width == 0 || self.config.height == 0 {
            return Ok(false);
        }

        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                match self.surface.get_current_texture() {
                    Ok(frame) => frame,
                    Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                        return Ok(false);
                    }
                    Err(wgpu::SurfaceError::Timeout) => return Ok(false),
                    Err(error) => {
                        return Err(anyhow!(
                            "failed to acquire frame after surface reconfigure: {error}"
                        ));
                    }
                }
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(false),
            Err(error) => return Err(anyhow!("failed to acquire frame: {error}")),
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("goldlight render encoder"),
            });
        let mut command_buffer = SceneCommandBuffer {
            device: &self.device,
            encoder: &mut encoder,
            target_view: &view,
            drawing_context: &self.drawing_context,
            geometry_pipeline: &self.geometry_pipeline,
        };
        match model.active_scene {
            Some(ActiveScene::TwoD(scene_id)) => {
                let scene = model
                    .scenes_2d
                    .get(&scene_id)
                    .ok_or_else(|| anyhow!("missing active 2D scene {scene_id}"))?;
                let rects = scene
                    .rect_ids
                    .iter()
                    .filter_map(|rect_id| model.rects_2d.get(rect_id))
                    .cloned()
                    .collect::<Vec<_>>();
                let paths = scene
                    .path_ids
                    .iter()
                    .filter_map(|path_id| model.paths_2d.get(path_id))
                    .cloned()
                    .collect::<Vec<_>>();
                let texts = scene
                    .text_ids
                    .iter()
                    .filter_map(|text_id| model.texts_2d.get(text_id))
                    .cloned()
                    .collect::<Vec<_>>();
                let recording = record_scene_2d(scene, &rects, &paths, &texts);
                let prepared =
                    prepare_drawing_recording(&recording, self.config.width, self.config.height);
                command_buffer.encode_drawing(
                    &prepared,
                    self.msaa_color_target.as_ref().map(|t| &t.view),
                    Some(&self.drawing_depth_target.view),
                    self.drawing_msaa_depth_target.as_ref().map(|t| &t.view),
                )?;
            }
            Some(ActiveScene::ThreeD(scene_id)) => {
                let scene = model
                    .scenes_3d
                    .get(&scene_id)
                    .ok_or_else(|| anyhow!("missing active 3D scene {scene_id}"))?;
                let vertices = self.build_scene_3d_vertices(model, scene);
                command_buffer.encode_geometry_3d(scene.clear_color, &vertices);
            }
            None => {
                command_buffer.encode_clear(ColorValue::default());
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(true)
    }

    fn build_scene_3d_vertices(&self, model: &RenderModel, scene: &Scene3D) -> Vec<Vertex> {
        let view_projection = Mat4::from_cols_array(&scene.camera.view_projection_matrix);

        let mut vertices = Vec::new();
        for triangle_id in &scene.triangle_ids {
            let Some(triangle) = model.triangles_3d.get(triangle_id) else {
                continue;
            };
            let _ = triangle.scene_id;
            let color = triangle.color.to_array();
            for position in triangle.positions {
                let clip = view_projection * Vec4::new(position[0], position[1], position[2], 1.0);
                vertices.push(Vertex {
                    position: clip.to_array(),
                    color,
                });
            }
        }
        vertices
    }
}

impl RendererBootstrap {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: preferred_backends(),
            flags: wgpu::InstanceFlags::empty(),
            backend_options: wgpu::BackendOptions::default(),
        });
        let surface = instance
            .create_surface(window)
            .context("failed to create window surface")?;
        Ok(Self {
            instance,
            surface,
            size,
        })
    }
}
