use std::f32::consts::PI;
use std::sync::Arc;

use anyhow::Result;
use bytemuck::{Pod, Zeroable};
use lyon::math::point;
use lyon::path::Path;
use lyon::tessellation::{
    BuffersBuilder, FillOptions, FillRule, FillTessellator, FillVertex, FillVertexConstructor,
    LineCap, LineJoin, StrokeOptions, StrokeTessellator, StrokeVertex, StrokeVertexConstructor,
    VertexBuffers,
};
use wgpu::util::DeviceExt;

use crate::render::{
    ColorValue, Path2D, PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, PathVerb2D,
    Rect2D, Scene2D,
};

const DRAWING_SHADER_SOURCE: &str = r#"
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

#[derive(Clone)]
pub struct DawnResourceProvider {
    device: wgpu::Device,
    pipeline: Arc<wgpu::RenderPipeline>,
}

impl DawnResourceProvider {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("goldlight drawing shader"),
            source: wgpu::ShaderSource::Wgsl(DRAWING_SHADER_SOURCE.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("goldlight drawing pipeline layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("goldlight drawing pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[DrawingVertex::layout()],
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
        Self {
            device: device.clone(),
            pipeline: Arc::new(pipeline),
        }
    }

    fn create_vertex_buffer(&self, vertices: &[DrawingVertex]) -> Option<wgpu::Buffer> {
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

    fn resolve_pipeline(&self, _desc: &DrawingGraphicsPipelineDesc) -> Arc<wgpu::RenderPipeline> {
        self.pipeline.clone()
    }
}

#[derive(Clone)]
pub struct DawnSharedContext {
    pub resource_provider: DawnResourceProvider,
}

impl DawnSharedContext {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        Self {
            resource_provider: DawnResourceProvider::new(device, format),
        }
    }
}

#[derive(Clone, Debug)]
pub struct DrawingRecorder {
    commands: Vec<DrawingCommand>,
}

impl DrawingRecorder {
    pub fn new() -> Self {
        Self { commands: Vec::new() }
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
    pub stroke_width: f32,
    pub stroke_join: PathStrokeJoin2D,
    pub stroke_cap: PathStrokeCap2D,
    pub _dash_array: Vec<f32>,
    pub _dash_offset: f32,
}

#[derive(Clone, Debug)]
pub struct DrawingGraphicsPipelineDesc;

#[derive(Clone, Debug)]
pub struct DrawingPreparedStep {
    pub pipeline: DrawingGraphicsPipelineDesc,
    pub vertices: Vec<DrawingVertex>,
}

#[derive(Clone, Debug)]
pub struct DrawingDrawPass {
    pub load_op: wgpu::LoadOp<wgpu::Color>,
    pub steps: Vec<DrawingPreparedStep>,
}

#[derive(Clone, Debug)]
pub struct DrawingPreparedRecording {
    pub passes: Vec<DrawingDrawPass>,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub struct DrawingVertex {
    position: [f32; 4],
    color: [f32; 4],
}

impl DrawingVertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

pub fn record_scene_2d(scene: &Scene2D, rects: &[Rect2D], paths: &[Path2D]) -> DrawingRecording {
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
            stroke_width: path.stroke_width,
            stroke_join: path.stroke_join,
            stroke_cap: path.stroke_cap,
            _dash_array: path.dash_array.clone(),
            _dash_offset: path.dash_offset,
        });
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

    let flush_pass =
        |passes: &mut Vec<DrawingDrawPass>,
         current_load_op: &mut wgpu::LoadOp<wgpu::Color>,
         current_steps: &mut Vec<DrawingPreparedStep>| {
            if matches!(current_load_op, wgpu::LoadOp::Load) && current_steps.is_empty() {
                return;
            }
            passes.push(DrawingDrawPass {
                load_op: *current_load_op,
                steps: std::mem::take(current_steps),
            });
            *current_load_op = wgpu::LoadOp::Load;
        };

    for command in &recording.commands {
        match command {
            DrawingCommand::Clear { color } => {
                flush_pass(&mut passes, &mut current_load_op, &mut current_steps);
                current_load_op = wgpu::LoadOp::Clear(color.to_wgpu());
            }
            DrawingCommand::FillRect(rect) => {
                current_steps.push(DrawingPreparedStep {
                    pipeline: DrawingGraphicsPipelineDesc,
                    vertices: build_rect_vertices(rect, width, height),
                });
            }
            DrawingCommand::DrawPath(path) => {
                let vertices = build_path_vertices(path, width, height);
                if !vertices.is_empty() {
                    current_steps.push(DrawingPreparedStep {
                        pipeline: DrawingGraphicsPipelineDesc,
                        vertices,
                    });
                }
            }
        }
    }

    flush_pass(&mut passes, &mut current_load_op, &mut current_steps);

    DrawingPreparedRecording { passes }
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
    };
    let top_right = DrawingVertex {
        position: [right, top, 0.0, 1.0],
        color,
    };
    let bottom_left = DrawingVertex {
        position: [left, bottom, 0.0, 1.0],
        color,
    };
    let bottom_right = DrawingVertex {
        position: [right, bottom, 0.0, 1.0],
        color,
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

#[derive(Clone, Copy)]
struct PositionCtor;

impl FillVertexConstructor<[f32; 2]> for PositionCtor {
    fn new_vertex(&mut self, vertex: FillVertex<'_>) -> [f32; 2] {
        let position = vertex.position();
        [position.x, position.y]
    }
}

impl StrokeVertexConstructor<[f32; 2]> for PositionCtor {
    fn new_vertex(&mut self, vertex: StrokeVertex<'_, '_>) -> [f32; 2] {
        let position = vertex.position();
        [position.x, position.y]
    }
}

fn build_path_vertices(path: &PathDrawCommand, width: f32, height: f32) -> Vec<DrawingVertex> {
    let Some(lyon_path) = build_lyon_path(path) else {
        return Vec::new();
    };

    let mut geometry: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
    match path.style {
        PathStyle2D::Fill => {
            let mut tessellator = FillTessellator::new();
            let fill_rule = match path.fill_rule {
                PathFillRule2D::Nonzero => FillRule::NonZero,
                PathFillRule2D::Evenodd => FillRule::EvenOdd,
            };
            if tessellator
                .tessellate_path(
                    &lyon_path,
                    &FillOptions::default().with_fill_rule(fill_rule),
                    &mut BuffersBuilder::new(&mut geometry, PositionCtor),
                )
                .is_err()
            {
                return Vec::new();
            }
        }
        PathStyle2D::Stroke => {
            let mut tessellator = StrokeTessellator::new();
            let mut options = StrokeOptions::default().with_line_width(path.stroke_width.max(0.0));
            options.start_cap = map_line_cap(path.stroke_cap);
            options.end_cap = map_line_cap(path.stroke_cap);
            options.line_join = map_line_join(path.stroke_join);
            if tessellator
                .tessellate_path(
                    &lyon_path,
                    &options,
                    &mut BuffersBuilder::new(&mut geometry, PositionCtor),
                )
                .is_err()
            {
                return Vec::new();
            }
        }
    }

    indexed_positions_to_vertices(&geometry.vertices, &geometry.indices, path.color, width, height)
}

fn map_line_join(join: PathStrokeJoin2D) -> LineJoin {
    match join {
        PathStrokeJoin2D::Miter => LineJoin::Miter,
        PathStrokeJoin2D::Bevel => LineJoin::Bevel,
        PathStrokeJoin2D::Round => LineJoin::Round,
    }
}

fn map_line_cap(cap: PathStrokeCap2D) -> LineCap {
    match cap {
        PathStrokeCap2D::Butt => LineCap::Butt,
        PathStrokeCap2D::Square => LineCap::Square,
        PathStrokeCap2D::Round => LineCap::Round,
    }
}

fn indexed_positions_to_vertices(
    positions: &[[f32; 2]],
    indices: &[u32],
    color: ColorValue,
    width: f32,
    height: f32,
) -> Vec<DrawingVertex> {
    let color = color.to_array();
    indices
        .iter()
        .filter_map(|index| positions.get(*index as usize))
        .map(|position| DrawingVertex {
            position: [
                (position[0] / width) * 2.0 - 1.0,
                1.0 - (position[1] / height) * 2.0,
                0.0,
                1.0,
            ],
            color,
        })
        .collect()
}

fn build_lyon_path(path: &PathDrawCommand) -> Option<Path> {
    let mut builder = Path::builder();
    let mut current = [path.x, path.y];
    let mut contour_start = [path.x, path.y];
    let mut saw_geometry = false;
    let mut contour_open = false;

    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                if contour_open {
                    builder.end(false);
                }
                let target = [path.x + to[0], path.y + to[1]];
                builder.begin(point(target[0], target[1]));
                current = target;
                contour_start = target;
                saw_geometry = true;
                contour_open = true;
            }
            PathVerb2D::LineTo { to } => {
                let target = [path.x + to[0], path.y + to[1]];
                ensure_path_started(
                    &mut builder,
                    current,
                    &mut contour_start,
                    &mut saw_geometry,
                    &mut contour_open,
                );
                builder.line_to(point(target[0], target[1]));
                current = target;
            }
            PathVerb2D::QuadTo { control, to } => {
                let control = [path.x + control[0], path.y + control[1]];
                let target = [path.x + to[0], path.y + to[1]];
                ensure_path_started(
                    &mut builder,
                    current,
                    &mut contour_start,
                    &mut saw_geometry,
                    &mut contour_open,
                );
                builder.quadratic_bezier_to(
                    point(control[0], control[1]),
                    point(target[0], target[1]),
                );
                current = target;
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                ensure_path_started(
                    &mut builder,
                    current,
                    &mut contour_start,
                    &mut saw_geometry,
                    &mut contour_open,
                );
                let control = [path.x + control[0], path.y + control[1]];
                let target = [path.x + to[0], path.y + to[1]];
                append_conic_polyline(&mut builder, current, control, target, weight);
                current = target;
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                let control1 = [path.x + control1[0], path.y + control1[1]];
                let control2 = [path.x + control2[0], path.y + control2[1]];
                let target = [path.x + to[0], path.y + to[1]];
                ensure_path_started(
                    &mut builder,
                    current,
                    &mut contour_start,
                    &mut saw_geometry,
                    &mut contour_open,
                );
                builder.cubic_bezier_to(
                    point(control1[0], control1[1]),
                    point(control2[0], control2[1]),
                    point(target[0], target[1]),
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
                ensure_path_started(
                    &mut builder,
                    current,
                    &mut contour_start,
                    &mut saw_geometry,
                    &mut contour_open,
                );
                let center = [path.x + center[0], path.y + center[1]];
                append_arc_polyline(
                    &mut builder,
                    center,
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                );
                current = arc_endpoint(center, radius, start_angle, end_angle, counter_clockwise);
            }
            PathVerb2D::Close => {
                if contour_open {
                    builder.close();
                    current = contour_start;
                    contour_open = false;
                }
            }
        }
    }

    if !saw_geometry {
        return None;
    }

    if contour_open {
        builder.end(false);
    }

    Some(builder.build())
}

fn ensure_path_started(
    builder: &mut lyon::path::path::Builder,
    current: [f32; 2],
    contour_start: &mut [f32; 2],
    saw_geometry: &mut bool,
    contour_open: &mut bool,
) {
    if !*saw_geometry {
        builder.begin(point(current[0], current[1]));
        *contour_start = current;
        *saw_geometry = true;
        *contour_open = true;
    }
}

fn append_conic_polyline(
    builder: &mut lyon::path::path::Builder,
    p0: [f32; 2],
    p1: [f32; 2],
    p2: [f32; 2],
    weight: f32,
) {
    let steps = 24;
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        let omt = 1.0 - t;
        let denom = omt * omt + 2.0 * weight * omt * t + t * t;
        let x = ((omt * omt * p0[0]) + (2.0 * weight * omt * t * p1[0]) + (t * t * p2[0])) / denom;
        let y = ((omt * omt * p0[1]) + (2.0 * weight * omt * t * p1[1]) + (t * t * p2[1])) / denom;
        builder.line_to(point(x, y));
    }
}

fn append_arc_polyline(
    builder: &mut lyon::path::path::Builder,
    center: [f32; 2],
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) {
    let sweep = normalized_arc_sweep(start_angle, end_angle, counter_clockwise);
    let steps = ((sweep.abs() / (PI / 16.0)).ceil() as usize).max(1);
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        let angle = start_angle + sweep * t;
        builder.line_to(point(
            center[0] + radius * angle.cos(),
            center[1] + radius * angle.sin(),
        ));
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
    [center[0] + radius * angle.cos(), center[1] + radius * angle.sin()]
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

pub fn encode_drawing_command_buffer(
    shared_context: &DawnSharedContext,
    prepared: &DrawingPreparedRecording,
    encoder: &mut wgpu::CommandEncoder,
    target_view: &wgpu::TextureView,
) -> Result<()> {
    for pass in &prepared.passes {
        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("goldlight drawing draw pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: pass.load_op,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });
        for step in &pass.steps {
            let Some(vertex_buffer) = shared_context
                .resource_provider
                .create_vertex_buffer(&step.vertices)
            else {
                continue;
            };
            let pipeline = shared_context
                .resource_provider
                .resolve_pipeline(&step.pipeline);
            render_pass.set_pipeline(&pipeline);
            render_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
            render_pass.draw(0..step.vertices.len() as u32, 0..1);
        }
    }
    Ok(())
}
