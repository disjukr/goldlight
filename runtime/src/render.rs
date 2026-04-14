use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec4};
use serde::{Deserialize, Serialize};
use wgpu::util::DeviceExt;
use wgpu::TextureFormatFeatureFlags;
use winit::{dpi::PhysicalSize, window::Window};

use crate::drawing::{
    compute_recording_bounds, encode_drawing_command_buffer_with_providers,
    prepare_drawing_recording_with_providers, record_item_2d, record_item_list_2d,
    DawnSharedContext, DrawingRecorder, DrawingRecording, DRAWING_DEPTH_FORMAT,
};
use crate::path_atlas::AtlasProvider;
use crate::text_atlas::TextAtlasProvider;

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

const RASTER_LAYER_SHADER_SOURCE: &str = r#"
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var layer_sampler: sampler;
@group(0) @binding(1) var layer_texture: texture_2d<f32>;

@vertex
fn vs_main(
  @location(0) position: vec2<f32>,
  @location(1) uv: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = uv;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(layer_texture, layer_sampler, input.uv);
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
    #[serde(default)]
    pub cache_as_raster: bool,
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

#[derive(Clone, Debug)]
pub(crate) struct Rect2D {
    pub _scene_id: u32,
    pub revision: u64,
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
    pub revision: u64,
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
pub(crate) struct PathTextGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub verbs: Vec<PathVerb2D>,
}

#[derive(Clone, Debug)]
pub(crate) enum Text2D {
    DirectMask {
        _scene_id: u32,
        revision: u64,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<DirectMaskGlyph2D>,
        transform: [f32; 6],
    },
    TransformedMask {
        _scene_id: u32,
        revision: u64,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<TransformedMaskGlyph2D>,
        transform: [f32; 6],
    },
    Sdf {
        _scene_id: u32,
        revision: u64,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<SdfGlyph2D>,
        transform: [f32; 6],
    },
    Path {
        _scene_id: u32,
        revision: u64,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<PathTextGlyph2D>,
        transform: [f32; 6],
    },
    Composite {
        _scene_id: u32,
        revision: u64,
        runs: Vec<Text2D>,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct Group2D {
    pub scene_id: u32,
    pub content_revision: u64,
    pub transform_revision: u64,
    pub transform: [f32; 6],
    pub cache_as_raster: bool,
    pub child_item_ids: Vec<u32>,
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
    pub root_item_ids: Vec<u32>,
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
    next_revision: u64,
    active_scene: Option<ActiveScene>,
    pub(crate) scenes_2d: HashMap<u32, Scene2D>,
    pub(crate) rects_2d: HashMap<u32, Rect2D>,
    pub(crate) paths_2d: HashMap<u32, Path2D>,
    pub(crate) texts_2d: HashMap<u32, Text2D>,
    pub(crate) groups_2d: HashMap<u32, Group2D>,
    scenes_3d: HashMap<u32, Scene3D>,
    triangles_3d: HashMap<u32, Triangle3D>,
}

impl Default for RenderModel {
    fn default() -> Self {
        Self {
            next_scene_id: 1,
            next_object_id: 1,
            next_revision: 1,
            active_scene: None,
            scenes_2d: HashMap::new(),
            rects_2d: HashMap::new(),
            paths_2d: HashMap::new(),
            texts_2d: HashMap::new(),
            groups_2d: HashMap::new(),
            scenes_3d: HashMap::new(),
            triangles_3d: HashMap::new(),
        }
    }
}

impl RenderModel {
    fn allocate_revision(&mut self) -> u64 {
        let revision = self.next_revision;
        self.next_revision = self.next_revision.saturating_add(1);
        revision
    }

    pub fn create_scene_2d(&mut self, options: Scene2DOptions) -> Scene2DHandle {
        let id = self.next_scene_id;
        self.next_scene_id += 1;
        self.scenes_2d.insert(
            id,
            Scene2D {
                clear_color: options.clear_color,
                root_item_ids: Vec::new(),
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
        let _scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        let revision = self.allocate_revision();
        self.rects_2d.insert(
            id,
            Rect2D {
                _scene_id: scene_id,
                revision,
                x: options.x,
                y: options.y,
                width: options.width,
                height: options.height,
                color: options.color,
                transform: options.transform,
            },
        );
        Ok(Rect2DHandle { id })
    }

    pub fn rect_2d_update(&mut self, rect_id: u32, options: Rect2DUpdate) -> Result<()> {
        if !self.rects_2d.contains_key(&rect_id) {
            return Err(anyhow!("unknown 2D rect {rect_id}"));
        }
        let revision = self.allocate_revision();
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
        rect.revision = revision;
        Ok(())
    }

    pub fn scene_2d_create_path(
        &mut self,
        scene_id: u32,
        options: Path2DOptions,
    ) -> Result<Path2DHandle> {
        let _scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        let revision = self.allocate_revision();
        self.paths_2d.insert(
            id,
            Path2D {
                _scene_id: scene_id,
                revision,
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
        Ok(Path2DHandle { id })
    }

    pub fn path_2d_update(&mut self, path_id: u32, options: Path2DUpdate) -> Result<()> {
        if !self.paths_2d.contains_key(&path_id) {
            return Err(anyhow!("unknown 2D path {path_id}"));
        }
        let revision = self.allocate_revision();
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
        path.revision = revision;
        Ok(())
    }

    pub fn scene_2d_create_text(
        &mut self,
        scene_id: u32,
        options: Text2DOptions,
    ) -> Result<Text2DHandle> {
        let _scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        let revision = self.allocate_revision();
        self.texts_2d
            .insert(id, text_from_options(scene_id, options, revision));
        Ok(Text2DHandle { id })
    }

    pub fn text_2d_update(&mut self, text_id: u32, options: Text2DUpdate) -> Result<()> {
        let scene_id = match self.texts_2d.get(&text_id) {
            Some(text) => text_scene_id(text),
            None => return Err(anyhow!("unknown 2D text {text_id}")),
        };
        let revision = self.allocate_revision();
        self.texts_2d
            .insert(text_id, text_from_options(scene_id, options, revision));
        Ok(())
    }

    pub fn scene_2d_create_group(
        &mut self,
        scene_id: u32,
        options: Group2DOptions,
    ) -> Result<Group2DHandle> {
        let _scene = self
            .scenes_2d
            .get(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        let revision = self.allocate_revision();
        self.groups_2d.insert(
            id,
            Group2D {
                scene_id,
                content_revision: revision,
                transform_revision: revision,
                transform: options.transform,
                cache_as_raster: options.cache_as_raster,
                child_item_ids: Vec::new(),
            },
        );
        Ok(Group2DHandle { id })
    }

    pub fn group_2d_update(&mut self, group_id: u32, options: Group2DUpdate) -> Result<()> {
        if !self.groups_2d.contains_key(&group_id) {
            return Err(anyhow!("unknown 2D group {group_id}"));
        }
        let revision = self.allocate_revision();
        let group = self
            .groups_2d
            .get_mut(&group_id)
            .ok_or_else(|| anyhow!("unknown 2D group {group_id}"))?;
        if group.transform != options.transform {
            group.transform_revision = revision;
        }
        group.transform = options.transform;
        group.cache_as_raster = options.cache_as_raster;
        Ok(())
    }

    pub fn scene_2d_set_root_items(&mut self, scene_id: u32, root_item_ids: Vec<u32>) -> Result<()> {
        for item_id in &root_item_ids {
            let item_scene_id = self
                .item_2d_scene_id(*item_id)
                .ok_or_else(|| anyhow!("unknown 2D item {item_id}"))?;
            if item_scene_id != scene_id {
                return Err(anyhow!(
                    "2D item {item_id} belongs to scene {item_scene_id}, not {scene_id}"
                ));
            }
        }
        let scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        scene.root_item_ids = root_item_ids;
        Ok(())
    }

    pub fn group_2d_set_children(&mut self, group_id: u32, child_item_ids: Vec<u32>) -> Result<()> {
        let scene_id = self
            .groups_2d
            .get(&group_id)
            .ok_or_else(|| anyhow!("unknown 2D group {group_id}"))?
            .scene_id;
        for item_id in &child_item_ids {
            let item_scene_id = self
                .item_2d_scene_id(*item_id)
                .ok_or_else(|| anyhow!("unknown 2D item {item_id}"))?;
            if item_scene_id != scene_id {
                return Err(anyhow!(
                    "2D item {item_id} belongs to scene {item_scene_id}, not {scene_id}"
                ));
            }
        }
        let revision = self.allocate_revision();
        let group = self
            .groups_2d
            .get_mut(&group_id)
            .ok_or_else(|| anyhow!("unknown 2D group {group_id}"))?;
        group.child_item_ids = child_item_ids;
        group.content_revision = revision;
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

    fn item_2d_scene_id(&self, item_id: u32) -> Option<u32> {
        if let Some(rect) = self.rects_2d.get(&item_id) {
            return Some(rect._scene_id);
        }
        if let Some(path) = self.paths_2d.get(&item_id) {
            return Some(path._scene_id);
        }
        if let Some(text) = self.texts_2d.get(&item_id) {
            return Some(text_scene_id(text));
        }
        self.groups_2d.get(&item_id).map(|group| group.scene_id)
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

fn text_scene_id(text: &Text2D) -> u32 {
    match text {
        Text2D::DirectMask { _scene_id, .. }
        | Text2D::TransformedMask { _scene_id, .. }
        | Text2D::Sdf { _scene_id, .. }
        | Text2D::Path { _scene_id, .. }
        | Text2D::Composite { _scene_id, .. } => *_scene_id,
    }
}

fn text_revision(text: &Text2D) -> u64 {
    match text {
        Text2D::DirectMask { revision, .. }
        | Text2D::TransformedMask { revision, .. }
        | Text2D::Sdf { revision, .. }
        | Text2D::Path { revision, .. }
        | Text2D::Composite { revision, .. } => *revision,
    }
}

fn text_from_options(scene_id: u32, options: Text2DOptions, revision: u64) -> Text2D {
    match options {
        Text2DOptions::DirectMask {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::DirectMask {
            _scene_id: scene_id,
            revision,
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
            revision,
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
            revision,
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
        Text2DOptions::Path {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::Path {
            _scene_id: scene_id,
            revision,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| PathTextGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    verbs: glyph.verbs,
                })
                .collect(),
            transform,
        },
        Text2DOptions::Composite { runs } => Text2D::Composite {
            _scene_id: scene_id,
            revision,
            runs: runs
                .into_iter()
                .map(|run| text_from_options(scene_id, run, revision))
                .collect(),
        },
    }
}

const RASTER_CACHE_EPSILON: f32 = 1e-4;

fn can_cache_group_as_raster(transform: [f32; 6]) -> Option<[i32; 2]> {
    let integer_tx = transform[4].round();
    let integer_ty = transform[5].round();
    let is_translate_only = (transform[0] - 1.0).abs() <= RASTER_CACHE_EPSILON
        && transform[1].abs() <= RASTER_CACHE_EPSILON
        && transform[2].abs() <= RASTER_CACHE_EPSILON
        && (transform[3] - 1.0).abs() <= RASTER_CACHE_EPSILON
        && (transform[4] - integer_tx).abs() <= RASTER_CACHE_EPSILON
        && (transform[5] - integer_ty).abs() <= RASTER_CACHE_EPSILON;
    is_translate_only.then_some([integer_tx as i32, integer_ty as i32])
}

fn multiply_affine_transforms(left: [f32; 6], right: [f32; 6]) -> [f32; 6] {
    [
        (left[0] * right[0]) + (left[2] * right[1]),
        (left[1] * right[0]) + (left[3] * right[1]),
        (left[0] * right[2]) + (left[2] * right[3]),
        (left[1] * right[2]) + (left[3] * right[3]),
        (left[0] * right[4]) + (left[2] * right[5]) + left[4],
        (left[1] * right[4]) + (left[3] * right[5]) + left[5],
    ]
}

fn item_subtree_revision(model: &RenderModel, item_id: u32) -> Option<u64> {
    if let Some(rect) = model.rects_2d.get(&item_id) {
        return Some(rect.revision);
    }
    if let Some(path) = model.paths_2d.get(&item_id) {
        return Some(path.revision);
    }
    if let Some(text) = model.texts_2d.get(&item_id) {
        return Some(text_revision(text));
    }
    if let Some(group) = model.groups_2d.get(&item_id) {
        return Some(group.transform_revision.max(group_content_revision(model, group)));
    }
    None
}

fn max_item_subtree_revision(model: &RenderModel, item_ids: &[u32]) -> u64 {
    item_ids
        .iter()
        .filter_map(|item_id| item_subtree_revision(model, *item_id))
        .max()
        .unwrap_or(0)
}

fn group_content_revision(model: &RenderModel, group: &Group2D) -> u64 {
    group
        .content_revision
        .max(max_item_subtree_revision(model, &group.child_item_ids))
}

#[derive(Clone)]
enum Scene2DPlanStep {
    Direct(DrawingRecording),
    CachedLayer(CachedLayerPlanStep),
}

#[derive(Clone)]
struct CachedLayerPlanStep {
    group_id: u32,
    content_revision: u64,
    translation: [i32; 2],
    local_origin: [i32; 2],
    size: [u32; 2],
    recording: DrawingRecording,
}

fn flush_scene_2d_recorder(recorder: &mut DrawingRecorder, steps: &mut Vec<Scene2DPlanStep>) {
    if recorder.is_empty() {
        return;
    }
    let finished = std::mem::replace(recorder, DrawingRecorder::new()).finish();
    steps.push(Scene2DPlanStep::Direct(finished));
}

fn append_scene_2d_item_plan(
    model: &RenderModel,
    item_id: u32,
    inherited_transform: [f32; 6],
    recorder: &mut DrawingRecorder,
    steps: &mut Vec<Scene2DPlanStep>,
) {
    if let Some(group) = model.groups_2d.get(&item_id) {
        let group_transform = multiply_affine_transforms(inherited_transform, group.transform);
        if group.cache_as_raster {
            if let Some(translation) = can_cache_group_as_raster(group_transform) {
                let mut bounds_recorder = DrawingRecorder::new();
                record_item_list_2d(
                    &mut bounds_recorder,
                    model,
                    &group.child_item_ids,
                    [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                );
                let bounds_recording = bounds_recorder.finish();
                if let Some(bounds) = compute_recording_bounds(&bounds_recording) {
                    let left = bounds.left.floor() as i32;
                    let top = bounds.top.floor() as i32;
                    let right = bounds.right.ceil() as i32;
                    let bottom = bounds.bottom.ceil() as i32;
                    let width = (right - left).max(1) as u32;
                    let height = (bottom - top).max(1) as u32;
                    flush_scene_2d_recorder(recorder, steps);
                    let mut layer_recorder = DrawingRecorder::new();
                    layer_recorder.clear(ColorValue {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 0.0,
                    });
                    record_item_list_2d(
                        &mut layer_recorder,
                        model,
                        &group.child_item_ids,
                        [1.0, 0.0, 0.0, 1.0, -(left as f32), -(top as f32)],
                    );
                    steps.push(Scene2DPlanStep::CachedLayer(CachedLayerPlanStep {
                        group_id: item_id,
                        content_revision: group_content_revision(model, group),
                        translation,
                        local_origin: [left, top],
                        size: [width, height],
                        recording: layer_recorder.finish(),
                    }));
                    return;
                }
            }
        }
        for child_id in &group.child_item_ids {
            append_scene_2d_item_plan(model, *child_id, group_transform, recorder, steps);
        }
        return;
    }

    record_item_2d(recorder, model, item_id, inherited_transform);
}

fn build_scene_2d_plan(
    scene: &Scene2D,
    model: &RenderModel,
    device_pixel_ratio: f32,
) -> Vec<Scene2DPlanStep> {
    let mut steps = Vec::new();
    let mut recorder = DrawingRecorder::new();
    recorder.clear(scene.clear_color);
    // Scene coordinates are authored in CSS pixels, so scale the root transform
    // to the current device-pixel backing resolution before rasterization.
    let root_transform = [
        device_pixel_ratio,
        0.0,
        0.0,
        device_pixel_ratio,
        0.0,
        0.0,
    ];
    for item_id in &scene.root_item_ids {
        append_scene_2d_item_plan(model, *item_id, root_transform, &mut recorder, &mut steps);
    }
    flush_scene_2d_recorder(&mut recorder, &mut steps);
    steps
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

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TexturedVertex {
    position: [f32; 2],
    uv: [f32; 2],
}

impl TexturedVertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

struct RasterLayerResources {
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    pipeline: wgpu::RenderPipeline,
}

struct RasterLayerCacheEntry {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    content_revision: u64,
    size: [u32; 2],
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
    path_atlas_provider: AtlasProvider,
    text_atlas_provider: TextAtlasProvider,
    geometry_pipeline: wgpu::RenderPipeline,
    raster_layer_resources: RasterLayerResources,
    raster_layer_cache: HashMap<u32, RasterLayerCacheEntry>,
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
    geometry_pipeline: &'a wgpu::RenderPipeline,
}

impl<'a> SceneCommandBuffer<'a> {
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

    fn encode_raster_layer(
        &mut self,
        resources: &RasterLayerResources,
        texture_view: &wgpu::TextureView,
        origin: [f32; 2],
        size: [u32; 2],
        surface_width: u32,
        surface_height: u32,
    ) {
        let width = surface_width.max(1) as f32;
        let height = surface_height.max(1) as f32;
        let left = -1.0 + (2.0 * origin[0] / width);
        let top = 1.0 - (2.0 * origin[1] / height);
        let right = -1.0 + (2.0 * (origin[0] + size[0] as f32) / width);
        let bottom = 1.0 - (2.0 * (origin[1] + size[1] as f32) / height);
        let vertices = [
            TexturedVertex {
                position: [left, top],
                uv: [0.0, 0.0],
            },
            TexturedVertex {
                position: [right, top],
                uv: [1.0, 0.0],
            },
            TexturedVertex {
                position: [right, bottom],
                uv: [1.0, 1.0],
            },
            TexturedVertex {
                position: [left, top],
                uv: [0.0, 0.0],
            },
            TexturedVertex {
                position: [right, bottom],
                uv: [1.0, 1.0],
            },
            TexturedVertex {
                position: [left, bottom],
                uv: [0.0, 1.0],
            },
        ];
        let vertex_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("goldlight raster layer vertex buffer"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("goldlight raster layer bind group"),
            layout: &resources.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Sampler(&resources.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(texture_view),
                },
            ],
        });

        let mut pass = self.encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("goldlight raster layer composite pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: self.target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });
        pass.set_pipeline(&resources.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.set_vertex_buffer(0, vertex_buffer.slice(..));
        pass.draw(0..vertices.len() as u32, 0..1);
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

    fn create_raster_layer_texture(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("goldlight raster layer cache texture"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }

    fn create_raster_layer_resources(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
    ) -> RasterLayerResources {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight raster layer shader"),
            source: wgpu::ShaderSource::Wgsl(RASTER_LAYER_SHADER_SOURCE.into()),
        });
        let bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("goldlight raster layer bind group layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                ],
            });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("goldlight raster layer pipeline layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("goldlight raster layer pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[TexturedVertex::layout()],
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
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("goldlight raster layer sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..wgpu::SamplerDescriptor::default()
        });
        RasterLayerResources {
            bind_group_layout,
            sampler,
            pipeline,
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
        let path_atlas_provider = AtlasProvider::new(&device);
        let text_atlas_provider = TextAtlasProvider::new(&device);
        let raster_layer_resources = Self::create_raster_layer_resources(&device, format);

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
            path_atlas_provider,
            text_atlas_provider,
            geometry_pipeline,
            raster_layer_resources,
            raster_layer_cache: HashMap::new(),
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
        self.raster_layer_cache.clear();
    }

    fn encode_recording_to_view(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        recording: &crate::drawing::DrawingRecording,
        target_view: &wgpu::TextureView,
        target_size: [u32; 2],
        msaa_target_view: Option<&wgpu::TextureView>,
        depth_target_view: Option<&wgpu::TextureView>,
        msaa_depth_target_view: Option<&wgpu::TextureView>,
    ) -> Result<()> {
        let prepared = prepare_drawing_recording_with_providers(
            recording,
            target_size[0],
            target_size[1],
            Some(&mut self.path_atlas_provider),
            Some(&mut self.text_atlas_provider),
        );
        encode_drawing_command_buffer_with_providers(
            &self.drawing_context,
            &prepared,
            Some(&mut self.path_atlas_provider),
            Some(&mut self.text_atlas_provider),
            encoder,
            target_view,
            msaa_target_view,
            depth_target_view,
            msaa_depth_target_view,
        )
    }

    fn prepare_cached_layer(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        step: &CachedLayerPlanStep,
    ) -> Result<()> {
        let mut needs_render = false;
        {
            let entry = self
                .raster_layer_cache
                .entry(step.group_id)
                .or_insert_with(|| {
                    let (texture, view) = Self::create_raster_layer_texture(
                        &self.device,
                        self.config.format,
                        step.size[0],
                        step.size[1],
                    );
                    RasterLayerCacheEntry {
                        _texture: texture,
                        view,
                        content_revision: u64::MAX,
                        size: step.size,
                    }
                });
            if entry.size != step.size {
                let (texture, view) = Self::create_raster_layer_texture(
                    &self.device,
                    self.config.format,
                    step.size[0],
                    step.size[1],
                );
                *entry = RasterLayerCacheEntry {
                    _texture: texture,
                    view,
                    content_revision: u64::MAX,
                    size: step.size,
                };
            }
            if entry.content_revision != step.content_revision {
                entry.content_revision = step.content_revision;
                needs_render = true;
            }
        }

        if needs_render {
            let msaa_color = Self::create_msaa_color_target(
                &self.device,
                &wgpu::SurfaceConfiguration {
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    format: self.config.format,
                    width: step.size[0].max(1),
                    height: step.size[1].max(1),
                    present_mode: self.config.present_mode,
                    alpha_mode: self.config.alpha_mode,
                    view_formats: vec![],
                    desired_maximum_frame_latency: self.config.desired_maximum_frame_latency,
                },
                self.msaa_sample_count,
            );
            let depth_target = Self::create_depth_target(
                &self.device,
                &wgpu::SurfaceConfiguration {
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    format: self.config.format,
                    width: step.size[0].max(1),
                    height: step.size[1].max(1),
                    present_mode: self.config.present_mode,
                    alpha_mode: self.config.alpha_mode,
                    view_formats: vec![],
                    desired_maximum_frame_latency: self.config.desired_maximum_frame_latency,
                },
                1,
            );
            let msaa_depth_target = (self.msaa_sample_count > 1).then(|| {
                Self::create_depth_target(
                    &self.device,
                    &wgpu::SurfaceConfiguration {
                        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                        format: self.config.format,
                        width: step.size[0].max(1),
                        height: step.size[1].max(1),
                        present_mode: self.config.present_mode,
                        alpha_mode: self.config.alpha_mode,
                        view_formats: vec![],
                        desired_maximum_frame_latency: self.config.desired_maximum_frame_latency,
                    },
                    self.msaa_sample_count,
                )
            });
            let target_view = self
                .raster_layer_cache
                .get(&step.group_id)
                .ok_or_else(|| anyhow!("missing raster layer cache entry"))?
                .view
                .clone();
            self.encode_recording_to_view(
                encoder,
                &step.recording,
                &target_view,
                step.size,
                msaa_color.as_ref().map(|t| &t.view),
                Some(&depth_target.view),
                msaa_depth_target.as_ref().map(|t| &t.view),
            )?;
        }

        Ok(())
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
            geometry_pipeline: &self.geometry_pipeline,
        };
        command_buffer.encode_clear(clear_color);

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(true)
    }

    pub fn render(&mut self, model: &RenderModel, device_pixel_ratio: f32) -> Result<bool> {
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
        match model.active_scene {
            Some(ActiveScene::TwoD(scene_id)) => {
                let scene = model
                    .scenes_2d
                    .get(&scene_id)
                    .ok_or_else(|| anyhow!("missing active 2D scene {scene_id}"))?;
                self.path_atlas_provider.begin_frame();
                self.text_atlas_provider.begin_frame();
                let plan = build_scene_2d_plan(scene, model, device_pixel_ratio);
                for step in &plan {
                    match step {
                        Scene2DPlanStep::Direct(recording) => {
                            let msaa_color_view =
                                self.msaa_color_target.as_ref().map(|t| t.view.clone());
                            let depth_view = self.drawing_depth_target.view.clone();
                            let msaa_depth_view = self
                                .drawing_msaa_depth_target
                                .as_ref()
                                .map(|t| t.view.clone());
                            self.encode_recording_to_view(
                                &mut encoder,
                                recording,
                                &view,
                                [self.config.width, self.config.height],
                                msaa_color_view.as_ref(),
                                Some(&depth_view),
                                msaa_depth_view.as_ref(),
                            )?;
                        }
                        Scene2DPlanStep::CachedLayer(cached_step) => {
                            self.prepare_cached_layer(&mut encoder, cached_step)?;
                            let cached_view = &self
                                .raster_layer_cache
                                .get(&cached_step.group_id)
                                .ok_or_else(|| anyhow!("missing raster layer cache entry"))?
                                .view;
                            {
                                let mut command_buffer = SceneCommandBuffer {
                                    device: &self.device,
                                    encoder: &mut encoder,
                                    target_view: &view,
                                    geometry_pipeline: &self.geometry_pipeline,
                                };
                                command_buffer.encode_raster_layer(
                                    &self.raster_layer_resources,
                                    cached_view,
                                    [
                                        (cached_step.translation[0] + cached_step.local_origin[0]) as f32,
                                        (cached_step.translation[1] + cached_step.local_origin[1]) as f32,
                                    ],
                                    cached_step.size,
                                    self.config.width,
                                    self.config.height,
                                );
                            }
                        }
                    }
                }
            }
            Some(ActiveScene::ThreeD(scene_id)) => {
                let scene = model
                    .scenes_3d
                    .get(&scene_id)
                    .ok_or_else(|| anyhow!("missing active 3D scene {scene_id}"))?;
                let vertices = self.build_scene_3d_vertices(model, scene);
                let mut command_buffer = SceneCommandBuffer {
                    device: &self.device,
                    encoder: &mut encoder,
                    target_view: &view,
                    geometry_pipeline: &self.geometry_pipeline,
                };
                command_buffer.encode_geometry_3d(scene.clear_color, &vertices);
            }
            None => {
                let mut command_buffer = SceneCommandBuffer {
                    device: &self.device,
                    encoder: &mut encoder,
                    target_view: &view,
                    geometry_pipeline: &self.geometry_pipeline,
                };
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

#[cfg(test)]
mod tests {
    use super::{
        group_content_revision, ColorValue, Group2DOptions, Rect2DOptions, RenderModel,
        Scene2DOptions,
    };

    fn test_scene_options() -> Scene2DOptions {
        Scene2DOptions {
            clear_color: ColorValue {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        }
    }

    fn test_rect_options() -> Rect2DOptions {
        Rect2DOptions {
            x: 0.0,
            y: 0.0,
            width: 64.0,
            height: 48.0,
            color: ColorValue {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 1.0,
            },
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }
    }

    #[test]
    fn group_content_revision_ignores_root_group_transform() {
        let mut model = RenderModel::default();
        let scene_id = model.create_scene_2d(test_scene_options()).id;
        let group_id = model
            .scene_2d_create_group(
                scene_id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    cache_as_raster: true,
                },
            )
            .unwrap()
            .id;
        let rect_id = model
            .scene_2d_create_rect(scene_id, test_rect_options())
            .unwrap()
            .id;
        model.group_2d_set_children(group_id, vec![rect_id]).unwrap();

        let first = {
            let group = model.groups_2d.get(&group_id).unwrap();
            group_content_revision(&model, group)
        };

        model
            .group_2d_update(
                group_id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 24.0, -18.0],
                    cache_as_raster: true,
                },
            )
            .unwrap();

        let second = {
            let group = model.groups_2d.get(&group_id).unwrap();
            group_content_revision(&model, group)
        };

        assert_eq!(first, second);
    }

    #[test]
    fn group_content_revision_tracks_child_and_nested_group_updates() {
        let mut model = RenderModel::default();
        let scene_id = model.create_scene_2d(test_scene_options()).id;
        let root_group_id = model
            .scene_2d_create_group(
                scene_id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    cache_as_raster: true,
                },
            )
            .unwrap()
            .id;
        let nested_group_id = model
            .scene_2d_create_group(
                scene_id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    cache_as_raster: false,
                },
            )
            .unwrap()
            .id;
        let rect_id = model
            .scene_2d_create_rect(scene_id, test_rect_options())
            .unwrap()
            .id;

        model.group_2d_set_children(nested_group_id, vec![rect_id]).unwrap();
        model
            .group_2d_set_children(root_group_id, vec![nested_group_id])
            .unwrap();

        let initial = {
            let group = model.groups_2d.get(&root_group_id).unwrap();
            group_content_revision(&model, group)
        };

        model
            .group_2d_update(
                nested_group_id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 12.0, 8.0],
                    cache_as_raster: false,
                },
            )
            .unwrap();

        let after_nested_group = {
            let group = model.groups_2d.get(&root_group_id).unwrap();
            group_content_revision(&model, group)
        };

        model
            .rect_2d_update(
                rect_id,
                super::Rect2DUpdate {
                    x: None,
                    y: None,
                    width: None,
                    height: None,
                    color: Some(ColorValue {
                        r: 0.2,
                        g: 0.4,
                        b: 0.8,
                        a: 1.0,
                    }),
                    transform: None,
                },
            )
            .unwrap();

        let after_rect = {
            let group = model.groups_2d.get(&root_group_id).unwrap();
            group_content_revision(&model, group)
        };

        assert!(after_nested_group > initial);
        assert!(after_rect > after_nested_group);
    }

    #[test]
    fn group_content_revision_tracks_root_group_structure_updates() {
        let mut model = RenderModel::default();
        let scene_id = model.create_scene_2d(test_scene_options()).id;
        let group_id = model
            .scene_2d_create_group(
                scene_id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    cache_as_raster: true,
                },
            )
            .unwrap()
            .id;
        let first_rect_id = model
            .scene_2d_create_rect(scene_id, test_rect_options())
            .unwrap()
            .id;
        let second_rect_id = model
            .scene_2d_create_rect(scene_id, test_rect_options())
            .unwrap()
            .id;

        model
            .group_2d_set_children(group_id, vec![first_rect_id, second_rect_id])
            .unwrap();

        let initial = {
            let group = model.groups_2d.get(&group_id).unwrap();
            group_content_revision(&model, group)
        };

        model
            .group_2d_set_children(group_id, vec![second_rect_id, first_rect_id])
            .unwrap();

        let after_reorder = {
            let group = model.groups_2d.get(&group_id).unwrap();
            group_content_revision(&model, group)
        };

        model
            .group_2d_set_children(group_id, vec![first_rect_id])
            .unwrap();

        let after_remove = {
            let group = model.groups_2d.get(&group_id).unwrap();
            group_content_revision(&model, group)
        };

        assert!(after_reorder > initial);
        assert!(after_remove > after_reorder);
    }
}
