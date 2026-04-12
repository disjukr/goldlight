use std::sync::{Arc, OnceLock};

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::render::{
    ColorValue, DirectMaskGlyph2D, GlyphMask2D, SdfGlyph2D, TransformedMaskGlyph2D,
};

const ATLAS_PADDING: u32 = 1;

const BITMAP_TEXT_SHADER_SOURCE: &str = r#"
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

@group(0) @binding(0) var text_sampler: sampler;
@group(0) @binding(1) var text_texture: texture_2d<f32>;

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
  @location(2) uv: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = position;
  output.color = color;
  output.uv = uv;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let coverage = textureSample(text_texture, text_sampler, input.uv).r;
  return vec4<f32>(input.color.rgb, input.color.a * coverage);
}
"#;

const SDF_TEXT_SHADER_SOURCE: &str = r#"
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

@group(0) @binding(0) var text_sampler: sampler;
@group(0) @binding(1) var text_texture: texture_2d<f32>;

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
  @location(2) uv: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = position;
  output.color = color;
  output.uv = uv;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let tex = textureSample(text_texture, text_sampler, input.uv).r;
  let dist = 7.96875 * (tex - 0.50196078431);
  let width = max(fwidth(dist), 1e-5);
  let coverage = smoothstep(-width, width, dist);
  return vec4<f32>(input.color.rgb, input.color.a * coverage);
}
"#;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct TextVertex {
    position: [f32; 4],
    color: [f32; 4],
    uv: [f32; 2],
}

impl TextVertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 3] =
        wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x2];

    pub fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TextAtlasData {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct PreparedBitmapTextStep {
    pub vertices: Vec<TextVertex>,
    pub atlas: TextAtlasData,
}

#[derive(Clone, Debug)]
pub struct PreparedSdfTextStep {
    pub vertices: Vec<TextVertex>,
    pub atlas: TextAtlasData,
}

#[derive(Clone)]
pub struct TextPipelineResources {
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    bitmap_pipeline: Arc<TextPipelinePair>,
    sdf_pipeline: Arc<TextPipelinePair>,
}

struct TextPipelinePair {
    _name: &'static str,
    create_pipeline: Arc<dyn Fn(u32) -> wgpu::RenderPipeline + Send + Sync>,
    single: OnceLock<Arc<wgpu::RenderPipeline>>,
    msaa: OnceLock<Arc<wgpu::RenderPipeline>>,
    msaa_sample_count: u32,
}

fn create_text_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    pipeline_layout: &wgpu::PipelineLayout,
    shader_source: &str,
    label: &str,
    sample_count: u32,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(label),
        source: wgpu::ShaderSource::Wgsl(shader_source.into()),
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[TextVertex::layout()],
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
        depth_stencil: Some(wgpu::DepthStencilState {
            format: crate::drawing::DRAWING_DEPTH_FORMAT,
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

#[derive(Clone, Copy)]
struct AtlasPlacement {
    x: u32,
    y: u32,
}

pub struct BitmapTextGlyphRef<'a> {
    pub x: f32,
    pub y: f32,
    pub strike_to_source_scale: f32,
    pub mask: &'a GlyphMask2D,
}

pub struct SdfTextGlyphRef<'a> {
    pub x: f32,
    pub y: f32,
    pub strike_to_source_scale: f32,
    pub sdf_inset: u32,
    pub sdf: &'a GlyphMask2D,
}

impl TextPipelinePair {
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
                .get_or_init(|| Arc::new((self.create_pipeline)(sample_count)))
                .clone();
        }
        self.single
            .get_or_init(|| Arc::new((self.create_pipeline)(1)))
            .clone()
    }
}

impl TextPipelineResources {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, msaa_sample_count: u32) -> Self {
        let device = device.clone();
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("goldlight text bind group layout"),
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
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("goldlight text sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("goldlight text pipeline layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        Self {
            bind_group_layout,
            sampler,
            bitmap_pipeline: Arc::new(TextPipelinePair::new(
                "bitmap text",
                {
                    let device = device.clone();
                    let pipeline_layout = pipeline_layout.clone();
                    move |sample_count| {
                        create_text_pipeline(
                            &device,
                            format,
                            &pipeline_layout,
                            BITMAP_TEXT_SHADER_SOURCE,
                            "goldlight bitmap text pipeline",
                            sample_count,
                        )
                    }
                },
                msaa_sample_count,
            )),
            sdf_pipeline: Arc::new(TextPipelinePair::new(
                "sdf text",
                {
                    let device = device.clone();
                    let pipeline_layout = pipeline_layout.clone();
                    move |sample_count| {
                        create_text_pipeline(
                            &device,
                            format,
                            &pipeline_layout,
                            SDF_TEXT_SHADER_SOURCE,
                            "goldlight sdf text pipeline",
                            sample_count,
                        )
                    }
                },
                msaa_sample_count,
            )),
        }
    }

    pub fn bitmap_pipeline(&self, sample_count: u32) -> Arc<wgpu::RenderPipeline> {
        self.bitmap_pipeline.get(sample_count)
    }

    pub fn sdf_pipeline(&self, sample_count: u32) -> Arc<wgpu::RenderPipeline> {
        self.sdf_pipeline.get(sample_count)
    }

    pub fn create_bind_group(
        &self,
        device: &wgpu::Device,
        view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("goldlight text bind group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(view),
                },
            ],
        })
    }
}

fn glyph_copy_width(mask: &GlyphMask2D) -> u32 {
    mask.width.min(mask.stride)
}

fn shelf_pack(sizes: &[(u32, u32)]) -> Option<(u32, u32, Vec<AtlasPlacement>)> {
    if sizes.is_empty() {
        return None;
    }
    let mut cursor_x = ATLAS_PADDING;
    let mut cursor_y = ATLAS_PADDING;
    let mut row_height = 0u32;
    let mut max_width = 0u32;
    let mut placements = Vec::with_capacity(sizes.len());
    for (width, height) in sizes.iter().copied() {
        if cursor_x + width + ATLAS_PADDING > 2048 {
            cursor_x = ATLAS_PADDING;
            cursor_y += row_height + ATLAS_PADDING;
            row_height = 0;
        }
        placements.push(AtlasPlacement {
            x: cursor_x,
            y: cursor_y,
        });
        cursor_x += width + ATLAS_PADDING;
        row_height = row_height.max(height);
        max_width = max_width.max(cursor_x);
    }
    Some((
        max_width.max(1),
        (cursor_y + row_height + ATLAS_PADDING).max(1),
        placements,
    ))
}

fn build_atlas(masks: &[&GlyphMask2D]) -> Option<(TextAtlasData, Vec<AtlasPlacement>)> {
    let sizes = masks
        .iter()
        .map(|mask| (glyph_copy_width(mask), mask.height))
        .collect::<Vec<_>>();
    let (width, height, placements) = shelf_pack(&sizes)?;
    let mut pixels = vec![0u8; (width * height) as usize];
    for (mask, placement) in masks.iter().zip(&placements) {
        let copy_width = glyph_copy_width(mask);
        for row in 0..mask.height {
            let src_offset = (row * mask.stride) as usize;
            let dst_offset = ((placement.y + row) * width + placement.x) as usize;
            pixels[dst_offset..dst_offset + copy_width as usize]
                .copy_from_slice(&mask.pixels[src_offset..src_offset + copy_width as usize]);
        }
    }
    Some((
        TextAtlasData {
            width,
            height,
            pixels,
        },
        placements,
    ))
}

fn to_clip_space(x: f32, y: f32, surface_width: f32, surface_height: f32, depth: f32) -> [f32; 4] {
    [
        (x / surface_width) * 2.0 - 1.0,
        1.0 - (y / surface_height) * 2.0,
        depth,
        1.0,
    ]
}

fn transform_point(point: [f32; 2], transform: [f32; 6]) -> [f32; 2] {
    [
        (transform[0] * point[0]) + (transform[2] * point[1]) + transform[4],
        (transform[1] * point[0]) + (transform[3] * point[1]) + transform[5],
    ]
}

fn append_quad(
    vertices: &mut Vec<TextVertex>,
    color: [f32; 4],
    atlas_width: f32,
    atlas_height: f32,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
    uv_left: f32,
    uv_top: f32,
    uv_width: f32,
    uv_height: f32,
    surface_width: f32,
    surface_height: f32,
    depth: f32,
    transform: [f32; 6],
) {
    let positions = [
        (left, top, uv_left, uv_top),
        (left + width, top, uv_left + uv_width, uv_top),
        (
            left + width,
            top + height,
            uv_left + uv_width,
            uv_top + uv_height,
        ),
        (left, top, uv_left, uv_top),
        (
            left + width,
            top + height,
            uv_left + uv_width,
            uv_top + uv_height,
        ),
        (left, top + height, uv_left, uv_top + uv_height),
    ];
    for (x, y, u, v) in positions {
        let mapped = transform_point([x, y], transform);
        vertices.push(TextVertex {
            position: to_clip_space(mapped[0], mapped[1], surface_width, surface_height, depth),
            color,
            uv: [u / atlas_width, v / atlas_height],
        });
    }
}

pub fn prepare_direct_mask_text_step(
    glyphs: &[DirectMaskGlyph2D],
    color: ColorValue,
    origin_x: f32,
    origin_y: f32,
    surface_width: u32,
    surface_height: u32,
    painter_depth: f32,
    transform: [f32; 6],
) -> Option<PreparedBitmapTextStep> {
    let glyph_refs = glyphs
        .iter()
        .filter_map(|glyph| {
            glyph.mask.as_ref().map(|mask| BitmapTextGlyphRef {
                x: origin_x + glyph.x,
                y: origin_y + glyph.y,
                strike_to_source_scale: 1.0,
                mask,
            })
        })
        .collect::<Vec<_>>();
    prepare_bitmap_text_step(
        &glyph_refs,
        color,
        surface_width,
        surface_height,
        painter_depth,
        transform,
    )
}

pub fn prepare_transformed_mask_text_step(
    glyphs: &[TransformedMaskGlyph2D],
    color: ColorValue,
    origin_x: f32,
    origin_y: f32,
    surface_width: u32,
    surface_height: u32,
    painter_depth: f32,
    transform: [f32; 6],
) -> Option<PreparedBitmapTextStep> {
    let glyph_refs = glyphs
        .iter()
        .filter_map(|glyph| {
            glyph.mask.as_ref().map(|mask| BitmapTextGlyphRef {
                x: origin_x + glyph.x,
                y: origin_y + glyph.y,
                strike_to_source_scale: glyph.strike_to_source_scale,
                mask,
            })
        })
        .collect::<Vec<_>>();
    prepare_bitmap_text_step(
        &glyph_refs,
        color,
        surface_width,
        surface_height,
        painter_depth,
        transform,
    )
}

pub fn prepare_sdf_text_step(
    glyphs: &[SdfGlyph2D],
    color: ColorValue,
    origin_x: f32,
    origin_y: f32,
    surface_width: u32,
    surface_height: u32,
    painter_depth: f32,
    transform: [f32; 6],
) -> Option<PreparedSdfTextStep> {
    let glyph_refs = glyphs
        .iter()
        .filter_map(|glyph| {
            glyph.sdf.as_ref().map(|sdf| SdfTextGlyphRef {
                x: origin_x + glyph.x,
                y: origin_y + glyph.y,
                strike_to_source_scale: glyph.strike_to_source_scale,
                sdf_inset: glyph.sdf_inset,
                sdf,
            })
        })
        .collect::<Vec<_>>();
    if glyph_refs.is_empty() {
        return None;
    }
    let masks = glyph_refs.iter().map(|glyph| glyph.sdf).collect::<Vec<_>>();
    let (atlas, placements) = build_atlas(&masks)?;
    let mut vertices = Vec::with_capacity(glyph_refs.len() * 6);
    let color = color.to_array();
    for (glyph, placement) in glyph_refs.iter().zip(&placements) {
        let visible_width = glyph.sdf.width.saturating_sub(glyph.sdf_inset * 2) as f32;
        let visible_height = glyph.sdf.height.saturating_sub(glyph.sdf_inset * 2) as f32;
        if visible_width <= 0.0 || visible_height <= 0.0 {
            continue;
        }
        append_quad(
            &mut vertices,
            color,
            atlas.width as f32,
            atlas.height as f32,
            glyph.x + glyph.sdf.offset_x as f32 + glyph.sdf_inset as f32,
            glyph.y + glyph.sdf.offset_y as f32 + glyph.sdf_inset as f32,
            visible_width * glyph.strike_to_source_scale,
            visible_height * glyph.strike_to_source_scale,
            placement.x as f32 + glyph.sdf_inset as f32,
            placement.y as f32 + glyph.sdf_inset as f32,
            visible_width,
            visible_height,
            surface_width as f32,
            surface_height as f32,
            painter_depth,
            transform,
        );
    }
    (!vertices.is_empty()).then_some(PreparedSdfTextStep { vertices, atlas })
}

fn prepare_bitmap_text_step(
    glyphs: &[BitmapTextGlyphRef<'_>],
    color: ColorValue,
    surface_width: u32,
    surface_height: u32,
    painter_depth: f32,
    transform: [f32; 6],
) -> Option<PreparedBitmapTextStep> {
    if glyphs.is_empty() {
        return None;
    }
    let masks = glyphs.iter().map(|glyph| glyph.mask).collect::<Vec<_>>();
    let (atlas, placements) = build_atlas(&masks)?;
    let mut vertices = Vec::with_capacity(glyphs.len() * 6);
    let color = color.to_array();
    for (glyph, placement) in glyphs.iter().zip(&placements) {
        append_quad(
            &mut vertices,
            color,
            atlas.width as f32,
            atlas.height as f32,
            glyph.x,
            glyph.y,
            glyph.mask.width as f32 * glyph.strike_to_source_scale,
            glyph.mask.height as f32 * glyph.strike_to_source_scale,
            placement.x as f32,
            placement.y as f32,
            glyph.mask.width as f32,
            glyph.mask.height as f32,
            surface_width as f32,
            surface_height as f32,
            painter_depth,
            transform,
        );
    }
    (!vertices.is_empty()).then_some(PreparedBitmapTextStep { vertices, atlas })
}

fn create_text_atlas_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    atlas: &TextAtlasData,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture_with_data(
        queue,
        &wgpu::TextureDescriptor {
            label: Some("goldlight text atlas"),
            size: wgpu::Extent3d {
                width: atlas.width,
                height: atlas.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::LayerMajor,
        &atlas.pixels,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

pub fn encode_bitmap_text_step(
    resources: &TextPipelineResources,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    render_pass: &mut wgpu::RenderPass<'_>,
    step: &PreparedBitmapTextStep,
    sample_count: u32,
) {
    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("goldlight bitmap text vertex buffer"),
        contents: bytemuck::cast_slice(&step.vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let (_texture, view) = create_text_atlas_texture(device, queue, &step.atlas);
    let bind_group = resources.create_bind_group(device, &view);
    let pipeline = resources.bitmap_pipeline(sample_count);
    render_pass.set_pipeline(&pipeline);
    render_pass.set_bind_group(0, &bind_group, &[]);
    render_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
    render_pass.draw(0..step.vertices.len() as u32, 0..1);
}

pub fn encode_sdf_text_step(
    resources: &TextPipelineResources,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    render_pass: &mut wgpu::RenderPass<'_>,
    step: &PreparedSdfTextStep,
    sample_count: u32,
) {
    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("goldlight sdf text vertex buffer"),
        contents: bytemuck::cast_slice(&step.vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let (_texture, view) = create_text_atlas_texture(device, queue, &step.atlas);
    let bind_group = resources.create_bind_group(device, &view);
    let pipeline = resources.sdf_pipeline(sample_count);
    render_pass.set_pipeline(&pipeline);
    render_pass.set_bind_group(0, &bind_group, &[]);
    render_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
    render_pass.draw(0..step.vertices.len() as u32, 0..1);
}
