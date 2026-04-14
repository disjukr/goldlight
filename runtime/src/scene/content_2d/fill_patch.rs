use bytemuck::{Pod, Zeroable};

use super::{PathDrawCommand, Point};
use crate::scene::{PathFillRule2D, PathVerb2D};

const EPSILON: f32 = 1e-5;
const PATCH_PRECISION: f32 = 4.0;
const MAX_PATCH_RESOLVE_LEVEL: u32 = 5;
const MAX_PARAMETRIC_SEGMENTS: u32 = 1 << MAX_PATCH_RESOLVE_LEVEL;
const MAX_PARAMETRIC_SEGMENTS_P4: f32 = (MAX_PARAMETRIC_SEGMENTS
    * MAX_PARAMETRIC_SEGMENTS
    * MAX_PARAMETRIC_SEGMENTS
    * MAX_PARAMETRIC_SEGMENTS) as f32;
const MAX_SEGMENTS_PER_CURVE_P4: f32 = 1024.0 * 1024.0 * 1024.0 * 1024.0;
const PREFERRED_WEDGE_VERB_THRESHOLD: usize = 50;
const PREFERRED_WEDGE_AREA_THRESHOLD: f32 = 256.0 * 256.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FillStencilMode {
    Evenodd,
    Nonzero,
}

impl FillStencilMode {
    pub(crate) fn from_fill_rule(fill_rule: PathFillRule2D) -> Self {
        match fill_rule {
            PathFillRule2D::Nonzero => Self::Nonzero,
            PathFillRule2D::Evenodd => Self::Evenodd,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FillTriangleMode {
    StencilEvenodd,
    StencilNonzero,
    StencilCover,
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedFillTriangleStep {
    pub(crate) points: Vec<Point>,
    pub(crate) mode: FillTriangleMode,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct PatchResolveVertex {
    pub(crate) resolve_level_and_idx: [f32; 2],
}

impl PatchResolveVertex {
    pub(crate) const ATTRIBUTES: [wgpu::VertexAttribute; 1] =
        wgpu::vertex_attr_array![0 => Float32x2];

    pub(crate) fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct WedgeFillPatchInstance {
    pub(crate) p0: [f32; 2],
    pub(crate) p1: [f32; 2],
    pub(crate) p2: [f32; 2],
    pub(crate) p3: [f32; 2],
    pub(crate) curve_meta: [f32; 2],
    pub(crate) fan_point: [f32; 2],
    pub(crate) depth: f32,
}

impl WedgeFillPatchInstance {
    pub(crate) const ATTRIBUTES: [wgpu::VertexAttribute; 7] = wgpu::vertex_attr_array![
        1 => Float32x2,
        2 => Float32x2,
        3 => Float32x2,
        4 => Float32x2,
        5 => Float32x2,
        6 => Float32x2,
        7 => Float32
    ];

    pub(crate) fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct CurveFillPatchInstance {
    pub(crate) p0: [f32; 2],
    pub(crate) p1: [f32; 2],
    pub(crate) p2: [f32; 2],
    pub(crate) p3: [f32; 2],
    pub(crate) curve_meta: [f32; 2],
    pub(crate) depth: f32,
}

impl CurveFillPatchInstance {
    pub(crate) const ATTRIBUTES: [wgpu::VertexAttribute; 6] = wgpu::vertex_attr_array![
        1 => Float32x2,
        2 => Float32x2,
        3 => Float32x2,
        4 => Float32x2,
        5 => Float32x2,
        6 => Float32
    ];

    pub(crate) fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedWedgeFillStep {
    pub(crate) instances: Vec<WedgeFillPatchInstance>,
    pub(crate) stencil_mode: Option<FillStencilMode>,
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedCurveFillStep {
    pub(crate) instances: Vec<CurveFillPatchInstance>,
    pub(crate) stencil_mode: FillStencilMode,
}

#[derive(Clone, Debug)]
pub(crate) enum PreparedFillStep {
    Triangles(PreparedFillTriangleStep),
    Wedges(PreparedWedgeFillStep),
    Curves(PreparedCurveFillStep),
}

pub(crate) fn fill_paint_shader_source(group_index: u32) -> String {
    r#"
struct PaintUniform {
  info: vec4<f32>,
  params0: vec4<f32>,
  localMatrix0: vec4<f32>,
  localMatrix1: vec4<f32>,
  solidColor: vec4<f32>,
  stopOffsets0: vec4<f32>,
  stopOffsets1: vec4<f32>,
  stopColors: array<vec4<f32>, 8>,
};

@group(__GROUP_INDEX__) @binding(0) var<uniform> paint: PaintUniform;

fn paint_local_position(devicePosition: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (paint.localMatrix0.x * devicePosition.x) +
      (paint.localMatrix0.z * devicePosition.y) + paint.localMatrix1.x,
    (paint.localMatrix0.y * devicePosition.x) +
      (paint.localMatrix0.w * devicePosition.y) + paint.localMatrix1.y,
  );
}

fn tile_grad(tileModeCode: f32, tIn: vec2<f32>) -> vec2<f32> {
  let tileMode = i32(round(tileModeCode));
  var t = tIn;
  if (tileMode == 1) {
    t.x = fract(t.x);
  } else if (tileMode == 2) {
    let t1 = t.x - 1.0;
    t.x = abs(t1 - 2.0 * floor(t1 * 0.5) - 1.0);
  } else if (tileMode == 3) {
    if (t.x < 0.0 || t.x > 1.0) {
      return vec2<f32>(0.0, -1.0);
    }
  }
  return t;
}

fn gradient_stop_offset(index: i32) -> f32 {
  if (index <= 0) {
    return paint.stopOffsets0.x;
  } else if (index == 1) {
    return paint.stopOffsets0.y;
  } else if (index == 2) {
    return paint.stopOffsets0.z;
  } else if (index == 3) {
    return paint.stopOffsets0.w;
  } else if (index == 4) {
    return paint.stopOffsets1.x;
  } else if (index == 5) {
    return paint.stopOffsets1.y;
  } else if (index == 6) {
    return paint.stopOffsets1.z;
  }
  return paint.stopOffsets1.w;
}

fn gradient_stop_color(index: i32) -> vec4<f32> {
  let clampedIndex = clamp(index, 0, 7);
  return paint.stopColors[u32(clampedIndex)];
}

fn srgb_channel_to_linear(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgb_to_linear(color: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    srgb_channel_to_linear(color.r),
    srgb_channel_to_linear(color.g),
    srgb_channel_to_linear(color.b),
    color.a,
  );
}

fn mix_gradient_interval(
  t: f32,
  lowOffset: f32,
  lowColor: vec4<f32>,
  highOffset: f32,
  highColor: vec4<f32>,
) -> vec4<f32> {
  if (highOffset <= lowOffset) {
    return select(lowColor, highColor, t >= highOffset);
  }
  return mix(lowColor, highColor, (t - lowOffset) / (highOffset - lowOffset));
}

fn gradient_interpolated_color(numStops: i32, t: f32) -> vec4<f32> {
  var startIndex = 0;
  var endIndex = numStops - 1;
  if (numStops > 1 && gradient_stop_offset(0) == gradient_stop_offset(1)) {
    startIndex = 1;
  }
  if (
    numStops > 1 &&
    gradient_stop_offset(numStops - 2) == gradient_stop_offset(numStops - 1)
  ) {
    endIndex = numStops - 2;
  }
  if (t <= gradient_stop_offset(startIndex)) {
    return gradient_stop_color(startIndex);
  }
  if (t >= gradient_stop_offset(endIndex)) {
    return gradient_stop_color(endIndex);
  }

  var lowIndex = startIndex;
  var highIndex = endIndex;
  while (highIndex - lowIndex > 1) {
    let middleIndex = (lowIndex + highIndex) / 2;
    if (t < gradient_stop_offset(middleIndex)) {
      highIndex = middleIndex;
    } else {
      lowIndex = middleIndex;
    }
  }

  let lowOffset = gradient_stop_offset(lowIndex);
  let lowColor = gradient_stop_color(lowIndex);
  let highOffset = gradient_stop_offset(highIndex);
  let highColor = gradient_stop_color(highIndex);
  return mix_gradient_interval(t, lowOffset, lowColor, highOffset, highColor);
}

fn colorize_gradient(numStops: i32, tileModeCode: f32, t: vec2<f32>) -> vec4<f32> {
  if (t.y < 0.0) {
    return vec4<f32>(0.0);
  }

  let tileMode = i32(round(tileModeCode));
  if (tileMode == 0) {
    if (t.x < 0.0) {
      return gradient_stop_color(0);
    }
    if (t.x > 1.0) {
      return gradient_stop_color(numStops - 1);
    }
    return gradient_interpolated_color(numStops, t.x);
  }

  let tiled = tile_grad(tileModeCode, t);
  if (tiled.y < 0.0) {
    return vec4<f32>(0.0);
  }
  return gradient_interpolated_color(numStops, tiled.x);
}

fn linear_grad_layout(pos: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(pos.x + 0.00001, 1.0);
}

fn radial_grad_layout(pos: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(length(pos), 1.0);
}

fn sweep_grad_layout(biasParam: f32, scaleParam: f32, pos: vec2<f32>) -> vec2<f32> {
  let angle = select(atan2(-pos.y, -pos.x), sign(pos.y) * -1.5707963267949, pos.x == 0.0);
  let t = (angle * 0.1591549430918 + 0.5 + biasParam) * scaleParam;
  return vec2<f32>(t, 1.0);
}

fn conical_grad_layout(
  radius0: f32,
  dRadius: f32,
  a: f32,
  invA: f32,
  pos: vec2<f32>,
) -> vec2<f32> {
  if (a == 0.0 && invA == 1.0) {
    return vec2<f32>(length(pos) * dRadius - radius0, 1.0);
  }
  let c = dot(pos, pos) - radius0 * radius0;
  let negB = 2.0 * (dRadius * radius0 + pos.x);
  var t = 0.0;
  if (a == 0.0) {
    t = c / negB;
  } else {
    let d = negB * negB - 4.0 * a * c;
    if (d < 0.0) {
      return vec2<f32>(0.0, -1.0);
    }
    t = invA * (negB + sign(1.0 - dRadius) * sqrt(d));
  }
  return vec2<f32>(t, sign(t * dRadius + radius0));
}

fn paint_shader_color(devicePosition: vec2<f32>) -> vec4<f32> {
  let kind = i32(round(paint.info.x));
  if (kind == 0) {
    return paint.solidColor;
  }

  let numStops = max(i32(round(paint.info.z)), 2);
  let coords = paint_local_position(devicePosition);
  let t = select(
    select(
      select(
        radial_grad_layout(coords),
        linear_grad_layout(coords),
        kind == 1,
      ),
      sweep_grad_layout(paint.params0.x, paint.params0.y, coords),
      kind == 3,
    ),
    conical_grad_layout(
      paint.params0.x,
      paint.params0.y,
      paint.params0.z,
      paint.params0.w,
      coords,
    ),
    kind == 4,
  );
  return srgb_to_linear(colorize_gradient(numStops, paint.info.y, t));
}
"#
    .replace("__GROUP_INDEX__", &group_index.to_string())
}

#[derive(Clone, Copy, Debug)]
enum FillPatchDefinition {
    Line([Point; 2]),
    Triangle([Point; 3]),
    Quadratic([Point; 3]),
    Conic { points: [Point; 3], weight: f32 },
    Cubic([Point; 4]),
}

#[derive(Clone, Copy, Debug)]
struct WedgePatch {
    definition: FillPatchDefinition,
    fan_point: Point,
}

#[derive(Clone, Copy, Debug)]
struct Bounds {
    origin: Point,
    width: f32,
    height: f32,
}

#[derive(Clone, Copy, Debug)]
enum MidpointContourVerb {
    MoveTo {
        _to: Point,
    },
    LineTo {
        to: Point,
    },
    QuadTo {
        control: Point,
        to: Point,
    },
    ConicTo {
        control: Point,
        to: Point,
        weight: f32,
    },
    CubicTo {
        control1: Point,
        control2: Point,
        to: Point,
    },
    Close,
}

#[derive(Clone, Debug)]
struct MidpointContour {
    verbs: Vec<MidpointContourVerb>,
    start_point: Point,
    midpoint: Point,
}

#[derive(Clone, Copy)]
enum ConvexityVerb {
    MoveTo {
        to: Point,
    },
    LineTo {
        to: Point,
    },
    QuadTo {
        control: Point,
        to: Point,
    },
    ConicTo {
        control: Point,
        to: Point,
    },
    CubicTo {
        control1: Point,
        control2: Point,
        to: Point,
    },
    Close,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConvexDirChange {
    Left,
    Right,
    Straight,
    Backwards,
    Unknown,
    Invalid,
}

#[derive(Clone, Copy)]
struct MiddleOutStackVertex {
    point: Point,
    vertex_index_delta: usize,
}

struct MiddleOutPolygonTriangulator {
    stack: Vec<MiddleOutStackVertex>,
    top_index: usize,
}

impl MiddleOutPolygonTriangulator {
    fn new(start_point: Point) -> Self {
        Self {
            stack: vec![MiddleOutStackVertex {
                point: start_point,
                vertex_index_delta: 0,
            }],
            top_index: 0,
        }
    }

    fn replace_top(&mut self, new_top_index: usize, new_top_value: MiddleOutStackVertex) {
        self.top_index = new_top_index;
        if self.stack.len() <= new_top_index {
            self.stack.resize(new_top_index + 1, new_top_value);
        } else {
            self.stack.truncate(new_top_index + 1);
        }
        self.stack[new_top_index] = new_top_value;
    }

    fn drain_triangles(
        &mut self,
        last_point: Point,
        end_index: usize,
        new_top_index: usize,
        new_top_value: MiddleOutStackVertex,
    ) -> Vec<[Point; 3]> {
        let mut triangles = Vec::new();
        for index in (end_index + 1..=self.top_index).rev() {
            triangles.push([
                self.stack[index - 1].point,
                self.stack[index].point,
                last_point,
            ]);
        }
        self.replace_top(new_top_index, new_top_value);
        triangles
    }

    fn push_vertex(&mut self, point: Point) -> Vec<[Point; 3]> {
        let mut end_index = self.top_index;
        let mut vertex_index_delta = 1usize;
        while self.stack[end_index].vertex_index_delta == vertex_index_delta {
            end_index -= 1;
            vertex_index_delta *= 2;
        }
        self.drain_triangles(
            point,
            end_index,
            end_index + 1,
            MiddleOutStackVertex {
                point,
                vertex_index_delta,
            },
        )
    }

    fn close_and_move(&mut self, new_start_point: Point) -> Vec<[Point; 3]> {
        let last_point = self.stack[0].point;
        self.drain_triangles(
            last_point,
            self.top_index.min(1),
            0,
            MiddleOutStackVertex {
                point: new_start_point,
                vertex_index_delta: 0,
            },
        )
    }

    fn close(&mut self) -> Vec<[Point; 3]> {
        self.close_and_move(self.stack[0].point)
    }
}

pub(crate) fn wedge_fill_shader_source() -> String {
    format!(
        r#"
const MAX_RESOLVE_LEVEL: f32 = {max_resolve_level}.0;

struct ViewportUniform {{
  scale: vec2<f32>,
  translate: vec2<f32>,
}};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;
{paint_shader}

struct VertexOut {{
  @builtin(position) position: vec4<f32>,
  @location(0) devicePosition: vec2<f32>,
}};

fn device_to_ndc(position: vec2<f32>, depth: f32) -> vec4<f32> {{
  return vec4<f32>((position * viewport.scale) + viewport.translate, depth, 1.0);
}}

fn wangs_formula_max_fdiff_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> f32 {{
  let v1 = p0 - (2.0 * p1) + p2;
  let v2 = p1 - (2.0 * p2) + p3;
  return max(dot(v1, v1), dot(v2, v2));
}}

fn wangs_formula_conic_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
) -> f32 {{
  let center = (min(min(p0, p1), p2) + max(max(p0, p1), p2)) * 0.5;
  let cp0 = p0 - center;
  let cp1 = p1 - center;
  let cp2 = p2 - center;
  let max_len = sqrt(max(max(dot(cp0, cp0), dot(cp1, cp1)), dot(cp2, cp2)));
  let dp = fma(vec2<f32>(-2.0 * w), cp1, cp0) + cp2;
  let dw = abs(fma(-2.0, w, 2.0));
  let rp_minus_1 = max(0.0, fma(max_len, {patch_precision}, -1.0));
  let numer = length(dp) * {patch_precision} + rp_minus_1 * dw;
  let denom = 4.0 * min(w, 1.0);
  return numer / max(denom, 1e-5);
}}

fn wangs_formula_cubic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> f32 {{
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3);
  let length_term_pow2 = 20.25;
  return ceil(log2(max(length_term_pow2 * m, 1.0)) * 0.25);
}}

fn wangs_formula_conic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
) -> f32 {{
  return ceil(log2(max(wangs_formula_conic_p2(p0, p1, p2, w), 1.0)) * 0.5);
}}

fn unchecked_mix_vec2(a: vec2<f32>, b: vec2<f32>, t: f32) -> vec2<f32> {{
  return fma(b - a, vec2<f32>(t), a);
}}

fn tessellate_filled_curve(
  resolve_level: f32,
  idx_in_resolve_level: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  curve_type: f32,
  weight: f32,
) -> vec2<f32> {{
  if (curve_type > 1.5) {{
    return select(select(p0, p2, idx_in_resolve_level != 0.0), p1, resolve_level != 0.0);
  }}

  var local_p0 = p0;
  var local_p1 = p1;
  var local_p2 = p2;
  var local_p3 = p3;
  var w = -1.0;
  var max_resolve_level = 0.0;
  if (curve_type > 0.5) {{
    w = weight;
    max_resolve_level = wangs_formula_conic_log2(local_p0, local_p1, local_p2, w);
    local_p1 *= w;
    local_p3 = local_p2;
  }} else {{
    max_resolve_level = wangs_formula_cubic_log2(local_p0, local_p1, local_p2, local_p3);
  }}

  var local_resolve_level = resolve_level;
  var local_idx_in_resolve_level = idx_in_resolve_level;
  if (local_resolve_level > max_resolve_level) {{
    local_idx_in_resolve_level = floor(local_idx_in_resolve_level * exp2(max_resolve_level - local_resolve_level));
    local_resolve_level = max_resolve_level;
  }}
  let fixed_vertex_id = floor(0.5 + (local_idx_in_resolve_level * exp2(MAX_RESOLVE_LEVEL - local_resolve_level)));
  if (0.0 < fixed_vertex_id && fixed_vertex_id < 32.0) {{
    let t = fixed_vertex_id * (1.0 / 32.0);
    let ab = unchecked_mix_vec2(local_p0, local_p1, t);
    let bc = unchecked_mix_vec2(local_p1, local_p2, t);
    let cd = unchecked_mix_vec2(local_p2, local_p3, t);
    let abc = unchecked_mix_vec2(ab, bc, t);
    let bcd = unchecked_mix_vec2(bc, cd, t);
    let abcd = unchecked_mix_vec2(abc, bcd, t);
    let u = mix(1.0, w, t);
    let v = w + 1.0 - u;
    let uv = mix(u, v, t);
    return select(abc / uv, abcd, w < 0.0);
  }}
  return select(local_p0, local_p3, fixed_vertex_id > 0.0);
}}

@vertex
fn vs_main(
  @location(0) resolveLevelAndIdx: vec2<f32>,
  @location(1) p0: vec2<f32>,
  @location(2) p1: vec2<f32>,
  @location(3) p2: vec2<f32>,
  @location(4) p3: vec2<f32>,
  @location(5) curveMeta: vec2<f32>,
  @location(6) fanPoint: vec2<f32>,
  @location(7) depth: f32,
) -> VertexOut {{
  var local: vec2<f32>;
  if (resolveLevelAndIdx.x < 0.0) {{
    local = fanPoint;
  }} else {{
    local = tessellate_filled_curve(
      resolveLevelAndIdx.x,
      resolveLevelAndIdx.y,
      p0,
      p1,
      p2,
      p3,
      curveMeta.x,
      curveMeta.y,
    );
  }}
  var out: VertexOut;
  out.position = device_to_ndc(local, depth);
  out.devicePosition = local;
  return out;
}}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {{
  return paint_shader_color(input.devicePosition);
}}
"#,
        max_resolve_level = MAX_PATCH_RESOLVE_LEVEL,
        patch_precision = PATCH_PRECISION,
        paint_shader = fill_paint_shader_source(1),
    )
}

pub(crate) fn curve_fill_shader_source() -> String {
    format!(
        r#"
const MAX_RESOLVE_LEVEL: f32 = {max_resolve_level}.0;

struct ViewportUniform {{
  scale: vec2<f32>,
  translate: vec2<f32>,
}};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;
{paint_shader}

struct VertexOut {{
  @builtin(position) position: vec4<f32>,
  @location(0) devicePosition: vec2<f32>,
}};

fn device_to_ndc(position: vec2<f32>, depth: f32) -> vec4<f32> {{
  return vec4<f32>((position * viewport.scale) + viewport.translate, depth, 1.0);
}}

fn wangs_formula_max_fdiff_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> f32 {{
  let v1 = p0 - (2.0 * p1) + p2;
  let v2 = p1 - (2.0 * p2) + p3;
  return max(dot(v1, v1), dot(v2, v2));
}}

fn wangs_formula_conic_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
) -> f32 {{
  let center = (min(min(p0, p1), p2) + max(max(p0, p1), p2)) * 0.5;
  let cp0 = p0 - center;
  let cp1 = p1 - center;
  let cp2 = p2 - center;
  let max_len = sqrt(max(max(dot(cp0, cp0), dot(cp1, cp1)), dot(cp2, cp2)));
  let dp = fma(vec2<f32>(-2.0 * w), cp1, cp0) + cp2;
  let dw = abs(fma(-2.0, w, 2.0));
  let rp_minus_1 = max(0.0, fma(max_len, {patch_precision}, -1.0));
  let numer = length(dp) * {patch_precision} + rp_minus_1 * dw;
  let denom = 4.0 * min(w, 1.0);
  return numer / max(denom, 1e-5);
}}

fn wangs_formula_cubic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> f32 {{
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3);
  let length_term_pow2 = 20.25;
  return ceil(log2(max(length_term_pow2 * m, 1.0)) * 0.25);
}}

fn wangs_formula_conic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
) -> f32 {{
  return ceil(log2(max(wangs_formula_conic_p2(p0, p1, p2, w), 1.0)) * 0.5);
}}

fn unchecked_mix_vec2(a: vec2<f32>, b: vec2<f32>, t: f32) -> vec2<f32> {{
  return fma(b - a, vec2<f32>(t), a);
}}

fn tessellate_filled_curve(
  resolve_level: f32,
  idx_in_resolve_level: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  curve_type: f32,
  weight: f32,
) -> vec2<f32> {{
  if (curve_type > 1.5) {{
    return select(select(p0, p2, idx_in_resolve_level != 0.0), p1, resolve_level != 0.0);
  }}

  var local_p0 = p0;
  var local_p1 = p1;
  var local_p2 = p2;
  var local_p3 = p3;
  var w = -1.0;
  var max_resolve_level = 0.0;
  if (curve_type > 0.5) {{
    w = weight;
    max_resolve_level = wangs_formula_conic_log2(local_p0, local_p1, local_p2, w);
    local_p1 *= w;
    local_p3 = local_p2;
  }} else {{
    max_resolve_level = wangs_formula_cubic_log2(local_p0, local_p1, local_p2, local_p3);
  }}

  var local_resolve_level = resolve_level;
  var local_idx_in_resolve_level = idx_in_resolve_level;
  if (local_resolve_level > max_resolve_level) {{
    local_idx_in_resolve_level = floor(local_idx_in_resolve_level * exp2(max_resolve_level - local_resolve_level));
    local_resolve_level = max_resolve_level;
  }}
  let fixed_vertex_id = floor(0.5 + (local_idx_in_resolve_level * exp2(MAX_RESOLVE_LEVEL - local_resolve_level)));
  if (0.0 < fixed_vertex_id && fixed_vertex_id < 32.0) {{
    let t = fixed_vertex_id * (1.0 / 32.0);
    let ab = unchecked_mix_vec2(local_p0, local_p1, t);
    let bc = unchecked_mix_vec2(local_p1, local_p2, t);
    let cd = unchecked_mix_vec2(local_p2, local_p3, t);
    let abc = unchecked_mix_vec2(ab, bc, t);
    let bcd = unchecked_mix_vec2(bc, cd, t);
    let abcd = unchecked_mix_vec2(abc, bcd, t);
    let u = mix(1.0, w, t);
    let v = w + 1.0 - u;
    let uv = mix(u, v, t);
    return select(abc / uv, abcd, w < 0.0);
  }}
  return select(local_p0, local_p3, fixed_vertex_id > 0.0);
}}

@vertex
fn vs_main(
  @location(0) resolveLevelAndIdx: vec2<f32>,
  @location(1) p0: vec2<f32>,
  @location(2) p1: vec2<f32>,
  @location(3) p2: vec2<f32>,
  @location(4) p3: vec2<f32>,
  @location(5) curveMeta: vec2<f32>,
  @location(6) depth: f32,
) -> VertexOut {{
  let local = tessellate_filled_curve(
    resolveLevelAndIdx.x,
    resolveLevelAndIdx.y,
    p0,
    p1,
    p2,
    p3,
    curveMeta.x,
    curveMeta.y,
  );
  var out: VertexOut;
  out.position = device_to_ndc(local, depth);
  out.devicePosition = local;
  return out;
}}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {{
  return paint_shader_color(input.devicePosition);
}}
"#,
        max_resolve_level = MAX_PATCH_RESOLVE_LEVEL,
        patch_precision = PATCH_PRECISION,
        paint_shader = fill_paint_shader_source(1),
    )
}

pub(crate) fn wedge_template_vertices() -> Vec<PatchResolveVertex> {
    let mut vertices = vec![[-1.0, -1.0]];
    vertices.extend(create_fixed_count_curve_vertices());
    let mut indices = vec![0u32, 1, 2];
    indices.extend(create_fixed_count_curve_indices(1));
    append_indexed_triangle_vertices(&vertices, &indices)
}

pub(crate) fn curve_template_vertices() -> Vec<PatchResolveVertex> {
    let vertices = create_fixed_count_curve_vertices();
    let indices = create_fixed_count_curve_indices(0);
    append_indexed_triangle_vertices(&vertices, &indices)
}

pub(crate) fn prepare_fill_steps(
    path: &PathDrawCommand,
    painter_depth: f32,
) -> Vec<PreparedFillStep> {
    let Some(bounds) = compute_path_bounds(path) else {
        return Vec::new();
    };
    let stencil_mode = FillStencilMode::from_fill_rule(path.fill_rule);
    if is_path_convex(path) {
        let instances = create_wedge_fill_instances(&prepare_wedge_patches(path), painter_depth);
        if instances.is_empty() {
            return Vec::new();
        }
        return vec![PreparedFillStep::Wedges(PreparedWedgeFillStep {
            instances,
            stencil_mode: None,
        })];
    }

    let prefer_wedges = path.verbs.len() < PREFERRED_WEDGE_VERB_THRESHOLD
        || bounds.width * bounds.height <= PREFERRED_WEDGE_AREA_THRESHOLD;
    let mut steps = Vec::new();
    if prefer_wedges {
        let instances = create_wedge_fill_instances(&prepare_wedge_patches(path), painter_depth);
        if !instances.is_empty() {
            steps.push(PreparedFillStep::Wedges(PreparedWedgeFillStep {
                instances,
                stencil_mode: Some(stencil_mode),
            }));
        }
    } else {
        let fan_triangles = prepare_middle_out_fan_triangles(path);
        if !fan_triangles.is_empty() {
            steps.push(PreparedFillStep::Triangles(PreparedFillTriangleStep {
                points: fan_triangles,
                mode: match stencil_mode {
                    FillStencilMode::Evenodd => FillTriangleMode::StencilEvenodd,
                    FillStencilMode::Nonzero => FillTriangleMode::StencilNonzero,
                },
            }));
        }
        let instances = create_curve_fill_instances(&prepare_curve_patches(path), painter_depth);
        if !instances.is_empty() {
            steps.push(PreparedFillStep::Curves(PreparedCurveFillStep {
                instances,
                stencil_mode,
            }));
        }
    }

    let cover_points = build_bounds_cover_points(bounds);
    if !cover_points.is_empty() {
        steps.push(PreparedFillStep::Triangles(PreparedFillTriangleStep {
            points: cover_points,
            mode: FillTriangleMode::StencilCover,
        }));
    }
    steps
}

fn create_fixed_count_curve_vertices() -> Vec<[f32; 2]> {
    let mut vertices = vec![[0.0, 0.0], [0.0, 1.0]];
    for resolve_level in 1..=MAX_PATCH_RESOLVE_LEVEL {
        let num_segments = 1u32 << resolve_level;
        let mut index = 1u32;
        while index < num_segments {
            vertices.push([resolve_level as f32, index as f32]);
            index += 2;
        }
    }
    vertices
}

fn create_fixed_count_curve_indices(base_index: u32) -> Vec<u32> {
    let mut indices = vec![base_index, base_index + 2, base_index + 1];
    let mut triangle_cursor = 0usize;
    let mut next_index = base_index + 3;
    for resolve_level in 2..=MAX_PATCH_RESOLVE_LEVEL {
        let num_pairs = 1usize << (resolve_level - 2);
        for pair_index in 0..num_pairs {
            let neighbor = triangle_cursor + pair_index;
            let a = indices[neighbor * 3];
            let b = indices[(neighbor * 3) + 1];
            let c = indices[(neighbor * 3) + 2];
            indices.extend([a, next_index, b]);
            next_index += 1;
            indices.extend([b, next_index, c]);
            next_index += 1;
        }
        triangle_cursor += num_pairs;
    }
    indices
}

fn append_indexed_triangle_vertices(
    source: &[[f32; 2]],
    indices: &[u32],
) -> Vec<PatchResolveVertex> {
    indices
        .iter()
        .filter_map(|index| source.get(*index as usize))
        .map(|resolve_level_and_idx| PatchResolveVertex {
            resolve_level_and_idx: *resolve_level_and_idx,
        })
        .collect()
}

fn create_wedge_fill_instances(patches: &[WedgePatch], depth: f32) -> Vec<WedgeFillPatchInstance> {
    patches
        .iter()
        .map(|patch| {
            let (points, curve_type, weight) = fill_patch_points_and_meta(patch.definition);
            WedgeFillPatchInstance {
                p0: points[0],
                p1: points[1],
                p2: points[2],
                p3: points[3],
                curve_meta: [curve_type, weight],
                fan_point: patch.fan_point,
                depth,
            }
        })
        .collect()
}

fn create_curve_fill_instances(
    patches: &[FillPatchDefinition],
    depth: f32,
) -> Vec<CurveFillPatchInstance> {
    patches
        .iter()
        .filter(|patch| !matches!(patch, FillPatchDefinition::Line(_)))
        .map(|patch| {
            let (points, curve_type, weight) = fill_patch_points_and_meta(*patch);
            CurveFillPatchInstance {
                p0: points[0],
                p1: points[1],
                p2: points[2],
                p3: points[3],
                curve_meta: [curve_type, weight],
                depth,
            }
        })
        .collect()
}

fn fill_patch_points_and_meta(patch: FillPatchDefinition) -> ([Point; 4], f32, f32) {
    match patch {
        FillPatchDefinition::Line(points) => {
            (line_to_cubic_patch_points(points[0], points[1]), 0.0, 0.0)
        }
        FillPatchDefinition::Triangle(points) => {
            ([points[0], points[1], points[2], points[2]], 2.0, 0.0)
        }
        FillPatchDefinition::Quadratic(points) => (
            quadratic_to_cubic_points(points[0], points[1], points[2]),
            0.0,
            0.0,
        ),
        FillPatchDefinition::Conic { points, weight } => {
            ([points[0], points[1], points[2], points[2]], 1.0, weight)
        }
        FillPatchDefinition::Cubic(points) => (points, 0.0, 0.0),
    }
}

fn compute_path_bounds(path: &PathDrawCommand) -> Option<Bounds> {
    let mut points = Vec::new();
    let implicit_start = [path.x, path.y];
    let mut have_current = false;
    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                points.push(offset_point(path, to));
                have_current = true;
            }
            PathVerb2D::LineTo { to } => {
                if !have_current {
                    points.push(implicit_start);
                    have_current = true;
                }
                points.push(offset_point(path, to));
            }
            PathVerb2D::QuadTo { control, to } => {
                if !have_current {
                    points.push(implicit_start);
                    have_current = true;
                }
                points.push(offset_point(path, control));
                points.push(offset_point(path, to));
            }
            PathVerb2D::ConicTo { control, to, .. } => {
                if !have_current {
                    points.push(implicit_start);
                    have_current = true;
                }
                points.push(offset_point(path, control));
                points.push(offset_point(path, to));
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                if !have_current {
                    points.push(implicit_start);
                    have_current = true;
                }
                points.push(offset_point(path, control1));
                points.push(offset_point(path, control2));
                points.push(offset_point(path, to));
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                let patches = create_arc_conic_patches(
                    offset_point(path, center),
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                );
                for patch in patches {
                    if let FillPatchDefinition::Conic {
                        points: patch_points,
                        ..
                    } = patch
                    {
                        points.extend(patch_points);
                        have_current = true;
                    }
                }
            }
            PathVerb2D::Close => {}
        }
    }
    if points.is_empty() {
        return None;
    }
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for point in points {
        min_x = min_x.min(point[0]);
        min_y = min_y.min(point[1]);
        max_x = max_x.max(point[0]);
        max_y = max_y.max(point[1]);
    }
    Some(Bounds {
        origin: [min_x, min_y],
        width: (max_x - min_x).max(0.0),
        height: (max_y - min_y).max(0.0),
    })
}

fn build_bounds_cover_points(bounds: Bounds) -> Vec<Point> {
    if bounds.width <= EPSILON || bounds.height <= EPSILON {
        return Vec::new();
    }
    let x0 = bounds.origin[0];
    let y0 = bounds.origin[1];
    let x1 = x0 + bounds.width;
    let y1 = y0 + bounds.height;
    vec![[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]
}

fn prepare_wedge_patches(path: &PathDrawCommand) -> Vec<WedgePatch> {
    let Some(contours) = parse_midpoint_contours(path) else {
        return Vec::new();
    };
    let mut patches = Vec::new();
    for contour in contours {
        let fan_point = contour.midpoint;
        let mut current_point = contour.start_point;
        for verb in contour.verbs {
            match verb {
                MidpointContourVerb::MoveTo { .. } | MidpointContourVerb::Close => {}
                MidpointContourVerb::LineTo { to } => {
                    patches.push(WedgePatch {
                        definition: FillPatchDefinition::Line([current_point, to]),
                        fan_point,
                    });
                    current_point = to;
                }
                MidpointContourVerb::QuadTo { control, to } => {
                    write_quadratic_fan_patches(
                        &mut patches,
                        current_point,
                        control,
                        to,
                        fan_point,
                    );
                    current_point = to;
                }
                MidpointContourVerb::ConicTo {
                    control,
                    to,
                    weight,
                } => {
                    write_conic_fan_patches(
                        &mut patches,
                        current_point,
                        control,
                        to,
                        weight,
                        fan_point,
                    );
                    current_point = to;
                }
                MidpointContourVerb::CubicTo {
                    control1,
                    control2,
                    to,
                } => {
                    write_cubic_fan_patches(
                        &mut patches,
                        current_point,
                        control1,
                        control2,
                        to,
                        fan_point,
                    );
                    current_point = to;
                }
            }
        }
        if !points_equal(current_point, contour.start_point) {
            patches.push(WedgePatch {
                definition: FillPatchDefinition::Line([current_point, contour.start_point]),
                fan_point,
            });
        }
    }
    patches
}

fn prepare_curve_patches(path: &PathDrawCommand) -> Vec<FillPatchDefinition> {
    let mut patches = Vec::new();
    let implicit_start = [path.x, path.y];
    let mut current_point = implicit_start;
    let mut contour_start = implicit_start;
    let mut have_current = false;
    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                current_point = offset_point(path, to);
                contour_start = current_point;
                have_current = true;
            }
            PathVerb2D::LineTo { to } => {
                if !have_current {
                    contour_start = implicit_start;
                    have_current = true;
                }
                current_point = offset_point(path, to);
            }
            PathVerb2D::QuadTo { control, to } => {
                if !have_current {
                    current_point = implicit_start;
                    contour_start = implicit_start;
                    have_current = true;
                }
                let control = offset_point(path, control);
                let to = offset_point(path, to);
                write_quadratic_patches(&mut patches, current_point, control, to);
                current_point = to;
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                if !have_current {
                    current_point = implicit_start;
                    contour_start = implicit_start;
                    have_current = true;
                }
                let control = offset_point(path, control);
                let to = offset_point(path, to);
                write_conic_patches(&mut patches, current_point, control, to, weight);
                current_point = to;
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                if !have_current {
                    current_point = implicit_start;
                    contour_start = implicit_start;
                    have_current = true;
                }
                let control1 = offset_point(path, control1);
                let control2 = offset_point(path, control2);
                let to = offset_point(path, to);
                write_cubic_patches(&mut patches, current_point, control1, control2, to);
                current_point = to;
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                let arc_patches = create_arc_conic_patches(
                    offset_point(path, center),
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                );
                for patch in arc_patches {
                    if let FillPatchDefinition::Conic { points, weight } = patch {
                        write_conic_patches(&mut patches, points[0], points[1], points[2], weight);
                        current_point = points[2];
                        have_current = true;
                    }
                }
            }
            PathVerb2D::Close => {
                current_point = contour_start;
            }
        }
    }
    patches
}

fn prepare_middle_out_fan_triangles(path: &PathDrawCommand) -> Vec<Point> {
    let implicit_start = [path.x, path.y];
    let mut triangulator = MiddleOutPolygonTriangulator::new(implicit_start);
    let mut triangles = Vec::new();
    let mut have_geometry = false;
    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                append_triangles(
                    &mut triangles,
                    triangulator.close_and_move(offset_point(path, to)),
                );
                have_geometry = true;
            }
            PathVerb2D::LineTo { to }
            | PathVerb2D::QuadTo { to, .. }
            | PathVerb2D::ConicTo { to, .. }
            | PathVerb2D::CubicTo { to, .. } => {
                append_triangles(
                    &mut triangles,
                    triangulator.push_vertex(offset_point(path, to)),
                );
                have_geometry = true;
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                let arc_patches = create_arc_conic_patches(
                    offset_point(path, center),
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                );
                if let Some(FillPatchDefinition::Conic { points, .. }) = arc_patches.last() {
                    append_triangles(&mut triangles, triangulator.push_vertex(points[2]));
                    have_geometry = true;
                }
            }
            PathVerb2D::Close => {
                append_triangles(&mut triangles, triangulator.close());
            }
        }
    }
    if have_geometry {
        append_triangles(&mut triangles, triangulator.close());
    }
    triangles
}

fn parse_midpoint_contours(path: &PathDrawCommand) -> Option<Vec<MidpointContour>> {
    let implicit_start = [path.x, path.y];
    let mut contours = Vec::new();
    let mut contour_verbs = Vec::new();
    let mut contour_start = None;
    let mut current_point = None;
    let mut midpoint_sum = [0.0, 0.0];
    let mut midpoint_weight = 0usize;
    let mut has_geometry = false;
    let mut closed_explicitly = false;

    let begin_contour = |start: Point,
                         contour_verbs: &mut Vec<MidpointContourVerb>,
                         contour_start: &mut Option<Point>,
                         current_point: &mut Option<Point>,
                         midpoint_sum: &mut Point,
                         midpoint_weight: &mut usize,
                         has_geometry: &mut bool,
                         closed_explicitly: &mut bool| {
        contour_verbs.clear();
        contour_verbs.push(MidpointContourVerb::MoveTo { _to: start });
        *contour_start = Some(start);
        *current_point = Some(start);
        *midpoint_sum = [0.0, 0.0];
        *midpoint_weight = 0;
        *has_geometry = false;
        *closed_explicitly = false;
    };

    let append_endpoint = |point: Point,
                           midpoint_sum: &mut Point,
                           midpoint_weight: &mut usize,
                           current_point: &mut Option<Point>,
                           has_geometry: &mut bool| {
        *midpoint_sum = add(*midpoint_sum, point);
        *midpoint_weight += 1;
        *current_point = Some(point);
        *has_geometry = true;
    };

    let finish_contour = |contours: &mut Vec<MidpointContour>,
                          contour_verbs: &mut Vec<MidpointContourVerb>,
                          contour_start: &mut Option<Point>,
                          current_point: &mut Option<Point>,
                          midpoint_sum: &mut Point,
                          midpoint_weight: &mut usize,
                          has_geometry: &mut bool,
                          closed_explicitly: &mut bool| {
        let (Some(start_point), Some(end_point)) = (*contour_start, *current_point) else {
            contour_verbs.clear();
            *contour_start = None;
            *current_point = None;
            *midpoint_sum = [0.0, 0.0];
            *midpoint_weight = 0;
            *has_geometry = false;
            *closed_explicitly = false;
            return;
        };
        if !*has_geometry || *midpoint_weight == 0 {
            contour_verbs.clear();
            *contour_start = None;
            *current_point = None;
            *midpoint_sum = [0.0, 0.0];
            *midpoint_weight = 0;
            *has_geometry = false;
            *closed_explicitly = false;
            return;
        }
        let mut sum = *midpoint_sum;
        let mut weight = *midpoint_weight;
        if !points_equal(start_point, end_point) {
            sum = add(sum, start_point);
            weight += 1;
        }
        contours.push(MidpointContour {
            verbs: contour_verbs.clone(),
            start_point,
            midpoint: scale(sum, 1.0 / weight as f32),
        });
        contour_verbs.clear();
        *contour_start = None;
        *current_point = None;
        *midpoint_sum = [0.0, 0.0];
        *midpoint_weight = 0;
        *has_geometry = false;
        *closed_explicitly = false;
    };

    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                if has_geometry {
                    finish_contour(
                        &mut contours,
                        &mut contour_verbs,
                        &mut contour_start,
                        &mut current_point,
                        &mut midpoint_sum,
                        &mut midpoint_weight,
                        &mut has_geometry,
                        &mut closed_explicitly,
                    );
                }
                begin_contour(
                    offset_point(path, to),
                    &mut contour_verbs,
                    &mut contour_start,
                    &mut current_point,
                    &mut midpoint_sum,
                    &mut midpoint_weight,
                    &mut has_geometry,
                    &mut closed_explicitly,
                );
            }
            PathVerb2D::LineTo { to } => {
                if contour_start.is_none() {
                    begin_contour(
                        implicit_start,
                        &mut contour_verbs,
                        &mut contour_start,
                        &mut current_point,
                        &mut midpoint_sum,
                        &mut midpoint_weight,
                        &mut has_geometry,
                        &mut closed_explicitly,
                    );
                }
                let to = offset_point(path, to);
                contour_verbs.push(MidpointContourVerb::LineTo { to });
                append_endpoint(
                    to,
                    &mut midpoint_sum,
                    &mut midpoint_weight,
                    &mut current_point,
                    &mut has_geometry,
                );
            }
            PathVerb2D::QuadTo { control, to } => {
                if contour_start.is_none() {
                    begin_contour(
                        implicit_start,
                        &mut contour_verbs,
                        &mut contour_start,
                        &mut current_point,
                        &mut midpoint_sum,
                        &mut midpoint_weight,
                        &mut has_geometry,
                        &mut closed_explicitly,
                    );
                }
                let control = offset_point(path, control);
                let to = offset_point(path, to);
                contour_verbs.push(MidpointContourVerb::QuadTo { control, to });
                append_endpoint(
                    to,
                    &mut midpoint_sum,
                    &mut midpoint_weight,
                    &mut current_point,
                    &mut has_geometry,
                );
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                if contour_start.is_none() {
                    begin_contour(
                        implicit_start,
                        &mut contour_verbs,
                        &mut contour_start,
                        &mut current_point,
                        &mut midpoint_sum,
                        &mut midpoint_weight,
                        &mut has_geometry,
                        &mut closed_explicitly,
                    );
                }
                let control = offset_point(path, control);
                let to = offset_point(path, to);
                contour_verbs.push(MidpointContourVerb::ConicTo {
                    control,
                    to,
                    weight,
                });
                append_endpoint(
                    to,
                    &mut midpoint_sum,
                    &mut midpoint_weight,
                    &mut current_point,
                    &mut has_geometry,
                );
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                if contour_start.is_none() {
                    begin_contour(
                        implicit_start,
                        &mut contour_verbs,
                        &mut contour_start,
                        &mut current_point,
                        &mut midpoint_sum,
                        &mut midpoint_weight,
                        &mut has_geometry,
                        &mut closed_explicitly,
                    );
                }
                let control1 = offset_point(path, control1);
                let control2 = offset_point(path, control2);
                let to = offset_point(path, to);
                contour_verbs.push(MidpointContourVerb::CubicTo {
                    control1,
                    control2,
                    to,
                });
                append_endpoint(
                    to,
                    &mut midpoint_sum,
                    &mut midpoint_weight,
                    &mut current_point,
                    &mut has_geometry,
                );
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                let patches = create_arc_conic_patches(
                    offset_point(path, center),
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                );
                if patches.is_empty() {
                    continue;
                }
                let arc_start = match patches[0] {
                    FillPatchDefinition::Conic { points, .. } => points[0],
                    _ => continue,
                };
                if contour_start.is_none() {
                    begin_contour(
                        arc_start,
                        &mut contour_verbs,
                        &mut contour_start,
                        &mut current_point,
                        &mut midpoint_sum,
                        &mut midpoint_weight,
                        &mut has_geometry,
                        &mut closed_explicitly,
                    );
                } else if current_point
                    .map(|current| !points_equal(current, arc_start))
                    .unwrap_or(false)
                {
                    contour_verbs.push(MidpointContourVerb::LineTo { to: arc_start });
                    append_endpoint(
                        arc_start,
                        &mut midpoint_sum,
                        &mut midpoint_weight,
                        &mut current_point,
                        &mut has_geometry,
                    );
                }
                for patch in patches {
                    if let FillPatchDefinition::Conic { points, weight } = patch {
                        contour_verbs.push(MidpointContourVerb::ConicTo {
                            control: points[1],
                            to: points[2],
                            weight,
                        });
                        append_endpoint(
                            points[2],
                            &mut midpoint_sum,
                            &mut midpoint_weight,
                            &mut current_point,
                            &mut has_geometry,
                        );
                    }
                }
            }
            PathVerb2D::Close => {
                if contour_start.is_none() || current_point.is_none() {
                    return None;
                }
                contour_verbs.push(MidpointContourVerb::Close);
                closed_explicitly = true;
            }
        }
    }

    finish_contour(
        &mut contours,
        &mut contour_verbs,
        &mut contour_start,
        &mut current_point,
        &mut midpoint_sum,
        &mut midpoint_weight,
        &mut has_geometry,
        &mut closed_explicitly,
    );
    Some(contours)
}

fn is_path_convex(path: &PathDrawCommand) -> bool {
    let verbs = trim_trailing_convexity_moves(expand_path_for_convexity(path));
    if verbs.is_empty() {
        return true;
    }
    let points = get_convexity_path_points(&verbs);
    if is_concave_by_sign(&points) {
        return false;
    }

    let mut contour_count = 0usize;
    let mut needs_close = false;
    let mut first_point = [0.0, 0.0];
    let mut first_vec = [0.0, 0.0];
    let mut last_point = [0.0, 0.0];
    let mut last_vec = [0.0, 0.0];
    let mut expected_dir = ConvexDirChange::Invalid;
    let mut first_direction = ConvexDirChange::Unknown;
    let mut reversals = 0usize;

    for verb in verbs {
        if contour_count == 0 {
            if let ConvexityVerb::MoveTo { to } = verb {
                set_move_point(
                    to,
                    &mut first_point,
                    &mut last_point,
                    &mut first_vec,
                    &mut last_vec,
                    &mut expected_dir,
                    &mut first_direction,
                    &mut reversals,
                );
                continue;
            }
            contour_count += 1;
            needs_close = true;
        }

        if contour_count == 1 {
            match verb {
                ConvexityVerb::Close => {
                    if !close_convex_contour(
                        first_point,
                        first_vec,
                        &mut last_point,
                        &mut last_vec,
                        &mut expected_dir,
                        &mut first_direction,
                        &mut reversals,
                    ) {
                        return false;
                    }
                    needs_close = false;
                    contour_count += 1;
                }
                ConvexityVerb::MoveTo { to } => {
                    if !close_convex_contour(
                        first_point,
                        first_vec,
                        &mut last_point,
                        &mut last_vec,
                        &mut expected_dir,
                        &mut first_direction,
                        &mut reversals,
                    ) {
                        return false;
                    }
                    needs_close = false;
                    contour_count += 1;
                    set_move_point(
                        to,
                        &mut first_point,
                        &mut last_point,
                        &mut first_vec,
                        &mut last_vec,
                        &mut expected_dir,
                        &mut first_direction,
                        &mut reversals,
                    );
                }
                _ => {
                    for point in get_convexity_verb_points(verb) {
                        if !add_convex_point(
                            point,
                            first_point,
                            &mut last_point,
                            &mut first_vec,
                            &mut last_vec,
                            &mut expected_dir,
                            &mut first_direction,
                            &mut reversals,
                        ) {
                            return false;
                        }
                    }
                }
            }
        } else if !matches!(verb, ConvexityVerb::MoveTo { .. }) {
            return false;
        }
    }

    if needs_close
        && !close_convex_contour(
            first_point,
            first_vec,
            &mut last_point,
            &mut last_vec,
            &mut expected_dir,
            &mut first_direction,
            &mut reversals,
        )
    {
        return false;
    }
    !(first_direction == ConvexDirChange::Unknown && reversals >= 3)
}

fn trim_trailing_convexity_moves(verbs: Vec<ConvexityVerb>) -> Vec<ConvexityVerb> {
    let mut count = verbs.len();
    while count > 0 && matches!(verbs[count - 1], ConvexityVerb::MoveTo { .. }) {
        count -= 1;
    }
    if count == verbs.len() {
        verbs
    } else {
        verbs[..count].to_vec()
    }
}

fn expand_path_for_convexity(path: &PathDrawCommand) -> Vec<ConvexityVerb> {
    let mut expanded = Vec::new();
    let implicit_start = [path.x, path.y];
    let mut current_point = None;
    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                let to = offset_point(path, to);
                expanded.push(ConvexityVerb::MoveTo { to });
                current_point = Some(to);
            }
            PathVerb2D::LineTo { to } => {
                if current_point.is_none() {
                    expanded.push(ConvexityVerb::MoveTo { to: implicit_start });
                }
                let to = offset_point(path, to);
                expanded.push(ConvexityVerb::LineTo { to });
                current_point = Some(to);
            }
            PathVerb2D::QuadTo { control, to } => {
                if current_point.is_none() {
                    expanded.push(ConvexityVerb::MoveTo { to: implicit_start });
                }
                let control = offset_point(path, control);
                let to = offset_point(path, to);
                expanded.push(ConvexityVerb::QuadTo { control, to });
                current_point = Some(to);
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight: _,
            } => {
                if current_point.is_none() {
                    expanded.push(ConvexityVerb::MoveTo { to: implicit_start });
                }
                let control = offset_point(path, control);
                let to = offset_point(path, to);
                expanded.push(ConvexityVerb::ConicTo { control, to });
                current_point = Some(to);
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                if current_point.is_none() {
                    expanded.push(ConvexityVerb::MoveTo { to: implicit_start });
                }
                let control1 = offset_point(path, control1);
                let control2 = offset_point(path, control2);
                let to = offset_point(path, to);
                expanded.push(ConvexityVerb::CubicTo {
                    control1,
                    control2,
                    to,
                });
                current_point = Some(to);
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                let patches = create_arc_conic_patches(
                    offset_point(path, center),
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                );
                if patches.is_empty() {
                    continue;
                }
                let start = match patches[0] {
                    FillPatchDefinition::Conic { points, .. } => points[0],
                    _ => continue,
                };
                if current_point.is_none() {
                    expanded.push(ConvexityVerb::MoveTo { to: start });
                } else if current_point
                    .map(|current| !points_equal(current, start))
                    .unwrap_or(false)
                {
                    expanded.push(ConvexityVerb::LineTo { to: start });
                }
                for patch in patches {
                    if let FillPatchDefinition::Conic { points, weight } = patch {
                        let _ = weight;
                        expanded.push(ConvexityVerb::ConicTo {
                            control: points[1],
                            to: points[2],
                        });
                        current_point = Some(points[2]);
                    }
                }
            }
            PathVerb2D::Close => expanded.push(ConvexityVerb::Close),
        }
    }
    expanded
}

fn get_convexity_path_points(verbs: &[ConvexityVerb]) -> Vec<Point> {
    verbs
        .iter()
        .flat_map(|verb| get_convexity_verb_points(*verb))
        .collect()
}

fn get_convexity_verb_points(verb: ConvexityVerb) -> Vec<Point> {
    match verb {
        ConvexityVerb::MoveTo { to } | ConvexityVerb::LineTo { to } => vec![to],
        ConvexityVerb::QuadTo { control, to } => vec![control, to],
        ConvexityVerb::ConicTo { control, to } => vec![control, to],
        ConvexityVerb::CubicTo {
            control1,
            control2,
            to,
        } => vec![control1, control2, to],
        ConvexityVerb::Close => Vec::new(),
    }
}

fn is_concave_by_sign(points: &[Point]) -> bool {
    if points.len() <= 3 {
        return false;
    }
    let mut current = points[0];
    let first = current;
    let mut dxes = 0u32;
    let mut dyes = 0u32;
    let mut last_sx = 2i32;
    let mut last_sy = 2i32;
    for outer in 0..2 {
        let limit = if outer == 0 { points.len() } else { 1 };
        for next in points.iter().take(limit).skip(1) {
            let vec = subtract(*next, current);
            if vec[0].abs() > EPSILON || vec[1].abs() > EPSILON {
                let sx = convexity_sign(vec[0]);
                let sy = convexity_sign(vec[1]);
                dxes += u32::from(sx != last_sx);
                dyes += u32::from(sy != last_sy);
                if dxes > 3 || dyes > 3 {
                    return true;
                }
                last_sx = sx;
                last_sy = sy;
            }
            current = *next;
        }
        current = first;
    }
    false
}

fn classify_direction_change(last_vec: Point, current_vec: Point) -> ConvexDirChange {
    let cross_value = cross_vector(last_vec, current_vec);
    if !cross_value.is_finite() {
        return ConvexDirChange::Unknown;
    }
    if cross_value.abs() <= EPSILON {
        let dot_value = dot(last_vec, current_vec);
        return if dot_value < 0.0 {
            ConvexDirChange::Backwards
        } else {
            ConvexDirChange::Straight
        };
    }
    if cross_value > 0.0 {
        ConvexDirChange::Right
    } else {
        ConvexDirChange::Left
    }
}

fn set_move_point(
    point: Point,
    first_point: &mut Point,
    last_point: &mut Point,
    first_vec: &mut Point,
    last_vec: &mut Point,
    expected_dir: &mut ConvexDirChange,
    first_direction: &mut ConvexDirChange,
    reversals: &mut usize,
) {
    *first_point = point;
    *last_point = point;
    *first_vec = [0.0, 0.0];
    *last_vec = [0.0, 0.0];
    *expected_dir = ConvexDirChange::Invalid;
    *first_direction = ConvexDirChange::Unknown;
    *reversals = 0;
}

fn add_convex_vec(
    current_vec: Point,
    last_vec: &mut Point,
    expected_dir: &mut ConvexDirChange,
    first_direction: &mut ConvexDirChange,
    reversals: &mut usize,
) -> bool {
    let dir = classify_direction_change(*last_vec, current_vec);
    match dir {
        ConvexDirChange::Left | ConvexDirChange::Right => {
            if *expected_dir == ConvexDirChange::Invalid {
                *expected_dir = dir;
                *first_direction = dir;
            } else if dir != *expected_dir {
                *first_direction = ConvexDirChange::Unknown;
                return false;
            }
            *last_vec = current_vec;
            true
        }
        ConvexDirChange::Straight => true,
        ConvexDirChange::Backwards => {
            *last_vec = current_vec;
            *reversals += 1;
            *reversals < 3
        }
        ConvexDirChange::Unknown | ConvexDirChange::Invalid => false,
    }
}

fn add_convex_point(
    point: Point,
    first_point: Point,
    last_point: &mut Point,
    first_vec: &mut Point,
    last_vec: &mut Point,
    expected_dir: &mut ConvexDirChange,
    first_direction: &mut ConvexDirChange,
    reversals: &mut usize,
) -> bool {
    if points_equal(*last_point, point) {
        return true;
    }
    if points_equal(first_point, *last_point)
        && *expected_dir == ConvexDirChange::Invalid
        && last_vec[0].abs() <= EPSILON
        && last_vec[1].abs() <= EPSILON
    {
        *last_vec = subtract(point, *last_point);
        *first_vec = *last_vec;
    } else if !add_convex_vec(
        subtract(point, *last_point),
        last_vec,
        expected_dir,
        first_direction,
        reversals,
    ) {
        return false;
    }
    *last_point = point;
    true
}

fn close_convex_contour(
    first_point: Point,
    first_vec: Point,
    last_point: &mut Point,
    last_vec: &mut Point,
    expected_dir: &mut ConvexDirChange,
    first_direction: &mut ConvexDirChange,
    reversals: &mut usize,
) -> bool {
    add_convex_point(
        first_point,
        first_point,
        last_point,
        &mut first_vec.clone(),
        last_vec,
        expected_dir,
        first_direction,
        reversals,
    ) && add_convex_vec(
        first_vec,
        last_vec,
        expected_dir,
        first_direction,
        reversals,
    )
}

fn prepare_triangle_patches_from_stack(
    patches: &mut Vec<FillPatchDefinition>,
    triangles: Vec<[Point; 3]>,
) {
    for triangle in triangles {
        patches.push(FillPatchDefinition::Triangle(triangle));
    }
}

fn write_quadratic_fan_patches(
    patches: &mut Vec<WedgePatch>,
    p0: Point,
    p1: Point,
    p2: Point,
    fan_point: Point,
) {
    let mut num_patches = account_for_fill_curve(quadratic_wangs_formula_p4(p0, p1, p2));
    if num_patches == 0 {
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Quadratic([p0, p1, p2]),
            fan_point,
        });
        return;
    }
    let mut current_p0 = p0;
    let mut current_p1 = p1;
    let current_p2 = p2;
    while num_patches >= 3 {
        let t0 = 1.0 / num_patches as f32;
        let t1 = 2.0 / num_patches as f32;
        let ab0 = lerp(current_p0, current_p1, t0);
        let bc0 = lerp(current_p1, current_p2, t0);
        let abc0 = lerp(ab0, bc0, t0);
        let ab1 = lerp(current_p0, current_p1, t1);
        let bc1 = lerp(current_p1, current_p2, t1);
        let abc1 = lerp(ab1, bc1, t1);
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Quadratic([current_p0, ab0, abc0]),
            fan_point,
        });
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Cubic([
                abc0,
                lerp(abc0, bc0, 2.0 / 3.0),
                lerp(abc1, bc1, 1.0 / 3.0),
                abc1,
            ]),
            fan_point,
        });
        current_p0 = abc1;
        current_p1 = bc1;
        num_patches -= 2;
    }
    if num_patches == 2 {
        let ab = midpoint(current_p0, current_p1);
        let bc = midpoint(current_p1, current_p2);
        let abc = midpoint(ab, bc);
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Quadratic([current_p0, ab, abc]),
            fan_point,
        });
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Quadratic([abc, bc, current_p2]),
            fan_point,
        });
    } else {
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Quadratic([current_p0, current_p1, current_p2]),
            fan_point,
        });
    }
}

fn write_conic_fan_patches(
    patches: &mut Vec<WedgePatch>,
    p0: Point,
    p1: Point,
    p2: Point,
    weight: f32,
    fan_point: Point,
) {
    let mut num_patches =
        account_for_fill_curve(conic_wangs_formula_p2(p0, p1, p2, weight).powi(2));
    if num_patches == 0 {
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Conic {
                points: [p0, p1, p2],
                weight,
            },
            fan_point,
        });
        return;
    }
    let mut h0 = [p0[0], p0[1], 1.0];
    let mut h1 = [p1[0] * weight, p1[1] * weight, weight];
    let h2 = [p2[0], p2[1], 1.0];
    while num_patches >= 2 {
        let t = 1.0 / num_patches as f32;
        let ab = [
            h0[0] + ((h1[0] - h0[0]) * t),
            h0[1] + ((h1[1] - h0[1]) * t),
            h0[2] + ((h1[2] - h0[2]) * t),
        ];
        let bc = [
            h1[0] + ((h2[0] - h1[0]) * t),
            h1[1] + ((h2[1] - h1[1]) * t),
            h1[2] + ((h2[2] - h1[2]) * t),
        ];
        let abc = [
            ab[0] + ((bc[0] - ab[0]) * t),
            ab[1] + ((bc[1] - ab[1]) * t),
            ab[2] + ((bc[2] - ab[2]) * t),
        ];
        let midpoint = [abc[0] / abc[2], abc[1] / abc[2]];
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Conic {
                points: [
                    [h0[0] / h0[2], h0[1] / h0[2]],
                    [ab[0] / ab[2], ab[1] / ab[2]],
                    midpoint,
                ],
                weight: ab[2] / (h0[2] * abc[2]).max(EPSILON).sqrt(),
            },
            fan_point,
        });
        h0 = abc;
        h1 = bc;
        num_patches -= 1;
    }
    patches.push(WedgePatch {
        definition: FillPatchDefinition::Conic {
            points: [
                [h0[0] / h0[2], h0[1] / h0[2]],
                [h1[0] / h1[2], h1[1] / h1[2]],
                [h2[0], h2[1]],
            ],
            weight: h1[2] / h0[2].max(EPSILON).sqrt(),
        },
        fan_point,
    });
}

fn write_cubic_fan_patches(
    patches: &mut Vec<WedgePatch>,
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    fan_point: Point,
) {
    let mut num_patches = account_for_fill_curve(cubic_wangs_formula_p4(p0, p1, p2, p3));
    if num_patches == 0 {
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Cubic([p0, p1, p2, p3]),
            fan_point,
        });
        return;
    }
    let mut current_p0 = p0;
    let mut current_p1 = p1;
    let mut current_p2 = p2;
    let current_p3 = p3;
    while num_patches >= 3 {
        let t0 = 1.0 / num_patches as f32;
        let t1 = 2.0 / num_patches as f32;
        let ab0 = lerp(current_p0, current_p1, t0);
        let bc0 = lerp(current_p1, current_p2, t0);
        let cd0 = lerp(current_p2, current_p3, t0);
        let abc0 = lerp(ab0, bc0, t0);
        let bcd0 = lerp(bc0, cd0, t0);
        let abcd0 = lerp(abc0, bcd0, t0);
        let ab1 = lerp(current_p0, current_p1, t1);
        let bc1 = lerp(current_p1, current_p2, t1);
        let cd1 = lerp(current_p2, current_p3, t1);
        let abc1 = lerp(ab1, bc1, t1);
        let bcd1 = lerp(bc1, cd1, t1);
        let abcd1 = lerp(abc1, bcd1, t1);
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Cubic([current_p0, ab0, abc0, abcd0]),
            fan_point,
        });
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Cubic([
                abcd0,
                lerp(abc0, bcd0, t1),
                lerp(abc1, bcd1, t0),
                abcd1,
            ]),
            fan_point,
        });
        current_p0 = abcd1;
        current_p1 = bcd1;
        current_p2 = cd1;
        num_patches -= 2;
    }
    if num_patches == 2 {
        let ab = midpoint(current_p0, current_p1);
        let bc = midpoint(current_p1, current_p2);
        let cd = midpoint(current_p2, current_p3);
        let abc = midpoint(ab, bc);
        let bcd = midpoint(bc, cd);
        let abcd = midpoint(abc, bcd);
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Cubic([current_p0, ab, abc, abcd]),
            fan_point,
        });
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Cubic([abcd, bcd, cd, current_p3]),
            fan_point,
        });
    } else {
        patches.push(WedgePatch {
            definition: FillPatchDefinition::Cubic([
                current_p0, current_p1, current_p2, current_p3,
            ]),
            fan_point,
        });
    }
}

fn write_quadratic_patches(
    patches: &mut Vec<FillPatchDefinition>,
    p0: Point,
    p1: Point,
    p2: Point,
) {
    let n4 = quadratic_wangs_formula_p4(p0, p1, p2);
    if n4 <= 1.0 {
        return;
    }
    let mut num_patches = account_for_fill_curve(n4);
    if num_patches == 0 {
        patches.push(FillPatchDefinition::Quadratic([p0, p1, p2]));
        return;
    }
    let mut triangulator = MiddleOutPolygonTriangulator::new(p0);
    let mut current_p0 = p0;
    let mut current_p1 = p1;
    let current_p2 = p2;
    while num_patches >= 3 {
        let t0 = 1.0 / num_patches as f32;
        let t1 = 2.0 / num_patches as f32;
        let ab0 = lerp(current_p0, current_p1, t0);
        let bc0 = lerp(current_p1, current_p2, t0);
        let abc0 = lerp(ab0, bc0, t0);
        let ab1 = lerp(current_p0, current_p1, t1);
        let bc1 = lerp(current_p1, current_p2, t1);
        let abc1 = lerp(ab1, bc1, t1);
        patches.push(FillPatchDefinition::Quadratic([current_p0, ab0, abc0]));
        patches.push(FillPatchDefinition::Triangle([current_p0, abc0, abc1]));
        patches.push(FillPatchDefinition::Cubic([
            abc0,
            lerp(abc0, bc0, 2.0 / 3.0),
            lerp(abc1, bc1, 1.0 / 3.0),
            abc1,
        ]));
        prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(abc1));
        current_p0 = abc1;
        current_p1 = bc1;
        num_patches -= 2;
    }
    if num_patches == 2 {
        let ab = midpoint(current_p0, current_p1);
        let bc = midpoint(current_p1, current_p2);
        let abc = midpoint(ab, bc);
        patches.push(FillPatchDefinition::Quadratic([current_p0, ab, abc]));
        patches.push(FillPatchDefinition::Triangle([current_p0, abc, current_p2]));
        patches.push(FillPatchDefinition::Quadratic([abc, bc, current_p2]));
        prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(current_p2));
    } else {
        patches.push(FillPatchDefinition::Quadratic([
            current_p0, current_p1, current_p2,
        ]));
        prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(current_p2));
    }
    prepare_triangle_patches_from_stack(patches, triangulator.close());
}

fn write_conic_patches(
    patches: &mut Vec<FillPatchDefinition>,
    p0: Point,
    p1: Point,
    p2: Point,
    weight: f32,
) {
    let n4 = conic_wangs_formula_p2(p0, p1, p2, weight).powi(2);
    if n4 <= 1.0 {
        return;
    }
    let mut num_patches = account_for_fill_curve(n4);
    if num_patches == 0 {
        patches.push(FillPatchDefinition::Conic {
            points: [p0, p1, p2],
            weight,
        });
        return;
    }
    let mut triangulator = MiddleOutPolygonTriangulator::new(p0);
    let mut h0 = [p0[0], p0[1], 1.0];
    let mut h1 = [p1[0] * weight, p1[1] * weight, weight];
    let h2 = [p2[0], p2[1], 1.0];
    while num_patches >= 2 {
        let t = 1.0 / num_patches as f32;
        let ab = [
            h0[0] + ((h1[0] - h0[0]) * t),
            h0[1] + ((h1[1] - h0[1]) * t),
            h0[2] + ((h1[2] - h0[2]) * t),
        ];
        let bc = [
            h1[0] + ((h2[0] - h1[0]) * t),
            h1[1] + ((h2[1] - h1[1]) * t),
            h1[2] + ((h2[2] - h1[2]) * t),
        ];
        let abc = [
            ab[0] + ((bc[0] - ab[0]) * t),
            ab[1] + ((bc[1] - ab[1]) * t),
            ab[2] + ((bc[2] - ab[2]) * t),
        ];
        let midpoint = [abc[0] / abc[2], abc[1] / abc[2]];
        patches.push(FillPatchDefinition::Conic {
            points: [
                [h0[0] / h0[2], h0[1] / h0[2]],
                [ab[0] / ab[2], ab[1] / ab[2]],
                midpoint,
            ],
            weight: ab[2] / (h0[2] * abc[2]).max(EPSILON).sqrt(),
        });
        prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(midpoint));
        h0 = abc;
        h1 = bc;
        num_patches -= 1;
    }
    patches.push(FillPatchDefinition::Conic {
        points: [
            [h0[0] / h0[2], h0[1] / h0[2]],
            [h1[0] / h1[2], h1[1] / h1[2]],
            [h2[0], h2[1]],
        ],
        weight: h1[2] / h0[2].max(EPSILON).sqrt(),
    });
    prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(p2));
    prepare_triangle_patches_from_stack(patches, triangulator.close());
}

fn write_cubic_patches(
    patches: &mut Vec<FillPatchDefinition>,
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
) {
    let n4 = cubic_wangs_formula_p4(p0, p1, p2, p3);
    if n4 <= 1.0 {
        return;
    }
    let mut num_patches = account_for_fill_curve(n4);
    if num_patches == 0 {
        patches.push(FillPatchDefinition::Cubic([p0, p1, p2, p3]));
        return;
    }
    let mut triangulator = MiddleOutPolygonTriangulator::new(p0);
    let mut current_p0 = p0;
    let mut current_p1 = p1;
    let mut current_p2 = p2;
    let current_p3 = p3;
    while num_patches >= 3 {
        let t0 = 1.0 / num_patches as f32;
        let t1 = 2.0 / num_patches as f32;
        let ab0 = lerp(current_p0, current_p1, t0);
        let bc0 = lerp(current_p1, current_p2, t0);
        let cd0 = lerp(current_p2, current_p3, t0);
        let abc0 = lerp(ab0, bc0, t0);
        let bcd0 = lerp(bc0, cd0, t0);
        let abcd0 = lerp(abc0, bcd0, t0);
        let ab1 = lerp(current_p0, current_p1, t1);
        let bc1 = lerp(current_p1, current_p2, t1);
        let cd1 = lerp(current_p2, current_p3, t1);
        let abc1 = lerp(ab1, bc1, t1);
        let bcd1 = lerp(bc1, cd1, t1);
        let abcd1 = lerp(abc1, bcd1, t1);
        patches.push(FillPatchDefinition::Cubic([current_p0, ab0, abc0, abcd0]));
        patches.push(FillPatchDefinition::Triangle([current_p0, abcd0, abcd1]));
        patches.push(FillPatchDefinition::Cubic([
            abcd0,
            lerp(abc0, bcd0, t1),
            lerp(abc1, bcd1, t0),
            abcd1,
        ]));
        prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(abcd1));
        current_p0 = abcd1;
        current_p1 = bcd1;
        current_p2 = cd1;
        num_patches -= 2;
    }
    if num_patches == 2 {
        let ab = midpoint(current_p0, current_p1);
        let bc = midpoint(current_p1, current_p2);
        let cd = midpoint(current_p2, current_p3);
        let abc = midpoint(ab, bc);
        let bcd = midpoint(bc, cd);
        let abcd = midpoint(abc, bcd);
        patches.push(FillPatchDefinition::Cubic([current_p0, ab, abc, abcd]));
        patches.push(FillPatchDefinition::Triangle([
            current_p0, abcd, current_p3,
        ]));
        patches.push(FillPatchDefinition::Cubic([abcd, bcd, cd, current_p3]));
        prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(current_p3));
    } else {
        patches.push(FillPatchDefinition::Cubic([
            current_p0, current_p1, current_p2, current_p3,
        ]));
        prepare_triangle_patches_from_stack(patches, triangulator.push_vertex(current_p3));
    }
    prepare_triangle_patches_from_stack(patches, triangulator.close());
}

fn create_arc_conic_patches(
    center: Point,
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) -> Vec<FillPatchDefinition> {
    let turn = std::f32::consts::PI * 2.0;
    let mut sweep = end_angle - start_angle;
    if counter_clockwise {
        while sweep <= 0.0 {
            sweep += turn;
        }
    } else {
        while sweep >= 0.0 {
            sweep -= turn;
        }
    }
    let segment_count = ((sweep.abs() / (std::f32::consts::PI / 2.0)).ceil() as usize).max(1);
    let segment_sweep = sweep / segment_count as f32;
    let mut patches = Vec::new();
    for index in 0..segment_count {
        let theta0 = start_angle + segment_sweep * index as f32;
        let theta1 = theta0 + segment_sweep;
        let theta_mid = (theta0 + theta1) * 0.5;
        let half_sweep = segment_sweep * 0.5;
        let weight = half_sweep.cos();
        let start = [
            center[0] + theta0.cos() * radius,
            center[1] + theta0.sin() * radius,
        ];
        let end = [
            center[0] + theta1.cos() * radius,
            center[1] + theta1.sin() * radius,
        ];
        let control_distance = radius / weight.max(EPSILON);
        let control = [
            center[0] + theta_mid.cos() * control_distance,
            center[1] + theta_mid.sin() * control_distance,
        ];
        patches.push(FillPatchDefinition::Conic {
            points: [start, control, end],
            weight,
        });
    }
    patches
}

fn quadratic_to_cubic_points(p0: Point, p1: Point, p2: Point) -> [Point; 4] {
    [
        p0,
        add(p0, scale(subtract(p1, p0), 2.0 / 3.0)),
        add(p2, scale(subtract(p1, p2), 2.0 / 3.0)),
        p2,
    ]
}

fn line_to_cubic_patch_points(p0: Point, p1: Point) -> [Point; 4] {
    [
        p0,
        add(p0, scale(subtract(p1, p0), 1.0 / 3.0)),
        add(p1, scale(subtract(p0, p1), 1.0 / 3.0)),
        p1,
    ]
}

fn quadratic_wangs_formula_p4(p0: Point, p1: Point, p2: Point) -> f32 {
    let v = add(subtract(p0, scale(p1, 2.0)), p2);
    dot(v, v) * PATCH_PRECISION * PATCH_PRECISION * 0.25
}

fn cubic_wangs_formula_p4(p0: Point, p1: Point, p2: Point, p3: Point) -> f32 {
    let v1 = add(subtract(p0, scale(p1, 2.0)), p2);
    let v2 = add(subtract(p1, scale(p2, 2.0)), p3);
    dot(v1, v1).max(dot(v2, v2)) * PATCH_PRECISION * PATCH_PRECISION * (81.0 / 64.0)
}

fn conic_wangs_formula_p2(p0: Point, p1: Point, p2: Point, weight: f32) -> f32 {
    let center = [
        (p0[0].min(p1[0]).min(p2[0]) + p0[0].max(p1[0]).max(p2[0])) * 0.5,
        (p0[1].min(p1[1]).min(p2[1]) + p0[1].max(p1[1]).max(p2[1])) * 0.5,
    ];
    let cp0 = subtract(p0, center);
    let cp1 = subtract(p1, center);
    let cp2 = subtract(p2, center);
    let max_len = magnitude(cp0).max(magnitude(cp1)).max(magnitude(cp2));
    let dp = add(add(cp0, cp2), scale(cp1, -2.0 * weight));
    let dw = (2.0 - (2.0 * weight)).abs();
    let rp_minus_one = (max_len * PATCH_PRECISION - 1.0).max(0.0);
    let numer = magnitude(dp) * PATCH_PRECISION + (rp_minus_one * dw);
    let denom = 4.0 * weight.min(1.0);
    if denom <= EPSILON {
        f32::INFINITY
    } else {
        numer.max(0.0) / denom
    }
}

fn account_for_fill_curve(wangs_formula_p4: f32) -> usize {
    if wangs_formula_p4 <= MAX_PARAMETRIC_SEGMENTS_P4 {
        return 0;
    }
    ((wangs_formula_p4.min(MAX_SEGMENTS_PER_CURVE_P4) / MAX_PARAMETRIC_SEGMENTS_P4)
        .sqrt()
        .sqrt()
        .ceil()) as usize
}

fn offset_point(path: &PathDrawCommand, point: Point) -> Point {
    [path.x + point[0], path.y + point[1]]
}

fn append_triangles(triangles: &mut Vec<Point>, new_triangles: Vec<[Point; 3]>) {
    for triangle in new_triangles {
        triangles.extend(triangle);
    }
}

fn convexity_sign(value: f32) -> i32 {
    if value > EPSILON {
        1
    } else if value < -EPSILON {
        -1
    } else {
        0
    }
}

fn add(a: Point, b: Point) -> Point {
    [a[0] + b[0], a[1] + b[1]]
}

fn subtract(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn scale(point: Point, factor: f32) -> Point {
    [point[0] * factor, point[1] * factor]
}

fn midpoint(a: Point, b: Point) -> Point {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}

fn lerp(a: Point, b: Point, t: f32) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

fn dot(a: Point, b: Point) -> f32 {
    (a[0] * b[0]) + (a[1] * b[1])
}

fn cross_vector(a: Point, b: Point) -> f32 {
    (a[0] * b[1]) - (a[1] * b[0])
}

fn magnitude(point: Point) -> f32 {
    (point[0] * point[0] + point[1] * point[1]).sqrt()
}

fn points_equal(a: Point, b: Point) -> bool {
    (a[0] - b[0]).abs() <= EPSILON && (a[1] - b[1]).abs() <= EPSILON
}
