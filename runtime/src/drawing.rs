use std::sync::Arc;

use anyhow::Result;
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::render::{ColorValue, Rect2D, Scene2D};

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
pub struct DrawingGraphicsPipelineDesc;

#[derive(Clone, Debug)]
pub struct DrawingPreparedStep {
    pub pipeline: DrawingGraphicsPipelineDesc,
    pub vertices: Vec<DrawingVertex>,
}

#[derive(Clone, Debug)]
pub struct DrawingDrawPass {
    pub load_op: wgpu::LoadOp<wgpu::Color>,
    pub clear_color: ColorValue,
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

pub fn record_scene_2d(scene: &Scene2D, rects: &[Rect2D]) -> DrawingRecording {
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
    let mut current_clear = ColorValue::default();
    let mut current_load_op = wgpu::LoadOp::Load;
    let mut current_steps = Vec::new();

    let flush_pass =
        |passes: &mut Vec<DrawingDrawPass>,
         current_load_op: &mut wgpu::LoadOp<wgpu::Color>,
         current_clear: &mut ColorValue,
         current_steps: &mut Vec<DrawingPreparedStep>| {
            if matches!(current_load_op, wgpu::LoadOp::Load) && current_steps.is_empty() {
                return;
            }
            passes.push(DrawingDrawPass {
                load_op: *current_load_op,
                clear_color: *current_clear,
                steps: std::mem::take(current_steps),
            });
            *current_load_op = wgpu::LoadOp::Load;
            *current_clear = ColorValue::default();
        };

    for command in &recording.commands {
        match command {
            DrawingCommand::Clear { color } => {
                flush_pass(
                    &mut passes,
                    &mut current_load_op,
                    &mut current_clear,
                    &mut current_steps,
                );
                current_clear = *color;
                current_load_op = wgpu::LoadOp::Clear(color.to_wgpu());
            }
            DrawingCommand::FillRect(rect) => {
                current_steps.push(DrawingPreparedStep {
                    pipeline: DrawingGraphicsPipelineDesc,
                    vertices: build_rect_vertices(rect, width, height),
                });
            }
        }
    }

    flush_pass(
        &mut passes,
        &mut current_load_op,
        &mut current_clear,
        &mut current_steps,
    );

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
        let _ = pass.clear_color;
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
