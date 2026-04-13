use std::sync::{Arc, OnceLock};

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::render::{
    ColorValue, DirectMaskGlyph2D, GlyphMask2D, SdfGlyph2D, TransformedMaskGlyph2D,
};
use crate::text_atlas::{TextAtlasPlacement, TextAtlasProvider};

const BITMAP_ATLAS_PADDING: u32 = 1;
const SDF_ATLAS_PADDING: u32 = 0;
const SK_GAMMA_CONTRAST: f32 = 0.5;
const SK_GAMMA_EXPONENT: f32 = 0.0;
const SK_DISTANCE_FIELD_AA_FACTOR: f32 = 0.65;
const DISTANCE_ADJUST_LUM_SHIFT: usize = 5;

const BITMAP_TEXT_SHADER_SOURCE: &str = r#"
struct TextUniform {
  atlas_size_inv: vec2<f32>,
  gamma_params: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) texture_coords: vec2<f32>,
  @location(2) unorm_tex_coords: vec2<f32>,
};

@group(0) @binding(0) var text_sampler: sampler;
@group(0) @binding(1) var text_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> text_uniform: TextUniform;

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
  @location(2) uv: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = position;
  output.color = color;
  output.unorm_tex_coords = uv;
  output.texture_coords = uv * text_uniform.atlas_size_inv;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let coverage = textureSample(text_texture, text_sampler, input.texture_coords).r;
  return vec4<f32>(input.color.rgb, input.color.a * coverage);
}
"#;

const SDF_TEXT_SHADER_SOURCE: &str = r#"
struct TextUniform {
  atlas_size_inv: vec2<f32>,
  gamma_params: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) texture_coords: vec2<f32>,
  @location(2) unorm_tex_coords: vec2<f32>,
};

@group(0) @binding(0) var text_sampler: sampler;
@group(0) @binding(1) var text_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> text_uniform: TextUniform;

fn sdf_text_coverage_fn(
  tex_color: f32,
  gamma_params: vec2<f32>,
  unorm_tex_coords: vec2<f32>,
) -> f32 {
  var dist = 7.96875 * (tex_color - 0.50196078431);
  dist -= gamma_params.x;

  var dist_grad = vec2<f32>(dpdx(dist), dpdy(dist));
  let dg_len2 = dot(dist_grad, dist_grad);
  dist_grad = select(
    vec2<f32>(0.7071, 0.7071),
    dist_grad * inverseSqrt(dg_len2),
    dg_len2 >= 0.0001,
  );

  let jacobian = mat2x2<f32>(dpdx(unorm_tex_coords), dpdy(unorm_tex_coords));
  let grad = jacobian * dist_grad;
  let approx_frag_width = 0.65 * length(grad);

  if (gamma_params.y > 0.0) {
    return clamp(
      (dist + approx_frag_width) / (2.0 * approx_frag_width),
      0.0,
      1.0,
    );
  }
  return smoothstep(-approx_frag_width, approx_frag_width, dist);
}

@vertex
fn vs_main(
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
  @location(2) uv: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = position;
  output.color = color;
  output.unorm_tex_coords = uv;
  output.texture_coords = uv * text_uniform.atlas_size_inv;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let coverage = sdf_text_coverage_fn(
    textureSample(text_texture, text_sampler, input.texture_coords).r,
    text_uniform.gamma_params,
    input.unorm_tex_coords,
  );
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

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct TextUniform {
    atlas_size_inv: [f32; 2],
    gamma_params: [f32; 2],
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
    pub atlas_page_index: Option<usize>,
    pub atlas: TextAtlasData,
}

#[derive(Clone, Debug)]
pub struct PreparedSdfTextStep {
    pub vertices: Vec<TextVertex>,
    pub atlas_page_index: Option<usize>,
    pub atlas: TextAtlasData,
}

#[derive(Clone)]
pub struct TextPipelineResources {
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    bitmap_pipeline: Arc<TextPipelinePair>,
    sdf_pipeline: Arc<TextPipelinePair>,
    use_gamma_correct_distance_table: bool,
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: Some(
                            wgpu::BufferSize::new(std::mem::size_of::<TextUniform>() as u64)
                                .expect("text uniform size"),
                        ),
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
            use_gamma_correct_distance_table: !format.is_srgb(),
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
        uniform_buffer: &wgpu::Buffer,
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
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: uniform_buffer.as_entire_binding(),
                },
            ],
        })
    }
}

fn create_text_uniform_buffer(
    device: &wgpu::Device,
    atlas_width: u32,
    atlas_height: u32,
    gamma_params: [f32; 2],
    label: &str,
) -> wgpu::Buffer {
    let uniform = TextUniform {
        atlas_size_inv: [
            1.0 / atlas_width.max(1) as f32,
            1.0 / atlas_height.max(1) as f32,
        ],
        gamma_params,
    };
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(label),
        contents: bytemuck::bytes_of(&uniform),
        usage: wgpu::BufferUsages::UNIFORM,
    })
}

fn clamp_unit(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn srgb_to_luma(luminance: f32) -> f32 {
    let luminance = clamp_unit(luminance);
    if luminance <= 0.04045 {
        luminance / 12.92
    } else {
        ((luminance + 0.055) / 1.055).powf(2.4)
    }
}

fn luma_to_srgb(luma: f32) -> f32 {
    let luma = clamp_unit(luma);
    if luma <= 0.0031308 {
        luma * 12.92
    } else {
        1.055 * luma.powf(1.0 / 2.4) - 0.055
    }
}

fn to_luma(gamma: f32, luminance: f32) -> f32 {
    if gamma == 0.0 {
        srgb_to_luma(luminance)
    } else if (gamma - 1.0).abs() <= f32::EPSILON {
        clamp_unit(luminance)
    } else {
        clamp_unit(luminance).powf(gamma)
    }
}

fn from_luma(gamma: f32, luma: f32) -> f32 {
    if gamma == 0.0 {
        luma_to_srgb(luma)
    } else if (gamma - 1.0).abs() <= f32::EPSILON {
        clamp_unit(luma)
    } else {
        clamp_unit(luma).powf(1.0 / gamma)
    }
}

fn compute_luminance(gamma: f32, color: [f32; 4]) -> u8 {
    let r = to_luma(gamma, color[0]);
    let g = to_luma(gamma, color[1]);
    let b = to_luma(gamma, color[2]);
    let luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    (from_luma(gamma, luma)
        .mul_add(255.0, 0.0)
        .round()
        .clamp(0.0, 255.0)) as u8
}

fn scale_three_bits_to_255(base: usize) -> u8 {
    let base = (base as u8) << 5;
    base | (base >> 3) | (base >> 6)
}

fn apply_contrast(src_alpha: f32, contrast: f32) -> f32 {
    src_alpha + ((1.0 - src_alpha) * contrast * src_alpha)
}

fn build_correcting_lut(src_i: u8, contrast: f32, device_gamma: f32) -> [u8; 256] {
    let src = src_i as f32 / 255.0;
    let lin_src = to_luma(device_gamma, src);
    let dst = 1.0 - src;
    let lin_dst = to_luma(device_gamma, dst);
    let adjusted_contrast = contrast * lin_dst;
    let mut table = [0u8; 256];
    if (src - dst).abs() < (1.0 / 256.0) {
        for (index, entry) in table.iter_mut().enumerate() {
            let raw_src_alpha = index as f32 / 255.0;
            let src_alpha = apply_contrast(raw_src_alpha, adjusted_contrast);
            *entry = (255.0 * src_alpha).round().clamp(0.0, 255.0) as u8;
        }
        return table;
    }

    for (index, entry) in table.iter_mut().enumerate() {
        let raw_src_alpha = index as f32 / 255.0;
        let src_alpha = apply_contrast(raw_src_alpha, adjusted_contrast);
        let dst_alpha = 1.0 - src_alpha;
        let lin_out = lin_src * src_alpha + dst_alpha * lin_dst;
        let out = from_luma(device_gamma, lin_out);
        let result = ((out - dst) / (src - dst)).clamp(0.0, 1.0);
        *entry = (255.0 * result).round().clamp(0.0, 255.0) as u8;
    }
    table
}

#[derive(Clone, Copy)]
struct DistanceFieldAdjustTable {
    table: [f32; 8],
    gamma_correct_table: [f32; 8],
}

impl DistanceFieldAdjustTable {
    fn build() -> Self {
        Self {
            table: build_distance_adjust_table(SK_GAMMA_EXPONENT),
            gamma_correct_table: build_distance_adjust_table(1.0),
        }
    }

    fn get_adjustment(&self, luminance: u8, use_gamma_correct_table: bool) -> f32 {
        let index = (luminance as usize) >> DISTANCE_ADJUST_LUM_SHIFT;
        if use_gamma_correct_table {
            self.gamma_correct_table[index]
        } else {
            self.table[index]
        }
    }
}

fn build_distance_adjust_table(device_gamma: f32) -> [f32; 8] {
    let mut table = [0.0; 8];
    for (row, value) in table.iter_mut().enumerate() {
        let lut = build_correcting_lut(
            scale_three_bits_to_255(row),
            SK_GAMMA_CONTRAST,
            device_gamma,
        );
        for column in 0..255 {
            if lut[column] <= 127 && lut[column + 1] >= 128 {
                let interp =
                    (127.5 - lut[column] as f32) / (lut[column + 1] as f32 - lut[column] as f32);
                let border_alpha = (column as f32 + interp) / 255.0;
                let t = border_alpha * (border_alpha * (4.0 * border_alpha - 6.0) + 5.0) / 3.0;
                *value = 2.0 * SK_DISTANCE_FIELD_AA_FACTOR * t - SK_DISTANCE_FIELD_AA_FACTOR;
                break;
            }
        }
    }
    table
}

fn distance_field_adjust_table() -> &'static DistanceFieldAdjustTable {
    static TABLE: OnceLock<DistanceFieldAdjustTable> = OnceLock::new();
    TABLE.get_or_init(DistanceFieldAdjustTable::build)
}

fn sdf_gamma_params(color: [f32; 4], use_gamma_correct_distance_table: bool) -> [f32; 2] {
    let luminance = compute_luminance(SK_GAMMA_EXPONENT, color);
    [
        distance_field_adjust_table().get_adjustment(luminance, use_gamma_correct_distance_table),
        if use_gamma_correct_distance_table {
            1.0
        } else {
            0.0
        },
    ]
}

fn glyph_copy_width(mask: &GlyphMask2D) -> u32 {
    mask.width.min(mask.stride)
}

fn shelf_pack(sizes: &[(u32, u32)], padding: u32) -> Option<(u32, u32, Vec<AtlasPlacement>)> {
    if sizes.is_empty() {
        return None;
    }
    let mut cursor_x = padding;
    let mut cursor_y = padding;
    let mut row_height = 0u32;
    let mut max_width = 0u32;
    let mut placements = Vec::with_capacity(sizes.len());
    for (width, height) in sizes.iter().copied() {
        if cursor_x + width + padding > 2048 {
            cursor_x = padding;
            cursor_y += row_height + padding;
            row_height = 0;
        }
        placements.push(AtlasPlacement {
            x: cursor_x,
            y: cursor_y,
        });
        cursor_x += width + padding;
        row_height = row_height.max(height);
        max_width = max_width.max(cursor_x);
    }
    Some((
        max_width.max(1),
        (cursor_y + row_height + padding).max(1),
        placements,
    ))
}

fn build_atlas(
    masks: &[&GlyphMask2D],
    padding: u32,
) -> Option<(TextAtlasData, Vec<AtlasPlacement>)> {
    let sizes = masks
        .iter()
        .map(|mask| (glyph_copy_width(mask), mask.height))
        .collect::<Vec<_>>();
    let (width, height, placements) = shelf_pack(&sizes, padding)?;
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
    _atlas_width: f32,
    _atlas_height: f32,
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
            uv: [u, v],
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
    atlas_provider: Option<&mut TextAtlasProvider>,
) -> Vec<PreparedBitmapTextStep> {
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
        atlas_provider,
    )
    .unwrap_or_default()
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
    atlas_provider: Option<&mut TextAtlasProvider>,
) -> Vec<PreparedBitmapTextStep> {
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
        atlas_provider,
    )
    .unwrap_or_default()
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
    atlas_provider: Option<&mut TextAtlasProvider>,
) -> Vec<PreparedSdfTextStep> {
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
        return Vec::new();
    }
    let color = color.to_array();
    let masks = glyph_refs.iter().map(|glyph| glyph.sdf).collect::<Vec<_>>();
    if let Some(atlas_provider) = atlas_provider {
        let Some((atlas_width, atlas_height, placements)) =
            atlas_provider.find_or_create_sdf_entries(&masks)
        else {
            return Vec::new();
        };
        let mut steps = Vec::new();
        let mut current_page = None;
        let mut current_vertices = Vec::new();
        for (glyph, placement) in glyph_refs.iter().zip(&placements) {
            flush_sdf_page(
                &mut steps,
                &mut current_page,
                &mut current_vertices,
                placement,
                atlas_width,
                atlas_height,
            );
            let visible_width = glyph.sdf.width.saturating_sub(glyph.sdf_inset * 2) as f32;
            let visible_height = glyph.sdf.height.saturating_sub(glyph.sdf_inset * 2) as f32;
            if visible_width <= 0.0 || visible_height <= 0.0 {
                continue;
            }
            append_quad(
                &mut current_vertices,
                color,
                atlas_width as f32,
                atlas_height as f32,
                glyph.x
                    + (glyph.sdf.offset_x as f32 + glyph.sdf_inset as f32)
                        * glyph.strike_to_source_scale,
                glyph.y
                    + (glyph.sdf.offset_y as f32 + glyph.sdf_inset as f32)
                        * glyph.strike_to_source_scale,
                visible_width * glyph.strike_to_source_scale,
                visible_height * glyph.strike_to_source_scale,
                placement.texture_origin[0] as f32 + glyph.sdf_inset as f32,
                placement.texture_origin[1] as f32 + glyph.sdf_inset as f32,
                visible_width,
                visible_height,
                surface_width as f32,
                surface_height as f32,
                painter_depth,
                transform,
            );
        }
        flush_pending_sdf_step(
            &mut steps,
            current_page,
            current_vertices,
            atlas_width,
            atlas_height,
        );
        return steps;
    }

    let Some((atlas, placements)) = build_atlas(&masks, SDF_ATLAS_PADDING) else {
        return Vec::new();
    };
    let mut vertices = Vec::with_capacity(glyph_refs.len() * 6);
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
            glyph.x
                + (glyph.sdf.offset_x as f32 + glyph.sdf_inset as f32)
                    * glyph.strike_to_source_scale,
            glyph.y
                + (glyph.sdf.offset_y as f32 + glyph.sdf_inset as f32)
                    * glyph.strike_to_source_scale,
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
    (!vertices.is_empty())
        .then_some(PreparedSdfTextStep {
            vertices,
            atlas_page_index: None,
            atlas,
        })
        .into_iter()
        .collect()
}

fn prepare_bitmap_text_step(
    glyphs: &[BitmapTextGlyphRef<'_>],
    color: ColorValue,
    surface_width: u32,
    surface_height: u32,
    painter_depth: f32,
    transform: [f32; 6],
    atlas_provider: Option<&mut TextAtlasProvider>,
) -> Option<Vec<PreparedBitmapTextStep>> {
    if glyphs.is_empty() {
        return None;
    }
    let masks = glyphs.iter().map(|glyph| glyph.mask).collect::<Vec<_>>();
    let color = color.to_array();
    if let Some(atlas_provider) = atlas_provider {
        let (atlas_width, atlas_height, placements) =
            atlas_provider.find_or_create_bitmap_entries(&masks)?;
        let mut steps = Vec::new();
        let mut current_page = None;
        let mut current_vertices = Vec::new();
        for (glyph, placement) in glyphs.iter().zip(&placements) {
            flush_bitmap_page(
                &mut steps,
                &mut current_page,
                &mut current_vertices,
                placement,
                atlas_width,
                atlas_height,
            );
            append_quad(
                &mut current_vertices,
                color,
                atlas_width as f32,
                atlas_height as f32,
                glyph.x,
                glyph.y,
                glyph.mask.width as f32 * glyph.strike_to_source_scale,
                glyph.mask.height as f32 * glyph.strike_to_source_scale,
                placement.texture_origin[0] as f32,
                placement.texture_origin[1] as f32,
                glyph.mask.width as f32,
                glyph.mask.height as f32,
                surface_width as f32,
                surface_height as f32,
                painter_depth,
                transform,
            );
        }
        flush_pending_bitmap_step(
            &mut steps,
            current_page,
            current_vertices,
            atlas_width,
            atlas_height,
        );
        return Some(steps);
    }

    let (atlas, placements) = build_atlas(&masks, BITMAP_ATLAS_PADDING)?;
    let mut vertices = Vec::with_capacity(glyphs.len() * 6);
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
    (!vertices.is_empty()).then_some(vec![PreparedBitmapTextStep {
        vertices,
        atlas_page_index: None,
        atlas,
    }])
}

fn flush_bitmap_page(
    steps: &mut Vec<PreparedBitmapTextStep>,
    current_page: &mut Option<usize>,
    current_vertices: &mut Vec<TextVertex>,
    placement: &TextAtlasPlacement,
    atlas_width: u32,
    atlas_height: u32,
) {
    if current_page.is_some()
        && *current_page != Some(placement.page_index)
        && !current_vertices.is_empty()
    {
        flush_pending_bitmap_step(
            steps,
            *current_page,
            std::mem::take(current_vertices),
            atlas_width,
            atlas_height,
        );
    }
    *current_page = Some(placement.page_index);
}

fn flush_pending_bitmap_step(
    steps: &mut Vec<PreparedBitmapTextStep>,
    page_index: Option<usize>,
    vertices: Vec<TextVertex>,
    atlas_width: u32,
    atlas_height: u32,
) {
    if vertices.is_empty() {
        return;
    }
    steps.push(PreparedBitmapTextStep {
        vertices,
        atlas_page_index: page_index,
        atlas: TextAtlasData {
            width: atlas_width,
            height: atlas_height,
            pixels: Vec::new(),
        },
    });
}

fn flush_sdf_page(
    steps: &mut Vec<PreparedSdfTextStep>,
    current_page: &mut Option<usize>,
    current_vertices: &mut Vec<TextVertex>,
    placement: &TextAtlasPlacement,
    atlas_width: u32,
    atlas_height: u32,
) {
    if current_page.is_some()
        && *current_page != Some(placement.page_index)
        && !current_vertices.is_empty()
    {
        flush_pending_sdf_step(
            steps,
            *current_page,
            std::mem::take(current_vertices),
            atlas_width,
            atlas_height,
        );
    }
    *current_page = Some(placement.page_index);
}

fn flush_pending_sdf_step(
    steps: &mut Vec<PreparedSdfTextStep>,
    page_index: Option<usize>,
    vertices: Vec<TextVertex>,
    atlas_width: u32,
    atlas_height: u32,
) {
    if vertices.is_empty() {
        return;
    }
    steps.push(PreparedSdfTextStep {
        vertices,
        atlas_page_index: page_index,
        atlas: TextAtlasData {
            width: atlas_width,
            height: atlas_height,
            pixels: Vec::new(),
        },
    });
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
    atlas_provider: Option<&TextAtlasProvider>,
    sample_count: u32,
) {
    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("goldlight bitmap text vertex buffer"),
        contents: bytemuck::cast_slice(&step.vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let uniform_buffer = create_text_uniform_buffer(
        device,
        step.atlas.width,
        step.atlas.height,
        [0.0, 0.0],
        "goldlight bitmap text uniform buffer",
    );
    let bind_group =
        if let (Some(page_index), Some(atlas_provider)) = (step.atlas_page_index, atlas_provider) {
            resources.create_bind_group(
                device,
                atlas_provider.page_view(page_index),
                &uniform_buffer,
            )
        } else {
            let (texture, view) = create_text_atlas_texture(device, queue, &step.atlas);
            let bind_group = resources.create_bind_group(device, &view, &uniform_buffer);
            let _temporary_texture = texture;
            bind_group
        };
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
    atlas_provider: Option<&TextAtlasProvider>,
    sample_count: u32,
) {
    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("goldlight sdf text vertex buffer"),
        contents: bytemuck::cast_slice(&step.vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let gamma_params = step
        .vertices
        .first()
        .map(|vertex| sdf_gamma_params(vertex.color, resources.use_gamma_correct_distance_table))
        .unwrap_or([0.0, 0.0]);
    let uniform_buffer = create_text_uniform_buffer(
        device,
        step.atlas.width,
        step.atlas.height,
        gamma_params,
        "goldlight sdf text uniform buffer",
    );
    let bind_group =
        if let (Some(page_index), Some(atlas_provider)) = (step.atlas_page_index, atlas_provider) {
            resources.create_bind_group(
                device,
                atlas_provider.page_view(page_index),
                &uniform_buffer,
            )
        } else {
            let (texture, view) = create_text_atlas_texture(device, queue, &step.atlas);
            let bind_group = resources.create_bind_group(device, &view, &uniform_buffer);
            let _temporary_texture = texture;
            bind_group
        };
    let pipeline = resources.sdf_pipeline(sample_count);
    render_pass.set_pipeline(&pipeline);
    render_pass.set_bind_group(0, &bind_group, &[]);
    render_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
    render_pass.draw(0..step.vertices.len() as u32, 0..1);
}
