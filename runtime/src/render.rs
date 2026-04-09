use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4};
use serde::{Deserialize, Serialize};
use wgpu::util::DeviceExt;
use winit::{dpi::PhysicalSize, window::Window};

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

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
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
            r: 0.10,
            g: 0.12,
            b: 0.16,
            a: 1.0,
        }
    }
}

impl ColorValue {
    fn to_wgpu(self) -> wgpu::Color {
        wgpu::Color {
            r: self.r as f64,
            g: self.g as f64,
            b: self.b as f64,
            a: self.a as f64,
        }
    }

    fn to_array(self) -> [f32; 4] {
        [self.r, self.g, self.b, self.a]
    }
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
}

fn default_rect_width() -> f32 {
    120.0
}

fn default_rect_height() -> f32 {
    120.0
}

fn default_rect_color() -> ColorValue {
    ColorValue {
        r: 0.25,
        g: 0.65,
        b: 0.95,
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
}

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
    #[serde(default = "default_camera_position")]
    pub position: [f32; 3],
    #[serde(default = "default_camera_target")]
    pub target: [f32; 3],
    #[serde(default = "default_camera_up")]
    pub up: [f32; 3],
    #[serde(default = "default_camera_fov_y_degrees")]
    pub fov_y_degrees: f32,
    #[serde(default = "default_camera_near")]
    pub near: f32,
    #[serde(default = "default_camera_far")]
    pub far: f32,
}

fn default_camera_position() -> [f32; 3] {
    [0.0, 0.0, 3.0]
}

fn default_camera_target() -> [f32; 3] {
    [0.0, 0.0, 0.0]
}

fn default_camera_up() -> [f32; 3] {
    [0.0, 1.0, 0.0]
}

fn default_camera_fov_y_degrees() -> f32 {
    50.0
}

fn default_camera_near() -> f32 {
    0.1
}

fn default_camera_far() -> f32 {
    100.0
}

impl Default for Camera3DOptions {
    fn default() -> Self {
        Self {
            position: default_camera_position(),
            target: default_camera_target(),
            up: default_camera_up(),
            fov_y_degrees: default_camera_fov_y_degrees(),
            near: default_camera_near(),
            far: default_camera_far(),
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
    [[-0.7, -0.6, 0.0], [0.7, -0.6, 0.0], [0.0, 0.7, 0.0]]
}

fn default_triangle_color() -> ColorValue {
    ColorValue {
        r: 0.95,
        g: 0.45,
        b: 0.25,
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
    pub position: Option<[f32; 3]>,
    pub target: Option<[f32; 3]>,
    pub up: Option<[f32; 3]>,
    pub fov_y_degrees: Option<f32>,
    pub near: Option<f32>,
    pub far: Option<f32>,
}

#[derive(Clone, Debug)]
struct Rect2D {
    scene_id: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    color: ColorValue,
}

#[derive(Clone, Debug)]
struct Triangle3D {
    scene_id: u32,
    positions: [[f32; 3]; 3],
    color: ColorValue,
}

#[derive(Clone, Debug)]
struct Scene2D {
    clear_color: ColorValue,
    rect_ids: Vec<u32>,
}

#[derive(Clone, Debug)]
struct Camera3D {
    position: [f32; 3],
    target: [f32; 3],
    up: [f32; 3],
    fov_y_degrees: f32,
    near: f32,
    far: f32,
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

pub struct RenderModel {
    next_scene_id: u32,
    next_object_id: u32,
    active_scene: Option<ActiveScene>,
    scenes_2d: HashMap<u32, Scene2D>,
    rects_2d: HashMap<u32, Rect2D>,
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
                scene_id,
                x: options.x,
                y: options.y,
                width: options.width,
                height: options.height,
                color: options.color,
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
                    position: options.camera.position,
                    target: options.camera.target,
                    up: options.camera.up,
                    fov_y_degrees: options.camera.fov_y_degrees,
                    near: options.camera.near,
                    far: options.camera.far,
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
        if let Some(position) = options.position {
            scene.camera.position = position;
        }
        if let Some(target) = options.target {
            scene.camera.target = target;
        }
        if let Some(up) = options.up {
            scene.camera.up = up;
        }
        if let Some(fov_y_degrees) = options.fov_y_degrees {
            scene.camera.fov_y_degrees = fov_y_degrees;
        }
        if let Some(near) = options.near {
            scene.camera.near = near;
        }
        if let Some(far) = options.far {
            scene.camera.far = far;
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
    pipeline: wgpu::RenderPipeline,
    size: PhysicalSize<u32>,
}

impl RendererState {
    pub fn new(window: Arc<Window>) -> Result<Self> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: preferred_backends(),
            flags: wgpu::InstanceFlags::empty(),
            backend_options: wgpu::BackendOptions::default(),
        });
        let surface = instance
            .create_surface(window.clone())
            .context("failed to create window surface")?;
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

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight geometry shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER_SOURCE.into()),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("goldlight pipeline layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
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

        Ok(Self {
            surface,
            device,
            queue,
            config,
            pipeline,
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
    }

    pub fn render(&mut self, model: &RenderModel) -> Result<()> {
        if self.config.width == 0 || self.config.height == 0 {
            return Ok(());
        }

        let scene_snapshot = match model.active_scene {
            Some(ActiveScene::TwoD(scene_id)) => {
                let scene = model
                    .scenes_2d
                    .get(&scene_id)
                    .ok_or_else(|| anyhow!("missing active 2D scene {scene_id}"))?;
                (
                    scene.clear_color,
                    self.build_scene_2d_vertices(model, scene),
                )
            }
            Some(ActiveScene::ThreeD(scene_id)) => {
                let scene = model
                    .scenes_3d
                    .get(&scene_id)
                    .ok_or_else(|| anyhow!("missing active 3D scene {scene_id}"))?;
                (
                    scene.clear_color,
                    self.build_scene_3d_vertices(model, scene),
                )
            }
            None => (ColorValue::default(), Vec::new()),
        };

        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
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

        let vertex_buffer = if scene_snapshot.1.is_empty() {
            None
        } else {
            Some(
                self.device
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("goldlight vertex buffer"),
                        contents: bytemuck::cast_slice(&scene_snapshot.1),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
            )
        };

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("goldlight render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(scene_snapshot.0.to_wgpu()),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });

            if let Some(vertex_buffer) = &vertex_buffer {
                pass.set_pipeline(&self.pipeline);
                pass.set_vertex_buffer(0, vertex_buffer.slice(..));
                pass.draw(0..scene_snapshot.1.len() as u32, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(())
    }

    fn build_scene_2d_vertices(&self, model: &RenderModel, scene: &Scene2D) -> Vec<Vertex> {
        let width = self.config.width.max(1) as f32;
        let height = self.config.height.max(1) as f32;
        let mut vertices = Vec::new();

        for rect_id in &scene.rect_ids {
            let Some(rect) = model.rects_2d.get(rect_id) else {
                continue;
            };
            let _ = rect.scene_id;
            let left = (rect.x / width) * 2.0 - 1.0;
            let right = ((rect.x + rect.width) / width) * 2.0 - 1.0;
            let top = 1.0 - (rect.y / height) * 2.0;
            let bottom = 1.0 - ((rect.y + rect.height) / height) * 2.0;
            let color = rect.color.to_array();

            let top_left = Vertex {
                position: [left, top, 0.0, 1.0],
                color,
            };
            let top_right = Vertex {
                position: [right, top, 0.0, 1.0],
                color,
            };
            let bottom_left = Vertex {
                position: [left, bottom, 0.0, 1.0],
                color,
            };
            let bottom_right = Vertex {
                position: [right, bottom, 0.0, 1.0],
                color,
            };

            vertices.extend_from_slice(&[
                top_left,
                bottom_left,
                top_right,
                top_right,
                bottom_left,
                bottom_right,
            ]);
        }

        vertices
    }

    fn build_scene_3d_vertices(&self, model: &RenderModel, scene: &Scene3D) -> Vec<Vertex> {
        let width = self.config.width.max(1) as f32;
        let height = self.config.height.max(1) as f32;
        let aspect = width / height;
        let eye = Vec3::from_array(scene.camera.position);
        let target = Vec3::from_array(scene.camera.target);
        let up = Vec3::from_array(scene.camera.up);
        let view = Mat4::look_at_rh(eye, target, up);
        let projection = Mat4::perspective_rh(
            scene.camera.fov_y_degrees.to_radians(),
            aspect,
            scene.camera.near.max(0.001),
            scene.camera.far.max(scene.camera.near + 0.001),
        );
        let view_projection = projection * view;

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
