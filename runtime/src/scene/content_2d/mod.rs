mod fill_patch;
mod lowering;
mod path_atlas;
mod stroke_patch;
pub(crate) mod svg;
pub(crate) mod text;
mod text_atlas;
mod text_pipeline;
mod vello_compute;

pub(crate) use self::lowering::lower_scene_2d_to_recording;
pub(crate) use self::path_atlas::{AtlasProvider, CoverageMask};
pub(crate) use self::text_atlas::TextAtlasProvider;

use std::f32::consts::PI;
use std::sync::{Arc, OnceLock};

use anyhow::Result;
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use self::fill_patch::{
    curve_fill_shader_source, curve_template_vertices, fill_paint_shader_source,
    prepare_fill_steps, wedge_fill_shader_source, wedge_template_vertices, CurveFillPatchInstance,
    FillStencilMode, FillTriangleMode, PatchResolveVertex, PreparedCurveFillStep, PreparedFillStep,
    PreparedFillTriangleStep, PreparedWedgeFillStep, WedgeFillPatchInstance,
};
use self::stroke_patch::{
    prepare_stroke_patch_step, stroke_patch_shader_source, PreparedStrokePatchStep,
    StrokePatchInstance,
};
use self::text_pipeline::{
    encode_bitmap_text_step, encode_sdf_text_step, prepare_direct_mask_text_step,
    prepare_sdf_text_step, prepare_transformed_mask_text_step, PreparedBitmapTextStep,
    PreparedSdfTextStep, TextPipelineResources,
};
use super::color::{to_linear_array, to_srgb_array};
use crate::scene::{
    ColorValue, GradientStop2D, GradientTileMode2D, PathFillRule2D, PathShader2D, PathStrokeCap2D,
    PathStrokeJoin2D, PathStyle2D, PathVerb2D,
};

const EPSILON: f32 = 1e-5;
const GRADIENT_EPSILON: f32 = 1e-5;
const MAX_GRADIENT_STOPS: usize = 8;
const AA_FRINGE_WIDTH: f32 = 1.0;
const CURVE_FLATNESS_TOLERANCE: f32 = 0.25;
const MAX_CURVE_SUBDIVISION_DEPTH: u32 = 8;
const HAIRLINE_COVERAGE_WIDTH: f32 = 1.0;
const DEFAULT_MITER_LIMIT: f32 = 4.0;
pub(crate) const DRAWING_DEPTH_FORMAT: wgpu::TextureFormat =
    wgpu::TextureFormat::Depth24PlusStencil8;

pub(crate) type Point = [f32; 2];

fn to_wgpu_color(color: ColorValue) -> wgpu::Color {
    let [r, g, b, a] = to_linear_array(color);
    wgpu::Color {
        r: r as f64,
        g: g as f64,
        b: b as f64,
        a: a as f64,
    }
}

fn drawing_shader_source() -> String {
    format!(
        r#"
{paint_shader}

struct VertexOutput {{
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) devicePosition: vec2<f32>,
}};

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
  @location(2) devicePosition: vec2<f32>,
) -> VertexOutput {{
  var output: VertexOutput;
  output.position = position;
  output.color = color;
  output.devicePosition = devicePosition;
  return output;
}}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {{
  return paint_shader_color(input.devicePosition) * input.color;
}}
"#,
        paint_shader = fill_paint_shader_source(0),
    )
}

fn path_mask_shader_source() -> String {
    format!(
        r#"
{paint_shader}

struct VertexOutput {{
  @builtin(position) position: vec4<f32>,
  @location(0) devicePosition: vec2<f32>,
  @location(1) uv: vec2<f32>,
}};

@group(0) @binding(0) var path_mask_sampler: sampler;
@group(0) @binding(1) var path_mask_texture: texture_2d<f32>;

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) devicePosition: vec2<f32>,
  @location(2) uv: vec2<f32>,
) -> VertexOutput {{
  var output: VertexOutput;
  output.position = position;
  output.devicePosition = devicePosition;
  output.uv = uv;
  return output;
}}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {{
  let coverage = textureSample(path_mask_texture, path_mask_sampler, input.uv).r;
  let color = paint_shader_color(input.devicePosition);
  return vec4<f32>(color.rgb, color.a * coverage);
}}
"#,
        paint_shader = fill_paint_shader_source(1),
    )
}

#[derive(Clone)]
pub struct DawnResourceProvider {
    device: wgpu::Device,
    msaa_sample_count: u32,
    triangle_direct_pipeline: Arc<PipelinePair>,
    triangle_depth_pipeline: Arc<PipelinePair>,
    triangle_stencil_evenodd_pipeline: Arc<PipelinePair>,
    triangle_stencil_nonzero_pipeline: Arc<PipelinePair>,
    triangle_stencil_cover_pipeline: Arc<PipelinePair>,
    wedge_direct_pipeline: Arc<PipelinePair>,
    wedge_stencil_evenodd_pipeline: Arc<PipelinePair>,
    wedge_stencil_nonzero_pipeline: Arc<PipelinePair>,
    curve_stencil_evenodd_pipeline: Arc<PipelinePair>,
    curve_stencil_nonzero_pipeline: Arc<PipelinePair>,
    stroke_pipeline: Arc<PipelinePair>,
    path_mask_pipeline: Arc<PipelinePair>,
    wedge_template_buffer: wgpu::Buffer,
    wedge_template_vertex_count: u32,
    curve_template_buffer: wgpu::Buffer,
    curve_template_vertex_count: u32,
    viewport_bind_group_layout: Arc<wgpu::BindGroupLayout>,
    fill_paint_bind_group_layout: Arc<wgpu::BindGroupLayout>,
    path_mask_bind_group_layout: Arc<wgpu::BindGroupLayout>,
    path_mask_sampler: wgpu::Sampler,
    text_resources: TextPipelineResources,
}

struct PipelinePair {
    _name: &'static str,
    create_pipeline: Arc<dyn Fn(u32) -> wgpu::RenderPipeline + Send + Sync>,
    single: OnceLock<Arc<wgpu::RenderPipeline>>,
    msaa: OnceLock<Arc<wgpu::RenderPipeline>>,
    msaa_sample_count: u32,
}

impl PipelinePair {
    fn new(
        name: &'static str,
        create_pipeline: impl Fn(u32) -> wgpu::RenderPipeline + Send + Sync + 'static,
        msaa_sample_count: u32,
    ) -> Self {
        Self {
            _name: name,
            create_pipeline: Arc::new(create_pipeline),
            single: OnceLock::new(),
            msaa: OnceLock::new(),
            msaa_sample_count,
        }
    }

    fn get(&self, sample_count: u32) -> Arc<wgpu::RenderPipeline> {
        if sample_count > 1 && self.msaa_sample_count > 1 {
            return self.msaa.get_or_init(|| self.create(sample_count)).clone();
        }
        self.single.get_or_init(|| self.create(1)).clone()
    }

    fn create(&self, sample_count: u32) -> Arc<wgpu::RenderPipeline> {
        Arc::new((self.create_pipeline)(sample_count))
    }
}

#[derive(Clone, Copy)]
enum TrianglePipelineKind {
    Direct,
    DirectDepth,
    StencilEvenodd,
    StencilNonzero,
    StencilCover,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PipelineWarmupKey {
    Triangle {
        sample_count: u32,
        mode: TriangleStepMode,
    },
    Wedge {
        sample_count: u32,
        stencil_mode: Option<FillStencilMode>,
    },
    Curve {
        sample_count: u32,
        stencil_mode: FillStencilMode,
    },
    Stroke {
        sample_count: u32,
    },
    PathMask {
        sample_count: u32,
    },
    BitmapText {
        sample_count: u32,
    },
    SdfText {
        sample_count: u32,
    },
}

fn create_triangle_render_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    shader: &wgpu::ShaderModule,
    pipeline_layout: &wgpu::PipelineLayout,
    sample_count: u32,
    kind: TrianglePipelineKind,
) -> wgpu::RenderPipeline {
    let (depth_stencil, write_mask) = triangle_pipeline_state(kind);
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("goldlight drawing pipeline"),
        layout: Some(pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[DrawingVertex::layout()],
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask,
            })],
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil,
        multisample: wgpu::MultisampleState {
            count: sample_count,
            ..wgpu::MultisampleState::default()
        },
        multiview: None,
        cache: None,
    })
}

fn create_wedge_render_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    shader: &wgpu::ShaderModule,
    pipeline_layout: &wgpu::PipelineLayout,
    sample_count: u32,
    stencil_mode: Option<FillStencilMode>,
) -> wgpu::RenderPipeline {
    let (depth_stencil, write_mask) = patch_pipeline_state(stencil_mode);
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("goldlight wedge fill patch pipeline"),
        layout: Some(pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[
                PatchResolveVertex::layout(),
                WedgeFillPatchInstance::layout(),
            ],
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask,
            })],
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil,
        multisample: wgpu::MultisampleState {
            count: sample_count,
            ..wgpu::MultisampleState::default()
        },
        multiview: None,
        cache: None,
    })
}

fn create_curve_render_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    shader: &wgpu::ShaderModule,
    pipeline_layout: &wgpu::PipelineLayout,
    sample_count: u32,
    stencil_mode: FillStencilMode,
) -> wgpu::RenderPipeline {
    let (depth_stencil, write_mask) = patch_pipeline_state(Some(stencil_mode));
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("goldlight curve fill patch pipeline"),
        layout: Some(pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[
                PatchResolveVertex::layout(),
                CurveFillPatchInstance::layout(),
            ],
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask,
            })],
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil,
        multisample: wgpu::MultisampleState {
            count: sample_count,
            ..wgpu::MultisampleState::default()
        },
        multiview: None,
        cache: None,
    })
}

fn create_stroke_render_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    shader: &wgpu::ShaderModule,
    pipeline_layout: &wgpu::PipelineLayout,
    sample_count: u32,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("goldlight stroke patch pipeline"),
        layout: Some(pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[StrokePatchInstance::layout()],
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
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleStrip,
            ..wgpu::PrimitiveState::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DRAWING_DEPTH_FORMAT,
            depth_write_enabled: true,
            depth_compare: wgpu::CompareFunction::Less,
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        }),
        multisample: wgpu::MultisampleState {
            count: sample_count,
            ..wgpu::MultisampleState::default()
        },
        multiview: None,
        cache: None,
    })
}

fn create_path_mask_render_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    shader: &wgpu::ShaderModule,
    pipeline_layout: &wgpu::PipelineLayout,
    sample_count: u32,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("goldlight path mask pipeline"),
        layout: Some(pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[PathMaskVertex::layout()],
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
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DRAWING_DEPTH_FORMAT,
            depth_write_enabled: true,
            depth_compare: wgpu::CompareFunction::Less,
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        }),
        multisample: wgpu::MultisampleState {
            count: sample_count,
            ..wgpu::MultisampleState::default()
        },
        multiview: None,
        cache: None,
    })
}

impl DawnResourceProvider {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat, msaa_sample_count: u32) -> Self {
        let device = device.clone();
        let triangle_shader_source = drawing_shader_source();
        let triangle_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight drawing shader"),
            source: wgpu::ShaderSource::Wgsl(triangle_shader_source.into()),
        });
        let viewport_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("goldlight stroke viewport bind group layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let fill_paint_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("goldlight fill paint bind group layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let path_mask_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("goldlight path mask bind group layout"),
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
        let path_mask_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("goldlight path mask sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let triangle_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("goldlight drawing pipeline layout"),
                bind_group_layouts: &[&fill_paint_bind_group_layout],
                push_constant_ranges: &[],
            });
        let wedge_shader_source = wedge_fill_shader_source();
        let wedge_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight wedge fill patch shader"),
            source: wgpu::ShaderSource::Wgsl(wedge_shader_source.into()),
        });
        let curve_shader_source = curve_fill_shader_source();
        let curve_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight curve fill patch shader"),
            source: wgpu::ShaderSource::Wgsl(curve_shader_source.into()),
        });
        let stroke_shader_source = stroke_patch_shader_source();
        let stroke_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight stroke patch shader"),
            source: wgpu::ShaderSource::Wgsl(stroke_shader_source.into()),
        });
        let path_mask_shader_source = path_mask_shader_source();
        let path_mask_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight path mask shader"),
            source: wgpu::ShaderSource::Wgsl(path_mask_shader_source.into()),
        });
        let fill_patch_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("goldlight fill patch pipeline layout"),
                bind_group_layouts: &[&viewport_bind_group_layout, &fill_paint_bind_group_layout],
                push_constant_ranges: &[],
            });
        let stroke_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("goldlight stroke patch pipeline layout"),
                bind_group_layouts: &[&viewport_bind_group_layout],
                push_constant_ranges: &[],
            });
        let path_mask_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("goldlight path mask pipeline layout"),
                bind_group_layouts: &[&path_mask_bind_group_layout, &fill_paint_bind_group_layout],
                push_constant_ranges: &[],
            });
        let wedge_template_vertices = wedge_template_vertices();
        let wedge_template_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("goldlight wedge fill template buffer"),
            contents: bytemuck::cast_slice(&wedge_template_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let curve_template_vertices = curve_template_vertices();
        let curve_template_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("goldlight curve fill template buffer"),
            contents: bytemuck::cast_slice(&curve_template_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let triangle_direct_pipeline = Arc::new(PipelinePair::new(
            "triangle direct",
            {
                let device = device.clone();
                let triangle_shader = triangle_shader.clone();
                let triangle_pipeline_layout = triangle_pipeline_layout.clone();
                move |sample_count| {
                    create_triangle_render_pipeline(
                        &device,
                        format,
                        &triangle_shader,
                        &triangle_pipeline_layout,
                        sample_count,
                        TrianglePipelineKind::Direct,
                    )
                }
            },
            msaa_sample_count,
        ));
        let triangle_depth_pipeline = Arc::new(PipelinePair::new(
            "triangle direct depth",
            {
                let device = device.clone();
                let triangle_shader = triangle_shader.clone();
                let triangle_pipeline_layout = triangle_pipeline_layout.clone();
                move |sample_count| {
                    create_triangle_render_pipeline(
                        &device,
                        format,
                        &triangle_shader,
                        &triangle_pipeline_layout,
                        sample_count,
                        TrianglePipelineKind::DirectDepth,
                    )
                }
            },
            msaa_sample_count,
        ));
        let triangle_stencil_evenodd_pipeline = Arc::new(PipelinePair::new(
            "triangle stencil evenodd",
            {
                let device = device.clone();
                let triangle_shader = triangle_shader.clone();
                let triangle_pipeline_layout = triangle_pipeline_layout.clone();
                move |sample_count| {
                    create_triangle_render_pipeline(
                        &device,
                        format,
                        &triangle_shader,
                        &triangle_pipeline_layout,
                        sample_count,
                        TrianglePipelineKind::StencilEvenodd,
                    )
                }
            },
            msaa_sample_count,
        ));
        let triangle_stencil_nonzero_pipeline = Arc::new(PipelinePair::new(
            "triangle stencil nonzero",
            {
                let device = device.clone();
                let triangle_shader = triangle_shader.clone();
                let triangle_pipeline_layout = triangle_pipeline_layout.clone();
                move |sample_count| {
                    create_triangle_render_pipeline(
                        &device,
                        format,
                        &triangle_shader,
                        &triangle_pipeline_layout,
                        sample_count,
                        TrianglePipelineKind::StencilNonzero,
                    )
                }
            },
            msaa_sample_count,
        ));
        let triangle_stencil_cover_pipeline = Arc::new(PipelinePair::new(
            "triangle stencil cover",
            {
                let device = device.clone();
                let triangle_shader = triangle_shader.clone();
                let triangle_pipeline_layout = triangle_pipeline_layout.clone();
                move |sample_count| {
                    create_triangle_render_pipeline(
                        &device,
                        format,
                        &triangle_shader,
                        &triangle_pipeline_layout,
                        sample_count,
                        TrianglePipelineKind::StencilCover,
                    )
                }
            },
            msaa_sample_count,
        ));
        let wedge_direct_pipeline = Arc::new(PipelinePair::new(
            "wedge direct",
            {
                let device = device.clone();
                let wedge_shader = wedge_shader.clone();
                let fill_patch_pipeline_layout = fill_patch_pipeline_layout.clone();
                move |sample_count| {
                    create_wedge_render_pipeline(
                        &device,
                        format,
                        &wedge_shader,
                        &fill_patch_pipeline_layout,
                        sample_count,
                        None,
                    )
                }
            },
            msaa_sample_count,
        ));
        let wedge_stencil_evenodd_pipeline = Arc::new(PipelinePair::new(
            "wedge stencil evenodd",
            {
                let device = device.clone();
                let wedge_shader = wedge_shader.clone();
                let fill_patch_pipeline_layout = fill_patch_pipeline_layout.clone();
                move |sample_count| {
                    create_wedge_render_pipeline(
                        &device,
                        format,
                        &wedge_shader,
                        &fill_patch_pipeline_layout,
                        sample_count,
                        Some(FillStencilMode::Evenodd),
                    )
                }
            },
            msaa_sample_count,
        ));
        let wedge_stencil_nonzero_pipeline = Arc::new(PipelinePair::new(
            "wedge stencil nonzero",
            {
                let device = device.clone();
                let wedge_shader = wedge_shader.clone();
                let fill_patch_pipeline_layout = fill_patch_pipeline_layout.clone();
                move |sample_count| {
                    create_wedge_render_pipeline(
                        &device,
                        format,
                        &wedge_shader,
                        &fill_patch_pipeline_layout,
                        sample_count,
                        Some(FillStencilMode::Nonzero),
                    )
                }
            },
            msaa_sample_count,
        ));
        let curve_stencil_evenodd_pipeline = Arc::new(PipelinePair::new(
            "curve stencil evenodd",
            {
                let device = device.clone();
                let curve_shader = curve_shader.clone();
                let fill_patch_pipeline_layout = fill_patch_pipeline_layout.clone();
                move |sample_count| {
                    create_curve_render_pipeline(
                        &device,
                        format,
                        &curve_shader,
                        &fill_patch_pipeline_layout,
                        sample_count,
                        FillStencilMode::Evenodd,
                    )
                }
            },
            msaa_sample_count,
        ));
        let curve_stencil_nonzero_pipeline = Arc::new(PipelinePair::new(
            "curve stencil nonzero",
            {
                let device = device.clone();
                let curve_shader = curve_shader.clone();
                let fill_patch_pipeline_layout = fill_patch_pipeline_layout.clone();
                move |sample_count| {
                    create_curve_render_pipeline(
                        &device,
                        format,
                        &curve_shader,
                        &fill_patch_pipeline_layout,
                        sample_count,
                        FillStencilMode::Nonzero,
                    )
                }
            },
            msaa_sample_count,
        ));
        let stroke_pipeline = Arc::new(PipelinePair::new(
            "stroke",
            {
                let device = device.clone();
                let stroke_shader = stroke_shader.clone();
                let stroke_pipeline_layout = stroke_pipeline_layout.clone();
                move |sample_count| {
                    create_stroke_render_pipeline(
                        &device,
                        format,
                        &stroke_shader,
                        &stroke_pipeline_layout,
                        sample_count,
                    )
                }
            },
            msaa_sample_count,
        ));
        let path_mask_pipeline = Arc::new(PipelinePair::new(
            "path mask",
            {
                let device = device.clone();
                let path_mask_shader = path_mask_shader.clone();
                let path_mask_pipeline_layout = path_mask_pipeline_layout.clone();
                move |sample_count| {
                    create_path_mask_render_pipeline(
                        &device,
                        format,
                        &path_mask_shader,
                        &path_mask_pipeline_layout,
                        sample_count,
                    )
                }
            },
            msaa_sample_count,
        ));
        let text_resources = TextPipelineResources::new(&device, format, msaa_sample_count);

        Self {
            device: device.clone(),
            msaa_sample_count,
            triangle_direct_pipeline,
            triangle_depth_pipeline,
            triangle_stencil_evenodd_pipeline,
            triangle_stencil_nonzero_pipeline,
            triangle_stencil_cover_pipeline,
            wedge_direct_pipeline,
            wedge_stencil_evenodd_pipeline,
            wedge_stencil_nonzero_pipeline,
            curve_stencil_evenodd_pipeline,
            curve_stencil_nonzero_pipeline,
            stroke_pipeline,
            path_mask_pipeline,
            wedge_template_buffer,
            wedge_template_vertex_count: wedge_template_vertices.len() as u32,
            curve_template_buffer,
            curve_template_vertex_count: curve_template_vertices.len() as u32,
            viewport_bind_group_layout: Arc::new(viewport_bind_group_layout),
            fill_paint_bind_group_layout: Arc::new(fill_paint_bind_group_layout),
            path_mask_bind_group_layout: Arc::new(path_mask_bind_group_layout),
            path_mask_sampler,
            text_resources,
        }
    }

    fn create_triangle_vertex_buffer(&self, vertices: &[DrawingVertex]) -> Option<wgpu::Buffer> {
        if vertices.is_empty() {
            return None;
        }
        Some(
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("goldlight drawing vertex buffer"),
                    contents: bytemuck::cast_slice(vertices),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
        )
    }

    fn warm_prepared_pipelines(&self, prepared: &DrawingPreparedRecording) {
        let mut keys = Vec::new();
        for pass in &prepared.passes {
            let sample_count = if pass.requires_msaa && self.msaa_sample_count > 1 {
                self.msaa_sample_count
            } else {
                1
            };
            for step in &pass.steps {
                let key = match step {
                    DrawingPreparedStep::Triangles { mode, .. } => PipelineWarmupKey::Triangle {
                        sample_count,
                        mode: *mode,
                    },
                    DrawingPreparedStep::WedgeFillPatches { step, .. } => {
                        PipelineWarmupKey::Wedge {
                            sample_count,
                            stencil_mode: step.stencil_mode,
                        }
                    }
                    DrawingPreparedStep::CurveFillPatches { step, .. } => {
                        PipelineWarmupKey::Curve {
                            sample_count,
                            stencil_mode: step.stencil_mode,
                        }
                    }
                    DrawingPreparedStep::StrokePatches(_) => {
                        PipelineWarmupKey::Stroke { sample_count }
                    }
                    DrawingPreparedStep::PathMask(_) => {
                        PipelineWarmupKey::PathMask { sample_count }
                    }
                    DrawingPreparedStep::BitmapText(_) => {
                        PipelineWarmupKey::BitmapText { sample_count }
                    }
                    DrawingPreparedStep::SdfText(_) => PipelineWarmupKey::SdfText { sample_count },
                };
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
        if keys.len() <= 1 {
            for key in keys {
                self.warm_pipeline(key);
            }
            return;
        }
        std::thread::scope(|scope| {
            for key in keys {
                let provider = self.clone();
                scope.spawn(move || {
                    provider.warm_pipeline(key);
                });
            }
        });
    }

    fn warm_pipeline(&self, key: PipelineWarmupKey) {
        match key {
            PipelineWarmupKey::Triangle { sample_count, mode } => {
                let _ = self.triangle_pipeline(sample_count, mode);
            }
            PipelineWarmupKey::Wedge {
                sample_count,
                stencil_mode,
            } => {
                let _ = self.wedge_pipeline(sample_count, stencil_mode);
            }
            PipelineWarmupKey::Curve {
                sample_count,
                stencil_mode,
            } => {
                let _ = self.curve_pipeline(sample_count, stencil_mode);
            }
            PipelineWarmupKey::Stroke { sample_count } => {
                let _ = self.stroke_pipeline(sample_count);
            }
            PipelineWarmupKey::PathMask { sample_count } => {
                let _ = self.path_mask_pipeline(sample_count);
            }
            PipelineWarmupKey::BitmapText { sample_count } => {
                let _ = self.text_resources.bitmap_pipeline(sample_count);
            }
            PipelineWarmupKey::SdfText { sample_count } => {
                let _ = self.text_resources.sdf_pipeline(sample_count);
            }
        }
    }

    fn create_stroke_patch_buffer(
        &self,
        instances: &[StrokePatchInstance],
    ) -> Option<wgpu::Buffer> {
        if instances.is_empty() {
            return None;
        }
        Some(
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("goldlight stroke patch buffer"),
                    contents: bytemuck::cast_slice(instances),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
        )
    }

    fn create_path_mask_vertex_buffer(&self, vertices: &[PathMaskVertex]) -> Option<wgpu::Buffer> {
        if vertices.is_empty() {
            return None;
        }
        Some(
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("goldlight path mask vertex buffer"),
                    contents: bytemuck::cast_slice(vertices),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
        )
    }

    fn create_wedge_fill_patch_buffer(
        &self,
        instances: &[WedgeFillPatchInstance],
    ) -> Option<wgpu::Buffer> {
        if instances.is_empty() {
            return None;
        }
        Some(
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("goldlight wedge fill patch buffer"),
                    contents: bytemuck::cast_slice(instances),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
        )
    }

    fn create_curve_fill_patch_buffer(
        &self,
        instances: &[CurveFillPatchInstance],
    ) -> Option<wgpu::Buffer> {
        if instances.is_empty() {
            return None;
        }
        Some(
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("goldlight curve fill patch buffer"),
                    contents: bytemuck::cast_slice(instances),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
        )
    }

    fn create_viewport_bind_group(
        &self,
        surface_width: u32,
        surface_height: u32,
    ) -> (wgpu::Buffer, wgpu::BindGroup) {
        let width = surface_width.max(1) as f32;
        let height = surface_height.max(1) as f32;
        let uniform = ViewportUniform {
            scale: [2.0 / width, -2.0 / height],
            translate: [-1.0, 1.0],
        };
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("goldlight stroke viewport buffer"),
                contents: bytemuck::bytes_of(&uniform),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("goldlight stroke viewport bind group"),
            layout: &self.viewport_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            }],
        });
        (buffer, bind_group)
    }

    fn create_fill_paint_bind_group(
        &self,
        uniform: &PaintUniform,
    ) -> (wgpu::Buffer, wgpu::BindGroup) {
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("goldlight fill paint buffer"),
                contents: bytemuck::bytes_of(uniform),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("goldlight fill paint bind group"),
            layout: &self.fill_paint_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            }],
        });
        (buffer, bind_group)
    }

    fn create_path_mask_bind_group(&self, view: &wgpu::TextureView) -> wgpu::BindGroup {
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("goldlight path mask bind group"),
            layout: &self.path_mask_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Sampler(&self.path_mask_sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(view),
                },
            ],
        })
    }

    fn triangle_pipeline(
        &self,
        sample_count: u32,
        mode: TriangleStepMode,
    ) -> Arc<wgpu::RenderPipeline> {
        match mode {
            TriangleStepMode::Direct => self.triangle_direct_pipeline.get(sample_count),
            TriangleStepMode::DirectDepth => self.triangle_depth_pipeline.get(sample_count),
            TriangleStepMode::StencilEvenodd => {
                self.triangle_stencil_evenodd_pipeline.get(sample_count)
            }
            TriangleStepMode::StencilNonzero => {
                self.triangle_stencil_nonzero_pipeline.get(sample_count)
            }
            TriangleStepMode::StencilCover => {
                self.triangle_stencil_cover_pipeline.get(sample_count)
            }
        }
    }

    fn stroke_pipeline(&self, sample_count: u32) -> Arc<wgpu::RenderPipeline> {
        self.stroke_pipeline.get(sample_count)
    }

    fn path_mask_pipeline(&self, sample_count: u32) -> Arc<wgpu::RenderPipeline> {
        self.path_mask_pipeline.get(sample_count)
    }

    fn wedge_pipeline(
        &self,
        sample_count: u32,
        stencil_mode: Option<FillStencilMode>,
    ) -> Arc<wgpu::RenderPipeline> {
        match stencil_mode {
            None => self.wedge_direct_pipeline.get(sample_count),
            Some(FillStencilMode::Evenodd) => self.wedge_stencil_evenodd_pipeline.get(sample_count),
            Some(FillStencilMode::Nonzero) => self.wedge_stencil_nonzero_pipeline.get(sample_count),
        }
    }

    fn curve_pipeline(
        &self,
        sample_count: u32,
        stencil_mode: FillStencilMode,
    ) -> Arc<wgpu::RenderPipeline> {
        match stencil_mode {
            FillStencilMode::Evenodd => self.curve_stencil_evenodd_pipeline.get(sample_count),
            FillStencilMode::Nonzero => self.curve_stencil_nonzero_pipeline.get(sample_count),
        }
    }

    fn wedge_template_buffer(&self) -> (&wgpu::Buffer, u32) {
        (
            &self.wedge_template_buffer,
            self.wedge_template_vertex_count,
        )
    }

    fn curve_template_buffer(&self) -> (&wgpu::Buffer, u32) {
        (
            &self.curve_template_buffer,
            self.curve_template_vertex_count,
        )
    }

    pub(crate) fn msaa_sample_count(&self) -> u32 {
        self.msaa_sample_count
    }
}

fn fill_stencil_state(stencil_mode: FillStencilMode) -> wgpu::DepthStencilState {
    let face = match stencil_mode {
        FillStencilMode::Evenodd => wgpu::StencilFaceState {
            compare: wgpu::CompareFunction::Always,
            fail_op: wgpu::StencilOperation::Keep,
            depth_fail_op: wgpu::StencilOperation::Keep,
            pass_op: wgpu::StencilOperation::Invert,
        },
        FillStencilMode::Nonzero => wgpu::StencilFaceState {
            compare: wgpu::CompareFunction::Always,
            fail_op: wgpu::StencilOperation::Keep,
            depth_fail_op: wgpu::StencilOperation::Keep,
            pass_op: wgpu::StencilOperation::IncrementWrap,
        },
    };
    let back = match stencil_mode {
        FillStencilMode::Evenodd => face,
        FillStencilMode::Nonzero => wgpu::StencilFaceState {
            compare: wgpu::CompareFunction::Always,
            fail_op: wgpu::StencilOperation::Keep,
            depth_fail_op: wgpu::StencilOperation::Keep,
            pass_op: wgpu::StencilOperation::DecrementWrap,
        },
    };
    wgpu::DepthStencilState {
        format: DRAWING_DEPTH_FORMAT,
        depth_write_enabled: false,
        depth_compare: wgpu::CompareFunction::Less,
        stencil: wgpu::StencilState {
            front: face,
            back,
            read_mask: 0xff,
            write_mask: 0xff,
        },
        bias: wgpu::DepthBiasState::default(),
    }
}

fn stencil_cover_state() -> wgpu::DepthStencilState {
    let face = wgpu::StencilFaceState {
        compare: wgpu::CompareFunction::NotEqual,
        fail_op: wgpu::StencilOperation::Keep,
        depth_fail_op: wgpu::StencilOperation::Zero,
        pass_op: wgpu::StencilOperation::Zero,
    };
    wgpu::DepthStencilState {
        format: DRAWING_DEPTH_FORMAT,
        depth_write_enabled: true,
        depth_compare: wgpu::CompareFunction::Less,
        stencil: wgpu::StencilState {
            front: face,
            back: face,
            read_mask: 0xff,
            write_mask: 0xff,
        },
        bias: wgpu::DepthBiasState::default(),
    }
}

fn direct_depth_state() -> wgpu::DepthStencilState {
    wgpu::DepthStencilState {
        format: DRAWING_DEPTH_FORMAT,
        depth_write_enabled: true,
        depth_compare: wgpu::CompareFunction::Less,
        stencil: wgpu::StencilState::default(),
        bias: wgpu::DepthBiasState::default(),
    }
}

fn triangle_pipeline_state(
    kind: TrianglePipelineKind,
) -> (Option<wgpu::DepthStencilState>, wgpu::ColorWrites) {
    match kind {
        TrianglePipelineKind::Direct => (None, wgpu::ColorWrites::ALL),
        TrianglePipelineKind::DirectDepth => (Some(direct_depth_state()), wgpu::ColorWrites::ALL),
        TrianglePipelineKind::StencilEvenodd => (
            Some(fill_stencil_state(FillStencilMode::Evenodd)),
            wgpu::ColorWrites::empty(),
        ),
        TrianglePipelineKind::StencilNonzero => (
            Some(fill_stencil_state(FillStencilMode::Nonzero)),
            wgpu::ColorWrites::empty(),
        ),
        TrianglePipelineKind::StencilCover => (Some(stencil_cover_state()), wgpu::ColorWrites::ALL),
    }
}

fn patch_pipeline_state(
    stencil_mode: Option<FillStencilMode>,
) -> (Option<wgpu::DepthStencilState>, wgpu::ColorWrites) {
    match stencil_mode {
        None => (Some(direct_depth_state()), wgpu::ColorWrites::ALL),
        Some(stencil_mode) => (
            Some(fill_stencil_state(stencil_mode)),
            wgpu::ColorWrites::empty(),
        ),
    }
}

#[derive(Clone)]
pub struct DawnSharedContext {
    pub resource_provider: DawnResourceProvider,
    pub queue: wgpu::Queue,
}

impl DawnSharedContext {
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        format: wgpu::TextureFormat,
        sample_count: u32,
    ) -> Self {
        Self {
            resource_provider: DawnResourceProvider::new(device, format, sample_count),
            queue: queue.clone(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct DrawingRecorder {
    commands: Vec<DrawingCommand>,
}

impl DrawingRecorder {
    pub fn new() -> Self {
        Self {
            commands: Vec::new(),
        }
    }

    pub fn fill_rect(&mut self, rect: RectDrawCommand) {
        self.commands.push(DrawingCommand::FillRect(rect));
    }

    pub fn draw_path(&mut self, path: PathDrawCommand) {
        self.commands.push(DrawingCommand::DrawPath(path));
    }

    pub fn draw_direct_mask_text(&mut self, text: DirectMaskTextDrawCommand) {
        self.commands.push(DrawingCommand::DrawDirectMaskText(text));
    }

    pub fn draw_transformed_mask_text(&mut self, text: TransformedMaskTextDrawCommand) {
        self.commands
            .push(DrawingCommand::DrawTransformedMaskText(text));
    }

    pub fn draw_sdf_text(&mut self, text: SdfTextDrawCommand) {
        self.commands.push(DrawingCommand::DrawSdfText(text));
    }

    pub fn push_clip_rect(&mut self, clip_rect: ClipRectCommand) {
        self.commands.push(DrawingCommand::PushClipRect(clip_rect));
    }

    pub fn pop_clip(&mut self) {
        self.commands.push(DrawingCommand::PopClip);
    }

    pub fn finish(self) -> DrawingRecording {
        DrawingRecording {
            commands: self.commands,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DrawingRecording {
    commands: Vec<DrawingCommand>,
}

impl DrawingRecording {}

#[derive(Clone, Copy, Debug)]
pub struct RecordingBounds {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

#[derive(Clone, Debug)]
enum DrawingCommand {
    FillRect(RectDrawCommand),
    DrawPath(PathDrawCommand),
    DrawDirectMaskText(DirectMaskTextDrawCommand),
    DrawTransformedMaskText(TransformedMaskTextDrawCommand),
    DrawSdfText(SdfTextDrawCommand),
    PushClipRect(ClipRectCommand),
    PopClip,
}

#[derive(Clone, Debug)]
pub struct RectDrawCommand {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub color: ColorValue,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub struct PathDrawCommand {
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
pub struct ClipRectCommand {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub struct DirectMaskTextDrawCommand {
    pub x: f32,
    pub y: f32,
    pub color: ColorValue,
    pub glyphs: Vec<super::DirectMaskGlyph2D>,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub struct TransformedMaskTextDrawCommand {
    pub x: f32,
    pub y: f32,
    pub color: ColorValue,
    pub glyphs: Vec<super::TransformedMaskGlyph2D>,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub struct SdfTextDrawCommand {
    pub x: f32,
    pub y: f32,
    pub color: ColorValue,
    pub glyphs: Vec<super::SdfGlyph2D>,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub enum DrawingPreparedStep {
    Triangles {
        vertices: Vec<DrawingVertex>,
        mode: TriangleStepMode,
        paint: PaintUniform,
    },
    WedgeFillPatches {
        step: PreparedWedgeFillStep,
        paint: PaintUniform,
    },
    CurveFillPatches {
        step: PreparedCurveFillStep,
        paint: PaintUniform,
    },
    StrokePatches(PreparedStrokePatchStep),
    PathMask(PreparedPathMaskStep),
    BitmapText(PreparedBitmapTextStep),
    SdfText(PreparedSdfTextStep),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriangleStepMode {
    Direct,
    DirectDepth,
    StencilEvenodd,
    StencilNonzero,
    StencilCover,
}

#[derive(Clone, Debug)]
pub struct DrawingDrawPass {
    pub load_op: wgpu::LoadOp<wgpu::Color>,
    pub requires_msaa: bool,
    pub requires_depth: bool,
    pub clip_rect: Option<DeviceClipRect>,
    pub steps: Vec<DrawingPreparedStep>,
}

#[derive(Clone, Debug)]
pub struct DrawingPreparedRecording {
    pub surface_width: u32,
    pub surface_height: u32,
    pub passes: Vec<DrawingDrawPass>,
}

impl DrawingPreparedRecording {
    pub fn is_cacheable(&self) -> bool {
        self.passes
            .iter()
            .flat_map(|pass| pass.steps.iter())
            .all(|step| !step.depends_on_atlas())
    }
}

impl DrawingPreparedStep {
    fn depends_on_atlas(&self) -> bool {
        matches!(
            self,
            Self::PathMask(_) | Self::BitmapText(_) | Self::SdfText(_)
        )
    }

    fn requires_msaa(&self) -> bool {
        matches!(
            self,
            Self::WedgeFillPatches { .. }
                | Self::CurveFillPatches { .. }
                | Self::Triangles {
                    mode: TriangleStepMode::StencilEvenodd
                        | TriangleStepMode::StencilNonzero
                        | TriangleStepMode::StencilCover,
                    ..
                }
                | Self::StrokePatches(_)
        )
    }

    fn requires_depth(&self) -> bool {
        matches!(
            self,
            Self::Triangles {
                mode: TriangleStepMode::DirectDepth
                    | TriangleStepMode::StencilEvenodd
                    | TriangleStepMode::StencilNonzero
                    | TriangleStepMode::StencilCover,
                ..
            } | Self::WedgeFillPatches { .. }
                | Self::CurveFillPatches { .. }
                | Self::StrokePatches(_)
                | Self::PathMask(_)
                | Self::BitmapText(_)
                | Self::SdfText(_)
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeviceClipRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActiveClip {
    None,
    Empty,
    Rect(DeviceClipRect),
}

impl ActiveClip {
    fn device_rect(self) -> Option<DeviceClipRect> {
        match self {
            Self::Rect(rect) => Some(rect),
            Self::None | Self::Empty => None,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
struct ViewportUniform {
    scale: [f32; 2],
    translate: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub(crate) struct PaintUniform {
    info: [f32; 4],
    params0: [f32; 4],
    local_matrix0: [f32; 4],
    local_matrix1: [f32; 4],
    solid_color: [f32; 4],
    stop_offsets0: [f32; 4],
    stop_offsets1: [f32; 4],
    stop_colors: [[f32; 4]; MAX_GRADIENT_STOPS],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub struct DrawingVertex {
    position: [f32; 4],
    color: [f32; 4],
    device_position: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub struct PathMaskVertex {
    position: [f32; 4],
    device_position: [f32; 2],
    uv: [f32; 2],
}

#[derive(Clone, Debug)]
pub struct PreparedPathMaskStep {
    pub vertices: Vec<PathMaskVertex>,
    pub paint: PaintUniform,
    pub mask: CoverageMask,
}

#[derive(Clone, Copy, Debug)]
struct ColoredPoint {
    point: Point,
    color: [f32; 4],
}

#[derive(Clone, Debug)]
pub(crate) struct FlattenedSubpath {
    pub(crate) points: Vec<Point>,
    pub(crate) corners: Vec<bool>,
    pub(crate) closed: bool,
}

#[derive(Clone, Copy, Debug)]
struct StrokeSegmentRecord {
    start: Point,
    end: Point,
    direction: Point,
    normal: Point,
    left_start: Point,
    right_start: Point,
    left_end: Point,
    right_end: Point,
}

#[derive(Clone, Debug)]
struct StrokeContourRecord {
    points: Vec<Point>,
    corners: Vec<bool>,
    closed: bool,
    segments: Vec<StrokeSegmentRecord>,
    degenerate_point: Option<Point>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct StrokeStyle {
    pub(crate) half_width: f32,
    pub(crate) join_limit: f32,
    pub(crate) cap: PathStrokeCap2D,
}

impl DrawingVertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 3] =
        wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x2];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

impl PathMaskVertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 3] =
        wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x2, 2 => Float32x2];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

#[cfg(test)]
fn transform_bounds_point(point: [f32; 2], matrix: [f32; 6]) -> [f32; 2] {
    [
        (matrix[0] * point[0]) + (matrix[2] * point[1]) + matrix[4],
        (matrix[1] * point[0]) + (matrix[3] * point[1]) + matrix[5],
    ]
}

#[cfg(test)]
fn include_point(bounds: &mut Option<RecordingBounds>, point: [f32; 2]) {
    match bounds {
        Some(existing) => {
            existing.left = existing.left.min(point[0]);
            existing.top = existing.top.min(point[1]);
            existing.right = existing.right.max(point[0]);
            existing.bottom = existing.bottom.max(point[1]);
        }
        None => {
            *bounds = Some(RecordingBounds {
                left: point[0],
                top: point[1],
                right: point[0],
                bottom: point[1],
            });
        }
    }
}

#[cfg(test)]
fn include_transformed_rect(
    bounds: &mut Option<RecordingBounds>,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    transform: [f32; 6],
) {
    for point in [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
    ] {
        include_point(bounds, transform_bounds_point(point, transform));
    }
}

#[cfg(test)]
fn include_arc_bounds(
    bounds: &mut Option<RecordingBounds>,
    center: [f32; 2],
    radius: f32,
    transform: [f32; 6],
) {
    for point in [
        [center[0] - radius, center[1] - radius],
        [center[0] + radius, center[1] - radius],
        [center[0] + radius, center[1] + radius],
        [center[0] - radius, center[1] + radius],
    ] {
        include_point(bounds, transform_bounds_point(point, transform));
    }
}

#[cfg(test)]
fn include_path_bounds(bounds: &mut Option<RecordingBounds>, path: &PathDrawCommand) {
    let mut local_bounds = None;
    let mut current = [path.x, path.y];
    include_point(&mut local_bounds, current);
    for verb in &path.verbs {
        match verb {
            PathVerb2D::MoveTo { to } | PathVerb2D::LineTo { to } => {
                current = [path.x + to[0], path.y + to[1]];
                include_point(&mut local_bounds, current);
            }
            PathVerb2D::QuadTo { control, to } | PathVerb2D::ConicTo { control, to, .. } => {
                include_point(
                    &mut local_bounds,
                    [path.x + control[0], path.y + control[1]],
                );
                current = [path.x + to[0], path.y + to[1]];
                include_point(&mut local_bounds, current);
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                include_point(
                    &mut local_bounds,
                    [path.x + control1[0], path.y + control1[1]],
                );
                include_point(
                    &mut local_bounds,
                    [path.x + control2[0], path.y + control2[1]],
                );
                current = [path.x + to[0], path.y + to[1]];
                include_point(&mut local_bounds, current);
            }
            PathVerb2D::ArcTo { center, radius, .. } => {
                include_arc_bounds(
                    &mut local_bounds,
                    [path.x + center[0], path.y + center[1]],
                    *radius,
                    [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                );
            }
            PathVerb2D::Close => {}
        }
    }

    let Some(mut local_bounds) = local_bounds else {
        return;
    };
    if matches!(path.style, PathStyle2D::Stroke) {
        let half_width = path.stroke_width.max(0.5) * 0.5;
        let join_outset = match path.stroke_join {
            PathStrokeJoin2D::Miter => half_width * DEFAULT_MITER_LIMIT.max(1.0),
            PathStrokeJoin2D::Bevel | PathStrokeJoin2D::Round => half_width,
        };
        let stroke_outset = join_outset + AA_FRINGE_WIDTH;
        local_bounds.left -= stroke_outset;
        local_bounds.top -= stroke_outset;
        local_bounds.right += stroke_outset;
        local_bounds.bottom += stroke_outset;
    }

    include_transformed_rect(
        bounds,
        local_bounds.left,
        local_bounds.top,
        (local_bounds.right - local_bounds.left).max(0.0),
        (local_bounds.bottom - local_bounds.top).max(0.0),
        path.transform,
    );
}

#[cfg(test)]
fn include_direct_mask_text_bounds(
    bounds: &mut Option<RecordingBounds>,
    text: &DirectMaskTextDrawCommand,
) {
    for glyph in &text.glyphs {
        if let Some(mask) = glyph.mask.as_ref() {
            include_transformed_rect(
                bounds,
                text.x + glyph.x,
                text.y + glyph.y,
                mask.width as f32,
                mask.height as f32,
                text.transform,
            );
        } else {
            include_point(
                bounds,
                transform_bounds_point([text.x + glyph.x, text.y + glyph.y], text.transform),
            );
        }
    }
}

#[cfg(test)]
fn include_transformed_mask_text_bounds(
    bounds: &mut Option<RecordingBounds>,
    text: &TransformedMaskTextDrawCommand,
) {
    for glyph in &text.glyphs {
        let scale =
            if glyph.strike_to_source_scale.is_finite() && glyph.strike_to_source_scale > 0.0 {
                glyph.strike_to_source_scale
            } else {
                1.0
            };
        if let Some(mask) = glyph.mask.as_ref() {
            include_transformed_rect(
                bounds,
                text.x + glyph.x,
                text.y + glyph.y,
                mask.width as f32 * scale,
                mask.height as f32 * scale,
                text.transform,
            );
        } else {
            include_point(
                bounds,
                transform_bounds_point([text.x + glyph.x, text.y + glyph.y], text.transform),
            );
        }
    }
}

#[cfg(test)]
fn include_sdf_text_bounds(bounds: &mut Option<RecordingBounds>, text: &SdfTextDrawCommand) {
    for glyph in &text.glyphs {
        let scale =
            if glyph.strike_to_source_scale.is_finite() && glyph.strike_to_source_scale > 0.0 {
                glyph.strike_to_source_scale
            } else {
                1.0
            };
        if let Some(source) = glyph.sdf.as_ref() {
            include_transformed_rect(
                bounds,
                text.x + glyph.x + (source.offset_x as f32 + glyph.sdf_inset as f32) * scale,
                text.y + glyph.y + (source.offset_y as f32 + glyph.sdf_inset as f32) * scale,
                source.width.saturating_sub(glyph.sdf_inset * 2) as f32 * scale,
                source.height.saturating_sub(glyph.sdf_inset * 2) as f32 * scale,
                text.transform,
            );
        } else {
            include_point(
                bounds,
                transform_bounds_point([text.x + glyph.x, text.y + glyph.y], text.transform),
            );
        }
    }
}

#[cfg(test)]
pub fn compute_recording_bounds(recording: &DrawingRecording) -> Option<RecordingBounds> {
    let mut bounds = None;
    let mut clip_stack = Vec::new();
    let mut current_clip = None;
    for command in &recording.commands {
        let mut command_bounds = None;
        match command {
            DrawingCommand::FillRect(rect) => include_transformed_rect(
                &mut command_bounds,
                rect.x,
                rect.y,
                rect.width.max(0.0),
                rect.height.max(0.0),
                rect.transform,
            ),
            DrawingCommand::DrawPath(path) => include_path_bounds(&mut command_bounds, path),
            DrawingCommand::DrawDirectMaskText(text) => {
                include_direct_mask_text_bounds(&mut command_bounds, text)
            }
            DrawingCommand::DrawTransformedMaskText(text) => {
                include_transformed_mask_text_bounds(&mut command_bounds, text)
            }
            DrawingCommand::DrawSdfText(text) => include_sdf_text_bounds(&mut command_bounds, text),
            DrawingCommand::PushClipRect(clip_rect) => {
                let mut next_clip = None;
                include_transformed_rect(
                    &mut next_clip,
                    clip_rect.x,
                    clip_rect.y,
                    clip_rect.width.max(0.0),
                    clip_rect.height.max(0.0),
                    clip_rect.transform,
                );
                clip_stack.push(current_clip);
                current_clip = intersect_recording_bounds(current_clip, next_clip);
                continue;
            }
            DrawingCommand::PopClip => {
                current_clip = clip_stack.pop().flatten();
                continue;
            }
        }
        if let Some(clipped_bounds) = intersect_recording_bounds(current_clip, command_bounds) {
            merge_recording_bounds(&mut bounds, clipped_bounds);
        }
    }

    bounds.and_then(|value| {
        (value.left.is_finite()
            && value.top.is_finite()
            && value.right.is_finite()
            && value.bottom.is_finite()
            && value.right > value.left
            && value.bottom > value.top)
            .then_some(value)
    })
}

fn transform_clip_point(point: [f32; 2], matrix: [f32; 6]) -> [f32; 2] {
    [
        (matrix[0] * point[0]) + (matrix[2] * point[1]) + matrix[4],
        (matrix[1] * point[0]) + (matrix[3] * point[1]) + matrix[5],
    ]
}

fn transformed_rect_bounds(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    transform: [f32; 6],
) -> Option<RecordingBounds> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return None;
    }
    let mut bounds = RecordingBounds {
        left: f32::INFINITY,
        top: f32::INFINITY,
        right: f32::NEG_INFINITY,
        bottom: f32::NEG_INFINITY,
    };
    for point in [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
    ] {
        let transformed = transform_clip_point(point, transform);
        bounds.left = bounds.left.min(transformed[0]);
        bounds.top = bounds.top.min(transformed[1]);
        bounds.right = bounds.right.max(transformed[0]);
        bounds.bottom = bounds.bottom.max(transformed[1]);
    }
    is_valid_recording_bounds(bounds).then_some(bounds)
}

#[cfg(test)]
fn merge_recording_bounds(bounds: &mut Option<RecordingBounds>, next: RecordingBounds) {
    match bounds {
        Some(existing) => {
            existing.left = existing.left.min(next.left);
            existing.top = existing.top.min(next.top);
            existing.right = existing.right.max(next.right);
            existing.bottom = existing.bottom.max(next.bottom);
        }
        None => *bounds = Some(next),
    }
}

#[cfg(test)]
fn intersect_recording_bounds(
    left: Option<RecordingBounds>,
    right: Option<RecordingBounds>,
) -> Option<RecordingBounds> {
    match (left, right) {
        (Some(left), Some(right)) => {
            let bounds = RecordingBounds {
                left: left.left.max(right.left),
                top: left.top.max(right.top),
                right: left.right.min(right.right),
                bottom: left.bottom.min(right.bottom),
            };
            is_valid_recording_bounds(bounds).then_some(bounds)
        }
        (Some(bounds), None) | (None, Some(bounds)) => Some(bounds),
        (None, None) => None,
    }
}

fn is_valid_recording_bounds(bounds: RecordingBounds) -> bool {
    bounds.left.is_finite()
        && bounds.top.is_finite()
        && bounds.right.is_finite()
        && bounds.bottom.is_finite()
        && bounds.right > bounds.left
        && bounds.bottom > bounds.top
}

fn clip_rect_to_device_rect(
    clip_rect: &ClipRectCommand,
    surface_width: u32,
    surface_height: u32,
) -> ActiveClip {
    let Some(bounds) = transformed_rect_bounds(
        clip_rect.x,
        clip_rect.y,
        clip_rect.width.max(0.0),
        clip_rect.height.max(0.0),
        clip_rect.transform,
    ) else {
        return ActiveClip::Empty;
    };
    recording_bounds_to_device_clip_rect(bounds, surface_width, surface_height)
        .map(ActiveClip::Rect)
        .unwrap_or(ActiveClip::Empty)
}

fn intersect_active_clips(left: ActiveClip, right: ActiveClip) -> ActiveClip {
    match (left, right) {
        (ActiveClip::Empty, _) | (_, ActiveClip::Empty) => ActiveClip::Empty,
        (ActiveClip::None, clip) | (clip, ActiveClip::None) => clip,
        (ActiveClip::Rect(left), ActiveClip::Rect(right)) => {
            let x0 = left.x.max(right.x);
            let y0 = left.y.max(right.y);
            let x1 = left
                .x
                .saturating_add(left.width)
                .min(right.x.saturating_add(right.width));
            let y1 = left
                .y
                .saturating_add(left.height)
                .min(right.y.saturating_add(right.height));
            if x1 <= x0 || y1 <= y0 {
                ActiveClip::Empty
            } else {
                ActiveClip::Rect(DeviceClipRect {
                    x: x0,
                    y: y0,
                    width: x1 - x0,
                    height: y1 - y0,
                })
            }
        }
    }
}

fn recording_bounds_to_device_clip_rect(
    bounds: RecordingBounds,
    surface_width: u32,
    surface_height: u32,
) -> Option<DeviceClipRect> {
    let max_width = surface_width.max(1) as f32;
    let max_height = surface_height.max(1) as f32;
    let left = bounds.left.floor().clamp(0.0, max_width);
    let top = bounds.top.floor().clamp(0.0, max_height);
    let right = bounds.right.ceil().clamp(0.0, max_width);
    let bottom = bounds.bottom.ceil().clamp(0.0, max_height);
    if right <= left || bottom <= top {
        return None;
    }
    Some(DeviceClipRect {
        x: left as u32,
        y: top as u32,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
    })
}

#[allow(dead_code)]
pub fn prepare_drawing_recording(
    recording: &DrawingRecording,
    surface_width: u32,
    surface_height: u32,
) -> DrawingPreparedRecording {
    prepare_drawing_recording_with_providers(recording, surface_width, surface_height, None, None)
}

#[allow(dead_code)]
pub fn prepare_drawing_recording_with_atlas(
    recording: &DrawingRecording,
    surface_width: u32,
    surface_height: u32,
    mut atlas_provider: Option<&mut AtlasProvider>,
) -> DrawingPreparedRecording {
    prepare_drawing_recording_with_providers(
        recording,
        surface_width,
        surface_height,
        atlas_provider.as_deref_mut(),
        None,
    )
}

pub fn prepare_drawing_recording_with_providers(
    recording: &DrawingRecording,
    surface_width: u32,
    surface_height: u32,
    mut path_atlas_provider: Option<&mut AtlasProvider>,
    mut text_atlas_provider: Option<&mut TextAtlasProvider>,
) -> DrawingPreparedRecording {
    prepare_drawing_recording_with_providers_and_initial_clear(
        recording,
        surface_width,
        surface_height,
        path_atlas_provider.as_deref_mut(),
        text_atlas_provider.as_deref_mut(),
        None,
    )
}

pub fn prepare_drawing_recording_with_providers_and_initial_clear(
    recording: &DrawingRecording,
    surface_width: u32,
    surface_height: u32,
    mut path_atlas_provider: Option<&mut AtlasProvider>,
    mut text_atlas_provider: Option<&mut TextAtlasProvider>,
    initial_clear: Option<ColorValue>,
) -> DrawingPreparedRecording {
    let width = surface_width.max(1) as f32;
    let height = surface_height.max(1) as f32;
    let mut passes = Vec::new();
    let mut current_load_op = wgpu::LoadOp::Load;
    let mut current_steps = Vec::new();
    let mut clip_stack = Vec::new();
    let mut current_clip = ActiveClip::None;
    let mut current_pass_clip = ActiveClip::None;
    let mut next_painters_depth = 1u16;

    let flush_pass = |passes: &mut Vec<DrawingDrawPass>,
                      current_load_op: &mut wgpu::LoadOp<wgpu::Color>,
                      current_steps: &mut Vec<DrawingPreparedStep>,
                      current_pass_clip: &mut ActiveClip| {
        if matches!(current_load_op, wgpu::LoadOp::Load) && current_steps.is_empty() {
            return;
        }
        let requires_msaa = current_steps.iter().any(DrawingPreparedStep::requires_msaa);
        let requires_depth = current_steps
            .iter()
            .any(DrawingPreparedStep::requires_depth);
        passes.push(DrawingDrawPass {
            load_op: *current_load_op,
            requires_msaa,
            requires_depth,
            clip_rect: current_pass_clip.device_rect(),
            steps: std::mem::take(current_steps),
        });
        *current_load_op = wgpu::LoadOp::Load;
        *current_pass_clip = ActiveClip::None;
    };

    let push_step = |passes: &mut Vec<DrawingDrawPass>,
                     current_load_op: &mut wgpu::LoadOp<wgpu::Color>,
                     current_steps: &mut Vec<DrawingPreparedStep>,
                     current_clip: ActiveClip,
                     current_pass_clip: &mut ActiveClip,
                     step: DrawingPreparedStep| {
        if matches!(current_clip, ActiveClip::Empty) {
            return;
        }
        if current_steps.is_empty() {
            *current_pass_clip = current_clip;
        } else if *current_pass_clip != current_clip {
            flush_pass(passes, current_load_op, current_steps, current_pass_clip);
            *current_pass_clip = current_clip;
        }
        if let Some(current_requires_depth) = current_steps
            .first()
            .map(DrawingPreparedStep::requires_depth)
        {
            let next_requires_depth = step.requires_depth();
            if current_requires_depth != next_requires_depth {
                flush_pass(passes, current_load_op, current_steps, current_pass_clip);
                *current_pass_clip = current_clip;
            }
        }
        current_steps.push(step);
    };

    for command in &recording.commands {
        match command {
            DrawingCommand::PushClipRect(clip_rect) => {
                flush_pass(
                    &mut passes,
                    &mut current_load_op,
                    &mut current_steps,
                    &mut current_pass_clip,
                );
                clip_stack.push(current_clip);
                current_clip = intersect_active_clips(
                    current_clip,
                    clip_rect_to_device_rect(clip_rect, surface_width, surface_height),
                );
            }
            DrawingCommand::PopClip => {
                flush_pass(
                    &mut passes,
                    &mut current_load_op,
                    &mut current_steps,
                    &mut current_pass_clip,
                );
                current_clip = clip_stack.pop().unwrap_or(ActiveClip::None);
            }
            DrawingCommand::FillRect(rect) => {
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                push_step(
                    &mut passes,
                    &mut current_load_op,
                    &mut current_steps,
                    current_clip,
                    &mut current_pass_clip,
                    DrawingPreparedStep::Triangles {
                        vertices: with_vertex_depth(
                            build_rect_vertices(rect, width, height),
                            painter_depth,
                        ),
                        mode: TriangleStepMode::DirectDepth,
                        paint: vertex_colored_paint(),
                    },
                );
            }
            DrawingCommand::DrawPath(path) => {
                if matches!(current_clip, ActiveClip::Empty) {
                    continue;
                }
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                for step in build_path_steps(
                    path,
                    width,
                    height,
                    painter_depth,
                    surface_width,
                    surface_height,
                    path_atlas_provider.as_deref_mut(),
                ) {
                    push_step(
                        &mut passes,
                        &mut current_load_op,
                        &mut current_steps,
                        current_clip,
                        &mut current_pass_clip,
                        step,
                    );
                }
            }
            DrawingCommand::DrawDirectMaskText(text) => {
                if matches!(current_clip, ActiveClip::Empty) {
                    continue;
                }
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                for step in prepare_direct_mask_text_step(
                    &text.glyphs,
                    text.color,
                    text.x,
                    text.y,
                    surface_width,
                    surface_height,
                    painter_depth,
                    text.transform,
                    text_atlas_provider.as_deref_mut(),
                ) {
                    push_step(
                        &mut passes,
                        &mut current_load_op,
                        &mut current_steps,
                        current_clip,
                        &mut current_pass_clip,
                        DrawingPreparedStep::BitmapText(step),
                    );
                }
            }
            DrawingCommand::DrawTransformedMaskText(text) => {
                if matches!(current_clip, ActiveClip::Empty) {
                    continue;
                }
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                for step in prepare_transformed_mask_text_step(
                    &text.glyphs,
                    text.color,
                    text.x,
                    text.y,
                    surface_width,
                    surface_height,
                    painter_depth,
                    text.transform,
                    text_atlas_provider.as_deref_mut(),
                ) {
                    push_step(
                        &mut passes,
                        &mut current_load_op,
                        &mut current_steps,
                        current_clip,
                        &mut current_pass_clip,
                        DrawingPreparedStep::BitmapText(step),
                    );
                }
            }
            DrawingCommand::DrawSdfText(text) => {
                if matches!(current_clip, ActiveClip::Empty) {
                    continue;
                }
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                for step in prepare_sdf_text_step(
                    &text.glyphs,
                    text.color,
                    text.x,
                    text.y,
                    surface_width,
                    surface_height,
                    painter_depth,
                    text.transform,
                    text_atlas_provider.as_deref_mut(),
                ) {
                    push_step(
                        &mut passes,
                        &mut current_load_op,
                        &mut current_steps,
                        current_clip,
                        &mut current_pass_clip,
                        DrawingPreparedStep::SdfText(step),
                    );
                }
            }
        }
    }

    flush_pass(
        &mut passes,
        &mut current_load_op,
        &mut current_steps,
        &mut current_pass_clip,
    );

    if let Some(clear_color) = initial_clear {
        if let Some(first_pass) = passes.first_mut() {
            first_pass.load_op = wgpu::LoadOp::Clear(to_wgpu_color(clear_color));
        } else {
            passes.push(DrawingDrawPass {
                load_op: wgpu::LoadOp::Clear(to_wgpu_color(clear_color)),
                requires_msaa: false,
                requires_depth: false,
                clip_rect: None,
                steps: Vec::new(),
            });
        }
    }

    DrawingPreparedRecording {
        surface_width,
        surface_height,
        passes,
    }
}

fn next_painter_depth_as_float(next_painters_depth: &mut u16) -> f32 {
    let depth = *next_painters_depth;
    *next_painters_depth = next_painters_depth.saturating_add(1);
    // Match Graphite's DrawOrder::depthAsFloat() mapping for painter-depth writes.
    1.0 - depth as f32 / u16::MAX as f32
}

fn with_vertex_depth(mut vertices: Vec<DrawingVertex>, painter_depth: f32) -> Vec<DrawingVertex> {
    for vertex in &mut vertices {
        vertex.position[2] = painter_depth;
    }
    vertices
}

fn transform_vertices(
    mut vertices: Vec<DrawingVertex>,
    transform: [f32; 6],
    width: f32,
    height: f32,
) -> Vec<DrawingVertex> {
    if is_identity_affine_transform(transform) {
        return vertices;
    }
    for vertex in &mut vertices {
        let mapped = transform_point(vertex.device_position, transform);
        vertex.device_position = mapped;
        vertex.position[0] = (mapped[0] / width) * 2.0 - 1.0;
        vertex.position[1] = 1.0 - (mapped[1] / height) * 2.0;
    }
    vertices
}

impl PaintUniform {
    fn solid(color: [f32; 4]) -> Self {
        Self {
            info: [0.0, 0.0, 0.0, 0.0],
            params0: [0.0; 4],
            local_matrix0: [1.0, 0.0, 0.0, 1.0],
            local_matrix1: [0.0; 4],
            solid_color: color,
            stop_offsets0: [0.0; 4],
            stop_offsets1: [0.0; 4],
            stop_colors: [[0.0; 4]; MAX_GRADIENT_STOPS],
        }
    }
}

fn multiply_affine_matrices(left: [f32; 6], right: [f32; 6]) -> [f32; 6] {
    [
        (left[0] * right[0]) + (left[2] * right[1]),
        (left[1] * right[0]) + (left[3] * right[1]),
        (left[0] * right[2]) + (left[2] * right[3]),
        (left[1] * right[2]) + (left[3] * right[3]),
        (left[0] * right[4]) + (left[2] * right[5]) + left[4],
        (left[1] * right[4]) + (left[3] * right[5]) + left[5],
    ]
}

fn invert_affine_transform(transform: [f32; 6]) -> Option<[f32; 6]> {
    let determinant = (transform[0] * transform[3]) - (transform[2] * transform[1]);
    if !determinant.is_finite() || determinant.abs() <= 1e-12 {
        return None;
    }
    let inverse_determinant = 1.0 / determinant;
    let i00 = transform[3] * inverse_determinant;
    let i10 = -transform[1] * inverse_determinant;
    let i01 = -transform[2] * inverse_determinant;
    let i11 = transform[0] * inverse_determinant;
    Some([
        i00,
        i10,
        i01,
        i11,
        -((i00 * transform[4]) + (i01 * transform[5])),
        -((i10 * transform[4]) + (i11 * transform[5])),
    ])
}

fn transform_point(point: Point, transform: [f32; 6]) -> Point {
    [
        (transform[0] * point[0]) + (transform[2] * point[1]) + transform[4],
        (transform[1] * point[0]) + (transform[3] * point[1]) + transform[5],
    ]
}

fn is_identity_affine_transform(transform: [f32; 6]) -> bool {
    transform == [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
}

fn is_translation_only_affine_transform(transform: [f32; 6]) -> bool {
    (transform[0] - 1.0).abs() <= EPSILON
        && transform[1].abs() <= EPSILON
        && transform[2].abs() <= EPSILON
        && (transform[3] - 1.0).abs() <= EPSILON
}

fn create_linear_gradient_matrix(start: Point, end: Point) -> [f32; 6] {
    let dx = end[0] - start[0];
    let dy = end[1] - start[1];
    let denom = ((dx * dx) + (dy * dy)).max(GRADIENT_EPSILON);
    let a = dx / denom;
    let b = -dy / denom;
    let c = dy / denom;
    let d = dx / denom;
    [
        a,
        b,
        c,
        d,
        -((a * start[0]) + (c * start[1])),
        -((b * start[0]) + (d * start[1])),
    ]
}

fn create_radial_gradient_matrix(center: Point, radius: f32) -> [f32; 6] {
    let scale = 1.0 / radius.max(GRADIENT_EPSILON);
    [
        scale,
        0.0,
        0.0,
        scale,
        -center[0] * scale,
        -center[1] * scale,
    ]
}

fn create_sweep_gradient_matrix(center: Point) -> [f32; 6] {
    [1.0, 0.0, 0.0, 1.0, -center[0], -center[1]]
}

fn create_conical_gradient_matrix(
    start_center: Point,
    end_center: Point,
    start_radius: f32,
    end_radius: f32,
) -> [f32; 6] {
    let dx = end_center[0] - start_center[0];
    let dy = end_center[1] - start_center[1];
    let len = dx.hypot(dy);
    if len <= GRADIENT_EPSILON {
        let diff_radius = end_radius - start_radius;
        let scale = 1.0 / diff_radius.abs().max(GRADIENT_EPSILON);
        return [
            scale,
            0.0,
            0.0,
            scale,
            -start_center[0] * scale,
            -start_center[1] * scale,
        ];
    }
    let inv_len_sq = 1.0 / (len * len);
    let a = dx * inv_len_sq;
    let b = -dy * inv_len_sq;
    let c = dy * inv_len_sq;
    let d = dx * inv_len_sq;
    [
        a,
        b,
        c,
        d,
        -((a * start_center[0]) + (c * start_center[1])),
        -((b * start_center[0]) + (d * start_center[1])),
    ]
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn gradient_tile_mode_code(tile_mode: GradientTileMode2D) -> f32 {
    match tile_mode {
        GradientTileMode2D::Clamp => 0.0,
        GradientTileMode2D::Repeat => 1.0,
        GradientTileMode2D::Mirror => 2.0,
        GradientTileMode2D::Decal => 3.0,
    }
}

fn normalize_gradient_stops(
    stops: &[GradientStop2D],
    tile_mode: GradientTileMode2D,
) -> Vec<GradientStop2D> {
    let mut clamped = if stops.is_empty() {
        vec![GradientStop2D {
            offset: 0.0,
            color: ColorValue::default(),
        }]
    } else {
        stops
            .iter()
            .map(|stop| GradientStop2D {
                offset: clamp01(stop.offset),
                color: stop.color,
            })
            .collect::<Vec<_>>()
    };

    let mut normalized = Vec::new();
    let mut previous_offset = 0.0;
    if clamped[0].offset > 0.0 {
        normalized.push(GradientStop2D {
            offset: 0.0,
            color: clamped[0].color,
        });
    }
    for stop in clamped.drain(..) {
        let offset = stop.offset.max(previous_offset);
        normalized.push(GradientStop2D {
            offset,
            color: stop.color,
        });
        previous_offset = offset;
    }

    if normalized.len() == 1 {
        normalized.push(GradientStop2D {
            offset: 1.0,
            color: normalized[0].color,
        });
    } else if normalized
        .last()
        .map(|stop| stop.offset < 1.0)
        .unwrap_or(false)
    {
        let color = normalized.last().map(|stop| stop.color).unwrap_or_default();
        normalized.push(GradientStop2D { offset: 1.0, color });
    }

    let mut deduped = Vec::new();
    let mut index = 0usize;
    while index < normalized.len() {
        let mut run_end = index + 1;
        while run_end < normalized.len()
            && (normalized[run_end].offset - normalized[index].offset).abs() <= GRADIENT_EPSILON
        {
            run_end += 1;
        }
        let duplicate = run_end - index > 1;
        let offset = normalized[index].offset;
        let ignore_leftmost =
            duplicate && !matches!(tile_mode, GradientTileMode2D::Clamp) && offset == 0.0;
        let ignore_rightmost = !matches!(tile_mode, GradientTileMode2D::Clamp) && offset == 1.0;
        if !ignore_leftmost {
            deduped.push(normalized[index].clone());
        }
        if duplicate && !ignore_rightmost {
            deduped.push(normalized[run_end - 1].clone());
        }
        index = run_end;
    }

    if deduped.len() == 1 {
        deduped.push(GradientStop2D {
            offset: 1.0,
            color: deduped[0].color,
        });
    }

    if deduped.len() > MAX_GRADIENT_STOPS {
        let last = deduped.last().cloned().unwrap_or(GradientStop2D {
            offset: 1.0,
            color: ColorValue::default(),
        });
        deduped.truncate(MAX_GRADIENT_STOPS);
        deduped[MAX_GRADIENT_STOPS - 1] = last;
    }

    deduped
}

fn build_fill_path_paint(path: &PathDrawCommand) -> PaintUniform {
    let Some(shader) = &path.shader else {
        return PaintUniform::solid(to_linear_array(path.color));
    };

    let draw_transform =
        multiply_affine_matrices(path.transform, [1.0, 0.0, 0.0, 1.0, path.x, path.y]);
    let inverse_draw_transform =
        invert_affine_transform(draw_transform).unwrap_or([1.0, 0.0, 0.0, 1.0, -path.x, -path.y]);
    let (kind, tile_mode, stops, params0, gradient_matrix) = match shader {
        PathShader2D::LinearGradient {
            start,
            end,
            stops,
            tile_mode,
        } => (
            1.0,
            *tile_mode,
            stops.as_slice(),
            [0.0; 4],
            create_linear_gradient_matrix(*start, *end),
        ),
        PathShader2D::RadialGradient {
            center,
            radius,
            stops,
            tile_mode,
        } => (
            2.0,
            *tile_mode,
            stops.as_slice(),
            [0.0; 4],
            create_radial_gradient_matrix(*center, *radius),
        ),
        PathShader2D::SweepGradient {
            center,
            start_angle,
            end_angle,
            stops,
            tile_mode,
        } => (
            3.0,
            *tile_mode,
            stops.as_slice(),
            [
                -*start_angle / (PI * 2.0),
                1.0 / ((*end_angle - *start_angle) / (PI * 2.0)).max(GRADIENT_EPSILON),
                0.0,
                0.0,
            ],
            create_sweep_gradient_matrix(*center),
        ),
        PathShader2D::TwoPointConicalGradient {
            start_center,
            start_radius,
            end_center,
            end_radius,
            stops,
            tile_mode,
        } => {
            let center_distance =
                (end_center[0] - start_center[0]).hypot(end_center[1] - start_center[1]);
            let params0 = if center_distance <= GRADIENT_EPSILON {
                let diff_radius = *end_radius - *start_radius;
                let scale = if diff_radius.abs() <= GRADIENT_EPSILON {
                    0.0
                } else {
                    1.0 / diff_radius
                };
                let radius0 = *start_radius * scale;
                let d_radius = if radius0 > 0.0 { 1.0 } else { -1.0 };
                [radius0, d_radius, 0.0, 1.0]
            } else {
                let radius0 = *start_radius / center_distance;
                let radius1 = *end_radius / center_distance;
                let d_radius = radius1 - radius0;
                let (a, inv_a) = if (1.0 - (d_radius * d_radius)).abs() > GRADIENT_EPSILON {
                    let a = 1.0 - (d_radius * d_radius);
                    (a, 1.0 / (2.0 * a))
                } else {
                    (0.0, 0.0)
                };
                [radius0, d_radius, a, inv_a]
            };
            (
                4.0,
                *tile_mode,
                stops.as_slice(),
                params0,
                create_conical_gradient_matrix(
                    *start_center,
                    *end_center,
                    *start_radius,
                    *end_radius,
                ),
            )
        }
    };

    let stops = normalize_gradient_stops(stops, tile_mode);
    let local_matrix = multiply_affine_matrices(gradient_matrix, inverse_draw_transform);
    let mut stop_offsets = [0.0; MAX_GRADIENT_STOPS];
    let mut stop_colors = [[0.0; 4]; MAX_GRADIENT_STOPS];
    for (index, stop) in stops.iter().enumerate() {
        stop_offsets[index] = stop.offset;
        stop_colors[index] = to_srgb_array(stop.color);
    }
    let last_offset = *stop_offsets
        .get(stops.len().saturating_sub(1))
        .unwrap_or(&1.0);
    let fallback_color = to_srgb_array(path.color);
    let last_color = stop_colors
        .get(stops.len().saturating_sub(1))
        .copied()
        .unwrap_or(fallback_color);
    for index in stops.len()..MAX_GRADIENT_STOPS {
        stop_offsets[index] = last_offset;
        stop_colors[index] = last_color;
    }

    PaintUniform {
        info: [
            kind,
            gradient_tile_mode_code(tile_mode),
            stops.len() as f32,
            0.0,
        ],
        params0,
        local_matrix0: [
            local_matrix[0],
            local_matrix[1],
            local_matrix[2],
            local_matrix[3],
        ],
        local_matrix1: [local_matrix[4], local_matrix[5], 0.0, 0.0],
        solid_color: [0.0; 4],
        stop_offsets0: [
            stop_offsets[0],
            stop_offsets[1],
            stop_offsets[2],
            stop_offsets[3],
        ],
        stop_offsets1: [
            stop_offsets[4],
            stop_offsets[5],
            stop_offsets[6],
            stop_offsets[7],
        ],
        stop_colors,
    }
}

fn build_path_mask_paint(path: &PathDrawCommand) -> PaintUniform {
    match path.style {
        PathStyle2D::Fill => build_fill_path_paint(path),
        PathStyle2D::Stroke => PaintUniform::solid(resolve_stroke_color(path)),
    }
}

fn vertex_colored_paint() -> PaintUniform {
    PaintUniform::solid([1.0, 1.0, 1.0, 1.0])
}

fn build_rect_vertices(rect: &RectDrawCommand, width: f32, height: f32) -> Vec<DrawingVertex> {
    let top_left_point = transform_point([rect.x, rect.y], rect.transform);
    let top_right_point = transform_point([rect.x + rect.width, rect.y], rect.transform);
    let bottom_left_point = transform_point([rect.x, rect.y + rect.height], rect.transform);
    let bottom_right_point =
        transform_point([rect.x + rect.width, rect.y + rect.height], rect.transform);
    let color = to_linear_array(rect.color);
    let top_left = DrawingVertex {
        position: [
            (top_left_point[0] / width) * 2.0 - 1.0,
            1.0 - (top_left_point[1] / height) * 2.0,
            0.0,
            1.0,
        ],
        color,
        device_position: top_left_point,
    };
    let top_right = DrawingVertex {
        position: [
            (top_right_point[0] / width) * 2.0 - 1.0,
            1.0 - (top_right_point[1] / height) * 2.0,
            0.0,
            1.0,
        ],
        color,
        device_position: top_right_point,
    };
    let bottom_left = DrawingVertex {
        position: [
            (bottom_left_point[0] / width) * 2.0 - 1.0,
            1.0 - (bottom_left_point[1] / height) * 2.0,
            0.0,
            1.0,
        ],
        color,
        device_position: bottom_left_point,
    };
    let bottom_right = DrawingVertex {
        position: [
            (bottom_right_point[0] / width) * 2.0 - 1.0,
            1.0 - (bottom_right_point[1] / height) * 2.0,
            0.0,
            1.0,
        ],
        color,
        device_position: bottom_right_point,
    };
    vec![
        top_left,
        bottom_left,
        top_right,
        top_right,
        bottom_left,
        bottom_right,
    ]
}

fn build_path_mask_vertices(
    mask: &CoverageMask,
    width: f32,
    height: f32,
    painter_depth: f32,
) -> Vec<PathMaskVertex> {
    let left = mask.mask_origin[0];
    let top = mask.mask_origin[1];
    let mask_width = mask.mask_size[0] as f32;
    let mask_height = mask.mask_size[1] as f32;
    let uv_left = mask.texture_origin[0] as f32 / mask.atlas_size[0] as f32;
    let uv_top = mask.texture_origin[1] as f32 / mask.atlas_size[1] as f32;
    let uv_right = (mask.texture_origin[0] + mask.mask_size[0]) as f32 / mask.atlas_size[0] as f32;
    let uv_bottom = (mask.texture_origin[1] + mask.mask_size[1]) as f32 / mask.atlas_size[1] as f32;
    let corners = [
        ([left, top], [uv_left, uv_top]),
        ([left + mask_width, top], [uv_right, uv_top]),
        (
            [left + mask_width, top + mask_height],
            [uv_right, uv_bottom],
        ),
        ([left, top + mask_height], [uv_left, uv_bottom]),
    ];
    [0usize, 1, 2, 0, 2, 3]
        .into_iter()
        .map(|index| {
            let (device_position, uv) = corners[index];
            PathMaskVertex {
                position: [
                    (device_position[0] / width) * 2.0 - 1.0,
                    1.0 - (device_position[1] / height) * 2.0,
                    painter_depth,
                    1.0,
                ],
                device_position,
                uv,
            }
        })
        .collect()
}

fn build_path_steps(
    path: &PathDrawCommand,
    width: f32,
    height: f32,
    painter_depth: f32,
    surface_width: u32,
    surface_height: u32,
    atlas_provider: Option<&mut AtlasProvider>,
) -> Vec<DrawingPreparedStep> {
    let mut steps = Vec::new();
    if let Some(step) = prepare_path_mask_step(
        path,
        width,
        height,
        painter_depth,
        surface_width,
        surface_height,
        atlas_provider,
    ) {
        steps.push(DrawingPreparedStep::PathMask(step));
        return steps;
    }

    let path_paint = build_fill_path_paint(path);
    match path.style {
        PathStyle2D::Fill => {
            for step in prepare_fill_steps(path, painter_depth) {
                match step {
                    PreparedFillStep::Triangles(PreparedFillTriangleStep { points, mode }) => {
                        let Some(vertices) = points_to_vertices_with_color(
                            &points
                                .into_iter()
                                .map(|point| transform_point(point, path.transform))
                                .collect::<Vec<_>>(),
                            [1.0, 1.0, 1.0, 1.0],
                            width,
                            height,
                        ) else {
                            continue;
                        };
                        steps.push(DrawingPreparedStep::Triangles {
                            vertices: with_vertex_depth(vertices, painter_depth),
                            mode: match mode {
                                FillTriangleMode::StencilEvenodd => {
                                    TriangleStepMode::StencilEvenodd
                                }
                                FillTriangleMode::StencilNonzero => {
                                    TriangleStepMode::StencilNonzero
                                }
                                FillTriangleMode::StencilCover => TriangleStepMode::StencilCover,
                            },
                            paint: path_paint,
                        });
                    }
                    PreparedFillStep::Wedges(mut step) => {
                        for instance in &mut step.instances {
                            instance.p0 = transform_point(instance.p0, path.transform);
                            instance.p1 = transform_point(instance.p1, path.transform);
                            instance.p2 = transform_point(instance.p2, path.transform);
                            instance.p3 = transform_point(instance.p3, path.transform);
                            instance.fan_point =
                                transform_point(instance.fan_point, path.transform);
                        }
                        steps.push(DrawingPreparedStep::WedgeFillPatches {
                            step,
                            paint: path_paint,
                        });
                    }
                    PreparedFillStep::Curves(mut step) => {
                        for instance in &mut step.instances {
                            instance.p0 = transform_point(instance.p0, path.transform);
                            instance.p1 = transform_point(instance.p1, path.transform);
                            instance.p2 = transform_point(instance.p2, path.transform);
                            instance.p3 = transform_point(instance.p3, path.transform);
                        }
                        steps.push(DrawingPreparedStep::CurveFillPatches {
                            step,
                            paint: path_paint,
                        });
                    }
                }
            }
        }
        PathStyle2D::Stroke => {
            let stroke_style = resolve_stroke_style(path);
            let stroke_color = resolve_stroke_color(path);
            let stroke_patch_path =
                is_translation_only_affine_transform(path.transform).then(|| {
                    let mut translated = path.clone();
                    translated.x += path.transform[4];
                    translated.y += path.transform[5];
                    translated.transform = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
                    translated
                });
            let dashed_subpaths = if let Some(stroke_patch_path) = stroke_patch_path.as_ref() {
                apply_dash_pattern(flatten_subpaths(stroke_patch_path), stroke_patch_path)
            } else {
                apply_dash_pattern(flatten_subpaths(path), path)
            };
            if let Some(stroke_patch_path) = stroke_patch_path.as_ref() {
                if let Some(step) = prepare_stroke_patch_step(
                    stroke_patch_path,
                    stroke_style,
                    &dashed_subpaths,
                    stroke_color,
                    painter_depth,
                ) {
                    steps.push(DrawingPreparedStep::StrokePatches(step));
                    return steps;
                }
            }
            let (interior, fringe) = build_stroke_vertices(path, width, height);
            if let Some(vertices) = interior {
                steps.push(DrawingPreparedStep::Triangles {
                    vertices: with_vertex_depth(
                        transform_vertices(vertices, path.transform, width, height),
                        painter_depth,
                    ),
                    mode: TriangleStepMode::Direct,
                    paint: vertex_colored_paint(),
                });
            }
            if let Some(vertices) = fringe {
                steps.push(DrawingPreparedStep::Triangles {
                    vertices: with_vertex_depth(
                        transform_vertices(vertices, path.transform, width, height),
                        painter_depth,
                    ),
                    mode: TriangleStepMode::Direct,
                    paint: vertex_colored_paint(),
                });
            }
        }
    }
    steps
}

fn prepare_path_mask_step(
    path: &PathDrawCommand,
    width: f32,
    height: f32,
    painter_depth: f32,
    surface_width: u32,
    surface_height: u32,
    atlas_provider: Option<&mut AtlasProvider>,
) -> Option<PreparedPathMaskStep> {
    let atlas_provider = atlas_provider?;
    let mask = atlas_provider.prepare_mask(path, surface_width, surface_height)?;
    let vertices = build_path_mask_vertices(&mask, width, height, painter_depth);
    (!vertices.is_empty()).then_some(PreparedPathMaskStep {
        vertices,
        paint: build_path_mask_paint(path),
        mask,
    })
}

fn build_stroke_vertices(
    path: &PathDrawCommand,
    width: f32,
    height: f32,
) -> (Option<Vec<DrawingVertex>>, Option<Vec<DrawingVertex>>) {
    let stroke_style = resolve_stroke_style(path);
    let stroke_color = resolve_stroke_color(path);
    let subpaths = apply_dash_pattern(flatten_subpaths(path), path);
    let contours = create_stroke_contours(&subpaths, stroke_style.half_width);
    let mut triangles = Vec::new();
    let mut fringe = Vec::new();
    let color = stroke_color;
    let transparent = [color[0], color[1], color[2], 0.0];
    let half_width = stroke_style.half_width;

    for contour in contours {
        if contour.points.len() < 2 {
            if let Some(point) = contour.degenerate_point {
                append_degenerate_stroke_cap(&mut triangles, point, half_width, stroke_style.cap);
                append_degenerate_stroke_cap_fringe(
                    &mut fringe,
                    point,
                    half_width,
                    stroke_style.cap,
                    color,
                );
            }
            continue;
        }

        for segment in &contour.segments {
            append_quad(
                &mut triangles,
                segment.left_start,
                segment.left_end,
                segment.right_end,
                segment.right_start,
            );

            let left_outer_start = add(
                segment.start,
                scale(segment.normal, half_width + AA_FRINGE_WIDTH),
            );
            let left_outer_end = add(
                segment.end,
                scale(segment.normal, half_width + AA_FRINGE_WIDTH),
            );
            let right_outer_start = add(
                segment.start,
                scale(segment.normal, -(half_width + AA_FRINGE_WIDTH)),
            );
            let right_outer_end = add(
                segment.end,
                scale(segment.normal, -(half_width + AA_FRINGE_WIDTH)),
            );

            append_colored_quad(
                &mut fringe,
                ColoredPoint {
                    point: segment.left_start,
                    color,
                },
                ColoredPoint {
                    point: segment.left_end,
                    color,
                },
                ColoredPoint {
                    point: left_outer_end,
                    color: transparent,
                },
                ColoredPoint {
                    point: left_outer_start,
                    color: transparent,
                },
            );
            append_colored_quad(
                &mut fringe,
                ColoredPoint {
                    point: segment.right_end,
                    color,
                },
                ColoredPoint {
                    point: segment.right_start,
                    color,
                },
                ColoredPoint {
                    point: right_outer_start,
                    color: transparent,
                },
                ColoredPoint {
                    point: right_outer_end,
                    color: transparent,
                },
            );
        }

        if contour.segments.is_empty() {
            continue;
        }

        if contour.closed {
            for index in 0..contour.segments.len() {
                if !contour.corners[index] {
                    let incoming = contour.segments
                        [(index + contour.segments.len() - 1) % contour.segments.len()];
                    let outgoing = contour.segments[index];
                    append_stroke_subdivision_body(&mut triangles, incoming, outgoing);
                    append_stroke_subdivision_fringe(
                        &mut fringe,
                        incoming,
                        outgoing,
                        half_width,
                        color,
                    );
                    continue;
                }
                let incoming =
                    contour.segments[(index + contour.segments.len() - 1) % contour.segments.len()];
                let outgoing = contour.segments[index];
                append_stroke_join(
                    &mut triangles,
                    outgoing.start,
                    incoming.direction,
                    outgoing.direction,
                    half_width,
                    path.stroke_join,
                    stroke_style.join_limit,
                );
                append_stroke_join_fringe(
                    &mut fringe,
                    outgoing.start,
                    incoming.direction,
                    outgoing.direction,
                    half_width,
                    path.stroke_join,
                    stroke_style.join_limit,
                    color,
                );
            }
        } else {
            append_stroke_cap(
                &mut triangles,
                contour.segments[0].start,
                contour.segments[0].direction,
                contour.segments[0].normal,
                half_width,
                stroke_style.cap,
                true,
            );
            append_stroke_cap_fringe(
                &mut fringe,
                contour.segments[0].start,
                contour.segments[0].direction,
                contour.segments[0].normal,
                half_width,
                stroke_style.cap,
                true,
                color,
            );
            append_stroke_cap(
                &mut triangles,
                contour.segments[contour.segments.len() - 1].end,
                contour.segments[contour.segments.len() - 1].direction,
                contour.segments[contour.segments.len() - 1].normal,
                half_width,
                stroke_style.cap,
                false,
            );
            append_stroke_cap_fringe(
                &mut fringe,
                contour.segments[contour.segments.len() - 1].end,
                contour.segments[contour.segments.len() - 1].direction,
                contour.segments[contour.segments.len() - 1].normal,
                half_width,
                stroke_style.cap,
                false,
                color,
            );
            for index in 1..contour.segments.len() {
                if !contour.corners[index] {
                    let incoming = contour.segments[index - 1];
                    let outgoing = contour.segments[index];
                    append_stroke_subdivision_body(&mut triangles, incoming, outgoing);
                    append_stroke_subdivision_fringe(
                        &mut fringe,
                        incoming,
                        outgoing,
                        half_width,
                        color,
                    );
                    continue;
                }
                append_stroke_join(
                    &mut triangles,
                    contour.segments[index].start,
                    contour.segments[index - 1].direction,
                    contour.segments[index].direction,
                    half_width,
                    path.stroke_join,
                    stroke_style.join_limit,
                );
                append_stroke_join_fringe(
                    &mut fringe,
                    contour.segments[index].start,
                    contour.segments[index - 1].direction,
                    contour.segments[index].direction,
                    half_width,
                    path.stroke_join,
                    stroke_style.join_limit,
                    color,
                );
            }
        }
    }

    let interior = points_to_vertices_with_color(&triangles, color, width, height);
    let fringe = colored_points_to_vertices(&fringe, width, height);
    (interior, fringe)
}

fn points_to_vertices_with_color(
    points: &[Point],
    color: [f32; 4],
    width: f32,
    height: f32,
) -> Option<Vec<DrawingVertex>> {
    if points.is_empty() {
        return None;
    }
    Some(
        points
            .iter()
            .map(|point| vertex_from_point(*point, color, width, height))
            .collect(),
    )
}

fn colored_points_to_vertices(
    points: &[ColoredPoint],
    width: f32,
    height: f32,
) -> Option<Vec<DrawingVertex>> {
    if points.is_empty() {
        return None;
    }
    Some(
        points
            .iter()
            .map(|point| vertex_from_point(point.point, point.color, width, height))
            .collect(),
    )
}

fn vertex_from_point(point: Point, color: [f32; 4], width: f32, height: f32) -> DrawingVertex {
    DrawingVertex {
        position: [
            (point[0] / width) * 2.0 - 1.0,
            1.0 - (point[1] / height) * 2.0,
            0.0,
            1.0,
        ],
        color,
        device_position: point,
    }
}

fn arc_endpoint(
    center: [f32; 2],
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) -> [f32; 2] {
    let angle = start_angle + normalized_arc_sweep(start_angle, end_angle, counter_clockwise);
    [
        center[0] + radius * angle.cos(),
        center[1] + radius * angle.sin(),
    ]
}

fn normalized_arc_sweep(start_angle: f32, end_angle: f32, counter_clockwise: bool) -> f32 {
    let mut sweep = end_angle - start_angle;
    if counter_clockwise {
        while sweep <= 0.0 {
            sweep += PI * 2.0;
        }
    } else {
        while sweep >= 0.0 {
            sweep -= PI * 2.0;
        }
    }
    sweep
}

fn flatten_subpaths(path: &PathDrawCommand) -> Vec<FlattenedSubpath> {
    let mut subpaths = Vec::new();
    let mut current = [path.x, path.y];
    let mut current_points: Vec<Point> = Vec::new();
    let mut current_corners: Vec<bool> = Vec::new();
    let mut saw_geometry = false;

    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                push_subpath(
                    &mut subpaths,
                    &mut current_points,
                    &mut current_corners,
                    false,
                );
                let target = [path.x + to[0], path.y + to[1]];
                current = target;
                current_points.push(target);
                current_corners.push(true);
                saw_geometry = true;
            }
            PathVerb2D::LineTo { to } => {
                if !saw_geometry {
                    current_points.push(current);
                    current_corners.push(true);
                    saw_geometry = true;
                }
                let target = [path.x + to[0], path.y + to[1]];
                push_unique_point(&mut current_points, &mut current_corners, target, true);
                current = target;
            }
            PathVerb2D::QuadTo { control, to } => {
                if !saw_geometry {
                    current_points.push(current);
                    current_corners.push(true);
                    saw_geometry = true;
                }
                let control = [path.x + control[0], path.y + control[1]];
                let target = [path.x + to[0], path.y + to[1]];
                flatten_quadratic_recursive(
                    current,
                    control,
                    target,
                    0,
                    &mut current_points,
                    &mut current_corners,
                );
                current = target;
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                if !saw_geometry {
                    current_points.push(current);
                    saw_geometry = true;
                }
                let control = [path.x + control[0], path.y + control[1]];
                let target = [path.x + to[0], path.y + to[1]];
                flatten_conic(
                    current,
                    control,
                    target,
                    weight,
                    &mut current_points,
                    &mut current_corners,
                );
                current = target;
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                if !saw_geometry {
                    current_points.push(current);
                    saw_geometry = true;
                }
                let control1 = [path.x + control1[0], path.y + control1[1]];
                let control2 = [path.x + control2[0], path.y + control2[1]];
                let target = [path.x + to[0], path.y + to[1]];
                flatten_cubic_recursive(
                    current,
                    control1,
                    control2,
                    target,
                    0,
                    &mut current_points,
                    &mut current_corners,
                );
                current = target;
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                if !saw_geometry {
                    current_points.push(current);
                    saw_geometry = true;
                }
                let center = [path.x + center[0], path.y + center[1]];
                flatten_arc(
                    center,
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                    &mut current_points,
                    &mut current_corners,
                );
                current = arc_endpoint(center, radius, start_angle, end_angle, counter_clockwise);
            }
            PathVerb2D::Close => {
                push_subpath(
                    &mut subpaths,
                    &mut current_points,
                    &mut current_corners,
                    true,
                );
                saw_geometry = false;
            }
        }
    }

    push_subpath(
        &mut subpaths,
        &mut current_points,
        &mut current_corners,
        false,
    );
    subpaths
}

fn push_subpath(
    subpaths: &mut Vec<FlattenedSubpath>,
    points: &mut Vec<Point>,
    corners: &mut Vec<bool>,
    closed: bool,
) {
    let (normalized, normalized_corners) =
        normalize_subpath_points(std::mem::take(points), std::mem::take(corners));
    if normalized.is_empty() {
        return;
    }
    let actually_closed = closed
        || (normalized.len() > 2 && points_equal(normalized[0], normalized[normalized.len() - 1]));
    let (normalized, normalized_corners) = if actually_closed
        && normalized.len() > 1
        && points_equal(normalized[0], normalized[normalized.len() - 1])
    {
        (
            normalized[..normalized.len() - 1].to_vec(),
            normalized_corners[..normalized_corners.len() - 1].to_vec(),
        )
    } else {
        (normalized, normalized_corners)
    };
    subpaths.push(FlattenedSubpath {
        points: normalized,
        corners: normalized_corners,
        closed: actually_closed,
    });
}

fn normalize_subpath_points(points: Vec<Point>, corners: Vec<bool>) -> (Vec<Point>, Vec<bool>) {
    let mut normalized = Vec::new();
    let mut normalized_corners = Vec::new();
    for (point, corner) in points.into_iter().zip(corners) {
        if normalized
            .last()
            .copied()
            .is_some_and(|last| points_equal(last, point))
        {
            if let Some(last_corner) = normalized_corners.last_mut() {
                *last_corner = *last_corner || corner;
            }
            continue;
        }
        normalized.push(point);
        normalized_corners.push(corner);
    }
    (normalized, normalized_corners)
}

fn create_stroke_contours(
    subpaths: &[FlattenedSubpath],
    half_width: f32,
) -> Vec<StrokeContourRecord> {
    subpaths
        .iter()
        .map(|subpath| StrokeContourRecord {
            points: subpath.points.clone(),
            corners: subpath.corners.clone(),
            closed: subpath.closed,
            segments: build_stroke_segment_records(&subpath.points, subpath.closed, half_width),
            degenerate_point: (subpath.points.len() == 1).then_some(subpath.points[0]),
        })
        .collect()
}

fn build_stroke_segment_records(
    points: &[Point],
    closed: bool,
    half_width: f32,
) -> Vec<StrokeSegmentRecord> {
    let mut segments = Vec::new();
    for index in 0..points.len().saturating_sub(1) {
        append_stroke_segment(&mut segments, points[index], points[index + 1], half_width);
    }
    if closed && points.len() > 2 {
        append_stroke_segment(
            &mut segments,
            points[points.len() - 1],
            points[0],
            half_width,
        );
    }
    segments
}

fn append_stroke_segment(
    segments: &mut Vec<StrokeSegmentRecord>,
    start: Point,
    end: Point,
    half_width: f32,
) {
    let Some(direction) = normalize(subtract(end, start)) else {
        return;
    };
    let normal = perpendicular(direction);
    segments.push(StrokeSegmentRecord {
        start,
        end,
        direction,
        normal,
        left_start: add(start, scale(normal, half_width)),
        right_start: add(start, scale(normal, -half_width)),
        left_end: add(end, scale(normal, half_width)),
        right_end: add(end, scale(normal, -half_width)),
    });
}

fn apply_dash_pattern(
    subpaths: Vec<FlattenedSubpath>,
    path: &PathDrawCommand,
) -> Vec<FlattenedSubpath> {
    let Some(dash_array) = normalize_dash_array(&path.dash_array) else {
        return subpaths;
    };
    let mut dashed = Vec::new();
    for subpath in subpaths {
        dashed.extend(build_dashed_polyline(
            &subpath.points,
            &subpath.corners,
            subpath.closed,
            &dash_array,
            path.dash_offset,
        ));
    }
    dashed
}

fn normalize_dash_array(dash_array: &[f32]) -> Option<Vec<f32>> {
    let filtered = dash_array
        .iter()
        .copied()
        .filter(|value| *value > EPSILON)
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        return None;
    }
    if filtered.len() % 2 == 1 {
        return Some(
            filtered
                .iter()
                .copied()
                .chain(filtered.iter().copied())
                .collect(),
        );
    }
    Some(filtered)
}

fn build_dashed_polyline(
    points: &[Point],
    corners: &[bool],
    closed: bool,
    dash_array: &[f32],
    dash_offset: f32,
) -> Vec<FlattenedSubpath> {
    if points.len() < 2 {
        return Vec::new();
    }

    let total_pattern_length = dash_array.iter().sum::<f32>();
    if total_pattern_length <= EPSILON {
        return Vec::new();
    }

    let mut offset = dash_offset.rem_euclid(total_pattern_length);
    let mut dash_index = 0usize;
    while offset > dash_array[dash_index] {
        offset -= dash_array[dash_index];
        dash_index = (dash_index + 1) % dash_array.len();
    }
    let mut dash_remaining = dash_array[dash_index] - offset;
    let mut drawing = dash_index % 2 == 0;

    let mut segments = Vec::new();
    let point_count = if closed {
        points.len() + 1
    } else {
        points.len()
    };
    for index in 1..point_count {
        let start_index = (index - 1) % points.len();
        let end_index = index % points.len();
        let mut start = points[(index - 1) % points.len()];
        let end = points[index % points.len()];
        let mut remaining = distance(start, end);
        if remaining <= EPSILON {
            continue;
        }
        let original_segment_length = remaining;
        let mut advanced = 0.0;
        while remaining > EPSILON {
            let step = remaining.min(dash_remaining);
            let split = lerp(start, end, step / remaining);
            if drawing {
                let start_corner =
                    advanced <= EPSILON && corners.get(start_index).copied().unwrap_or(false);
                let end_corner = (advanced + step) >= original_segment_length - EPSILON
                    && corners.get(end_index).copied().unwrap_or(false);
                segments.push((start, start_corner, split, end_corner));
            }
            start = split;
            remaining -= step;
            advanced += step;
            dash_remaining -= step;
            if dash_remaining <= EPSILON {
                dash_index = (dash_index + 1) % dash_array.len();
                dash_remaining = dash_array[dash_index];
                drawing = dash_index % 2 == 0;
            }
        }
    }

    let mut dashed = Vec::new();
    let mut current = Vec::new();
    let mut current_corners = Vec::new();
    for (start, start_corner, end, end_corner) in segments {
        if current.is_empty() {
            current.push(start);
            current_corners.push(start_corner);
            current.push(end);
            current_corners.push(end_corner);
            continue;
        }
        if points_equal(*current.last().unwrap(), start) {
            if let Some(last_corner) = current_corners.last_mut() {
                *last_corner = *last_corner || start_corner;
            }
            current.push(end);
            current_corners.push(end_corner);
            continue;
        }
        let (normalized_points, normalized_corners) = normalize_subpath_points(
            std::mem::take(&mut current),
            std::mem::take(&mut current_corners),
        );
        dashed.push(FlattenedSubpath {
            points: normalized_points,
            corners: normalized_corners,
            closed: false,
        });
        current.push(start);
        current_corners.push(start_corner);
        current.push(end);
        current_corners.push(end_corner);
    }
    if !current.is_empty() {
        let (normalized_points, normalized_corners) =
            normalize_subpath_points(current, current_corners);
        dashed.push(FlattenedSubpath {
            points: normalized_points,
            corners: normalized_corners,
            closed: false,
        });
    }
    dashed
}

fn resolve_stroke_color(path: &PathDrawCommand) -> [f32; 4] {
    let mut color = to_linear_array(path.color);
    if path.stroke_width >= HAIRLINE_COVERAGE_WIDTH {
        return color;
    }
    let coverage = (path.stroke_width / HAIRLINE_COVERAGE_WIDTH).max(0.0);
    color[3] *= coverage;
    color
}

fn resolve_stroke_style(path: &PathDrawCommand) -> StrokeStyle {
    let stroke_width = path.stroke_width.max(EPSILON);
    let half_width = stroke_width.max(0.5) * 0.5;
    let join_limit = match path.stroke_join {
        PathStrokeJoin2D::Round => -1.0,
        PathStrokeJoin2D::Bevel => 0.0,
        PathStrokeJoin2D::Miter => DEFAULT_MITER_LIMIT.max(1.0),
    };
    StrokeStyle {
        half_width,
        join_limit,
        cap: path.stroke_cap,
    }
}

fn append_triangle(triangles: &mut Vec<Point>, a: Point, b: Point, c: Point) {
    triangles.extend([a, b, c]);
}

fn append_quad(triangles: &mut Vec<Point>, a: Point, b: Point, c: Point, d: Point) {
    triangles.extend([a, b, c, a, c, d]);
}

fn append_colored_quad(
    triangles: &mut Vec<ColoredPoint>,
    a: ColoredPoint,
    b: ColoredPoint,
    c: ColoredPoint,
    d: ColoredPoint,
) {
    triangles.extend([a, b, c, a, c, d]);
}

fn append_colored_triangle(
    triangles: &mut Vec<ColoredPoint>,
    a: ColoredPoint,
    b: ColoredPoint,
    c: ColoredPoint,
) {
    triangles.extend([a, b, c]);
}

fn append_round_fan(
    triangles: &mut Vec<Point>,
    center: Point,
    start: Point,
    end: Point,
    approx_stroke_radius: f32,
) {
    let start_angle = (start[1] - center[1]).atan2(start[0] - center[0]);
    let mut span = (end[1] - center[1]).atan2(end[0] - center[0]) - start_angle;
    while span <= -PI {
        span += PI * 2.0;
    }
    while span > PI {
        span -= PI * 2.0;
    }
    if span.abs() <= EPSILON {
        span = PI * 2.0;
    }
    let steps = (span * calc_num_radial_segments_per_radian(approx_stroke_radius))
        .abs()
        .ceil()
        .max(2.0) as usize;
    let radius = distance(center, start);
    let mut previous = start;
    for index in 1..=steps {
        let angle = start_angle + span * index as f32 / steps as f32;
        let next = [
            center[0] + angle.cos() * radius,
            center[1] + angle.sin() * radius,
        ];
        append_triangle(triangles, center, previous, next);
        previous = next;
    }
}

fn append_stroke_cap(
    triangles: &mut Vec<Point>,
    point: Point,
    direction: Point,
    normal: Point,
    half_width: f32,
    cap: PathStrokeCap2D,
    at_start: bool,
) {
    let signed_direction = if at_start {
        scale(direction, -1.0)
    } else {
        direction
    };
    let left = add(point, scale(normal, half_width));
    let right = add(point, scale(normal, -half_width));
    match cap {
        PathStrokeCap2D::Butt => {}
        PathStrokeCap2D::Square => {
            let extension = scale(signed_direction, half_width);
            append_quad(
                triangles,
                add(left, extension),
                add(right, extension),
                right,
                left,
            );
        }
        PathStrokeCap2D::Round => {
            let start = if at_start { right } else { left };
            let end = if at_start { left } else { right };
            append_round_fan(triangles, point, start, end, half_width);
        }
    }
}

fn append_stroke_cap_fringe(
    fringe: &mut Vec<ColoredPoint>,
    point: Point,
    direction: Point,
    normal: Point,
    half_width: f32,
    cap: PathStrokeCap2D,
    at_start: bool,
    color: [f32; 4],
) {
    let transparent = [color[0], color[1], color[2], 0.0];
    let signed_direction = if at_start {
        scale(direction, -1.0)
    } else {
        direction
    };
    let left = add(point, scale(normal, half_width));
    let right = add(point, scale(normal, -half_width));

    match cap {
        PathStrokeCap2D::Butt => {
            let outward = scale(signed_direction, AA_FRINGE_WIDTH);
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: right,
                    color,
                },
                ColoredPoint { point: left, color },
                ColoredPoint {
                    point: add(left, outward),
                    color: transparent,
                },
                ColoredPoint {
                    point: add(right, outward),
                    color: transparent,
                },
            );
        }
        PathStrokeCap2D::Square => {
            let extension = scale(signed_direction, half_width);
            let cap_left = add(left, extension);
            let cap_right = add(right, extension);
            let outward = scale(signed_direction, AA_FRINGE_WIDTH);
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: cap_right,
                    color,
                },
                ColoredPoint {
                    point: cap_left,
                    color,
                },
                ColoredPoint {
                    point: add(cap_left, outward),
                    color: transparent,
                },
                ColoredPoint {
                    point: add(cap_right, outward),
                    color: transparent,
                },
            );
            let left_side_outset = add(cap_left, scale(normal, AA_FRINGE_WIDTH));
            append_colored_quad(
                fringe,
                ColoredPoint { point: left, color },
                ColoredPoint {
                    point: cap_left,
                    color,
                },
                ColoredPoint {
                    point: left_side_outset,
                    color: transparent,
                },
                ColoredPoint {
                    point: add(left, scale(normal, AA_FRINGE_WIDTH)),
                    color: transparent,
                },
            );
            let right_side_outset = add(cap_right, scale(normal, -AA_FRINGE_WIDTH));
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: cap_right,
                    color,
                },
                ColoredPoint {
                    point: right,
                    color,
                },
                ColoredPoint {
                    point: add(right, scale(normal, -AA_FRINGE_WIDTH)),
                    color: transparent,
                },
                ColoredPoint {
                    point: right_side_outset,
                    color: transparent,
                },
            );
        }
        PathStrokeCap2D::Round => {
            let start = if at_start { right } else { left };
            let end = if at_start { left } else { right };
            append_round_fringe(fringe, point, start, end, half_width, color);
        }
    }
}

fn append_degenerate_stroke_cap(
    triangles: &mut Vec<Point>,
    point: Point,
    half_width: f32,
    cap: PathStrokeCap2D,
) {
    match cap {
        PathStrokeCap2D::Butt => {}
        PathStrokeCap2D::Square => {
            append_quad(
                triangles,
                [point[0] - half_width, point[1] - half_width],
                [point[0] + half_width, point[1] - half_width],
                [point[0] + half_width, point[1] + half_width],
                [point[0] - half_width, point[1] + half_width],
            );
        }
        PathStrokeCap2D::Round => {
            let start = [point[0] + half_width, point[1]];
            append_round_fan(triangles, point, start, start, half_width);
        }
    }
}

fn append_degenerate_stroke_cap_fringe(
    fringe: &mut Vec<ColoredPoint>,
    point: Point,
    half_width: f32,
    cap: PathStrokeCap2D,
    color: [f32; 4],
) {
    let transparent = [color[0], color[1], color[2], 0.0];
    match cap {
        PathStrokeCap2D::Butt => {}
        PathStrokeCap2D::Square => {
            let left = point[0] - half_width;
            let right = point[0] + half_width;
            let top = point[1] - half_width;
            let bottom = point[1] + half_width;
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: [left, top],
                    color,
                },
                ColoredPoint {
                    point: [right, top],
                    color,
                },
                ColoredPoint {
                    point: [right, top - AA_FRINGE_WIDTH],
                    color: transparent,
                },
                ColoredPoint {
                    point: [left, top - AA_FRINGE_WIDTH],
                    color: transparent,
                },
            );
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: [right, top],
                    color,
                },
                ColoredPoint {
                    point: [right, bottom],
                    color,
                },
                ColoredPoint {
                    point: [right + AA_FRINGE_WIDTH, bottom],
                    color: transparent,
                },
                ColoredPoint {
                    point: [right + AA_FRINGE_WIDTH, top],
                    color: transparent,
                },
            );
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: [right, bottom],
                    color,
                },
                ColoredPoint {
                    point: [left, bottom],
                    color,
                },
                ColoredPoint {
                    point: [left, bottom + AA_FRINGE_WIDTH],
                    color: transparent,
                },
                ColoredPoint {
                    point: [right, bottom + AA_FRINGE_WIDTH],
                    color: transparent,
                },
            );
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: [left, bottom],
                    color,
                },
                ColoredPoint {
                    point: [left, top],
                    color,
                },
                ColoredPoint {
                    point: [left - AA_FRINGE_WIDTH, top],
                    color: transparent,
                },
                ColoredPoint {
                    point: [left - AA_FRINGE_WIDTH, bottom],
                    color: transparent,
                },
            );
        }
        PathStrokeCap2D::Round => {
            let start = [point[0] + half_width, point[1]];
            append_round_fringe(fringe, point, start, start, half_width, color);
        }
    }
}

fn append_stroke_join(
    triangles: &mut Vec<Point>,
    point: Point,
    in_direction: Point,
    out_direction: Point,
    half_width: f32,
    join: PathStrokeJoin2D,
    miter_limit: f32,
) {
    let in_normal = perpendicular(in_direction);
    let out_normal = perpendicular(out_direction);
    let turn = cross(in_direction, out_direction);
    if turn.abs() <= EPSILON {
        return;
    }
    let outer_sign = if turn > 0.0 { 1.0 } else { -1.0 };
    let outer_start = add(point, scale(in_normal, half_width * outer_sign));
    let outer_end = add(point, scale(out_normal, half_width * outer_sign));

    match join {
        PathStrokeJoin2D::Round => {
            append_round_fan(triangles, point, outer_start, outer_end, half_width);
        }
        PathStrokeJoin2D::Miter => {
            if let Some(miter_point) =
                line_intersection(outer_start, in_direction, outer_end, out_direction)
            {
                let miter_length = distance(miter_point, point) / half_width.max(EPSILON);
                if miter_length <= miter_limit {
                    append_triangle(triangles, point, outer_start, miter_point);
                    append_triangle(triangles, point, miter_point, outer_end);
                    return;
                }
            }
            append_triangle(triangles, point, outer_start, outer_end);
        }
        PathStrokeJoin2D::Bevel => {
            append_triangle(triangles, point, outer_start, outer_end);
        }
    }
}

fn append_stroke_join_fringe(
    fringe: &mut Vec<ColoredPoint>,
    point: Point,
    in_direction: Point,
    out_direction: Point,
    half_width: f32,
    join: PathStrokeJoin2D,
    miter_limit: f32,
    color: [f32; 4],
) {
    let transparent = [color[0], color[1], color[2], 0.0];
    let in_normal = perpendicular(in_direction);
    let out_normal = perpendicular(out_direction);
    let turn = cross(in_direction, out_direction);
    if turn.abs() <= EPSILON {
        return;
    }
    let outer_sign = if turn > 0.0 { 1.0 } else { -1.0 };
    let outer_start = add(point, scale(in_normal, half_width * outer_sign));
    let outer_end = add(point, scale(out_normal, half_width * outer_sign));
    match join {
        PathStrokeJoin2D::Round => {
            append_round_fringe(fringe, point, outer_start, outer_end, half_width, color);
        }
        PathStrokeJoin2D::Bevel => {
            let start_outset = add(
                point,
                scale(in_normal, (half_width + AA_FRINGE_WIDTH) * outer_sign),
            );
            let end_outset = add(
                point,
                scale(out_normal, (half_width + AA_FRINGE_WIDTH) * outer_sign),
            );
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: outer_start,
                    color,
                },
                ColoredPoint {
                    point: outer_end,
                    color,
                },
                ColoredPoint {
                    point: end_outset,
                    color: transparent,
                },
                ColoredPoint {
                    point: start_outset,
                    color: transparent,
                },
            );
        }
        PathStrokeJoin2D::Miter => {
            if let Some(miter_point) =
                line_intersection(outer_start, in_direction, outer_end, out_direction)
            {
                let miter_length = distance(miter_point, point) / half_width.max(EPSILON);
                if miter_length <= miter_limit {
                    let miter_scale = (half_width + AA_FRINGE_WIDTH) / half_width.max(EPSILON);
                    let outer_miter = add(point, scale(subtract(miter_point, point), miter_scale));
                    append_colored_quad(
                        fringe,
                        ColoredPoint {
                            point: outer_start,
                            color,
                        },
                        ColoredPoint {
                            point: miter_point,
                            color,
                        },
                        ColoredPoint {
                            point: outer_miter,
                            color: transparent,
                        },
                        ColoredPoint {
                            point: add(
                                point,
                                scale(in_normal, (half_width + AA_FRINGE_WIDTH) * outer_sign),
                            ),
                            color: transparent,
                        },
                    );
                    append_colored_quad(
                        fringe,
                        ColoredPoint {
                            point: miter_point,
                            color,
                        },
                        ColoredPoint {
                            point: outer_end,
                            color,
                        },
                        ColoredPoint {
                            point: add(
                                point,
                                scale(out_normal, (half_width + AA_FRINGE_WIDTH) * outer_sign),
                            ),
                            color: transparent,
                        },
                        ColoredPoint {
                            point: outer_miter,
                            color: transparent,
                        },
                    );
                    return;
                }
            }
            let start_outset = add(
                point,
                scale(in_normal, (half_width + AA_FRINGE_WIDTH) * outer_sign),
            );
            let end_outset = add(
                point,
                scale(out_normal, (half_width + AA_FRINGE_WIDTH) * outer_sign),
            );
            append_colored_quad(
                fringe,
                ColoredPoint {
                    point: outer_start,
                    color,
                },
                ColoredPoint {
                    point: outer_end,
                    color,
                },
                ColoredPoint {
                    point: end_outset,
                    color: transparent,
                },
                ColoredPoint {
                    point: start_outset,
                    color: transparent,
                },
            );
        }
    }
}

fn append_stroke_subdivision_fringe(
    fringe: &mut Vec<ColoredPoint>,
    incoming: StrokeSegmentRecord,
    outgoing: StrokeSegmentRecord,
    half_width: f32,
    color: [f32; 4],
) {
    let transparent = [color[0], color[1], color[2], 0.0];
    let left_inner_join = line_intersection(
        incoming.left_end,
        incoming.direction,
        outgoing.left_start,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(incoming.left_end, outgoing.left_start));
    let left_incoming_outer = add(
        incoming.end,
        scale(incoming.normal, half_width + AA_FRINGE_WIDTH),
    );
    let left_outgoing_outer = add(
        outgoing.start,
        scale(outgoing.normal, half_width + AA_FRINGE_WIDTH),
    );
    let left_outer_join = line_intersection(
        left_incoming_outer,
        incoming.direction,
        left_outgoing_outer,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(left_incoming_outer, left_outgoing_outer));

    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: incoming.left_end,
            color,
        },
        ColoredPoint {
            point: left_inner_join,
            color,
        },
        ColoredPoint {
            point: left_incoming_outer,
            color: transparent,
        },
    );
    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: left_incoming_outer,
            color: transparent,
        },
        ColoredPoint {
            point: left_inner_join,
            color,
        },
        ColoredPoint {
            point: left_outer_join,
            color: transparent,
        },
    );
    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: left_inner_join,
            color,
        },
        ColoredPoint {
            point: outgoing.left_start,
            color,
        },
        ColoredPoint {
            point: left_outer_join,
            color: transparent,
        },
    );
    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: left_outer_join,
            color: transparent,
        },
        ColoredPoint {
            point: outgoing.left_start,
            color,
        },
        ColoredPoint {
            point: left_outgoing_outer,
            color: transparent,
        },
    );

    let right_inner_join = line_intersection(
        incoming.right_end,
        incoming.direction,
        outgoing.right_start,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(incoming.right_end, outgoing.right_start));
    let right_incoming_outer = add(
        incoming.end,
        scale(incoming.normal, -(half_width + AA_FRINGE_WIDTH)),
    );
    let right_outgoing_outer = add(
        outgoing.start,
        scale(outgoing.normal, -(half_width + AA_FRINGE_WIDTH)),
    );
    let right_outer_join = line_intersection(
        right_incoming_outer,
        incoming.direction,
        right_outgoing_outer,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(right_incoming_outer, right_outgoing_outer));

    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: outgoing.right_start,
            color,
        },
        ColoredPoint {
            point: right_inner_join,
            color,
        },
        ColoredPoint {
            point: right_outgoing_outer,
            color: transparent,
        },
    );
    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: right_outgoing_outer,
            color: transparent,
        },
        ColoredPoint {
            point: right_inner_join,
            color,
        },
        ColoredPoint {
            point: right_outer_join,
            color: transparent,
        },
    );
    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: right_inner_join,
            color,
        },
        ColoredPoint {
            point: incoming.right_end,
            color,
        },
        ColoredPoint {
            point: right_outer_join,
            color: transparent,
        },
    );
    append_colored_triangle(
        fringe,
        ColoredPoint {
            point: right_outer_join,
            color: transparent,
        },
        ColoredPoint {
            point: incoming.right_end,
            color,
        },
        ColoredPoint {
            point: right_incoming_outer,
            color: transparent,
        },
    );
}

fn append_stroke_subdivision_body(
    triangles: &mut Vec<Point>,
    incoming: StrokeSegmentRecord,
    outgoing: StrokeSegmentRecord,
) {
    let left_join = line_intersection(
        incoming.left_end,
        incoming.direction,
        outgoing.left_start,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(incoming.left_end, outgoing.left_start));
    let right_join = line_intersection(
        incoming.right_end,
        incoming.direction,
        outgoing.right_start,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(incoming.right_end, outgoing.right_start));

    append_triangle(triangles, outgoing.start, incoming.left_end, left_join);
    append_triangle(triangles, outgoing.start, left_join, outgoing.left_start);
    append_triangle(triangles, outgoing.start, right_join, incoming.right_end);
    append_triangle(triangles, outgoing.start, outgoing.right_start, right_join);
}

fn append_round_fringe(
    fringe: &mut Vec<ColoredPoint>,
    center: Point,
    start: Point,
    end: Point,
    radius: f32,
    color: [f32; 4],
) {
    let transparent = [color[0], color[1], color[2], 0.0];
    let start_angle = (start[1] - center[1]).atan2(start[0] - center[0]);
    let mut span = (end[1] - center[1]).atan2(end[0] - center[0]) - start_angle;
    while span <= -PI {
        span += PI * 2.0;
    }
    while span > PI {
        span -= PI * 2.0;
    }
    if span.abs() <= EPSILON {
        span = PI * 2.0;
    }
    let steps = (span.abs() * calc_num_radial_segments_per_radian(radius))
        .ceil()
        .max(2.0) as usize;
    let outer_radius = radius + AA_FRINGE_WIDTH;
    let mut previous_inner = start;
    let mut previous_outer = [
        center[0] + start_angle.cos() * outer_radius,
        center[1] + start_angle.sin() * outer_radius,
    ];
    for index in 1..=steps {
        let angle = start_angle + span * index as f32 / steps as f32;
        let inner = [
            center[0] + angle.cos() * radius,
            center[1] + angle.sin() * radius,
        ];
        let outer = [
            center[0] + angle.cos() * outer_radius,
            center[1] + angle.sin() * outer_radius,
        ];
        append_colored_quad(
            fringe,
            ColoredPoint {
                point: previous_inner,
                color,
            },
            ColoredPoint {
                point: inner,
                color,
            },
            ColoredPoint {
                point: outer,
                color: transparent,
            },
            ColoredPoint {
                point: previous_outer,
                color: transparent,
            },
        );
        previous_inner = inner;
        previous_outer = outer;
    }
}

fn flatten_quadratic_recursive(
    from: Point,
    control: Point,
    to: Point,
    depth: u32,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    if depth >= MAX_CURVE_SUBDIVISION_DEPTH || quadratic_flat_enough(from, control, to) {
        push_unique_point(out, corners, to, true);
        return;
    }
    let p01 = midpoint(from, control);
    let p12 = midpoint(control, to);
    let split = midpoint(p01, p12);
    flatten_quadratic_recursive(from, p01, split, depth + 1, out, corners);
    if let Some(last_corner) = corners.last_mut() {
        *last_corner = false;
    }
    flatten_quadratic_recursive(split, p12, to, depth + 1, out, corners);
}

fn flatten_cubic_recursive(
    from: Point,
    control1: Point,
    control2: Point,
    to: Point,
    depth: u32,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    if depth >= MAX_CURVE_SUBDIVISION_DEPTH || cubic_flat_enough(from, control1, control2, to) {
        push_unique_point(out, corners, to, true);
        return;
    }
    let p01 = midpoint(from, control1);
    let p12 = midpoint(control1, control2);
    let p23 = midpoint(control2, to);
    let p012 = midpoint(p01, p12);
    let p123 = midpoint(p12, p23);
    let split = midpoint(p012, p123);
    flatten_cubic_recursive(from, p01, p012, split, depth + 1, out, corners);
    if let Some(last_corner) = corners.last_mut() {
        *last_corner = false;
    }
    flatten_cubic_recursive(split, p123, p23, to, depth + 1, out, corners);
}

fn flatten_conic(
    from: Point,
    control: Point,
    to: Point,
    weight: f32,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    let steps = 24usize;
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        let omt = 1.0 - t;
        let denom = omt * omt + 2.0 * weight * omt * t + t * t;
        push_unique_point(
            out,
            corners,
            [
                ((omt * omt * from[0]) + (2.0 * weight * omt * t * control[0]) + (t * t * to[0]))
                    / denom,
                ((omt * omt * from[1]) + (2.0 * weight * omt * t * control[1]) + (t * t * to[1]))
                    / denom,
            ],
            step == steps,
        );
    }
}

fn flatten_arc(
    center: Point,
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    let sweep = normalized_arc_sweep(start_angle, end_angle, counter_clockwise);
    let steps = ((sweep.abs() / (PI / 16.0)).ceil() as usize).max(1);
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        let angle = start_angle + sweep * t;
        push_unique_point(
            out,
            corners,
            [
                center[0] + radius * angle.cos(),
                center[1] + radius * angle.sin(),
            ],
            step == steps,
        );
    }
}

fn quadratic_flat_enough(from: Point, control: Point, to: Point) -> bool {
    point_line_distance(control, from, to) <= CURVE_FLATNESS_TOLERANCE
}

fn cubic_flat_enough(from: Point, control1: Point, control2: Point, to: Point) -> bool {
    point_line_distance(control1, from, to) <= CURVE_FLATNESS_TOLERANCE
        && point_line_distance(control2, from, to) <= CURVE_FLATNESS_TOLERANCE
}

fn point_line_distance(point: Point, line_start: Point, line_end: Point) -> f32 {
    let line = subtract(line_end, line_start);
    let length = magnitude(line);
    if length <= EPSILON {
        return distance(point, line_start);
    }
    cross(subtract(point, line_start), line).abs() / length
}

fn midpoint(a: Point, b: Point) -> Point {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}

fn points_equal(left: Point, right: Point) -> bool {
    (left[0] - right[0]).abs() <= EPSILON && (left[1] - right[1]).abs() <= EPSILON
}

fn push_unique_point(points: &mut Vec<Point>, corners: &mut Vec<bool>, point: Point, corner: bool) {
    if points
        .last()
        .copied()
        .is_some_and(|last| points_equal(last, point))
    {
        if let Some(last_corner) = corners.last_mut() {
            *last_corner = *last_corner || corner;
        }
        return;
    }
    points.push(point);
    corners.push(corner);
}

fn calc_num_radial_segments_per_radian(approx_stroke_radius: f32) -> f32 {
    let approx_stroke_radius = approx_stroke_radius.max(1.0);
    let cos_theta = 1.0 - (1.0 / 4.0) / approx_stroke_radius;
    0.5 / cos_theta.max(-1.0).acos()
}

fn line_intersection(p0: Point, d0: Point, p1: Point, d1: Point) -> Option<Point> {
    let det = d0[0] * d1[1] - d0[1] * d1[0];
    if det.abs() <= EPSILON {
        return None;
    }
    let delta = subtract(p1, p0);
    let t = (delta[0] * d1[1] - delta[1] * d1[0]) / det;
    Some(add(p0, scale(d0, t)))
}

fn subtract(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn add(a: Point, b: Point) -> Point {
    [a[0] + b[0], a[1] + b[1]]
}

fn scale(point: Point, factor: f32) -> Point {
    [point[0] * factor, point[1] * factor]
}

fn lerp(a: Point, b: Point, t: f32) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

fn perpendicular(point: Point) -> Point {
    [-point[1], point[0]]
}

fn magnitude(point: Point) -> f32 {
    (point[0] * point[0] + point[1] * point[1]).sqrt()
}

fn normalize(point: Point) -> Option<Point> {
    let length = magnitude(point);
    (length > EPSILON).then_some([point[0] / length, point[1] / length])
}

fn distance(a: Point, b: Point) -> f32 {
    magnitude(subtract(a, b))
}

fn cross(a: Point, b: Point) -> f32 {
    a[0] * b[1] - a[1] * b[0]
}

#[allow(dead_code)]
pub fn encode_drawing_command_buffer(
    shared_context: &DawnSharedContext,
    prepared: &DrawingPreparedRecording,
    atlas_provider: Option<&mut AtlasProvider>,
    encoder: &mut wgpu::CommandEncoder,
    target_view: &wgpu::TextureView,
    msaa_target_view: Option<&wgpu::TextureView>,
    depth_target_view: Option<&wgpu::TextureView>,
    msaa_depth_target_view: Option<&wgpu::TextureView>,
) -> Result<()> {
    encode_drawing_command_buffer_with_providers(
        shared_context,
        prepared,
        atlas_provider,
        None,
        encoder,
        target_view,
        msaa_target_view,
        depth_target_view,
        msaa_depth_target_view,
    )
}

pub fn encode_drawing_command_buffer_with_providers(
    shared_context: &DawnSharedContext,
    prepared: &DrawingPreparedRecording,
    path_atlas_provider: Option<&mut AtlasProvider>,
    text_atlas_provider: Option<&mut TextAtlasProvider>,
    encoder: &mut wgpu::CommandEncoder,
    target_view: &wgpu::TextureView,
    msaa_target_view: Option<&wgpu::TextureView>,
    depth_target_view: Option<&wgpu::TextureView>,
    msaa_depth_target_view: Option<&wgpu::TextureView>,
) -> Result<()> {
    let mut path_atlas_provider = path_atlas_provider;
    let mut text_atlas_provider = text_atlas_provider;
    shared_context
        .resource_provider
        .warm_prepared_pipelines(prepared);
    if let Some(atlas_provider) = path_atlas_provider.as_deref_mut() {
        atlas_provider.upload_pending(&shared_context.queue);
        atlas_provider.encode_pending(encoder);
    }
    if let Some(atlas_provider) = text_atlas_provider.as_deref_mut() {
        atlas_provider.upload_pending(&shared_context.queue);
    }
    let path_atlas_provider = path_atlas_provider.as_deref();
    let text_atlas_provider = text_atlas_provider.as_deref();
    let (_viewport_buffer, viewport_bind_group) = shared_context
        .resource_provider
        .create_viewport_bind_group(prepared.surface_width, prepared.surface_height);
    for pass in &prepared.passes {
        let use_msaa = pass.requires_msaa
            && shared_context.resource_provider.msaa_sample_count() > 1
            && msaa_target_view.is_some();
        let (color_view, resolve_target, depth_view, sample_count) = if use_msaa {
            (
                msaa_target_view.expect("msaa target view checked above"),
                Some(target_view),
                pass.requires_depth.then(|| {
                    msaa_depth_target_view.expect("msaa depth target view required for msaa pass")
                }),
                shared_context.resource_provider.msaa_sample_count(),
            )
        } else {
            (
                target_view,
                None,
                pass.requires_depth.then(|| {
                    depth_target_view.expect("depth target view required for drawing pass")
                }),
                1,
            )
        };
        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("goldlight drawing draw pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: color_view,
                resolve_target,
                ops: wgpu::Operations {
                    load: pass.load_op,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: depth_view.map(|view| {
                wgpu::RenderPassDepthStencilAttachment {
                    view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0),
                        store: wgpu::StoreOp::Store,
                    }),
                }
            }),
            occlusion_query_set: None,
            timestamp_writes: None,
        });
        if let Some(clip_rect) = pass.clip_rect {
            render_pass.set_scissor_rect(
                clip_rect.x,
                clip_rect.y,
                clip_rect.width,
                clip_rect.height,
            );
        }
        for step in &pass.steps {
            match step {
                DrawingPreparedStep::Triangles {
                    vertices,
                    mode,
                    paint,
                } => {
                    let Some(vertex_buffer) = shared_context
                        .resource_provider
                        .create_triangle_vertex_buffer(vertices)
                    else {
                        continue;
                    };
                    let (_paint_buffer, paint_bind_group) = shared_context
                        .resource_provider
                        .create_fill_paint_bind_group(paint);
                    let pipeline = shared_context
                        .resource_provider
                        .triangle_pipeline(sample_count, *mode);
                    render_pass.set_pipeline(&pipeline);
                    render_pass.set_bind_group(0, &paint_bind_group, &[]);
                    render_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
                    render_pass.draw(0..vertices.len() as u32, 0..1);
                }
                DrawingPreparedStep::WedgeFillPatches { step, paint } => {
                    let Some(instance_buffer) = shared_context
                        .resource_provider
                        .create_wedge_fill_patch_buffer(&step.instances)
                    else {
                        continue;
                    };
                    let (_paint_buffer, paint_bind_group) = shared_context
                        .resource_provider
                        .create_fill_paint_bind_group(paint);
                    let (template_buffer, vertex_count) =
                        shared_context.resource_provider.wedge_template_buffer();
                    let pipeline = shared_context
                        .resource_provider
                        .wedge_pipeline(sample_count, step.stencil_mode);
                    render_pass.set_pipeline(&pipeline);
                    render_pass.set_bind_group(0, &viewport_bind_group, &[]);
                    render_pass.set_bind_group(1, &paint_bind_group, &[]);
                    render_pass.set_vertex_buffer(0, template_buffer.slice(..));
                    render_pass.set_vertex_buffer(1, instance_buffer.slice(..));
                    render_pass.draw(0..vertex_count, 0..step.instances.len() as u32);
                }
                DrawingPreparedStep::CurveFillPatches { step, paint } => {
                    let Some(instance_buffer) = shared_context
                        .resource_provider
                        .create_curve_fill_patch_buffer(&step.instances)
                    else {
                        continue;
                    };
                    let (_paint_buffer, paint_bind_group) = shared_context
                        .resource_provider
                        .create_fill_paint_bind_group(paint);
                    let (template_buffer, vertex_count) =
                        shared_context.resource_provider.curve_template_buffer();
                    let pipeline = shared_context
                        .resource_provider
                        .curve_pipeline(sample_count, step.stencil_mode);
                    render_pass.set_pipeline(&pipeline);
                    render_pass.set_bind_group(0, &viewport_bind_group, &[]);
                    render_pass.set_bind_group(1, &paint_bind_group, &[]);
                    render_pass.set_vertex_buffer(0, template_buffer.slice(..));
                    render_pass.set_vertex_buffer(1, instance_buffer.slice(..));
                    render_pass.draw(0..vertex_count, 0..step.instances.len() as u32);
                }
                DrawingPreparedStep::StrokePatches(step) => {
                    let Some(instance_buffer) = shared_context
                        .resource_provider
                        .create_stroke_patch_buffer(&step.instances)
                    else {
                        continue;
                    };
                    let pipeline = shared_context
                        .resource_provider
                        .stroke_pipeline(sample_count);
                    render_pass.set_pipeline(&pipeline);
                    render_pass.set_bind_group(0, &viewport_bind_group, &[]);
                    render_pass.set_vertex_buffer(0, instance_buffer.slice(..));
                    render_pass.draw(0..step.vertex_count, 0..step.instances.len() as u32);
                }
                DrawingPreparedStep::PathMask(step) => {
                    let Some(atlas_provider) = path_atlas_provider else {
                        continue;
                    };
                    let Some(vertex_buffer) = shared_context
                        .resource_provider
                        .create_path_mask_vertex_buffer(&step.vertices)
                    else {
                        continue;
                    };
                    let atlas_view = atlas_provider.page_view(step.mask.page_index);
                    let atlas_bind_group = shared_context
                        .resource_provider
                        .create_path_mask_bind_group(atlas_view);
                    let (_paint_buffer, paint_bind_group) = shared_context
                        .resource_provider
                        .create_fill_paint_bind_group(&step.paint);
                    let pipeline = shared_context
                        .resource_provider
                        .path_mask_pipeline(sample_count);
                    render_pass.set_pipeline(&pipeline);
                    render_pass.set_bind_group(0, &atlas_bind_group, &[]);
                    render_pass.set_bind_group(1, &paint_bind_group, &[]);
                    render_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
                    render_pass.draw(0..step.vertices.len() as u32, 0..1);
                }
                DrawingPreparedStep::BitmapText(step) => {
                    encode_bitmap_text_step(
                        &shared_context.resource_provider.text_resources,
                        &shared_context.resource_provider.device,
                        &shared_context.queue,
                        &mut render_pass,
                        step,
                        text_atlas_provider,
                        sample_count,
                    );
                }
                DrawingPreparedStep::SdfText(step) => {
                    encode_sdf_text_step(
                        &shared_context.resource_provider.text_resources,
                        &shared_context.resource_provider.device,
                        &shared_context.queue,
                        &mut render_pass,
                        step,
                        text_atlas_provider,
                        sample_count,
                    );
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        compute_recording_bounds, prepare_drawing_recording, ClipRectCommand, DeviceClipRect,
        DirectMaskTextDrawCommand, DrawingPreparedStep, DrawingRecorder, PathDrawCommand,
    };
    use crate::scene::content_2d::svg::parse_svg;
    use crate::scene::{
        ColorValue, PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, PathVerb2D,
    };
    use crate::scene::{DirectMaskGlyph2D, GlyphMask2D};

    const SVG_STROKE_FIXTURE: &str = r##"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <g transform="matrix(2,0,0,2,8,12)" stroke="#000" fill="none" stroke-width="2" stroke-linejoin="round">
    <path d="M 0 0 L 18 8 L 6 24 Z" />
    <path d="M 28 4 C 34 18 48 -6 56 12" />
  </g>
  <path d="M 8 88 L 44 88" stroke="#c33" stroke-width="0.5" fill="none" />
  <path d="M 72 72 L 108 72 L 108 108 Z" fill="#fc6" />
</svg>
"##;

    fn stroke_path(verbs: Vec<PathVerb2D>, dash_array: Vec<f32>) -> PathDrawCommand {
        PathDrawCommand {
            x: 0.0,
            y: 0.0,
            verbs,
            fill_rule: PathFillRule2D::Nonzero,
            style: PathStyle2D::Stroke,
            color: ColorValue {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 0.5,
            },
            shader: None,
            stroke_width: 12.0,
            stroke_join: PathStrokeJoin2D::Round,
            stroke_cap: PathStrokeCap2D::Round,
            dash_array,
            dash_offset: 0.0,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }
    }

    fn fill_path(verbs: Vec<PathVerb2D>) -> PathDrawCommand {
        PathDrawCommand {
            x: 0.0,
            y: 0.0,
            verbs,
            fill_rule: PathFillRule2D::Nonzero,
            style: PathStyle2D::Fill,
            color: ColorValue {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 1.0,
            },
            shader: None,
            stroke_width: 1.0,
            stroke_join: PathStrokeJoin2D::Round,
            stroke_cap: PathStrokeCap2D::Round,
            dash_array: Vec::new(),
            dash_offset: 0.0,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }
    }

    fn assert_stroke_uses_patch_step(path: PathDrawCommand) {
        let mut recorder = DrawingRecorder::new();
        recorder.draw_path(path);
        let prepared = prepare_drawing_recording(&recorder.finish(), 640, 480);
        let steps = prepared
            .passes
            .iter()
            .flat_map(|pass| pass.steps.iter())
            .collect::<Vec<_>>();
        assert!(steps
            .iter()
            .any(|step| matches!(step, DrawingPreparedStep::StrokePatches(_))));
        assert!(!steps
            .iter()
            .any(|step| matches!(step, DrawingPreparedStep::Triangles { .. })));
    }

    fn direct_mask_text() -> DirectMaskTextDrawCommand {
        DirectMaskTextDrawCommand {
            x: 0.0,
            y: 0.0,
            color: ColorValue {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 1.0,
            },
            glyphs: vec![DirectMaskGlyph2D {
                _glyph_id: 1,
                x: 24.0,
                y: 32.0,
                mask: Some(GlyphMask2D {
                    _cache_key: "glyph-1".into(),
                    width: 2,
                    height: 2,
                    stride: 2,
                    _format: "a8".into(),
                    offset_x: 0,
                    offset_y: 0,
                    pixels: vec![255, 255, 255, 255],
                }),
            }],
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }
    }

    #[test]
    fn stroke_recording_uses_patch_step_for_cubic() {
        assert_stroke_uses_patch_step(stroke_path(
            vec![
                PathVerb2D::MoveTo { to: [10.0, 10.0] },
                PathVerb2D::CubicTo {
                    control1: [40.0, 140.0],
                    control2: [140.0, -40.0],
                    to: [180.0, 40.0],
                },
            ],
            Vec::new(),
        ));
    }

    #[test]
    fn stroke_recording_uses_patch_step_for_dashed_line() {
        assert_stroke_uses_patch_step(stroke_path(
            vec![
                PathVerb2D::MoveTo { to: [10.0, 10.0] },
                PathVerb2D::LineTo { to: [210.0, 10.0] },
            ],
            vec![12.0, 8.0],
        ));
    }

    #[test]
    fn text_pass_requires_depth_but_not_msaa() {
        let mut recorder = DrawingRecorder::new();
        recorder.draw_direct_mask_text(direct_mask_text());

        let prepared = prepare_drawing_recording(&recorder.finish(), 640, 480);

        assert_eq!(prepared.passes.len(), 1);
        assert!(!prepared.passes[0].requires_msaa);
        assert!(prepared.passes[0].requires_depth);
    }

    #[test]
    fn text_can_share_an_msaa_pass() {
        let mut recorder = DrawingRecorder::new();
        recorder.draw_direct_mask_text(direct_mask_text());
        recorder.draw_path(stroke_path(
            vec![
                PathVerb2D::MoveTo { to: [10.0, 10.0] },
                PathVerb2D::LineTo { to: [120.0, 120.0] },
            ],
            vec![],
        ));

        let prepared = prepare_drawing_recording(&recorder.finish(), 640, 480);

        assert_eq!(prepared.passes.len(), 1);
        assert!(prepared.passes[0].requires_msaa);
        assert!(prepared.passes[0].requires_depth);
    }

    #[test]
    fn translated_stroke_paths_can_share_depth_pass_with_fill() {
        let mut recorder = DrawingRecorder::new();
        recorder.draw_path(fill_path(vec![
            PathVerb2D::MoveTo { to: [20.0, 20.0] },
            PathVerb2D::LineTo { to: [140.0, 20.0] },
            PathVerb2D::LineTo { to: [80.0, 120.0] },
            PathVerb2D::Close,
        ]));
        let mut stroke = stroke_path(
            vec![
                PathVerb2D::MoveTo { to: [30.0, 150.0] },
                PathVerb2D::LineTo { to: [200.0, 190.0] },
            ],
            vec![],
        );
        stroke.transform = [1.0, 0.0, 0.0, 1.0, 4.0, 0.0];
        recorder.draw_path(stroke);

        let prepared = prepare_drawing_recording(&recorder.finish(), 640, 480);

        assert_eq!(prepared.passes.len(), 1);
        assert!(prepared.passes[0].requires_depth);
        assert!(prepared.passes[0].requires_msaa);
    }

    #[test]
    fn stroke_bounds_include_aa_fringe_and_join_outset() {
        let mut recorder = DrawingRecorder::new();
        recorder.draw_path(stroke_path(
            vec![
                PathVerb2D::MoveTo { to: [10.0, 10.0] },
                PathVerb2D::LineTo { to: [110.0, 10.0] },
            ],
            vec![],
        ));

        let bounds = compute_recording_bounds(&recorder.finish()).expect("stroke bounds");

        assert_eq!(bounds.left, -7.0);
        assert_eq!(bounds.top, -7.0);
        assert_eq!(bounds.right, 117.0);
        assert_eq!(bounds.bottom, 17.0);
    }

    #[test]
    fn svg_fixture_strokes_prepare_stroke_patch_steps() {
        let parsed = parse_svg(SVG_STROKE_FIXTURE).expect("parse svg stroke fixture");
        let mut recorder = DrawingRecorder::new();

        for path in parsed.paths {
            recorder.draw_path(PathDrawCommand {
                x: path.x,
                y: path.y,
                verbs: path.verbs,
                fill_rule: path.fill_rule,
                style: path.style,
                color: path.color,
                shader: path.shader,
                stroke_width: path.stroke_width,
                stroke_join: path.stroke_join,
                stroke_cap: path.stroke_cap,
                dash_array: path.dash_array,
                dash_offset: path.dash_offset,
                transform: path.transform,
            });
        }

        let prepared = prepare_drawing_recording(&recorder.finish(), 900, 900);
        let stroke_step_count = prepared
            .passes
            .iter()
            .flat_map(|pass| pass.steps.iter())
            .filter(|step| matches!(step, DrawingPreparedStep::StrokePatches(_)))
            .count();

        assert!(stroke_step_count > 0, "expected fixture stroke patch steps");
    }

    #[test]
    fn translated_stroke_paths_still_use_stroke_patches() {
        let mut path = stroke_path(
            vec![
                PathVerb2D::MoveTo { to: [10.0, 10.0] },
                PathVerb2D::LineTo { to: [110.0, 40.0] },
            ],
            vec![],
        );
        path.transform = [1.0, 0.0, 0.0, 1.0, 24.0, -12.0];

        let mut recorder = DrawingRecorder::new();
        recorder.draw_path(path);
        let prepared = prepare_drawing_recording(&recorder.finish(), 640, 480);
        let steps = prepared
            .passes
            .iter()
            .flat_map(|pass| pass.steps.iter())
            .collect::<Vec<_>>();

        assert!(steps
            .iter()
            .any(|step| matches!(step, DrawingPreparedStep::StrokePatches(_))));
        assert!(!steps
            .iter()
            .any(|step| matches!(step, DrawingPreparedStep::Triangles { .. })));
    }

    #[test]
    fn clip_rect_prepares_scissored_pass() {
        let mut recorder = DrawingRecorder::new();
        recorder.push_clip_rect(ClipRectCommand {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        });
        recorder.draw_path(fill_path(vec![
            PathVerb2D::MoveTo { to: [0.0, 0.0] },
            PathVerb2D::LineTo { to: [100.0, 0.0] },
            PathVerb2D::LineTo { to: [100.0, 100.0] },
            PathVerb2D::Close,
        ]));
        recorder.pop_clip();

        let prepared = prepare_drawing_recording(&recorder.finish(), 100, 100);
        assert_eq!(prepared.passes.len(), 1);
        assert_eq!(
            prepared.passes[0].clip_rect,
            Some(DeviceClipRect {
                x: 10,
                y: 20,
                width: 30,
                height: 40,
            })
        );
    }
}
