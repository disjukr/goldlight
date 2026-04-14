use std::collections::HashMap;
use std::sync::{Arc, Weak};

use anyhow::{anyhow, Context, Result};
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;
use wgpu::TextureFormatFeatureFlags;
use winit::{dpi::PhysicalSize, window::Window};

use super::compositor::CompositorState;
use super::drawing::{
    encode_drawing_command_buffer_with_providers,
    prepare_drawing_recording_with_providers_and_initial_clear, AtlasProvider, DawnSharedContext,
    DrawingPreparedRecording, DrawingRecording, TextAtlasProvider, DRAWING_DEPTH_FORMAT,
};
use super::frame::{AggregatedQuad, AggregatedRenderPass, ClipSpaceVertex, ColorLoadOp, RenderContent};
use super::lowering_2d::lower_scene_2d_to_recording;
use super::lowering_3d::lower_scene_3d_to_geometry;
use super::model::RenderModel;
use super::types::ColorValue;

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

impl From<ClipSpaceVertex> for Vertex {
    fn from(value: ClipSpaceVertex) -> Self {
        Self {
            position: value.position,
            color: value.color,
        }
    }
}

pub struct DisplayState {
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
    scene_2d_recording_cache: HashMap<Scene2DRecordingCacheKey, Scene2DRecordingCacheEntry>,
    scene_3d_geometry_cache: HashMap<Scene3DGeometryCacheKey, Scene3DGeometryCacheEntry>,
    prepared_recording_cache: HashMap<PreparedRecordingCacheKey, PreparedRecordingCacheEntry>,
    compositor: CompositorState,
    geometry_pipeline: wgpu::RenderPipeline,
    size: PhysicalSize<u32>,
}

pub struct DisplayBootstrap {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct PreparedRecordingCacheKey {
    recording_ptr: usize,
    surface_width: u32,
    surface_height: u32,
    initial_clear_bits: Option<[u32; 4]>,
}

struct PreparedRecordingCacheEntry {
    recording: Weak<DrawingRecording>,
    prepared: Arc<DrawingPreparedRecording>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Scene2DRecordingCacheKey {
    scene_id: u32,
    device_pixel_ratio_bits: u32,
}

struct Scene2DRecordingCacheEntry {
    scene_revision: u64,
    recording: Arc<DrawingRecording>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Scene3DGeometryCacheKey {
    scene_id: u32,
}

struct Scene3DGeometryCacheEntry {
    scene_revision: u64,
    geometry: Arc<Vec<ClipSpaceVertex>>,
}

struct SceneCommandBuffer<'a> {
    device: &'a wgpu::Device,
    encoder: &'a mut wgpu::CommandEncoder,
    target_view: &'a wgpu::TextureView,
    geometry_pipeline: &'a wgpu::RenderPipeline,
}

impl<'a> SceneCommandBuffer<'a> {
    fn encode_geometry_3d(
        &mut self,
        color_load_op: wgpu::LoadOp<wgpu::Color>,
        vertices: &[Vertex],
    ) {
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
                    load: color_load_op,
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

impl DisplayState {
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

    pub fn new(bootstrap: DisplayBootstrap) -> Result<Self> {
        let DisplayBootstrap {
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
            scene_2d_recording_cache: HashMap::new(),
            scene_3d_geometry_cache: HashMap::new(),
            prepared_recording_cache: HashMap::new(),
            compositor: CompositorState::default(),
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

    fn prepared_recording_cache_key(
        recording: &Arc<DrawingRecording>,
        surface_width: u32,
        surface_height: u32,
        initial_clear: Option<ColorValue>,
    ) -> PreparedRecordingCacheKey {
        PreparedRecordingCacheKey {
            recording_ptr: Arc::as_ptr(recording) as usize,
            surface_width,
            surface_height,
            initial_clear_bits: initial_clear.map(|color| {
                [
                    color.r.to_bits(),
                    color.g.to_bits(),
                    color.b.to_bits(),
                    color.a.to_bits(),
                ]
            }),
        }
    }

    fn prepare_recording(
        &mut self,
        recording: &Arc<DrawingRecording>,
        surface_width: u32,
        surface_height: u32,
        initial_clear: Option<ColorValue>,
    ) -> Arc<DrawingPreparedRecording> {
        let key = Self::prepared_recording_cache_key(
            recording,
            surface_width,
            surface_height,
            initial_clear,
        );
        if let Some(entry) = self.prepared_recording_cache.get(&key) {
            if let Some(cached_recording) = entry.recording.upgrade() {
                if Arc::ptr_eq(&cached_recording, recording) {
                    return entry.prepared.clone();
                }
            }
            self.prepared_recording_cache.remove(&key);
        }

        let prepared = Arc::new(prepare_drawing_recording_with_providers_and_initial_clear(
            recording,
            surface_width,
            surface_height,
            Some(&mut self.path_atlas_provider),
            Some(&mut self.text_atlas_provider),
            initial_clear,
        ));
        if prepared.is_cacheable() {
            self.prepared_recording_cache.insert(
                key,
                PreparedRecordingCacheEntry {
                    recording: Arc::downgrade(recording),
                    prepared: prepared.clone(),
                },
            );
        }
        prepared
    }

    fn encode_recording_to_view(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        recording: &Arc<DrawingRecording>,
        initial_clear: Option<ColorValue>,
        target_view: &wgpu::TextureView,
        target_size: [u32; 2],
        msaa_target_view: Option<&wgpu::TextureView>,
        depth_target_view: Option<&wgpu::TextureView>,
        msaa_depth_target_view: Option<&wgpu::TextureView>,
    ) -> Result<()> {
        let prepared =
            self.prepare_recording(recording, target_size[0], target_size[1], initial_clear);
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

    fn scene_2d_recording(
        &mut self,
        model: &RenderModel,
        scene_id: u32,
        device_pixel_ratio: f32,
    ) -> Result<Arc<DrawingRecording>> {
        let scene = model
            .scenes_2d
            .get(&scene_id)
            .ok_or_else(|| anyhow!("missing presented 2D scene {scene_id}"))?;
        let key = Scene2DRecordingCacheKey {
            scene_id,
            device_pixel_ratio_bits: device_pixel_ratio.to_bits(),
        };
        if let Some(entry) = self.scene_2d_recording_cache.get(&key) {
            if entry.scene_revision == scene.revision {
                return Ok(entry.recording.clone());
            }
        }

        let recording = Arc::new(lower_scene_2d_to_recording(
            model,
            &scene.root_item_ids,
            device_pixel_ratio,
        ));
        self.scene_2d_recording_cache.insert(
            key,
            Scene2DRecordingCacheEntry {
                scene_revision: scene.revision,
                recording: recording.clone(),
            },
        );
        Ok(recording)
    }

    fn scene_3d_geometry(
        &mut self,
        model: &RenderModel,
        scene_id: u32,
    ) -> Result<Arc<Vec<ClipSpaceVertex>>> {
        let scene = model
            .scenes_3d
            .get(&scene_id)
            .ok_or_else(|| anyhow!("missing presented 3D scene {scene_id}"))?;
        let key = Scene3DGeometryCacheKey { scene_id };
        if let Some(entry) = self.scene_3d_geometry_cache.get(&key) {
            if entry.scene_revision == scene.revision {
                return Ok(entry.geometry.clone());
            }
        }

        let geometry = Arc::new(lower_scene_3d_to_geometry(model, scene));
        self.scene_3d_geometry_cache.insert(
            key,
            Scene3DGeometryCacheEntry {
                scene_revision: scene.revision,
                geometry: geometry.clone(),
            },
        );
        Ok(geometry)
    }

    fn execute_frame_pass(
        &mut self,
        model: &RenderModel,
        device_pixel_ratio: f32,
        pass: &AggregatedRenderPass,
        encoder: &mut wgpu::CommandEncoder,
        target_view: &wgpu::TextureView,
    ) -> Result<()> {
        match &pass.quad {
            AggregatedQuad::Empty => {
                let ColorLoadOp::Clear(clear_color) = pass.color_load_op else {
                    return Ok(());
                };
                let mut command_buffer = SceneCommandBuffer {
                    device: &self.device,
                    encoder,
                    target_view,
                    geometry_pipeline: &self.geometry_pipeline,
                };
                command_buffer.encode_clear(clear_color);
                if let Some(msaa_target) = self.msaa_color_target.as_ref() {
                    let mut msaa_command_buffer = SceneCommandBuffer {
                        device: &self.device,
                        encoder,
                        target_view: &msaa_target.view,
                        geometry_pipeline: &self.geometry_pipeline,
                    };
                    msaa_command_buffer.encode_clear(clear_color);
                }
            }
            AggregatedQuad::Content(content) => match content {
                RenderContent::Scene2D(scene_id) => {
                    let recording = self.scene_2d_recording(model, *scene_id, device_pixel_ratio)?;
                    self.path_atlas_provider.begin_frame();
                    self.text_atlas_provider.begin_frame();
                    let msaa_color_view = self.msaa_color_target.as_ref().map(|t| t.view.clone());
                    let depth_view = self.drawing_depth_target.view.clone();
                    let msaa_depth_view = self
                        .drawing_msaa_depth_target
                        .as_ref()
                        .map(|t| t.view.clone());
                    let initial_clear = match pass.color_load_op {
                        ColorLoadOp::Load => None,
                        ColorLoadOp::Clear(color) => Some(color),
                    };
                    self.encode_recording_to_view(
                        encoder,
                        &recording,
                        initial_clear,
                        target_view,
                        [self.config.width, self.config.height],
                        msaa_color_view.as_ref(),
                        Some(&depth_view),
                        msaa_depth_view.as_ref(),
                    )?;
                }
                RenderContent::Scene3D(scene_id) => {
                    let vertices = self
                        .scene_3d_geometry(model, *scene_id)?
                        .iter()
                        .copied()
                        .map(Vertex::from)
                        .collect::<Vec<_>>();
                    let mut command_buffer = SceneCommandBuffer {
                        device: &self.device,
                        encoder,
                        target_view,
                        geometry_pipeline: &self.geometry_pipeline,
                    };
                    let load_op = match pass.color_load_op {
                        ColorLoadOp::Load => wgpu::LoadOp::Load,
                        ColorLoadOp::Clear(color) => wgpu::LoadOp::Clear(color.to_wgpu()),
                    };
                    command_buffer.encode_geometry_3d(load_op, &vertices);
                }
            }
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
        let aggregated_frame = self.compositor.composite(model)?;
        for pass in aggregated_frame.passes() {
            self.execute_frame_pass(model, device_pixel_ratio, pass, &mut encoder, &view)?;
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(true)
    }
}

impl DisplayBootstrap {
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
