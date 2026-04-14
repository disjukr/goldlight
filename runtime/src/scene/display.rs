use std::collections::HashMap;
use std::sync::{Arc, Weak};

use anyhow::{anyhow, Context, Result};
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;
use wgpu::TextureFormatFeatureFlags;
use winit::{dpi::PhysicalSize, window::Window};

use super::aggregator::FrameAggregator;
use super::color::to_linear_array;
use super::composition::RootComposer;
use super::content_2d::{
    encode_drawing_command_buffer_with_providers,
    prepare_drawing_recording_with_providers_and_initial_clear, AtlasProvider, DawnSharedContext,
    DrawingPreparedRecording, DrawingRecording, TextAtlasProvider, DRAWING_DEPTH_FORMAT,
};
use super::content_3d::lower_scene_3d_to_geometry;
use super::frame::{
    AggregatedQuad, AggregatedRenderPass, ClipSpaceVertex, ColorLoadOp, CompositorQuad,
    RenderContent, RetainedSurfaceQuad, SurfaceId,
};
use super::model::RenderModel;
use super::surfaces::SurfaceStore;
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

const SURFACE_COMPOSITE_SHADER_SOURCE: &str = r#"
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) source_pixel: vec2<f32>,
  @location(1) texture_size: vec2<f32>,
};

@group(0) @binding(0) var surface_sampler: sampler;
@group(0) @binding(1) var surface_texture: texture_2d<f32>;

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) source_pixel: vec2<f32>,
  @location(2) texture_size: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = position;
  output.source_pixel = source_pixel;
  output.texture_size = texture_size;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.source_pixel.x < 0.0 || input.source_pixel.y < 0.0 ||
      input.source_pixel.x >= input.texture_size.x ||
      input.source_pixel.y >= input.texture_size.y) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  let uv = input.source_pixel / input.texture_size;
  return textureSample(surface_texture, surface_sampler, uv);
}
"#;

fn to_wgpu_color(color: ColorValue) -> wgpu::Color {
    let [r, g, b, a] = to_linear_array(color);
    wgpu::Color {
        r: r as f64,
        g: g as f64,
        b: b as f64,
        a: a as f64,
    }
}

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

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SurfaceCompositeVertex {
    position: [f32; 4],
    source_pixel: [f32; 2],
    texture_size: [f32; 2],
}

impl SurfaceCompositeVertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 3] =
        wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x2, 2 => Float32x2];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<SurfaceCompositeVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
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
    scene_3d_geometry_cache: HashMap<Scene3DGeometryCacheKey, Scene3DGeometryCacheEntry>,
    prepared_recording_cache: HashMap<PreparedRecordingCacheKey, PreparedRecordingCacheEntry>,
    retained_surface_texture_cache: HashMap<SurfaceId, RetainedSurfaceTextureCacheEntry>,
    root_composer: RootComposer,
    surface_store: SurfaceStore,
    frame_aggregator: FrameAggregator,
    geometry_pipeline: wgpu::RenderPipeline,
    surface_composite_bind_group_layout: wgpu::BindGroupLayout,
    surface_composite_sampler: wgpu::Sampler,
    surface_composite_single_pipeline: wgpu::RenderPipeline,
    surface_composite_msaa_pipeline: Option<wgpu::RenderPipeline>,
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
struct FramePreparedRecordingKey {
    surface_id: SurfaceId,
    recording_index: u32,
    initial_clear_bits: Option<[u32; 4]>,
}

type FramePreparedRecordingMap = HashMap<FramePreparedRecordingKey, Arc<DrawingPreparedRecording>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Scene3DGeometryCacheKey {
    scene_id: u32,
}

struct Scene3DGeometryCacheEntry {
    scene_revision: u64,
    geometry: Arc<Vec<ClipSpaceVertex>>,
}

struct RetainedSurfaceTextureCacheEntry {
    frame_revision: u64,
    device_pixel_ratio_bits: u32,
    raster_origin: [f32; 2],
    texture_size: [u32; 2],
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    _depth_target: DepthTarget,
}

struct RenderTarget<'a> {
    target_view: &'a wgpu::TextureView,
    target_size: [u32; 2],
    msaa_target_view: Option<&'a wgpu::TextureView>,
    depth_target_view: Option<&'a wgpu::TextureView>,
    msaa_depth_target_view: Option<&'a wgpu::TextureView>,
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
                    load: wgpu::LoadOp::Clear(to_wgpu_color(clear_color)),
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
    fn color_value_bits(color: ColorValue) -> [u32; 4] {
        [
            color.r.to_bits(),
            color.g.to_bits(),
            color.b.to_bits(),
            color.a.to_bits(),
        ]
    }

    fn create_surface_composite_pipeline(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        shader: &wgpu::ShaderModule,
        pipeline_layout: &wgpu::PipelineLayout,
        sample_count: u32,
    ) -> wgpu::RenderPipeline {
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("goldlight surface composite pipeline"),
            layout: Some(pipeline_layout),
            vertex: wgpu::VertexState {
                module: shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[SurfaceCompositeVertex::layout()],
            },
            fragment: Some(wgpu::FragmentState {
                module: shader,
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
            multisample: wgpu::MultisampleState {
                count: sample_count,
                ..Default::default()
            },
            multiview: None,
            cache: None,
        })
    }

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
        let surface_composite_shader =
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("goldlight surface composite shader"),
                source: wgpu::ShaderSource::Wgsl(SURFACE_COMPOSITE_SHADER_SOURCE.into()),
            });
        let surface_composite_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("goldlight surface composite bind group layout"),
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
        let surface_composite_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("goldlight surface composite sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let surface_composite_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("goldlight surface composite pipeline layout"),
                bind_group_layouts: &[&surface_composite_bind_group_layout],
                push_constant_ranges: &[],
            });
        let surface_composite_single_pipeline = Self::create_surface_composite_pipeline(
            &device,
            format,
            &surface_composite_shader,
            &surface_composite_pipeline_layout,
            1,
        );
        let surface_composite_msaa_pipeline = (msaa_sample_count > 1).then(|| {
            Self::create_surface_composite_pipeline(
                &device,
                format,
                &surface_composite_shader,
                &surface_composite_pipeline_layout,
                msaa_sample_count,
            )
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
            scene_3d_geometry_cache: HashMap::new(),
            prepared_recording_cache: HashMap::new(),
            retained_surface_texture_cache: HashMap::new(),
            root_composer: RootComposer::default(),
            surface_store: SurfaceStore::default(),
            frame_aggregator: FrameAggregator::default(),
            geometry_pipeline,
            surface_composite_bind_group_layout,
            surface_composite_sampler,
            surface_composite_single_pipeline,
            surface_composite_msaa_pipeline,
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
            initial_clear_bits: initial_clear.map(Self::color_value_bits),
        }
    }

    fn frame_prepared_recording_key(
        surface_id: SurfaceId,
        recording_index: u32,
        initial_clear: Option<ColorValue>,
    ) -> FramePreparedRecordingKey {
        FramePreparedRecordingKey {
            surface_id,
            recording_index,
            initial_clear_bits: initial_clear.map(Self::color_value_bits),
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

    fn encode_prepared_recording_to_view(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        prepared: &DrawingPreparedRecording,
        target_view: &wgpu::TextureView,
        msaa_target_view: Option<&wgpu::TextureView>,
        depth_target_view: Option<&wgpu::TextureView>,
        msaa_depth_target_view: Option<&wgpu::TextureView>,
    ) -> Result<()> {
        encode_drawing_command_buffer_with_providers(
            &self.drawing_context,
            prepared,
            Some(&mut self.path_atlas_provider),
            Some(&mut self.text_atlas_provider),
            encoder,
            target_view,
            msaa_target_view,
            depth_target_view,
            msaa_depth_target_view,
        )
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

    fn ensure_root_surfaces(
        &mut self,
        model: &RenderModel,
        device_pixel_ratio: f32,
    ) -> Result<()> {
        fn ensure_node(
            display: &mut DisplayState,
            model: &RenderModel,
            node: &super::model::CompositionNode,
            device_pixel_ratio: f32,
        ) -> Result<()> {
            match node {
                super::model::CompositionNode::Stack { children } => {
                    for child in children {
                        ensure_node(display, model, child, device_pixel_ratio)?;
                    }
                }
                super::model::CompositionNode::Scene2D { scene_id, .. } => {
                    display
                        .surface_store
                        .ensure_scene_2d_surface(model, *scene_id, device_pixel_ratio)?;
                }
                super::model::CompositionNode::Scene3D { scene_id, .. } => {
                    display
                        .surface_store
                        .ensure_scene_3d_surface(model, *scene_id)?;
                }
            }
            Ok(())
        }

        if let Some(root) = model.presented_root.as_ref() {
            ensure_node(self, model, root, device_pixel_ratio)?;
        }
        Ok(())
    }

    fn wgpu_load_op(color_load_op: ColorLoadOp) -> wgpu::LoadOp<wgpu::Color> {
        match color_load_op {
            ColorLoadOp::Load => wgpu::LoadOp::Load,
            ColorLoadOp::Clear(color) => wgpu::LoadOp::Clear(to_wgpu_color(color)),
        }
    }

    fn transparent_color() -> ColorValue {
        ColorValue {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.0,
        }
    }

    fn encode_recording_pass(
        &mut self,
        recording: &Arc<DrawingRecording>,
        color_load_op: ColorLoadOp,
        encoder: &mut wgpu::CommandEncoder,
        target: &RenderTarget<'_>,
    ) -> Result<()> {
        let initial_clear = match color_load_op {
            ColorLoadOp::Load => None,
            ColorLoadOp::Clear(color) => Some(color),
        };
        let prepared =
            self.prepare_recording(recording, target.target_size[0], target.target_size[1], initial_clear);
        self.encode_prepared_recording_to_view(
            encoder,
            prepared.as_ref(),
            target.target_view,
            target.msaa_target_view,
            target.depth_target_view,
            target.msaa_depth_target_view,
        )
    }

    fn surface_recording_target_size(&self, surface_id: SurfaceId) -> Result<[u32; 2]> {
        Ok(match surface_id {
            SurfaceId::Scene2D(_) => [self.config.width, self.config.height],
            SurfaceId::ScrollContainer2D(_) => self.surface_store.get(surface_id)?.raster_size,
            SurfaceId::Scene3D(_) => {
                return Err(anyhow!(
                    "scene 3d surfaces do not expose 2D recordings for msaa analysis"
                ))
            }
        })
    }

    fn prepare_aggregated_frame_recordings(
        &mut self,
        frame: &super::frame::AggregatedFrame,
    ) -> Result<(bool, FramePreparedRecordingMap)> {
        let mut frame_requires_msaa = false;
        let mut prepared_recordings: FramePreparedRecordingMap = HashMap::new();
        for pass in frame.passes() {
            match pass.quad {
                AggregatedQuad::Content(RenderContent::SurfaceRecording {
                    surface_id,
                    recording_index,
                }) => {
                    let initial_clear = match pass.color_load_op {
                        ColorLoadOp::Load => None,
                        ColorLoadOp::Clear(color) => Some(color),
                    };
                    let key =
                        Self::frame_prepared_recording_key(surface_id, recording_index, initial_clear);
                    if let Some(prepared) = prepared_recordings.get(&key) {
                        frame_requires_msaa |= prepared.passes.iter().any(|pass| pass.requires_msaa);
                        continue;
                    }
                    let target_size = self.surface_recording_target_size(surface_id)?;
                    let recording = self
                        .surface_store
                        .get(surface_id)?
                        .recording(recording_index)?
                        .clone();
                    let prepared = self.prepare_recording(
                        &recording,
                        target_size[0],
                        target_size[1],
                        initial_clear,
                    );
                    frame_requires_msaa |= prepared.passes.iter().any(|pass| pass.requires_msaa);
                    prepared_recordings.insert(key, prepared);
                }
                AggregatedQuad::Empty
                | AggregatedQuad::RetainedSurface(_)
                | AggregatedQuad::Content(RenderContent::Scene3D(_)) => {}
            }
        }
        Ok((frame_requires_msaa, prepared_recordings))
    }

    fn create_surface_texture_target(&self, size: [u32; 2]) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("goldlight retained surface texture"),
            size: wgpu::Extent3d {
                width: size[0].max(1),
                height: size[1].max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }

    fn target_clip_position(target_size: [u32; 2], point: [f32; 2]) -> [f32; 4] {
        let width = target_size[0].max(1) as f32;
        let height = target_size[1].max(1) as f32;
        [
            point[0] / width * 2.0 - 1.0,
            1.0 - point[1] / height * 2.0,
            0.0,
            1.0,
        ]
    }

    fn transform_point(transform: [f32; 6], point: [f32; 2]) -> [f32; 2] {
        [
            (transform[0] * point[0]) + (transform[2] * point[1]) + transform[4],
            (transform[1] * point[0]) + (transform[3] * point[1]) + transform[5],
        ]
    }

    fn retained_surface_vertices(
        quad: &RetainedSurfaceQuad,
        raster_origin: [f32; 2],
        texture_size: [u32; 2],
        target_size: [u32; 2],
        device_pixel_ratio: f32,
    ) -> Vec<SurfaceCompositeVertex> {
        let local = [
            [0.0, 0.0],
            [quad.viewport_size[0], 0.0],
            [quad.viewport_size[0], quad.viewport_size[1]],
            [0.0, quad.viewport_size[1]],
        ];
        let destination = local.map(|point| Self::transform_point(quad.transform, point));
        let source = local.map(|point| {
            [
                (point[0] + quad.scroll_offset[0]) * device_pixel_ratio - raster_origin[0],
                (point[1] + quad.scroll_offset[1]) * device_pixel_ratio - raster_origin[1],
            ]
        });
        let texture_size = [
            texture_size[0].max(1) as f32,
            texture_size[1].max(1) as f32,
        ];
        let build = |index: usize| SurfaceCompositeVertex {
            position: Self::target_clip_position(target_size, destination[index]),
            source_pixel: source[index],
            texture_size,
        };
        vec![
            build(0),
            build(1),
            build(2),
            build(0),
            build(2),
            build(3),
        ]
    }

    fn retained_surface_scissor(
        quad: &RetainedSurfaceQuad,
        target_size: [u32; 2],
    ) -> Option<[u32; 4]> {
        let local = [
            [0.0, 0.0],
            [quad.viewport_size[0], 0.0],
            [quad.viewport_size[0], quad.viewport_size[1]],
            [0.0, quad.viewport_size[1]],
        ];
        let transformed = local.map(|point| Self::transform_point(quad.transform, point));
        let left = transformed
            .iter()
            .map(|point| point[0])
            .fold(f32::INFINITY, f32::min)
            .floor()
            .clamp(0.0, target_size[0].max(1) as f32);
        let top = transformed
            .iter()
            .map(|point| point[1])
            .fold(f32::INFINITY, f32::min)
            .floor()
            .clamp(0.0, target_size[1].max(1) as f32);
        let right = transformed
            .iter()
            .map(|point| point[0])
            .fold(f32::NEG_INFINITY, f32::max)
            .ceil()
            .clamp(0.0, target_size[0].max(1) as f32);
        let bottom = transformed
            .iter()
            .map(|point| point[1])
            .fold(f32::NEG_INFINITY, f32::max)
            .ceil()
            .clamp(0.0, target_size[1].max(1) as f32);
        (right > left && bottom > top)
            .then_some([left as u32, top as u32, (right - left) as u32, (bottom - top) as u32])
    }

    fn draw_retained_surface_pass(
        &mut self,
        model: &RenderModel,
        device_pixel_ratio: f32,
        color_load_op: ColorLoadOp,
        quad: &RetainedSurfaceQuad,
        encoder: &mut wgpu::CommandEncoder,
        target: &RenderTarget<'_>,
    ) -> Result<()> {
        let (raster_origin, texture_size, texture_view) = {
            let texture_entry = self.ensure_retained_surface_texture(
                model,
                quad.surface_id,
                device_pixel_ratio,
                encoder,
            )?;
            (
                texture_entry.raster_origin,
                texture_entry.texture_size,
                texture_entry.view.clone(),
            )
        };
        let vertices = Self::retained_surface_vertices(
            quad,
            raster_origin,
            texture_size,
            target.target_size,
            device_pixel_ratio,
        );
        if vertices.is_empty() {
            return Ok(());
        }

        let vertex_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("goldlight retained surface vertices"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("goldlight retained surface bind group"),
            layout: &self.surface_composite_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Sampler(&self.surface_composite_sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&texture_view),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("goldlight retained surface pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target.target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: Self::wgpu_load_op(color_load_op),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });
        if let Some([x, y, width, height]) = Self::retained_surface_scissor(quad, target.target_size)
        {
            pass.set_scissor_rect(x, y, width, height);
        }
        pass.set_pipeline(&self.surface_composite_single_pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.set_vertex_buffer(0, vertex_buffer.slice(..));
        pass.draw(0..vertices.len() as u32, 0..1);
        drop(pass);

        if let Some(msaa_target_view) = target.msaa_target_view {
            if let Some(surface_composite_msaa_pipeline) =
                self.surface_composite_msaa_pipeline.as_ref()
            {
                let mut msaa_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("goldlight retained surface msaa mirror pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: msaa_target_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: Self::wgpu_load_op(color_load_op),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    occlusion_query_set: None,
                    timestamp_writes: None,
                });
                if let Some([x, y, width, height]) =
                    Self::retained_surface_scissor(quad, target.target_size)
                {
                    msaa_pass.set_scissor_rect(x, y, width, height);
                }
                msaa_pass.set_pipeline(surface_composite_msaa_pipeline);
                msaa_pass.set_bind_group(0, &bind_group, &[]);
                msaa_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
                msaa_pass.draw(0..vertices.len() as u32, 0..1);
            }
        }
        Ok(())
    }

    fn ensure_retained_surface_texture(
        &mut self,
        model: &RenderModel,
        surface_id: SurfaceId,
        device_pixel_ratio: f32,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<&RetainedSurfaceTextureCacheEntry> {
        match surface_id {
            SurfaceId::ScrollContainer2D(scroll_container_id) => {
                self.surface_store.ensure_scroll_container_2d_surface(
                    model,
                    scroll_container_id,
                    device_pixel_ratio,
                )?;
            }
            _ => return Err(anyhow!("retained surface compositing is only implemented for scroll surfaces")),
        }

        let device_pixel_ratio_bits = device_pixel_ratio.to_bits();
        let (frame_revision, raster_origin, texture_size, surface_frame) = {
            let surface_entry = self.surface_store.get(surface_id)?;
            (
                surface_entry.frame_revision,
                surface_entry.raster_origin,
                surface_entry.raster_size,
                surface_entry.frame.clone(),
            )
        };
        let is_current = self
            .retained_surface_texture_cache
            .get(&surface_id)
            .is_some_and(|entry| {
                entry.frame_revision == frame_revision
                    && entry.device_pixel_ratio_bits == device_pixel_ratio_bits
            });
        if !is_current {
            let (texture, view) = self.create_surface_texture_target(texture_size);
            let depth_texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("goldlight retained surface depth target"),
                size: wgpu::Extent3d {
                    width: texture_size[0].max(1),
                    height: texture_size[1].max(1),
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: DRAWING_DEPTH_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            let depth_target = DepthTarget {
                view: depth_texture.create_view(&wgpu::TextureViewDescriptor::default()),
                _texture: depth_texture,
            };
            let target = RenderTarget {
                target_view: &view,
                target_size: texture_size,
                msaa_target_view: None,
                depth_target_view: Some(&depth_target.view),
                msaa_depth_target_view: None,
            };
            if surface_frame.passes().is_empty() {
                let mut command_buffer = SceneCommandBuffer {
                    device: &self.device,
                    encoder,
                    target_view: &view,
                    geometry_pipeline: &self.geometry_pipeline,
                };
                command_buffer.encode_clear(Self::transparent_color());
            } else {
                for (index, pass) in surface_frame.passes().iter().enumerate() {
                    let color_load_op = if index == 0 {
                        match pass.color_load_op {
                            ColorLoadOp::Load => ColorLoadOp::Clear(Self::transparent_color()),
                            clear_or_load => clear_or_load,
                        }
                    } else {
                        pass.color_load_op
                    };
                    self.execute_compositor_pass(
                        model,
                        device_pixel_ratio,
                        color_load_op,
                        &pass.quad,
                        encoder,
                        &target,
                    )?;
                }
            }
            self.retained_surface_texture_cache.insert(
                surface_id,
                RetainedSurfaceTextureCacheEntry {
                    frame_revision,
                    device_pixel_ratio_bits,
                    raster_origin,
                    texture_size,
                    _texture: texture,
                    view,
                    _depth_target: depth_target,
                },
            );
        }

        self.retained_surface_texture_cache
            .get(&surface_id)
            .ok_or_else(|| anyhow!("missing retained surface cache entry for {surface_id:?}"))
    }

    fn execute_compositor_pass(
        &mut self,
        model: &RenderModel,
        device_pixel_ratio: f32,
        color_load_op: ColorLoadOp,
        quad: &CompositorQuad,
        encoder: &mut wgpu::CommandEncoder,
        target: &RenderTarget<'_>,
    ) -> Result<()> {
        match quad {
            CompositorQuad::Empty => {
                let ColorLoadOp::Clear(clear_color) = color_load_op else {
                    return Ok(());
                };
                let mut command_buffer = SceneCommandBuffer {
                    device: &self.device,
                    encoder,
                    target_view: target.target_view,
                    geometry_pipeline: &self.geometry_pipeline,
                };
                command_buffer.encode_clear(clear_color);
                Ok(())
            }
            CompositorQuad::SurfaceRef(surface_id) => Err(anyhow!(
                "surface refs must be flattened before execution: {surface_id:?}"
            )),
            CompositorQuad::RetainedSurface(quad) => self.draw_retained_surface_pass(
                model,
                device_pixel_ratio,
                color_load_op,
                quad,
                encoder,
                target,
            ),
            CompositorQuad::Content(content) => match content {
                RenderContent::SurfaceRecording {
                    surface_id,
                    recording_index,
                } => {
                    let recording = self
                        .surface_store
                        .get(*surface_id)?
                        .recording(*recording_index)?
                        .clone();
                    self.encode_recording_pass(&recording, color_load_op, encoder, target)
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
                        target_view: target.target_view,
                        geometry_pipeline: &self.geometry_pipeline,
                    };
                    command_buffer.encode_geometry_3d(Self::wgpu_load_op(color_load_op), &vertices);
                    Ok(())
                }
            },
        }
    }

    fn execute_frame_pass(
        &mut self,
        model: &RenderModel,
        device_pixel_ratio: f32,
        pass: &AggregatedRenderPass,
        prepared_recordings: &FramePreparedRecordingMap,
        encoder: &mut wgpu::CommandEncoder,
        target: &RenderTarget<'_>,
    ) -> Result<()> {
        match &pass.quad {
            AggregatedQuad::Empty => {
                let ColorLoadOp::Clear(clear_color) = pass.color_load_op else {
                    return Ok(());
                };
                let mut command_buffer = SceneCommandBuffer {
                    device: &self.device,
                    encoder,
                    target_view: target.target_view,
                    geometry_pipeline: &self.geometry_pipeline,
                };
                command_buffer.encode_clear(clear_color);
                if let Some(msaa_target_view) = target.msaa_target_view {
                    let mut msaa_command_buffer = SceneCommandBuffer {
                        device: &self.device,
                        encoder,
                        target_view: msaa_target_view,
                        geometry_pipeline: &self.geometry_pipeline,
                    };
                    msaa_command_buffer.encode_clear(clear_color);
                }
            }
            AggregatedQuad::RetainedSurface(quad) => self.draw_retained_surface_pass(
                model,
                device_pixel_ratio,
                pass.color_load_op,
                quad,
                encoder,
                target,
            )?,
            AggregatedQuad::Content(content) => {
                match content {
                    RenderContent::SurfaceRecording {
                        surface_id,
                        recording_index,
                    } => {
                        let initial_clear = match pass.color_load_op {
                            ColorLoadOp::Load => None,
                            ColorLoadOp::Clear(color) => Some(color),
                        };
                        let key = Self::frame_prepared_recording_key(
                            *surface_id,
                            *recording_index,
                            initial_clear,
                        );
                        if let Some(prepared) = prepared_recordings.get(&key) {
                            self.encode_prepared_recording_to_view(
                                encoder,
                                prepared.as_ref(),
                                target.target_view,
                                target.msaa_target_view,
                                target.depth_target_view,
                                target.msaa_depth_target_view,
                            )?;
                        } else {
                            self.execute_compositor_pass(
                                model,
                                device_pixel_ratio,
                                pass.color_load_op,
                                &CompositorQuad::Content(*content),
                                encoder,
                                target,
                            )?;
                        }
                    }
                    RenderContent::Scene3D(_) => {
                        self.execute_compositor_pass(
                            model,
                            device_pixel_ratio,
                            pass.color_load_op,
                            &CompositorQuad::Content(*content),
                            encoder,
                            target,
                        )?;
                    }
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
        self.path_atlas_provider.begin_frame();
        self.text_atlas_provider.begin_frame();
        self.ensure_root_surfaces(model, device_pixel_ratio)?;
        let (root_key, root_frame) = self.root_composer.compose(model)?;
        let aggregated_frame =
            self.frame_aggregator
                .aggregate(root_key, root_frame, &self.surface_store)?;
        let (frame_requires_msaa, prepared_recordings) =
            self.prepare_aggregated_frame_recordings(aggregated_frame.as_ref())?;
        let msaa_color_view = self.msaa_color_target.as_ref().map(|target| target.view.clone());
        let depth_view = self.drawing_depth_target.view.clone();
        let msaa_depth_view = self
            .drawing_msaa_depth_target
            .as_ref()
            .map(|target| target.view.clone());
        let target = RenderTarget {
            target_view: &view,
            target_size: [self.config.width, self.config.height],
            msaa_target_view: frame_requires_msaa.then_some(msaa_color_view.as_ref()).flatten(),
            depth_target_view: Some(&depth_view),
            msaa_depth_target_view: frame_requires_msaa
                .then_some(msaa_depth_view.as_ref())
                .flatten(),
        };
        for pass in aggregated_frame.passes() {
            self.execute_frame_pass(
                model,
                device_pixel_ratio,
                pass,
                &prepared_recordings,
                &mut encoder,
                &target,
            )?;
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
