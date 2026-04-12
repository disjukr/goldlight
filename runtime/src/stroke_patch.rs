use bytemuck::{Pod, Zeroable};

use crate::drawing::{FlattenedSubpath, PathDrawCommand, Point, StrokeStyle};
use crate::render::{PathStrokeCap2D, PathVerb2D};

const EPSILON: f32 = 1e-5;
const PATCH_PRECISION: f32 = 4.0;
const TESSELLATION_PRECISION: f32 = 4.0;
const MAX_PATCH_RESOLVE_LEVEL: u32 = 5;
const MAX_STROKE_EDGES: u32 = (1 << 14) - 1;
const MAX_PARAMETRIC_SEGMENTS: u32 = 1 << MAX_PATCH_RESOLVE_LEVEL;
const MAX_PARAMETRIC_SEGMENTS_P4: f32 = (MAX_PARAMETRIC_SEGMENTS
    * MAX_PARAMETRIC_SEGMENTS
    * MAX_PARAMETRIC_SEGMENTS
    * MAX_PARAMETRIC_SEGMENTS) as f32;
const MAX_SEGMENTS_PER_CURVE_P4: f32 = 1024.0 * 1024.0 * 1024.0 * 1024.0;
const CUBIC_CONVEX_180_CHOP_EPSILON: f32 = 1.0 / ((1 << 11) as f32);

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct StrokePatchInstance {
    pub(crate) p0: [f32; 2],
    pub(crate) p1: [f32; 2],
    pub(crate) p2: [f32; 2],
    pub(crate) p3: [f32; 2],
    pub(crate) join_control_point: [f32; 2],
    pub(crate) stroke: [f32; 2],
    pub(crate) curve_meta: [f32; 2],
    pub(crate) depth: f32,
    pub(crate) color: [f32; 4],
}

impl StrokePatchInstance {
    pub(crate) const ATTRIBUTES: [wgpu::VertexAttribute; 9] = wgpu::vertex_attr_array![
        0 => Float32x2,
        1 => Float32x2,
        2 => Float32x2,
        3 => Float32x2,
        4 => Float32x2,
        5 => Float32x2,
        6 => Float32x2,
        7 => Float32,
        8 => Float32x4
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
pub(crate) struct PreparedStrokePatchStep {
    pub(crate) instances: Vec<StrokePatchInstance>,
    pub(crate) vertex_count: u32,
}

#[derive(Clone)]
enum PatchPathVerb {
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
        weight: f32,
    },
    CubicTo {
        control1: Point,
        control2: Point,
        to: Point,
    },
    ArcTo {
        center: Point,
        radius: f32,
        start_angle: f32,
        end_angle: f32,
        counter_clockwise: bool,
    },
    Close,
}

#[derive(Clone)]
enum PatchDefinition {
    Line([Point; 2]),
    Quadratic([Point; 3]),
    Conic { points: [Point; 3], weight: f32 },
    Cubic([Point; 4]),
}

#[derive(Clone)]
struct PreparedPatch {
    definition: PatchDefinition,
    wangs_formula_p4: f32,
}

#[derive(Clone)]
struct StrokePatch {
    patch: PreparedPatch,
    join_control_point: Point,
}

enum SequenceItem {
    BasePatch(PreparedPatch),
    PreparedPatch(StrokePatch),
    MoveWithinContour(Point),
    ContourFinished,
}

const STROKE_PATCH_SHADER_SOURCE_HEAD: &str = r#"
struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
}

fn wangs_formula_max_fdiff_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> f32 {
  let v1 = p0 - (2.0 * p1) + p2;
  let v2 = p1 - (2.0 * p2) + p3;
  return max(dot(v1, v1), dot(v2, v2));
}

fn wangs_formula_cubic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> f32 {
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3);
  return max(ceil(sqrt(3.0 * sqrt(max(m, 0.0)))), 1.0);
}

fn wangs_formula_conic_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
) -> f32 {
  let center = (min(min(p0, p1), p2) + max(max(p0, p1), p2)) * 0.5;
  let cp0 = p0 - center;
  let cp1 = p1 - center;
  let cp2 = p2 - center;
  let maxLen = sqrt(max(max(dot(cp0, cp0), dot(cp1, cp1)), dot(cp2, cp2)));
  let dp = fma(vec2<f32>(-2.0 * w), cp1, cp0) + cp2;
  let dw = abs(fma(-2.0, w, 2.0));
  let rpMinus1 = max(0.0, fma(maxLen, 4.0, -1.0));
  let numer = length(dp) * 4.0 + rpMinus1 * dw;
  let denom = 4.0 * min(w, 1.0);
  return numer / max(denom, 1e-5);
}

fn wangs_formula_conic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
) -> f32 {
  return max(ceil(sqrt(max(wangs_formula_conic_p2(p0, p1, p2, w), 1.0))), 1.0);
}

fn cosine_between_unit_vectors(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return clamp(dot(a, b), -1.0, 1.0);
}

fn miter_extent(cosTheta: f32, miterLimit: f32) -> f32 {
  let x = fma(cosTheta, 0.5, 0.5);
  if (x * miterLimit * miterLimit >= 1.0) {
    return inverseSqrt(max(x, 1e-5));
  }
  return sqrt(max(x, 0.0));
}

fn num_radial_segments_per_radian(approxDevStrokeRadius: f32) -> f32 {
  let radius = max(approxDevStrokeRadius, 0.5);
  return 0.5 / acos(max(1.0 - (1.0 / 4.0) / radius, -1.0));
}

fn robust_normalize_diff(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let delta = a - b;
  if (all(delta == vec2<f32>(0.0, 0.0))) {
    return vec2<f32>(0.0, 0.0);
  }
  let invMag = 1.0 / max(abs(delta.x), abs(delta.y));
  return normalize(invMag * delta);
}

fn unchecked_mix(a: f32, b: f32, t: f32) -> f32 {
  return fma(b - a, t, a);
}

fn unchecked_mix_vec2(a: vec2<f32>, b: vec2<f32>, t: f32) -> vec2<f32> {
  return fma(b - a, vec2<f32>(t), a);
}

fn cross_length_2d(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return (a.x * b.y) - (a.y * b.x);
}

fn stroke_join_edges(joinType: f32, prevTan: vec2<f32>, tan0: vec2<f32>, strokeRadius: f32) -> f32 {
  if (joinType >= 0.0) {
    return sign(joinType) + 3.0;
  }
  let joinRads = acos(cosine_between_unit_vectors(prevTan, tan0));
  let numRadialSegmentsInJoin = max(ceil(joinRads * num_radial_segments_per_radian(strokeRadius)), 1.0);
  return numRadialSegmentsInJoin + 2.0;
}

fn tangents_nearly_parallel(turn: f32, tan0: vec2<f32>, tan1: vec2<f32>) -> bool {
  let sinEpsilon = 1e-2;
  let tangentScale = max(dot(tan0, tan0) * dot(tan1, tan1), 1e-5);
  return abs(turn) * inverseSqrt(tangentScale) < sinEpsilon;
}
"#;

const STROKE_PATCH_SHADER_SOURCE_MAIN: &str = r#"
@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) p0: vec2<f32>,
  @location(1) p1: vec2<f32>,
  @location(2) p2: vec2<f32>,
  @location(3) p3: vec2<f32>,
  @location(4) joinControlPoint: vec2<f32>,
  @location(5) stroke: vec2<f32>,
  @location(6) curveMeta: vec2<f32>,
  @location(7) depth: f32,
  @location(8) color: vec4<f32>,
) -> VertexOut {
  var edgeID = f32(vertexIndex >> 1u);
  if ((vertexIndex & 1u) != 0u) {
    edgeID = -edgeID;
  }
  let curveType = curveMeta.x;
  var weight = -1.0;
  var curveP0 = p0;
  var curveP1 = p1;
  var curveP2 = p2;
  var curveP3 = p3;
  if (curveType >= 1.5 && curveType < 2.5) {
    weight = curveMeta.y;
    curveP3 = curveP2;
  }
  let strokeRadius = stroke.x;
  let joinType = stroke.y;
  let lastControlPoint = joinControlPoint;
  var numParametricSegments: f32;
  if (weight < 0.0) {
    if (all(curveP0 == curveP1) && all(curveP2 == curveP3)) {
      numParametricSegments = 1.0;
    } else {
      numParametricSegments = wangs_formula_cubic(curveP0, curveP1, curveP2, curveP3);
    }
  } else {
    if (all(curveP0 == curveP1) || all(curveP1 == curveP2)) {
      numParametricSegments = 1.0;
    } else {
      numParametricSegments = wangs_formula_conic(curveP0, curveP1, curveP2, weight);
    }
  }
  let numRadialSegmentsPerRadian = num_radial_segments_per_radian(strokeRadius);
  var prevTan = robust_normalize_diff(curveP0, lastControlPoint);
  var tan0 = robust_normalize_diff(select(select(curveP2, curveP3, all(curveP1 == curveP2)), curveP1, !all(curveP0 == curveP1)), curveP0);
  var tan1 = robust_normalize_diff(curveP3, select(select(curveP1, curveP0, all(curveP2 == curveP1)), curveP2, !all(curveP3 == curveP2)));
  var localJoinType = joinType;
  if (length(tan0) <= 1e-5) {
    localJoinType = 0.0;
    if (weight < 0.0) {
      tan0 = vec2<f32>(1.0, 0.0);
      tan1 = vec2<f32>(-1.0, 0.0);
    } else {
      tan0 = prevTan;
      tan1 = prevTan;
      if (length(prevTan) <= 1e-5) {
        curveP2 = curveP0 + (strokeRadius * vec2<f32>(1.0, 0.0));
        curveP3 = curveP2;
        curveP0 = curveP0 - (strokeRadius * vec2<f32>(1.0, 0.0));
        curveP1 = curveP0;
        prevTan = vec2<f32>(1.0, 0.0);
        tan0 = prevTan;
        tan1 = prevTan;
      } else {
        curveP1 = curveP0;
        curveP2 = curveP0 + (strokeRadius * prevTan);
        curveP3 = curveP2;
      }
    }
  }
  let maxEdges = f32(16383u);
  var numEdgesInJoin = stroke_join_edges(localJoinType, prevTan, tan0, strokeRadius);
  if (localJoinType < 0.0) {
    numEdgesInJoin = min(numEdgesInJoin, maxEdges - 2.0);
  }
  var joinTan0 = tan0;
  var joinTan1 = tan1;
  var turn = cross_length_2d(curveP2 - curveP0, curveP3 - curveP1);
  var strokeOutset = sign(edgeID);
  var combinedEdgeID = abs(edgeID) - numEdgesInJoin;
  if (combinedEdgeID < 0.0) {
    joinTan1 = joinTan0;
    if (!all(lastControlPoint == curveP0)) {
      joinTan0 = prevTan;
    }
    turn = cross_length_2d(joinTan0, joinTan1);
  }
  let cosTheta = cosine_between_unit_vectors(joinTan0, joinTan1);
  var rotation = acos(cosTheta);
  if (turn < 0.0) {
    rotation = -rotation;
  }
  var numRadialSegments: f32;
  if (combinedEdgeID < 0.0) {
    numRadialSegments = numEdgesInJoin - 2.0;
    numParametricSegments = 1.0;
    curveP1 = curveP0;
    curveP2 = curveP0;
    curveP3 = curveP0;
    combinedEdgeID += numRadialSegments + 1.0;
    if (!tangents_nearly_parallel(turn, joinTan0, joinTan1) || dot(joinTan0, joinTan1) < 0.0) {
      if (combinedEdgeID >= 0.0) {
        strokeOutset = select(max(strokeOutset, 0.0), min(strokeOutset, 0.0), turn < 0.0);
      }
    }
    combinedEdgeID = max(combinedEdgeID, 0.0);
  } else {
    let maxCombinedSegments = maxEdges - numEdgesInJoin - 1.0;
    numRadialSegments = max(ceil(abs(rotation) * numRadialSegmentsPerRadian), 1.0);
    numRadialSegments = min(numRadialSegments, maxCombinedSegments);
    numParametricSegments = min(numParametricSegments, maxCombinedSegments - numRadialSegments + 1.0);
  }
  let radsPerSegment = rotation / numRadialSegments;
  let numCombinedSegments = numParametricSegments + numRadialSegments - 1.0;
  let isFinalEdge = combinedEdgeID >= numCombinedSegments;
  if (combinedEdgeID > numCombinedSegments) {
    strokeOutset = 0.0;
  }
  if (abs(edgeID) == 2.0 && localJoinType > 0.0) {
    strokeOutset *= miter_extent(cosTheta, localJoinType);
  }
  var strokeCoord: vec2<f32>;
  var curveTangent: vec2<f32>;
"#;

const STROKE_PATCH_SHADER_SOURCE_TAIL: &str = r#"
  if (combinedEdgeID != 0.0 && !isFinalEdge) {
    var coeffA: vec2<f32>;
    var coeffB: vec2<f32>;
    var coeffC = curveP1 - curveP0;
    let deltaP = curveP3 - curveP0;
    if (curveType < 2.5) {
      if (curveType < 1.5) {
        if (curveType < 0.5) {
          let edgeP = curveP2 - curveP1;
          coeffB = edgeP - coeffC;
          coeffA = (-3.0 * edgeP) + deltaP;
        } else {
          coeffA = vec2<f32>(0.0, 0.0);
          coeffB = (0.5 * deltaP) - coeffC;
        }
      } else {
        coeffC *= weight;
        coeffB = (0.5 * deltaP) - coeffC;
        coeffA = (weight - 1.0) * deltaP;
        curveP1 *= weight;
      }
    } else {
      let edgeP = curveP2 - curveP1;
      coeffB = edgeP - coeffC;
      coeffA = (-3.0 * edgeP) + deltaP;
    }
    let coeffBScaled = coeffB * (numParametricSegments * 2.0);
    let coeffCScaled = coeffC * (numParametricSegments * numParametricSegments);
    var lastParametricEdgeID = 0.0;
    let maxParametricEdgeID = min(numParametricSegments - 1.0, combinedEdgeID);
    let negAbsRadsPerSegment = -abs(radsPerSegment);
    let maxRotation0 = (1.0 + combinedEdgeID) * abs(radsPerSegment);
    for (var exp = 4; exp >= 0; exp--) {
      let testParametricID = lastParametricEdgeID + exp2(f32(exp));
      if (testParametricID <= maxParametricEdgeID) {
        var testTan = fma(vec2<f32>(testParametricID), coeffA, coeffBScaled);
        testTan = fma(vec2<f32>(testParametricID), testTan, coeffCScaled);
        let cosRotationAtTest = dot(normalize(testTan), joinTan0);
        let maxRotation = min(fma(testParametricID, negAbsRadsPerSegment, maxRotation0), 3.14159265359);
        if (cosRotationAtTest >= cos(maxRotation)) {
          lastParametricEdgeID = testParametricID;
        }
      }
    }
    let parametricT = lastParametricEdgeID / numParametricSegments;
    let lastRadialEdgeID = combinedEdgeID - lastParametricEdgeID;
    let angle0Magnitude = acos(clamp(joinTan0.x, -1.0, 1.0));
    let angle0 = select(angle0Magnitude, -angle0Magnitude, joinTan0.y < 0.0);
    let radialAngle = fma(lastRadialEdgeID, radsPerSegment, angle0);
    let radialTangent = vec2<f32>(cos(radialAngle), sin(radialAngle));
    curveTangent = radialTangent;
    let radialNorm = vec2<f32>(-radialTangent.y, radialTangent.x);
    let quadraticA = dot(radialNorm, coeffA);
    let quadraticBOver2 = dot(radialNorm, coeffB);
    let quadraticC = dot(radialNorm, coeffC);
    let discrOver4 = max((quadraticBOver2 * quadraticBOver2) - (quadraticA * quadraticC), 0.0);
    var rootQ = sqrt(discrOver4);
    if (quadraticBOver2 > 0.0) {
      rootQ = -rootQ;
    }
    rootQ -= quadraticBOver2;
    let rootSentinel = -0.5 * rootQ * quadraticA;
    let useQaRoot = abs(fma(rootQ, rootQ, rootSentinel)) < abs(fma(quadraticA, quadraticC, rootSentinel));
    let rootNumer = select(quadraticC, rootQ, useQaRoot);
    let rootDenom = select(rootQ, quadraticA, useQaRoot);
    var radialT = 0.0;
    if (lastRadialEdgeID != 0.0) {
      radialT = select(0.0, clamp(rootNumer / rootDenom, 0.0, 1.0), rootDenom != 0.0);
    }
    let finalT = max(parametricT, radialT);
    if (curveType < 2.5) {
      if (curveType < 1.5) {
        if (curveType < 0.5) {
          let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
          let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
          let cd = unchecked_mix_vec2(curveP2, curveP3, finalT);
          let abc = unchecked_mix_vec2(ab, bc, finalT);
          let bcd = unchecked_mix_vec2(bc, cd, finalT);
          strokeCoord = unchecked_mix_vec2(abc, bcd, finalT);
          if (finalT != radialT) {
            curveTangent = robust_normalize_diff(bcd, abc);
          }
        } else {
          let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
          let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
          strokeCoord = unchecked_mix_vec2(ab, bc, finalT);
          if (finalT != radialT) {
            curveTangent = robust_normalize_diff(bc, ab);
          }
        }
      } else {
        let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
        let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
        let abc = unchecked_mix_vec2(ab, bc, finalT);
        let u = unchecked_mix(1.0, weight, finalT);
        let v = weight + 1.0 - u;
        let uv = unchecked_mix(u, v, finalT);
        strokeCoord = abc / max(uv, 1e-5);
        if (finalT != radialT) {
          curveTangent = robust_normalize_diff(bc * u, ab * v);
        }
      }
    } else {
      let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
      let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
      let cd = unchecked_mix_vec2(curveP2, curveP3, finalT);
      let abc = unchecked_mix_vec2(ab, bc, finalT);
      let bcd = unchecked_mix_vec2(bc, cd, finalT);
      strokeCoord = unchecked_mix_vec2(abc, bcd, finalT);
      if (finalT != radialT) {
        curveTangent = robust_normalize_diff(bcd, abc);
      }
    }
  } else {
    curveTangent = select(joinTan0, joinTan1, isFinalEdge);
    strokeCoord = select(curveP0, curveP3, isFinalEdge);
  }
  let ortho = vec2<f32>(curveTangent.y, -curveTangent.x);
  let strokedCoord = strokeCoord + (ortho * strokeRadius * strokeOutset);
  let clipPosition = device_to_ndc(strokedCoord);
  var out: VertexOut;
  out.position = vec4<f32>(clipPosition.xy, depth, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
}
"#;

pub(crate) fn stroke_patch_shader_source() -> String {
    [
        STROKE_PATCH_SHADER_SOURCE_HEAD,
        STROKE_PATCH_SHADER_SOURCE_MAIN,
        STROKE_PATCH_SHADER_SOURCE_TAIL,
    ]
    .concat()
}

pub(crate) fn prepare_stroke_patch_step(
    path: &PathDrawCommand,
    stroke_style: StrokeStyle,
    dashed_subpaths: &[FlattenedSubpath],
    color: [f32; 4],
    depth: f32,
) -> Option<PreparedStrokePatchStep> {
    let use_flattened_path = !path.dash_array.is_empty();
    let prepared = if use_flattened_path {
        create_prepared_stroke_patches_from_verbs(
            &create_path_from_flattened_stroke_subpaths(dashed_subpaths),
            stroke_style,
        )
    } else {
        create_prepared_stroke_patches_from_verbs(&source_path_verbs(path), stroke_style)
    };
    if prepared.is_empty() {
        return None;
    }
    let vertex_count = required_stroke_vertex_count(&prepared, stroke_style);
    if vertex_count == 0 {
        return None;
    }
    let instances = prepared
        .iter()
        .map(|patch| stroke_patch_instance(patch, stroke_style, color, depth))
        .collect::<Vec<_>>();
    Some(PreparedStrokePatchStep {
        instances,
        vertex_count,
    })
}

fn source_path_verbs(path: &PathDrawCommand) -> Vec<PatchPathVerb> {
    path.verbs
        .iter()
        .map(|verb| match verb {
            PathVerb2D::MoveTo { to } => PatchPathVerb::MoveTo {
                to: [path.x + to[0], path.y + to[1]],
            },
            PathVerb2D::LineTo { to } => PatchPathVerb::LineTo {
                to: [path.x + to[0], path.y + to[1]],
            },
            PathVerb2D::QuadTo { control, to } => PatchPathVerb::QuadTo {
                control: [path.x + control[0], path.y + control[1]],
                to: [path.x + to[0], path.y + to[1]],
            },
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => PatchPathVerb::ConicTo {
                control: [path.x + control[0], path.y + control[1]],
                to: [path.x + to[0], path.y + to[1]],
                weight: *weight,
            },
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => PatchPathVerb::CubicTo {
                control1: [path.x + control1[0], path.y + control1[1]],
                control2: [path.x + control2[0], path.y + control2[1]],
                to: [path.x + to[0], path.y + to[1]],
            },
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => PatchPathVerb::ArcTo {
                center: [path.x + center[0], path.y + center[1]],
                radius: *radius,
                start_angle: *start_angle,
                end_angle: *end_angle,
                counter_clockwise: *counter_clockwise,
            },
            PathVerb2D::Close => PatchPathVerb::Close,
        })
        .collect()
}

fn create_path_from_flattened_stroke_subpaths(subpaths: &[FlattenedSubpath]) -> Vec<PatchPathVerb> {
    let mut verbs = Vec::new();
    for subpath in subpaths {
        if subpath.points.is_empty() {
            continue;
        }
        verbs.push(PatchPathVerb::MoveTo {
            to: subpath.points[0],
        });
        if subpath.points.len() == 1 {
            verbs.push(PatchPathVerb::LineTo {
                to: subpath.points[0],
            });
        } else {
            for point in subpath.points.iter().skip(1) {
                verbs.push(PatchPathVerb::LineTo { to: *point });
            }
        }
        if subpath.closed {
            verbs.push(PatchPathVerb::Close);
        }
    }
    verbs
}

fn create_prepared_stroke_patches_from_verbs(
    verbs: &[PatchPathVerb],
    stroke_style: StrokeStyle,
) -> Vec<StrokePatch> {
    let mut prepared = Vec::new();
    let mut current_point = None;
    let mut contour_start = None;
    let mut pending_contour_start = None;
    let mut last_degenerate_point = None;
    let mut contour_units = Vec::new();
    let cap = stroke_style.cap;
    let is_hairline = stroke_style.half_width < 0.5;

    for verb in verbs {
        match verb {
            PatchPathVerb::MoveTo { to } => {
                flush_open_contour(
                    &mut prepared,
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    stroke_style,
                    cap,
                    is_hairline,
                );
                reset_contour(
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    Some(*to),
                );
            }
            PatchPathVerb::LineTo { to } => {
                if !ensure_implicit_contour(
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    &mut pending_contour_start,
                ) {
                    continue;
                }
                let from = current_point.unwrap();
                if points_equal(from, *to) {
                    last_degenerate_point = Some(*to);
                    current_point = Some(*to);
                    continue;
                }
                emit_patch_definition(
                    &mut contour_units,
                    finalize_patch(PatchDefinition::Line([from, *to])),
                );
                current_point = Some(*to);
                last_degenerate_point = None;
            }
            PatchPathVerb::QuadTo { control, to } => {
                if !ensure_implicit_contour(
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    &mut pending_contour_start,
                ) {
                    continue;
                }
                let from = current_point.unwrap();
                if points_equal(from, *control) && points_equal(*control, *to) {
                    last_degenerate_point = Some(*to);
                    current_point = Some(*to);
                    continue;
                }
                if let Some(cusp_t) = find_quadratic_cusp_t(from, *control, *to) {
                    let [left, _right] = split_quadratic_at(from, *control, *to, cusp_t);
                    let cusp_point = left[2];
                    contour_units.push(SequenceItem::PreparedPatch(
                        create_synthetic_round_stroke_patch(cusp_point),
                    ));
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Line([from, cusp_point])),
                    );
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Line([cusp_point, *to])),
                    );
                } else {
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Quadratic([from, *control, *to])),
                    );
                }
                current_point = Some(*to);
                last_degenerate_point = None;
            }
            PatchPathVerb::ConicTo {
                control,
                to,
                weight,
            } => {
                if !ensure_implicit_contour(
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    &mut pending_contour_start,
                ) {
                    continue;
                }
                let from = current_point.unwrap();
                if points_equal(from, *control) && points_equal(*control, *to) {
                    last_degenerate_point = Some(*to);
                    current_point = Some(*to);
                    continue;
                }
                if let Some(cusp_t) = find_conic_cusp_t(from, *control, *to, *weight) {
                    let cusp = evaluate_conic(from, *control, *to, *weight, cusp_t);
                    contour_units.push(SequenceItem::PreparedPatch(
                        create_synthetic_round_stroke_patch(cusp),
                    ));
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Line([from, cusp])),
                    );
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Line([cusp, *to])),
                    );
                } else {
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Conic {
                            points: [from, *control, *to],
                            weight: *weight,
                        }),
                    );
                }
                current_point = Some(*to);
                last_degenerate_point = None;
            }
            PatchPathVerb::CubicTo {
                control1,
                control2,
                to,
            } => {
                if !ensure_implicit_contour(
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    &mut pending_contour_start,
                ) {
                    continue;
                }
                let from = current_point.unwrap();
                if points_equal(from, *control1)
                    && points_equal(*control1, *control2)
                    && points_equal(*control2, *to)
                {
                    last_degenerate_point = Some(*to);
                    current_point = Some(*to);
                    continue;
                }
                let chops = find_cubic_convex_180_chops(from, *control1, *control2, *to);
                if !chops.ts.is_empty() {
                    let chopped = split_cubic_at_many(from, *control1, *control2, *to, &chops.ts);
                    if chops.are_cusps && chopped.len() == 2 {
                        let cusp_point = chopped[0][3];
                        contour_units.push(SequenceItem::PreparedPatch(
                            create_synthetic_round_stroke_patch(cusp_point),
                        ));
                        emit_patch_definition(
                            &mut contour_units,
                            finalize_patch(PatchDefinition::Cubic([
                                chopped[0][0],
                                chopped[0][1],
                                cusp_point,
                                cusp_point,
                            ])),
                        );
                        emit_patch_definition(
                            &mut contour_units,
                            finalize_patch(PatchDefinition::Cubic([
                                cusp_point,
                                cusp_point,
                                chopped[1][2],
                                chopped[1][3],
                            ])),
                        );
                    } else if chops.are_cusps && chopped.len() == 3 {
                        let cusp0 = chopped[0][3];
                        let cusp1 = chopped[1][3];
                        contour_units.push(SequenceItem::PreparedPatch(
                            create_synthetic_round_stroke_patch(cusp0),
                        ));
                        contour_units.push(SequenceItem::PreparedPatch(
                            create_synthetic_round_stroke_patch(cusp1),
                        ));
                        emit_patch_definition(
                            &mut contour_units,
                            finalize_patch(PatchDefinition::Line([chopped[0][0], cusp0])),
                        );
                        emit_patch_definition(
                            &mut contour_units,
                            finalize_patch(PatchDefinition::Line([cusp0, cusp1])),
                        );
                        emit_patch_definition(
                            &mut contour_units,
                            finalize_patch(PatchDefinition::Line([cusp1, chopped[2][3]])),
                        );
                    } else {
                        for cubic_patch in chopped {
                            emit_patch_definition(
                                &mut contour_units,
                                finalize_patch(PatchDefinition::Cubic(cubic_patch)),
                            );
                        }
                    }
                } else {
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Cubic([from, *control1, *control2, *to])),
                    );
                }
                current_point = Some(*to);
                last_degenerate_point = None;
            }
            PatchPathVerb::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                if !ensure_implicit_contour(
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    &mut pending_contour_start,
                ) {
                    continue;
                }
                let arc_patches = create_arc_conic_patches(
                    *center,
                    *radius,
                    *start_angle,
                    *end_angle,
                    *counter_clockwise,
                );
                for patch in arc_patches {
                    emit_patch_definition(&mut contour_units, finalize_patch(patch));
                }
                current_point = contour_units.last().map(sequence_item_end_point);
                last_degenerate_point = None;
            }
            PatchPathVerb::Close => {
                let Some(contour_start_point) = contour_start else {
                    continue;
                };
                let Some(current) = current_point else {
                    continue;
                };
                if contour_units.is_empty() && last_degenerate_point.is_none() {
                    last_degenerate_point = Some(contour_start_point);
                }
                if !points_equal(current, contour_start_point) {
                    emit_patch_definition(
                        &mut contour_units,
                        finalize_patch(PatchDefinition::Line([current, contour_start_point])),
                    );
                }
                current_point = Some(contour_start_point);
                pending_contour_start = Some(contour_start_point);
                flush_closed_contour(
                    &mut prepared,
                    &mut current_point,
                    &mut contour_start,
                    &mut last_degenerate_point,
                    &mut contour_units,
                    stroke_style,
                    cap,
                    is_hairline,
                );
            }
        }
    }

    flush_open_contour(
        &mut prepared,
        &mut current_point,
        &mut contour_start,
        &mut last_degenerate_point,
        &mut contour_units,
        stroke_style,
        cap,
        is_hairline,
    );
    prepared
}

fn emit_patch_definition(contour_units: &mut Vec<SequenceItem>, patch: PreparedPatch) {
    for subdivided in subdivide_stroke_prepared_patch(patch) {
        contour_units.push(SequenceItem::BasePatch(subdivided));
    }
}

fn reset_contour(
    current_point: &mut Option<Point>,
    contour_start: &mut Option<Point>,
    last_degenerate_point: &mut Option<Point>,
    contour_units: &mut Vec<SequenceItem>,
    next_move_to: Option<Point>,
) {
    *current_point = next_move_to;
    *contour_start = next_move_to;
    *last_degenerate_point = None;
    contour_units.clear();
}

fn ensure_implicit_contour(
    current_point: &mut Option<Point>,
    contour_start: &mut Option<Point>,
    last_degenerate_point: &mut Option<Point>,
    contour_units: &mut Vec<SequenceItem>,
    pending_contour_start: &mut Option<Point>,
) -> bool {
    if current_point.is_some() {
        return true;
    }
    let Some(next_move_to) = *pending_contour_start else {
        return false;
    };
    reset_contour(
        current_point,
        contour_start,
        last_degenerate_point,
        contour_units,
        Some(next_move_to),
    );
    *pending_contour_start = None;
    true
}

fn clone_sequence_items(sequence: &[SequenceItem]) -> Vec<SequenceItem> {
    sequence
        .iter()
        .map(|item| match item {
            SequenceItem::BasePatch(patch) => SequenceItem::BasePatch(patch.clone()),
            SequenceItem::PreparedPatch(patch) => SequenceItem::PreparedPatch(patch.clone()),
            SequenceItem::MoveWithinContour(point) => SequenceItem::MoveWithinContour(*point),
            SequenceItem::ContourFinished => SequenceItem::ContourFinished,
        })
        .collect()
}

fn find_first_contour_patch_item(sequence: &[SequenceItem]) -> Option<&SequenceItem> {
    sequence.iter().find(|item| {
        matches!(
            item,
            SequenceItem::BasePatch(_) | SequenceItem::PreparedPatch(_)
        )
    })
}

fn find_last_contour_patch_item(sequence: &[SequenceItem]) -> Option<&SequenceItem> {
    sequence.iter().rev().find(|item| {
        matches!(
            item,
            SequenceItem::BasePatch(_) | SequenceItem::PreparedPatch(_)
        )
    })
}

fn resolve_sequence_item_join_control_point(
    previous: &SequenceItem,
    patch: &PreparedPatch,
) -> Point {
    match previous {
        SequenceItem::MoveWithinContour(anchor) => *anchor,
        SequenceItem::BasePatch(previous_patch) => {
            get_patch_outgoing_join_control_point(previous_patch)
        }
        SequenceItem::PreparedPatch(previous_patch) => previous_patch.join_control_point,
        SequenceItem::ContourFinished => get_patch_start_point(patch),
    }
}

fn emit_contour_sequence(prepared: &mut Vec<StrokePatch>, sequence: &[SequenceItem]) {
    if sequence.is_empty() {
        return;
    }
    let mut previous = &sequence[0];
    for item in sequence.iter().skip(1) {
        match item {
            SequenceItem::BasePatch(patch) => {
                let join_control_point = resolve_sequence_item_join_control_point(previous, patch);
                prepared.push(StrokePatch {
                    patch: patch.clone(),
                    join_control_point,
                });
            }
            SequenceItem::PreparedPatch(patch) => prepared.push(patch.clone()),
            SequenceItem::MoveWithinContour(_) | SequenceItem::ContourFinished => {}
        }
        previous = item;
    }
}

fn emit_degenerate_contour(
    prepared: &mut Vec<StrokePatch>,
    point: Option<Point>,
    stroke_style: StrokeStyle,
    cap: PathStrokeCap2D,
    is_hairline: bool,
) {
    let Some(point) = point else {
        return;
    };
    match cap {
        PathStrokeCap2D::Butt => {}
        PathStrokeCap2D::Round => prepared.push(create_degenerate_round_stroke_patch(point)),
        PathStrokeCap2D::Square => {
            let square_patch =
                create_degenerate_square_stroke_patch(point, stroke_style.half_width, is_hairline);
            let sequence = vec![
                SequenceItem::BasePatch(square_patch.clone()),
                SequenceItem::MoveWithinContour(get_patch_start_point(&square_patch)),
                SequenceItem::BasePatch(square_patch),
                SequenceItem::ContourFinished,
            ];
            emit_contour_sequence(prepared, &sequence);
        }
    }
}

fn flush_open_contour(
    prepared: &mut Vec<StrokePatch>,
    current_point: &mut Option<Point>,
    contour_start: &mut Option<Point>,
    last_degenerate_point: &mut Option<Point>,
    contour_units: &mut Vec<SequenceItem>,
    stroke_style: StrokeStyle,
    cap: PathStrokeCap2D,
    is_hairline: bool,
) {
    let Some(first_patch) = find_first_contour_patch_item(contour_units) else {
        emit_degenerate_contour(
            prepared,
            *last_degenerate_point,
            stroke_style,
            cap,
            is_hairline,
        );
        reset_contour(
            current_point,
            contour_start,
            last_degenerate_point,
            contour_units,
            None,
        );
        return;
    };
    let Some(last_patch) = find_last_contour_patch_item(contour_units) else {
        emit_degenerate_contour(
            prepared,
            *last_degenerate_point,
            stroke_style,
            cap,
            is_hairline,
        );
        reset_contour(
            current_point,
            contour_start,
            last_degenerate_point,
            contour_units,
            None,
        );
        return;
    };
    let mut sequence = clone_sequence_items(contour_units);
    let first_point = sequence_item_start_point(first_patch);
    let last_point = sequence_item_end_point(last_patch);
    match cap {
        PathStrokeCap2D::Round => {
            sequence.push(SequenceItem::PreparedPatch(
                create_synthetic_round_stroke_patch(last_point),
            ));
            sequence.push(SequenceItem::PreparedPatch(
                create_synthetic_round_stroke_patch(first_point),
            ));
        }
        PathStrokeCap2D::Square => {
            let last_join_control = sequence_item_join_control_point(last_patch);
            let first_join_control = sequence_item_first_control_point(first_patch);
            sequence.push(SequenceItem::BasePatch(create_square_cap_end_patch(
                last_point,
                last_join_control,
                stroke_style.half_width,
                is_hairline,
            )));
            sequence.push(SequenceItem::MoveWithinContour(add(
                first_point,
                resolve_square_cap_offset(
                    first_point,
                    first_join_control,
                    stroke_style.half_width,
                    is_hairline,
                ),
            )));
            sequence.push(SequenceItem::BasePatch(create_square_cap_start_patch(
                first_point,
                first_join_control,
                stroke_style.half_width,
                is_hairline,
            )));
        }
        PathStrokeCap2D::Butt => sequence.push(SequenceItem::MoveWithinContour(first_point)),
    }
    sequence.push(match first_patch {
        SequenceItem::BasePatch(patch) => SequenceItem::BasePatch(patch.clone()),
        SequenceItem::PreparedPatch(patch) => SequenceItem::PreparedPatch(patch.clone()),
        SequenceItem::MoveWithinContour(_) | SequenceItem::ContourFinished => unreachable!(),
    });
    sequence.push(SequenceItem::ContourFinished);
    emit_contour_sequence(prepared, &sequence);
    reset_contour(
        current_point,
        contour_start,
        last_degenerate_point,
        contour_units,
        None,
    );
}

fn flush_closed_contour(
    prepared: &mut Vec<StrokePatch>,
    current_point: &mut Option<Point>,
    contour_start: &mut Option<Point>,
    last_degenerate_point: &mut Option<Point>,
    contour_units: &mut Vec<SequenceItem>,
    stroke_style: StrokeStyle,
    cap: PathStrokeCap2D,
    is_hairline: bool,
) {
    let Some(first_patch) = find_first_contour_patch_item(contour_units) else {
        emit_degenerate_contour(
            prepared,
            *last_degenerate_point,
            stroke_style,
            cap,
            is_hairline,
        );
        reset_contour(
            current_point,
            contour_start,
            last_degenerate_point,
            contour_units,
            None,
        );
        return;
    };
    let mut sequence = clone_sequence_items(contour_units);
    sequence.push(match first_patch {
        SequenceItem::BasePatch(patch) => SequenceItem::BasePatch(patch.clone()),
        SequenceItem::PreparedPatch(patch) => SequenceItem::PreparedPatch(patch.clone()),
        SequenceItem::MoveWithinContour(_) | SequenceItem::ContourFinished => unreachable!(),
    });
    sequence.push(SequenceItem::ContourFinished);
    emit_contour_sequence(prepared, &sequence);
    reset_contour(
        current_point,
        contour_start,
        last_degenerate_point,
        contour_units,
        None,
    );
}

fn sequence_item_start_point(item: &SequenceItem) -> Point {
    match item {
        SequenceItem::BasePatch(patch) => get_patch_start_point(patch),
        SequenceItem::PreparedPatch(patch) => get_patch_start_point(&patch.patch),
        SequenceItem::MoveWithinContour(_) | SequenceItem::ContourFinished => unreachable!(),
    }
}

fn sequence_item_end_point(item: &SequenceItem) -> Point {
    match item {
        SequenceItem::BasePatch(patch) => get_patch_end_point(patch),
        SequenceItem::PreparedPatch(patch) => get_patch_end_point(&patch.patch),
        SequenceItem::MoveWithinContour(_) | SequenceItem::ContourFinished => unreachable!(),
    }
}

fn sequence_item_join_control_point(item: &SequenceItem) -> Point {
    match item {
        SequenceItem::BasePatch(patch) => get_patch_outgoing_join_control_point(patch),
        SequenceItem::PreparedPatch(patch) => patch.join_control_point,
        SequenceItem::MoveWithinContour(_) | SequenceItem::ContourFinished => unreachable!(),
    }
}

fn sequence_item_first_control_point(item: &SequenceItem) -> Point {
    match item {
        SequenceItem::BasePatch(patch) => get_patch_first_control_point(patch),
        SequenceItem::PreparedPatch(patch) => get_patch_first_control_point(&patch.patch),
        SequenceItem::MoveWithinContour(_) | SequenceItem::ContourFinished => unreachable!(),
    }
}

fn patch_wangs_formula_p4(patch: &PatchDefinition) -> f32 {
    match patch {
        PatchDefinition::Line(_) => 1.0,
        PatchDefinition::Quadratic(points) => {
            quadratic_wangs_formula_p4(points[0], points[1], points[2])
        }
        PatchDefinition::Conic { points, weight } => {
            let n2 = conic_wangs_formula_p2(points[0], points[1], points[2], *weight);
            n2 * n2
        }
        PatchDefinition::Cubic(points) => {
            cubic_wangs_formula_p4(points[0], points[1], points[2], points[3])
        }
    }
}

fn finalize_patch(definition: PatchDefinition) -> PreparedPatch {
    PreparedPatch {
        wangs_formula_p4: patch_wangs_formula_p4(&definition),
        definition,
    }
}

fn quadratic_wangs_formula_p4(from: Point, control: Point, to: Point) -> f32 {
    let vx = from[0] - (2.0 * control[0]) + to[0];
    let vy = from[1] - (2.0 * control[1]) + to[1];
    ((vx * vx) + (vy * vy)) * PATCH_PRECISION * PATCH_PRECISION * 0.25
}

fn cubic_wangs_formula_p4(from: Point, control1: Point, control2: Point, to: Point) -> f32 {
    let v1x = from[0] - (2.0 * control1[0]) + control2[0];
    let v1y = from[1] - (2.0 * control1[1]) + control2[1];
    let v2x = control1[0] - (2.0 * control2[0]) + to[0];
    let v2y = control1[1] - (2.0 * control2[1]) + to[1];
    ((v1x * v1x) + (v1y * v1y)).max((v2x * v2x) + (v2y * v2y))
        * PATCH_PRECISION
        * PATCH_PRECISION
        * (81.0 / 64.0)
}

fn conic_wangs_formula_p2(from: Point, control: Point, to: Point, weight: f32) -> f32 {
    let center = [
        (from[0].min(control[0]).min(to[0]) + from[0].max(control[0]).max(to[0])) * 0.5,
        (from[1].min(control[1]).min(to[1]) + from[1].max(control[1]).max(to[1])) * 0.5,
    ];
    let centered = [
        subtract(from, center),
        subtract(control, center),
        subtract(to, center),
    ];
    let max_length = magnitude(centered[0])
        .max(magnitude(centered[1]))
        .max(magnitude(centered[2]));
    let dp = subtract(
        add(centered[0], centered[2]),
        scale(centered[1], 2.0 * weight),
    );
    let dw = (2.0 - (2.0 * weight)).abs();
    let rp_minus_one = (max_length * PATCH_PRECISION - 1.0).max(0.0);
    let numerator = magnitude(dp) * PATCH_PRECISION + rp_minus_one * dw;
    let denominator = 4.0 * weight.min(1.0);
    if denominator <= EPSILON {
        return f32::INFINITY;
    }
    (numerator / denominator).max(0.0)
}

fn account_for_stroke_curve(wangs_formula_p4: f32) -> usize {
    if wangs_formula_p4 <= MAX_PARAMETRIC_SEGMENTS_P4 {
        return 0;
    }
    ((((wangs_formula_p4.min(MAX_SEGMENTS_PER_CURVE_P4)) / MAX_PARAMETRIC_SEGMENTS_P4).sqrt())
        .sqrt())
    .ceil() as usize
}

fn subdivide_stroke_prepared_patch(patch: PreparedPatch) -> Vec<PreparedPatch> {
    let normalized_patch = match &patch.definition {
        PatchDefinition::Quadratic(points) => finalize_patch(PatchDefinition::Cubic(
            quadratic_to_cubic_points(points[0], points[1], points[2]),
        )),
        _ => patch.clone(),
    };
    match &normalized_patch.definition {
        PatchDefinition::Conic { points, weight } => {
            let num_patches = account_for_stroke_curve(normalized_patch.wangs_formula_p4);
            if num_patches == 0 {
                return vec![normalized_patch];
            }
            chop_and_write_stroke_conics(points[0], points[1], points[2], *weight, num_patches)
        }
        PatchDefinition::Cubic(points) => {
            let num_patches = account_for_stroke_curve(normalized_patch.wangs_formula_p4);
            if num_patches == 0 {
                return vec![normalized_patch];
            }
            chop_and_write_stroke_cubics(points[0], points[1], points[2], points[3], num_patches)
        }
        PatchDefinition::Line(_) | PatchDefinition::Quadratic(_) => vec![normalized_patch],
    }
}

fn chop_and_write_stroke_cubics(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    mut num_patches: usize,
) -> Vec<PreparedPatch> {
    let mut prepared = Vec::new();
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
        let middle_p1 = lerp(abc0, bcd0, t1);
        let middle_p2 = lerp(abc1, bcd1, t0);

        prepared.push(finalize_patch(PatchDefinition::Cubic([
            current_p0, ab0, abc0, abcd0,
        ])));
        prepared.push(finalize_patch(PatchDefinition::Cubic([
            abcd0, middle_p1, middle_p2, abcd1,
        ])));

        current_p0 = abcd1;
        current_p1 = bcd1;
        current_p2 = cd1;
        num_patches -= 2;
    }

    if num_patches == 2 {
        let [left, right] = split_cubic_at(current_p0, current_p1, current_p2, current_p3, 0.5);
        prepared.push(finalize_patch(PatchDefinition::Cubic(left)));
        prepared.push(finalize_patch(PatchDefinition::Cubic(right)));
    } else {
        prepared.push(finalize_patch(PatchDefinition::Cubic([
            current_p0, current_p1, current_p2, current_p3,
        ])));
    }

    prepared
}

fn chop_and_write_stroke_conics(
    p0: Point,
    p1: Point,
    p2: Point,
    weight: f32,
    mut num_patches: usize,
) -> Vec<PreparedPatch> {
    let mut prepared = Vec::new();
    let mut h0 = [p0[0], p0[1], 1.0, 1.0];
    let mut h1 = [p1[0] * weight, p1[1] * weight, weight, weight];
    let h2 = [p2[0], p2[1], 1.0, 1.0];

    while num_patches >= 2 {
        let t = 1.0 / num_patches as f32;
        let ab = lerp4(h0, h1, t);
        let bc = lerp4(h1, h2, t);
        let abc = lerp4(ab, bc, t);
        let midpoint = [abc[0] / abc[3], abc[1] / abc[3]];
        let first_control = [ab[0] / ab[3], ab[1] / ab[3]];
        let first_weight = ab[3] / (h0[3] * abc[3]).max(EPSILON).sqrt();
        prepared.push(finalize_patch(PatchDefinition::Conic {
            points: [[h0[0] / h0[3], h0[1] / h0[3]], first_control, midpoint],
            weight: first_weight,
        }));
        h0 = abc;
        h1 = bc;
        num_patches -= 1;
    }

    let final_control = [h1[0] / h1[3], h1[1] / h1[3]];
    let final_weight = h1[3] / h0[3].max(EPSILON).sqrt();
    prepared.push(finalize_patch(PatchDefinition::Conic {
        points: [
            [h0[0] / h0[3], h0[1] / h0[3]],
            final_control,
            [h2[0], h2[1]],
        ],
        weight: final_weight,
    }));
    prepared
}

fn get_patch_start_point(patch: &PreparedPatch) -> Point {
    match &patch.definition {
        PatchDefinition::Line(points) => points[0],
        PatchDefinition::Quadratic(points) => points[0],
        PatchDefinition::Conic { points, .. } => points[0],
        PatchDefinition::Cubic(points) => points[0],
    }
}

fn get_patch_end_point(patch: &PreparedPatch) -> Point {
    match &patch.definition {
        PatchDefinition::Line(points) => points[1],
        PatchDefinition::Quadratic(points) => points[2],
        PatchDefinition::Conic { points, .. } => points[2],
        PatchDefinition::Cubic(points) => points[3],
    }
}

fn get_patch_points4(patch: &PreparedPatch) -> [Point; 4] {
    match &patch.definition {
        PatchDefinition::Line(points) => [points[0], points[0], points[1], points[1]],
        PatchDefinition::Quadratic(points) => {
            quadratic_to_cubic_points(points[0], points[1], points[2])
        }
        PatchDefinition::Conic { points, .. } => [points[0], points[1], points[2], points[2]],
        PatchDefinition::Cubic(points) => *points,
    }
}

fn resolve_patch_tangent_control_point(
    anchor: Point,
    control_a: Point,
    control_b: Point,
    fallback: Point,
) -> Point {
    if !points_equal(control_a, anchor) {
        return control_a;
    }
    if !points_equal(control_b, anchor) {
        return control_b;
    }
    fallback
}

fn get_patch_first_control_point(patch: &PreparedPatch) -> Point {
    let [p0, p1, p2, p3] = get_patch_points4(patch);
    resolve_patch_tangent_control_point(p0, p1, p2, p3)
}

fn get_patch_outgoing_join_control_point(patch: &PreparedPatch) -> Point {
    let [p0, p1, p2, p3] = get_patch_points4(patch);
    resolve_patch_tangent_control_point(p3, p2, p1, p0)
}

fn resolve_square_cap_offset(
    anchor: Point,
    tangent_control_point: Point,
    half_width: f32,
    is_hairline: bool,
) -> Point {
    let tangent = normalize(subtract(anchor, tangent_control_point)).unwrap_or([1.0, 0.0]);
    if is_hairline {
        scale(tangent, 0.5)
    } else {
        scale(tangent, half_width)
    }
}

fn resolve_degenerate_square_cap_offset(half_width: f32, is_hairline: bool) -> Point {
    if is_hairline {
        [0.5, 0.0]
    } else {
        [half_width, 0.0]
    }
}

fn create_square_cap_start_patch(
    anchor: Point,
    tangent_control_point: Point,
    half_width: f32,
    is_hairline: bool,
) -> PreparedPatch {
    let offset = resolve_square_cap_offset(anchor, tangent_control_point, half_width, is_hairline);
    finalize_patch(PatchDefinition::Line([add(anchor, offset), anchor]))
}

fn create_square_cap_end_patch(
    anchor: Point,
    tangent_control_point: Point,
    half_width: f32,
    is_hairline: bool,
) -> PreparedPatch {
    let offset = resolve_square_cap_offset(anchor, tangent_control_point, half_width, is_hairline);
    finalize_patch(PatchDefinition::Line([anchor, add(anchor, offset)]))
}

fn create_degenerate_square_stroke_patch(
    center: Point,
    half_width: f32,
    is_hairline: bool,
) -> PreparedPatch {
    let offset = resolve_degenerate_square_cap_offset(half_width, is_hairline);
    finalize_patch(PatchDefinition::Line([
        subtract(center, offset),
        add(center, offset),
    ]))
}

fn create_synthetic_round_stroke_patch(center: Point) -> StrokePatch {
    StrokePatch {
        patch: PreparedPatch {
            definition: PatchDefinition::Cubic([center, center, center, center]),
            wangs_formula_p4: 1.0,
        },
        join_control_point: center,
    }
}

fn create_degenerate_round_stroke_patch(center: Point) -> StrokePatch {
    create_synthetic_round_stroke_patch(center)
}

fn quadratic_to_cubic_points(p0: Point, p1: Point, p2: Point) -> [Point; 4] {
    let c1 = add(p0, scale(subtract(p1, p0), 2.0 / 3.0));
    let c2 = add(p2, scale(subtract(p1, p2), 2.0 / 3.0));
    [p0, c1, c2, p2]
}

fn create_arc_conic_patches(
    center: Point,
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) -> Vec<PatchDefinition> {
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
        patches.push(PatchDefinition::Conic {
            points: [start, control, end],
            weight,
        });
    }
    patches
}

fn evaluate_conic(from: Point, control: Point, to: Point, weight: f32, t: f32) -> Point {
    let one_minus_t = 1.0 - t;
    let denominator = one_minus_t * one_minus_t + 2.0 * weight * one_minus_t * t + t * t;
    [
        ((one_minus_t * one_minus_t * from[0])
            + (2.0 * weight * one_minus_t * t * control[0])
            + (t * t * to[0]))
            / denominator,
        ((one_minus_t * one_minus_t * from[1])
            + (2.0 * weight * one_minus_t * t * control[1])
            + (t * t * to[1]))
            / denominator,
    ]
}

fn split_quadratic_at(from: Point, control: Point, to: Point, t: f32) -> [[Point; 3]; 2] {
    let p01 = lerp(from, control, t);
    let p12 = lerp(control, to, t);
    let split = lerp(p01, p12, t);
    [[from, p01, split], [split, p12, to]]
}

fn split_cubic_at(
    from: Point,
    control1: Point,
    control2: Point,
    to: Point,
    t: f32,
) -> [[Point; 4]; 2] {
    let p01 = lerp(from, control1, t);
    let p12 = lerp(control1, control2, t);
    let p23 = lerp(control2, to, t);
    let p012 = lerp(p01, p12, t);
    let p123 = lerp(p12, p23, t);
    let split = lerp(p012, p123, t);
    [[from, p01, p012, split], [split, p123, p23, to]]
}

fn split_cubic_at_many(
    from: Point,
    control1: Point,
    control2: Point,
    to: Point,
    ts: &[f32],
) -> Vec<[Point; 4]> {
    let mut sorted = ts
        .iter()
        .copied()
        .filter(|t| *t > EPSILON && *t < 1.0 - EPSILON)
        .collect::<Vec<_>>();
    sorted.sort_by(|a, b| a.total_cmp(b));
    if sorted.is_empty() {
        return vec![[from, control1, control2, to]];
    }
    let mut segments = Vec::new();
    let mut current = [from, control1, control2, to];
    let mut last_t = 0.0;
    for t in sorted {
        let local_t = (t - last_t) / (1.0 - last_t).max(EPSILON);
        let [left, right] = split_cubic_at(current[0], current[1], current[2], current[3], local_t);
        segments.push(left);
        current = right;
        last_t = t;
    }
    segments.push(current);
    segments
}

fn find_quadratic_cusp_t(from: Point, control: Point, to: Point) -> Option<f32> {
    let tan0 = subtract(control, from);
    let tan1 = subtract(to, control);
    let cross_value = (tan0[0] * tan1[1] - tan0[1] * tan1[0]).abs();
    if cross_value > EPSILON || dot(tan0, tan1) >= 0.0 {
        return None;
    }
    let normalized_tan0 = normalize(tan0);
    let normalized_neg_tan1 = normalize(scale(tan1, -1.0));
    let (Some(normalized_tan0), Some(normalized_neg_tan1)) = (normalized_tan0, normalized_neg_tan1)
    else {
        return Some(0.5);
    };
    let mut bisector = add(normalized_tan0, normalized_neg_tan1);
    if magnitude(bisector) <= EPSILON {
        bisector = perpendicular(normalized_tan0);
    }
    let denominator = dot(subtract(tan0, tan1), bisector);
    let t = if denominator.abs() <= EPSILON {
        0.5
    } else {
        dot(tan0, bisector) / denominator
    };
    Some(if t > EPSILON && t < 1.0 - EPSILON {
        t
    } else {
        0.5
    })
}

fn solve_quadratic_mid_tangent(a: f32, b: f32, c: f32) -> f32 {
    let discriminant = (b * b - 4.0 * a * c).max(0.0);
    let q = -0.5 * (b + (if b == 0.0 { 1.0 } else { b.signum() } * discriminant.sqrt()));
    let half_qa = -0.5 * q * a;
    let t = if ((q * q) + half_qa).abs() < ((a * c) + half_qa).abs() {
        if a.abs() <= EPSILON { f32::NAN } else { q / a }
    } else if q.abs() <= EPSILON {
        f32::NAN
    } else {
        c / q
    };
    if t > EPSILON && t < 1.0 - EPSILON {
        t
    } else {
        0.5
    }
}

fn find_conic_cusp_t(from: Point, control: Point, to: Point, weight: f32) -> Option<f32> {
    let tan0 = subtract(control, from);
    let tan1 = subtract(to, control);
    let cross_value = (tan0[0] * tan1[1] - tan0[1] * tan1[0]).abs();
    if cross_value > EPSILON || dot(tan0, tan1) >= 0.0 {
        return None;
    }
    let normalized_tan0 = normalize(tan0);
    let normalized_neg_tan1 = normalize(scale(tan1, -1.0));
    let (Some(normalized_tan0), Some(normalized_neg_tan1)) = (normalized_tan0, normalized_neg_tan1)
    else {
        return Some(0.5);
    };
    let mut bisector = add(normalized_tan0, normalized_neg_tan1);
    if magnitude(bisector) <= EPSILON {
        bisector = perpendicular(normalized_tan0);
    }
    let delta = subtract(to, from);
    let coeff_a = scale(delta, weight - 1.0);
    let coeff_b = subtract(delta, scale(tan0, 2.0 * weight));
    let coeff_c = scale(tan0, weight);
    Some(solve_quadratic_mid_tangent(
        dot(bisector, coeff_a),
        dot(bisector, coeff_b),
        dot(bisector, coeff_c),
    ))
}

struct CubicConvex180Chops {
    ts: Vec<f32>,
    are_cusps: bool,
}

fn find_cubic_convex_180_chops(
    from: Point,
    control1: Point,
    control2: Point,
    to: Point,
) -> CubicConvex180Chops {
    fn cross2(lhs: Point, rhs: Point) -> f32 {
        lhs[0] * rhs[1] - lhs[1] * rhs[0]
    }

    let c = subtract(control1, from);
    let d = subtract(control2, control1);
    let e = subtract(to, from);
    let b = subtract(d, c);
    let a = subtract(e, scale(d, 3.0));

    let mut qa = cross2(a, b);
    let mut qb_over_minus_2 = -0.5 * cross2(a, c);
    let mut qc = cross2(b, c);
    let mut discr_over_4 = qb_over_minus_2 * qb_over_minus_2 - qa * qc;
    let mut cusp_threshold = qa * (CUBIC_CONVEX_180_CHOP_EPSILON / 2.0);
    cusp_threshold *= cusp_threshold;

    if discr_over_4 < -cusp_threshold {
        let root = if qb_over_minus_2 != 0.0 {
            qc / qb_over_minus_2
        } else {
            f32::NAN
        };
        return if root > CUBIC_CONVEX_180_CHOP_EPSILON && root < 1.0 - CUBIC_CONVEX_180_CHOP_EPSILON
        {
            CubicConvex180Chops {
                ts: vec![root],
                are_cusps: false,
            }
        } else {
            CubicConvex180Chops {
                ts: Vec::new(),
                are_cusps: false,
            }
        };
    }

    let are_cusps = discr_over_4 <= cusp_threshold;
    if are_cusps {
        if qa != 0.0 || qb_over_minus_2 != 0.0 || qc != 0.0 {
            let root = if qa != 0.0 {
                qb_over_minus_2 / qa
            } else {
                f32::NAN
            };
            return if root > CUBIC_CONVEX_180_CHOP_EPSILON
                && root < 1.0 - CUBIC_CONVEX_180_CHOP_EPSILON
            {
                CubicConvex180Chops {
                    ts: vec![root],
                    are_cusps: true,
                }
            } else {
                CubicConvex180Chops {
                    ts: Vec::new(),
                    are_cusps: true,
                }
            };
        }

        let tan0 = if c[0].abs() > EPSILON || c[1].abs() > EPSILON {
            c
        } else {
            subtract(control2, from)
        };
        qa = dot(tan0, a);
        qb_over_minus_2 = -dot(tan0, b);
        qc = dot(tan0, c);
        discr_over_4 = qb_over_minus_2 * qb_over_minus_2 - qa * qc;
        if discr_over_4 < -cusp_threshold {
            return CubicConvex180Chops {
                ts: Vec::new(),
                are_cusps: false,
            };
        }
        discr_over_4 = discr_over_4.max(0.0);
    }

    let mut q = discr_over_4.max(0.0).sqrt();
    q = (if qb_over_minus_2 == 0.0 {
        1.0
    } else {
        qb_over_minus_2.signum()
    }) * q
        + qb_over_minus_2;
    let mut roots = [
        if qa != 0.0 { q / qa } else { f32::NAN },
        if q != 0.0 { qc / q } else { f32::NAN },
    ]
    .into_iter()
    .filter(|root| {
        *root > CUBIC_CONVEX_180_CHOP_EPSILON && *root < 1.0 - CUBIC_CONVEX_180_CHOP_EPSILON
    })
    .map(|root| (root * 1_000_000_000.0).round() / 1_000_000_000.0)
    .collect::<Vec<_>>();
    roots.sort_by(|a, b| a.total_cmp(b));
    roots.dedup_by(|a, b| (*a - *b).abs() <= EPSILON);
    CubicConvex180Chops {
        ts: roots,
        are_cusps,
    }
}

fn calc_num_radial_segments_per_radian(approx_stroke_radius: f32) -> f32 {
    let radius = approx_stroke_radius.max(0.5);
    let cos_theta = 1.0 - (1.0 / TESSELLATION_PRECISION) / radius;
    0.5 / cos_theta.max(-1.0).acos()
}

fn required_stroke_edges_for_patch(patch: &StrokePatch, stroke_style: StrokeStyle) -> u32 {
    let points = get_patch_points4(&patch.patch);
    let num_radial_segments_per_radian =
        calc_num_radial_segments_per_radian(stroke_style.half_width);
    let max_radial_segments_in_stroke = (num_radial_segments_per_radian * std::f32::consts::PI)
        .ceil()
        .max(1.0);
    let num_parametric_segments_p4 = match &patch.patch.definition {
        PatchDefinition::Conic { weight, .. } => {
            conic_wangs_formula_p2(points[0], points[1], points[2], *weight).powi(2)
        }
        _ => cubic_wangs_formula_p4(points[0], points[1], points[2], points[3]),
    };
    let max_parametric_segments_in_stroke = num_parametric_segments_p4
        .max(1.0)
        .sqrt()
        .sqrt()
        .ceil()
        .max(1.0);
    let mut edges_in_joins = if stroke_style.join_limit > 0.0 {
        4.0
    } else {
        3.0
    };
    if stroke_style.join_limit < 0.0 && num_radial_segments_per_radian > 0.0 {
        edges_in_joins += (num_radial_segments_per_radian * std::f32::consts::PI).ceil() - 1.0;
    }
    (edges_in_joins + max_radial_segments_in_stroke + max_parametric_segments_in_stroke)
        .min(MAX_STROKE_EDGES as f32) as u32
}

fn required_stroke_vertex_count(patches: &[StrokePatch], stroke_style: StrokeStyle) -> u32 {
    if patches.is_empty() {
        return 0;
    }
    let max_edges_required = patches
        .iter()
        .map(|patch| required_stroke_edges_for_patch(patch, stroke_style))
        .max()
        .unwrap_or(1);
    max_edges_required.min(MAX_STROKE_EDGES) * 2
}

fn stroke_patch_instance(
    patch: &StrokePatch,
    stroke_style: StrokeStyle,
    color: [f32; 4],
    depth: f32,
) -> StrokePatchInstance {
    let [p0, p1, p2, p3] = get_instance_points(&patch.patch);
    let curve_meta = match &patch.patch.definition {
        PatchDefinition::Line(_) => [0.0, 1.0],
        PatchDefinition::Quadratic(_) => [1.0, 1.0],
        PatchDefinition::Conic { weight, .. } => [2.0, *weight],
        PatchDefinition::Cubic(_) => [3.0, 1.0],
    };
    StrokePatchInstance {
        p0,
        p1,
        p2,
        p3,
        join_control_point: patch.join_control_point,
        stroke: [stroke_style.half_width, stroke_style.join_limit],
        curve_meta,
        depth,
        color,
    }
}

fn get_instance_points(patch: &PreparedPatch) -> [Point; 4] {
    match &patch.definition {
        PatchDefinition::Line(points) => [points[0], points[0], points[1], points[1]],
        PatchDefinition::Quadratic(points) => [points[0], points[1], points[2], points[2]],
        PatchDefinition::Conic { points, .. } => [points[0], points[1], points[2], points[2]],
        PatchDefinition::Cubic(points) => *points,
    }
}

fn lerp4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

#[cfg(test)]
mod tests {
    use super::prepare_stroke_patch_step;
    use crate::drawing::{PathDrawCommand, StrokeStyle};
    use crate::render::{
        ColorValue, PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, PathVerb2D,
    };

    fn stroke_style() -> StrokeStyle {
        StrokeStyle {
            half_width: 6.0,
            join_limit: 4.0,
            cap: PathStrokeCap2D::Round,
        }
    }

    fn stroke_path(verbs: Vec<PathVerb2D>) -> PathDrawCommand {
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
            stroke_join: PathStrokeJoin2D::Miter,
            stroke_cap: PathStrokeCap2D::Round,
            dash_array: Vec::new(),
            dash_offset: 0.0,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }
    }

    fn assert_prepared(verbs: Vec<PathVerb2D>) {
        let prepared = prepare_stroke_patch_step(
            &stroke_path(verbs),
            stroke_style(),
            &[],
            [1.0, 1.0, 1.0, 0.5],
            0.5,
        );
        assert!(prepared.is_some());
        assert!(!prepared.unwrap().instances.is_empty());
    }

    #[test]
    fn prepares_line_stroke_patch() {
        assert_prepared(vec![
            PathVerb2D::MoveTo { to: [10.0, 10.0] },
            PathVerb2D::LineTo { to: [110.0, 40.0] },
        ]);
    }

    #[test]
    fn prepares_quadratic_stroke_patch() {
        assert_prepared(vec![
            PathVerb2D::MoveTo { to: [10.0, 10.0] },
            PathVerb2D::QuadTo {
                control: [80.0, 140.0],
                to: [180.0, 20.0],
            },
        ]);
    }

    #[test]
    fn prepares_conic_stroke_patch() {
        assert_prepared(vec![
            PathVerb2D::MoveTo { to: [10.0, 10.0] },
            PathVerb2D::ConicTo {
                control: [80.0, 140.0],
                to: [180.0, 20.0],
                weight: 0.75,
            },
        ]);
    }

    #[test]
    fn prepares_cubic_stroke_patch() {
        assert_prepared(vec![
            PathVerb2D::MoveTo { to: [10.0, 10.0] },
            PathVerb2D::CubicTo {
                control1: [40.0, 140.0],
                control2: [140.0, -40.0],
                to: [180.0, 40.0],
            },
        ]);
    }

    #[test]
    fn prepares_arc_stroke_patch() {
        assert_prepared(vec![
            PathVerb2D::MoveTo { to: [160.0, 80.0] },
            PathVerb2D::ArcTo {
                center: [100.0, 80.0],
                radius: 60.0,
                start_angle: 0.0,
                end_angle: std::f32::consts::PI * 1.5,
                counter_clockwise: false,
            },
        ]);
    }
}

fn points_equal(left: Point, right: Point) -> bool {
    (left[0] - right[0]).abs() <= EPSILON && (left[1] - right[1]).abs() <= EPSILON
}

fn subtract(left: Point, right: Point) -> Point {
    [left[0] - right[0], left[1] - right[1]]
}

fn add(left: Point, right: Point) -> Point {
    [left[0] + right[0], left[1] + right[1]]
}

fn scale(point: Point, factor: f32) -> Point {
    [point[0] * factor, point[1] * factor]
}

fn dot(left: Point, right: Point) -> f32 {
    left[0] * right[0] + left[1] * right[1]
}

fn magnitude(point: Point) -> f32 {
    (point[0] * point[0] + point[1] * point[1]).sqrt()
}

fn normalize(point: Point) -> Option<Point> {
    let length = magnitude(point);
    (length > EPSILON).then_some([point[0] / length, point[1] / length])
}

fn perpendicular(vector: Point) -> Point {
    [-vector[1], vector[0]]
}

fn lerp(a: Point, b: Point, t: f32) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
