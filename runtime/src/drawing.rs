use std::f32::consts::PI;
use std::sync::{Arc, OnceLock};

use anyhow::Result;
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::drawing_text::{
    encode_bitmap_text_step, encode_sdf_text_step, prepare_direct_mask_text_step,
    prepare_sdf_text_step, prepare_transformed_mask_text_step, PreparedBitmapTextStep,
    PreparedSdfTextStep, TextPipelineResources,
};
use crate::fill_patch::{
    curve_fill_shader_source, curve_template_vertices, fill_paint_shader_source,
    prepare_fill_steps, wedge_fill_shader_source, wedge_template_vertices, CurveFillPatchInstance,
    FillStencilMode, FillTriangleMode, PatchResolveVertex, PreparedCurveFillStep, PreparedFillStep,
    PreparedFillTriangleStep, PreparedWedgeFillStep, WedgeFillPatchInstance,
};
use crate::render::{
    ColorValue, GradientStop2D, GradientTileMode2D, Path2D, PathFillRule2D, PathShader2D,
    PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, PathVerb2D, Rect2D, Scene2D, Text2D,
};
use crate::stroke_patch::{
    prepare_stroke_patch_step, stroke_patch_shader_source, PreparedStrokePatchStep,
    StrokePatchInstance,
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
    wedge_template_buffer: wgpu::Buffer,
    wedge_template_vertex_count: u32,
    curve_template_buffer: wgpu::Buffer,
    curve_template_vertex_count: u32,
    viewport_bind_group_layout: Arc<wgpu::BindGroupLayout>,
    fill_paint_bind_group_layout: Arc<wgpu::BindGroupLayout>,
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
            return self
                .msaa
                .get_or_init(|| self.create(sample_count))
                .clone();
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
            buffers: &[PatchResolveVertex::layout(), WedgeFillPatchInstance::layout()],
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
            buffers: &[PatchResolveVertex::layout(), CurveFillPatchInstance::layout()],
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
            wedge_template_buffer,
            wedge_template_vertex_count: wedge_template_vertices.len() as u32,
            curve_template_buffer,
            curve_template_vertex_count: curve_template_vertices.len() as u32,
            viewport_bind_group_layout: Arc::new(viewport_bind_group_layout),
            fill_paint_bind_group_layout: Arc::new(fill_paint_bind_group_layout),
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
                    DrawingPreparedStep::WedgeFillPatches { step, .. } => PipelineWarmupKey::Wedge {
                        sample_count,
                        stencil_mode: step.stencil_mode,
                    },
                    DrawingPreparedStep::CurveFillPatches { step, .. } => PipelineWarmupKey::Curve {
                        sample_count,
                        stencil_mode: step.stencil_mode,
                    },
                    DrawingPreparedStep::StrokePatches(_) => {
                        PipelineWarmupKey::Stroke { sample_count }
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

    pub fn clear(&mut self, color: ColorValue) {
        self.commands.push(DrawingCommand::Clear { color });
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

#[derive(Clone, Debug)]
enum DrawingCommand {
    Clear { color: ColorValue },
    FillRect(RectDrawCommand),
    DrawPath(PathDrawCommand),
    DrawDirectMaskText(DirectMaskTextDrawCommand),
    DrawTransformedMaskText(TransformedMaskTextDrawCommand),
    DrawSdfText(SdfTextDrawCommand),
}

#[derive(Clone, Debug)]
pub struct RectDrawCommand {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub color: ColorValue,
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
}

#[derive(Clone, Debug)]
pub struct DirectMaskTextDrawCommand {
    pub x: f32,
    pub y: f32,
    pub color: ColorValue,
    pub glyphs: Vec<crate::render::DirectMaskGlyph2D>,
}

#[derive(Clone, Debug)]
pub struct TransformedMaskTextDrawCommand {
    pub x: f32,
    pub y: f32,
    pub color: ColorValue,
    pub glyphs: Vec<crate::render::TransformedMaskGlyph2D>,
}

#[derive(Clone, Debug)]
pub struct SdfTextDrawCommand {
    pub x: f32,
    pub y: f32,
    pub color: ColorValue,
    pub glyphs: Vec<crate::render::SdfGlyph2D>,
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
    pub steps: Vec<DrawingPreparedStep>,
}

#[derive(Clone, Debug)]
pub struct DrawingPreparedRecording {
    pub surface_width: u32,
    pub surface_height: u32,
    pub passes: Vec<DrawingDrawPass>,
}

impl DrawingPreparedStep {
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
                | Self::BitmapText(_)
                | Self::SdfText(_)
        )
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

pub fn record_scene_2d(
    scene: &Scene2D,
    rects: &[Rect2D],
    paths: &[Path2D],
    texts: &[Text2D],
) -> DrawingRecording {
    let mut recorder = DrawingRecorder::new();
    recorder.clear(scene.clear_color);
    for rect in rects {
        recorder.fill_rect(RectDrawCommand {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            color: rect.color,
        });
    }
    for path in paths {
        recorder.draw_path(PathDrawCommand {
            x: path.x,
            y: path.y,
            verbs: path.verbs.clone(),
            fill_rule: path.fill_rule,
            style: path.style,
            color: path.color,
            shader: path.shader.clone(),
            stroke_width: path.stroke_width,
            stroke_join: path.stroke_join,
            stroke_cap: path.stroke_cap,
            dash_array: path.dash_array.clone(),
            dash_offset: path.dash_offset,
        });
    }
    for text in texts {
        match text {
            Text2D::DirectMask {
                x,
                y,
                color,
                glyphs,
                ..
            } => recorder.draw_direct_mask_text(DirectMaskTextDrawCommand {
                x: *x,
                y: *y,
                color: *color,
                glyphs: glyphs.clone(),
            }),
            Text2D::TransformedMask {
                x,
                y,
                color,
                glyphs,
                ..
            } => recorder.draw_transformed_mask_text(TransformedMaskTextDrawCommand {
                x: *x,
                y: *y,
                color: *color,
                glyphs: glyphs.clone(),
            }),
            Text2D::Sdf {
                x,
                y,
                color,
                glyphs,
                ..
            } => recorder.draw_sdf_text(SdfTextDrawCommand {
                x: *x,
                y: *y,
                color: *color,
                glyphs: glyphs.clone(),
            }),
        }
    }
    recorder.finish()
}

pub fn prepare_drawing_recording(
    recording: &DrawingRecording,
    surface_width: u32,
    surface_height: u32,
) -> DrawingPreparedRecording {
    let width = surface_width.max(1) as f32;
    let height = surface_height.max(1) as f32;
    let mut passes = Vec::new();
    let mut current_load_op = wgpu::LoadOp::Load;
    let mut current_steps = Vec::new();
    let mut next_painters_depth = 1u16;

    let flush_pass = |passes: &mut Vec<DrawingDrawPass>,
                      current_load_op: &mut wgpu::LoadOp<wgpu::Color>,
                      current_steps: &mut Vec<DrawingPreparedStep>| {
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
            steps: std::mem::take(current_steps),
        });
        *current_load_op = wgpu::LoadOp::Load;
    };

    for command in &recording.commands {
        match command {
            DrawingCommand::Clear { color } => {
                flush_pass(&mut passes, &mut current_load_op, &mut current_steps);
                current_load_op = wgpu::LoadOp::Clear(color.to_wgpu());
                next_painters_depth = 1;
            }
            DrawingCommand::FillRect(rect) => {
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                current_steps.push(DrawingPreparedStep::Triangles {
                    vertices: with_vertex_depth(
                        build_rect_vertices(rect, width, height),
                        painter_depth,
                    ),
                    mode: TriangleStepMode::DirectDepth,
                    paint: vertex_colored_paint(),
                });
            }
            DrawingCommand::DrawPath(path) => {
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                current_steps.extend(build_path_steps(path, width, height, painter_depth));
            }
            DrawingCommand::DrawDirectMaskText(text) => {
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                if let Some(step) = prepare_direct_mask_text_step(
                    &text.glyphs,
                    text.color,
                    text.x,
                    text.y,
                    surface_width,
                    surface_height,
                    painter_depth,
                ) {
                    current_steps.push(DrawingPreparedStep::BitmapText(step));
                }
            }
            DrawingCommand::DrawTransformedMaskText(text) => {
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                if let Some(step) = prepare_transformed_mask_text_step(
                    &text.glyphs,
                    text.color,
                    text.x,
                    text.y,
                    surface_width,
                    surface_height,
                    painter_depth,
                ) {
                    current_steps.push(DrawingPreparedStep::BitmapText(step));
                }
            }
            DrawingCommand::DrawSdfText(text) => {
                let painter_depth = next_painter_depth_as_float(&mut next_painters_depth);
                if let Some(step) = prepare_sdf_text_step(
                    &text.glyphs,
                    text.color,
                    text.x,
                    text.y,
                    surface_width,
                    surface_height,
                    painter_depth,
                ) {
                    current_steps.push(DrawingPreparedStep::SdfText(step));
                }
            }
        }
    }

    flush_pass(&mut passes, &mut current_load_op, &mut current_steps);

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

fn build_path_paint(path: &PathDrawCommand) -> PaintUniform {
    let Some(shader) = &path.shader else {
        return PaintUniform::solid(path.color.to_array());
    };

    let inverse_draw_transform = [1.0, 0.0, 0.0, 1.0, -path.x, -path.y];
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
        stop_colors[index] = stop.color.to_srgb_array();
    }
    let last_offset = *stop_offsets
        .get(stops.len().saturating_sub(1))
        .unwrap_or(&1.0);
    let fallback_color = path.color.to_srgb_array();
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

fn vertex_colored_paint() -> PaintUniform {
    PaintUniform::solid([1.0, 1.0, 1.0, 1.0])
}

fn build_rect_vertices(rect: &RectDrawCommand, width: f32, height: f32) -> Vec<DrawingVertex> {
    let left = (rect.x / width) * 2.0 - 1.0;
    let right = ((rect.x + rect.width) / width) * 2.0 - 1.0;
    let top = 1.0 - (rect.y / height) * 2.0;
    let bottom = 1.0 - ((rect.y + rect.height) / height) * 2.0;
    let color = rect.color.to_array();
    let top_left = DrawingVertex {
        position: [left, top, 0.0, 1.0],
        color,
        device_position: [rect.x, rect.y],
    };
    let top_right = DrawingVertex {
        position: [right, top, 0.0, 1.0],
        color,
        device_position: [rect.x + rect.width, rect.y],
    };
    let bottom_left = DrawingVertex {
        position: [left, bottom, 0.0, 1.0],
        color,
        device_position: [rect.x, rect.y + rect.height],
    };
    let bottom_right = DrawingVertex {
        position: [right, bottom, 0.0, 1.0],
        color,
        device_position: [rect.x + rect.width, rect.y + rect.height],
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

fn build_path_steps(
    path: &PathDrawCommand,
    width: f32,
    height: f32,
    painter_depth: f32,
) -> Vec<DrawingPreparedStep> {
    let mut steps = Vec::new();
    let path_paint = build_path_paint(path);
    match path.style {
        PathStyle2D::Fill => {
            for step in prepare_fill_steps(path, painter_depth) {
                match step {
                    PreparedFillStep::Triangles(PreparedFillTriangleStep { points, mode }) => {
                        let Some(vertices) = points_to_vertices_with_color(
                            &points,
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
                    PreparedFillStep::Wedges(step) => {
                        steps.push(DrawingPreparedStep::WedgeFillPatches {
                            step,
                            paint: path_paint,
                        });
                    }
                    PreparedFillStep::Curves(step) => {
                        steps.push(DrawingPreparedStep::CurveFillPatches {
                            step,
                            paint: path_paint,
                        });
                    }
                }
            }
        }
        PathStyle2D::Stroke => {
            let dashed_subpaths = apply_dash_pattern(flatten_subpaths(path), path);
            let stroke_style = resolve_stroke_style(path);
            let stroke_color = resolve_stroke_color(path);
            if let Some(step) = prepare_stroke_patch_step(
                path,
                stroke_style,
                &dashed_subpaths,
                stroke_color,
                painter_depth,
            ) {
                steps.push(DrawingPreparedStep::StrokePatches(step));
            } else {
                let (interior, fringe) = build_stroke_vertices(path, width, height);
                if let Some(vertices) = interior {
                    steps.push(DrawingPreparedStep::Triangles {
                        vertices: with_vertex_depth(vertices, painter_depth),
                        mode: TriangleStepMode::Direct,
                        paint: vertex_colored_paint(),
                    });
                }
                if let Some(vertices) = fringe {
                    steps.push(DrawingPreparedStep::Triangles {
                        vertices: with_vertex_depth(vertices, painter_depth),
                        mode: TriangleStepMode::Direct,
                        paint: vertex_colored_paint(),
                    });
                }
            }
        }
    }
    steps
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
    let mut color = path.color.to_array();
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

pub fn encode_drawing_command_buffer(
    shared_context: &DawnSharedContext,
    prepared: &DrawingPreparedRecording,
    encoder: &mut wgpu::CommandEncoder,
    target_view: &wgpu::TextureView,
    msaa_target_view: Option<&wgpu::TextureView>,
    depth_target_view: Option<&wgpu::TextureView>,
    msaa_depth_target_view: Option<&wgpu::TextureView>,
) -> Result<()> {
    shared_context
        .resource_provider
        .warm_prepared_pipelines(prepared);
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
                DrawingPreparedStep::BitmapText(step) => {
                    encode_bitmap_text_step(
                        &shared_context.resource_provider.text_resources,
                        &shared_context.resource_provider.device,
                        &shared_context.queue,
                        &mut render_pass,
                        step,
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
        prepare_drawing_recording, DirectMaskTextDrawCommand, DrawingPreparedStep, DrawingRecorder,
        PathDrawCommand,
    };
    use crate::render::{
        ColorValue, DirectMaskGlyph2D, GlyphMask2D, PathFillRule2D, PathStrokeCap2D,
        PathStrokeJoin2D, PathStyle2D, PathVerb2D,
    };

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
    fn msaa_requirement_is_tracked_per_pass() {
        let mut recorder = DrawingRecorder::new();
        recorder.draw_direct_mask_text(direct_mask_text());
        recorder.clear(ColorValue::default());
        recorder.draw_path(stroke_path(
            vec![
                PathVerb2D::MoveTo { to: [10.0, 10.0] },
                PathVerb2D::LineTo { to: [120.0, 120.0] },
            ],
            vec![],
        ));

        let prepared = prepare_drawing_recording(&recorder.finish(), 640, 480);

        assert_eq!(prepared.passes.len(), 2);
        assert!(!prepared.passes[0].requires_msaa);
        assert!(prepared.passes[0].requires_depth);
        assert!(prepared.passes[1].requires_msaa);
        assert!(prepared.passes[1].requires_depth);
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
}
