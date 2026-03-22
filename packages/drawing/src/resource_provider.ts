import type { DawnBackendContext } from './dawn_backend_context.ts';
import type { DawnCaps } from './caps.ts';
import type { DrawingGraphicsPipelineDesc } from './draw_pass.ts';

export type DrawingBufferDescriptor = Readonly<{
  label?: string;
  size: number;
  usage: GPUBufferUsageFlags;
  mappedAtCreation?: boolean;
}>;

export type DrawingTextureDescriptor = Readonly<{
  label?: string;
  size: GPUExtent3D;
  format: GPUTextureFormat;
  usage: GPUTextureUsageFlags;
  sampleCount?: number;
  mipLevelCount?: number;
  dimension?: GPUTextureDimension;
}>;

export type DrawingSamplerDescriptor = Readonly<{
  label?: string;
  magFilter?: GPUFilterMode;
  minFilter?: GPUFilterMode;
  mipmapFilter?: GPUMipmapFilterMode;
  addressModeU?: GPUAddressMode;
  addressModeV?: GPUAddressMode;
  addressModeW?: GPUAddressMode;
}>;

export type DrawingGraphicsPipelineHandle = Readonly<{
  key: string;
  descriptor: DrawingGraphicsPipelineDesc;
}>;

export type DawnResourceProvider = Readonly<{
  backend: DawnBackendContext;
  resourceBudget: number;
  createBuffer: (descriptor: DrawingBufferDescriptor) => GPUBuffer;
  createTexture: (descriptor: DrawingTextureDescriptor) => GPUTexture;
  createSampler: (descriptor?: DrawingSamplerDescriptor) => GPUSampler;
  createViewportBindGroup: (buffer: GPUBuffer) => GPUBindGroup;
  createStepBindGroup: (buffer: GPUBuffer) => GPUBindGroup;
  createClipTextureBindGroup: (textureView?: GPUTextureView) => GPUBindGroup;
  createGraphicsPipelineHandle: (
    descriptor: DrawingGraphicsPipelineDesc,
  ) => DrawingGraphicsPipelineHandle;
  resolveGraphicsPipelineHandle: (handle: DrawingGraphicsPipelineHandle) => GPURenderPipeline;
  findOrCreateGraphicsPipeline: (descriptor: DrawingGraphicsPipelineDesc) => GPURenderPipeline;
  getStencilAttachmentView: () => GPUTextureView;
}>;

const renderAttachmentUsage = 0x10;
const textureCopyDstUsage = 0x02;
const floatBytes = Float32Array.BYTES_PER_ELEMENT;
const floatsPerVertex = 6;
const stencilFormat = 'depth24plus-stencil8';
const noColorWrites = 0;
const srcOverBlend: GPUBlendState = {
  color: {
    operation: 'add',
    srcFactor: 'src-alpha',
    dstFactor: 'one-minus-src-alpha',
  },
  alpha: {
    operation: 'add',
    srcFactor: 'one',
    dstFactor: 'one-minus-src-alpha',
  },
};
const maxPatchResolveLevel = 5;
const tessellationPrecision = 4;
const patchPrecision = 4;
const tessellationPrecisionLiteral = `${tessellationPrecision}.0`;
const patchPrecisionLiteral = `${patchPrecision}.0`;
const cubicLengthTermLiteral = `${(patchPrecision * (3 * 2 / 8)).toFixed(1)}`;
const curveFillSegments = 1 << maxPatchResolveLevel;
const strokePatchSegments = (1 << 14) - 1;
const textureBindingUsage = 0x04;

const fillPathShaderSource = `
struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

struct StepUniform {
  matrix0: vec4<f32>,
  matrix1: vec4<f32>,
  color: vec4<f32>,
  params: vec4<f32>,
  clipAtlas: vec4<f32>,
  clipAnalytic: vec4<f32>,
  clipShader: vec4<f32>,
};

@group(1) @binding(0) var<uniform> step: StepUniform;
@group(2) @binding(0) var clipMaskSampler: sampler;
@group(2) @binding(1) var clipMaskTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) devicePosition: vec2<f32>,
};

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}


fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
}

@vertex
fn vs_main(
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>,
) -> VertexOut {
  let devicePosition = local_to_device(position);
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.color = color;
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  var clipCoverage = 1.0;
  if (step.params.y > 0.5) {
    let uv = (in.devicePosition - step.clipAtlas.xy) * step.clipAtlas.zw;
    clipCoverage *= textureSample(clipMaskTexture, clipMaskSampler, uv).a;
  }
  if (step.params.z > 0.5) {
    let local = in.devicePosition - step.clipAnalytic.xy;
    let inside = local.x >= 0.0 && local.y >= 0.0 &&
      local.x <= step.clipAnalytic.z && local.y <= step.clipAnalytic.w;
    clipCoverage *= select(0.0, 1.0, inside);
  }
  var color = in.color * step.color;
  if (step.params.w > 0.5) {
    color *= step.clipShader;
  }
  color.a *= clipCoverage;
  return color;
}
`;

const wedgePatchShaderSource = `
const MAX_RESOLVE_LEVEL: f32 = ${maxPatchResolveLevel}.0;
const SEGMENTS: u32 = ${curveFillSegments}u;

struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

struct StepUniform {
  matrix0: vec4<f32>,
  matrix1: vec4<f32>,
  color: vec4<f32>,
  params: vec4<f32>,
  clipAtlas: vec4<f32>,
  clipAnalytic: vec4<f32>,
  clipShader: vec4<f32>,
};

@group(1) @binding(0) var<uniform> step: StepUniform;
@group(2) @binding(0) var clipMaskSampler: sampler;
@group(2) @binding(1) var clipMaskTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) devicePosition: vec2<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
}

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) p0: vec2<f32>,
  @location(1) p1: vec2<f32>,
  @location(2) p2: vec2<f32>,
  @location(3) p3: vec2<f32>,
  @location(4) curveMeta: vec4<f32>,
  @location(5) fanPoint: vec2<f32>,
) -> VertexOut {
  let triVertex = vertexIndex % 3u;
  let segmentIndex = vertexIndex / 3u;
  let activeSegments = max(1u, 1u << u32(clamp(curveMeta.z, 0.0, MAX_RESOLVE_LEVEL)));
  let t0 = f32(segmentIndex) / f32(activeSegments);
  let t1 = f32(min(segmentIndex + 1u, activeSegments)) / f32(activeSegments);
  var local: vec2<f32>;
  let curveType = curveMeta.x;
  let weight = curveMeta.y;
  let oneMinusT0 = 1.0 - t0;
  let oneMinusT1 = 1.0 - t1;
  var a = p0;
  var b = p3;
  if (curveType < 0.5) {
    a = mix(p0, p1, t0);
    b = mix(p0, p1, t1);
  } else if (curveType < 1.5) {
    a = (oneMinusT0 * oneMinusT0 * p0) + (2.0 * oneMinusT0 * t0 * p1) + (t0 * t0 * p2);
    b = (oneMinusT1 * oneMinusT1 * p0) + (2.0 * oneMinusT1 * t1 * p1) + (t1 * t1 * p2);
  } else if (curveType < 2.5) {
    let denom0 = max((oneMinusT0 * oneMinusT0) + (2.0 * weight * oneMinusT0 * t0) + (t0 * t0), 1e-5);
    let denom1 = max((oneMinusT1 * oneMinusT1) + (2.0 * weight * oneMinusT1 * t1) + (t1 * t1), 1e-5);
    a = ((oneMinusT0 * oneMinusT0 * p0) + (2.0 * weight * oneMinusT0 * t0 * p1) + (t0 * t0 * p2)) / denom0;
    b = ((oneMinusT1 * oneMinusT1 * p0) + (2.0 * weight * oneMinusT1 * t1 * p1) + (t1 * t1 * p2)) / denom1;
  } else {
    a =
      (oneMinusT0 * oneMinusT0 * oneMinusT0 * p0) +
      (3.0 * oneMinusT0 * oneMinusT0 * t0 * p1) +
      (3.0 * oneMinusT0 * t0 * t0 * p2) +
      (t0 * t0 * t0 * p3);
    b =
      (oneMinusT1 * oneMinusT1 * oneMinusT1 * p0) +
      (3.0 * oneMinusT1 * oneMinusT1 * t1 * p1) +
      (3.0 * oneMinusT1 * t1 * t1 * p2) +
      (t1 * t1 * t1 * p3);
  }
  if (segmentIndex >= activeSegments) {
    if (triVertex == 0u) {
      local = fanPoint;
    } else {
      local = p3;
    }
  } else if (triVertex == 0u) {
    local = fanPoint;
  } else if (triVertex == 1u) {
    local = a;
  } else {
    local = b;
  }
  let devicePosition = local_to_device(local);
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.color = step.color;
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  var clipCoverage = 1.0;
  if (step.params.y > 0.5) {
    let uv = (in.devicePosition - step.clipAtlas.xy) * step.clipAtlas.zw;
    clipCoverage *= textureSample(clipMaskTexture, clipMaskSampler, uv).a;
  }
  if (step.params.z > 0.5) {
    let local = in.devicePosition - step.clipAnalytic.xy;
    let inside = local.x >= 0.0 && local.y >= 0.0 &&
      local.x <= step.clipAnalytic.z && local.y <= step.clipAnalytic.w;
    clipCoverage *= select(0.0, 1.0, inside);
  }
  var color = in.color;
  if (step.params.w > 0.5) {
    color *= step.clipShader;
  }
  color.a *= clipCoverage;
  return color;
}
`;

const curvePatchShaderSource = `
const SEGMENTS: u32 = ${curveFillSegments}u;
const MAX_RESOLVE_LEVEL: f32 = ${maxPatchResolveLevel}.0;

struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

struct StepUniform {
  matrix0: vec4<f32>,
  matrix1: vec4<f32>,
  color: vec4<f32>,
  params: vec4<f32>,
  clipAtlas: vec4<f32>,
  clipAnalytic: vec4<f32>,
  clipShader: vec4<f32>,
};

@group(1) @binding(0) var<uniform> step: StepUniform;
@group(2) @binding(0) var clipMaskSampler: sampler;
@group(2) @binding(1) var clipMaskTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) devicePosition: vec2<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
}

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}

fn eval_patch(
  curveType: f32,
  weight: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  let oneMinusT = 1.0 - t;
  if (curveType < 0.5) {
    return
      (oneMinusT * oneMinusT * oneMinusT * p0) +
      (3.0 * oneMinusT * oneMinusT * t * p1) +
      (3.0 * oneMinusT * t * t * p2) +
      (t * t * t * p3);
  }
  if (curveType < 1.5) {
    return (oneMinusT * oneMinusT * p0) + (2.0 * oneMinusT * t * p1) + (t * t * p2);
  }
  if (curveType < 2.5) {
    let denom = (oneMinusT * oneMinusT) + (2.0 * weight * oneMinusT * t) + (t * t);
    return ((oneMinusT * oneMinusT * p0) + (2.0 * weight * oneMinusT * t * p1) + (t * t * p2)) / max(denom, 1e-5);
  }
  return
    (oneMinusT * oneMinusT * oneMinusT * p0) +
    (3.0 * oneMinusT * oneMinusT * t * p1) +
    (3.0 * oneMinusT * t * t * p2) +
    (t * t * t * p3);
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
  return 0.5 / acos(max(1.0 - (1.0 / ${tessellationPrecisionLiteral}) / radius, -1.0));
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) p0: vec2<f32>,
  @location(1) p1: vec2<f32>,
  @location(2) p2: vec2<f32>,
  @location(3) p3: vec2<f32>,
  @location(4) curveMeta: vec4<f32>,
) -> VertexOut {
  let triVertex = vertexIndex % 3u;
  let segmentIndex = vertexIndex / 3u;
  let activeSegments = max(1u, 1u << u32(clamp(curveMeta.z, 0.0, MAX_RESOLVE_LEVEL)));
  let t0 = f32(segmentIndex) / f32(activeSegments);
  let t1 = f32(min(segmentIndex + 1u, activeSegments)) / f32(activeSegments);
  var local: vec2<f32>;
  if (segmentIndex >= activeSegments) {
    local = p3;
  } else if (triVertex == 0u) {
    local = p0;
  } else if (triVertex == 1u) {
    local = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t0);
  } else {
    local = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t1);
  }
  let devicePosition = local_to_device(local);
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.color = step.color;
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  var clipCoverage = 1.0;
  if (step.params.y > 0.5) {
    let uv = (in.devicePosition - step.clipAtlas.xy) * step.clipAtlas.zw;
    clipCoverage *= textureSample(clipMaskTexture, clipMaskSampler, uv).a;
  }
  if (step.params.z > 0.5) {
    let local = in.devicePosition - step.clipAnalytic.xy;
    let inside = local.x >= 0.0 && local.y >= 0.0 &&
      local.x <= step.clipAnalytic.z && local.y <= step.clipAnalytic.w;
    clipCoverage *= select(0.0, 1.0, inside);
  }
  var color = in.color;
  if (step.params.w > 0.5) {
    color *= step.clipShader;
  }
  color.a *= clipCoverage;
  return color;
}
`;

const strokePatchShaderSource = `
const SEGMENTS: u32 = ${strokePatchSegments}u;
const MAX_RESOLVE_LEVEL: f32 = ${maxPatchResolveLevel}.0;

struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

struct StepUniform {
  matrix0: vec4<f32>,
  matrix1: vec4<f32>,
  color: vec4<f32>,
  params: vec4<f32>,
  clipAtlas: vec4<f32>,
  clipAnalytic: vec4<f32>,
  clipShader: vec4<f32>,
};

@group(1) @binding(0) var<uniform> step: StepUniform;
@group(2) @binding(0) var clipMaskSampler: sampler;
@group(2) @binding(1) var clipMaskTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) devicePosition: vec2<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
}

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}

fn affine_matrix() -> mat2x2<f32> {
  return mat2x2<f32>(
    vec2<f32>(step.matrix0.x, step.matrix0.y),
    vec2<f32>(step.matrix0.z, step.matrix0.w),
  );
}

fn max_scale_factor(affine: mat2x2<f32>) -> f32 {
  let c0 = vec2<f32>(affine[0].x, affine[0].y);
  let c1 = vec2<f32>(affine[1].x, affine[1].y);
  return max(length(c0), length(c1));
}

fn wangs_formula_max_fdiff_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let v1 = matrix * (p0 - (2.0 * p1) + p2);
  let v2 = matrix * (p1 - (2.0 * p2) + p3);
  return max(dot(v1, v1), dot(v2, v2));
}

fn wangs_formula_cubic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3, matrix);
  let lengthTerm = ${cubicLengthTermLiteral};
  return max(ceil(sqrt(lengthTerm * sqrt(max(m, 0.0)))), 1.0);
}

fn wangs_formula_conic_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  let tp0 = matrix * p0;
  let tp1 = matrix * p1;
  let tp2 = matrix * p2;
  let center = (min(min(tp0, tp1), tp2) + max(max(tp0, tp1), tp2)) * 0.5;
  let cp0 = tp0 - center;
  let cp1 = tp1 - center;
  let cp2 = tp2 - center;
  let maxLen = sqrt(max(max(dot(cp0, cp0), dot(cp1, cp1)), dot(cp2, cp2)));
  let dp = fma(vec2<f32>(-2.0 * w), cp1, cp0) + cp2;
  let dw = abs(fma(-2.0, w, 2.0));
  let rpMinus1 = max(0.0, fma(maxLen, ${patchPrecisionLiteral}, -1.0));
  let numer = length(dp) * ${patchPrecisionLiteral} + rpMinus1 * dw;
  let denom = 4.0 * min(w, 1.0);
  return numer / max(denom, 1e-5);
}

fn wangs_formula_conic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  return max(ceil(sqrt(max(wangs_formula_conic_p2(p0, p1, p2, w, matrix), 1.0))), 1.0);
}

fn eval_patch(
  curveType: f32,
  weight: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  let oneMinusT = 1.0 - t;
  if (curveType < 0.5) {
    return mix(p0, p1, t);
  }
  if (curveType < 1.5) {
    return (oneMinusT * oneMinusT * p0) + (2.0 * oneMinusT * t * p1) + (t * t * p2);
  }
  if (curveType < 2.5) {
    let denom = (oneMinusT * oneMinusT) + (2.0 * weight * oneMinusT * t) + (t * t);
    return ((oneMinusT * oneMinusT * p0) + (2.0 * weight * oneMinusT * t * p1) + (t * t * p2)) / max(denom, 1e-5);
  }
  return
    (oneMinusT * oneMinusT * oneMinusT * p0) +
    (3.0 * oneMinusT * oneMinusT * t * p1) +
    (3.0 * oneMinusT * t * t * p2) +
    (t * t * t * p3);
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
  return 0.5 / acos(max(1.0 - (1.0 / ${tessellationPrecisionLiteral}) / radius, -1.0));
}

fn robust_normalize_diff(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let delta = a - b;
  let deltaLength = length(delta);
  if (deltaLength <= 1e-5) {
    return vec2<f32>(0.0, 0.0);
  }
  return delta / deltaLength;
}

fn patch_start_tangent(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> vec2<f32> {
  if (distance(p0, p1) > 1e-5) {
    return robust_normalize_diff(p1, p0);
  }
  if (distance(p0, p2) > 1e-5) {
    return robust_normalize_diff(p2, p0);
  }
  return robust_normalize_diff(p3, p0);
}

fn patch_end_tangent(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> vec2<f32> {
  if (distance(p3, p2) > 1e-5) {
    return robust_normalize_diff(p3, p2);
  }
  if (distance(p3, p1) > 1e-5) {
    return robust_normalize_diff(p3, p1);
  }
  return robust_normalize_diff(p3, p0);
}

fn eval_patch_tangent(
  curveType: f32,
  weight: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  if (curveType < 0.5) {
    let oneMinusT = 1.0 - t;
    let tangent =
      (3.0 * oneMinusT * oneMinusT * (p1 - p0)) +
      (6.0 * oneMinusT * t * (p2 - p1)) +
      (3.0 * t * t * (p3 - p2));
    return robust_normalize_diff(tangent, vec2<f32>(0.0, 0.0));
  }
  if (curveType < 1.5) {
    let tangent =
      (2.0 * (1.0 - t) * (p1 - p0)) +
      (2.0 * t * (p2 - p1));
    return robust_normalize_diff(tangent, vec2<f32>(0.0, 0.0));
  }
  if (curveType < 2.5) {
    let oneMinusT = 1.0 - t;
    let numerator =
      (oneMinusT * oneMinusT * p0) +
      (2.0 * weight * oneMinusT * t * p1) +
      (t * t * p2);
    let denom = (oneMinusT * oneMinusT) + (2.0 * weight * oneMinusT * t) + (t * t);
    let numeratorDeriv =
      (-2.0 * oneMinusT * p0) +
      (2.0 * weight * (1.0 - 2.0 * t) * p1) +
      (2.0 * t * p2);
    let denomDeriv = (-2.0 * oneMinusT) + (2.0 * weight * (1.0 - 2.0 * t)) + (2.0 * t);
    let safeDenom = max(denom, 1e-5);
    let tangent = ((numeratorDeriv * safeDenom) - (numerator * denomDeriv)) / (safeDenom * safeDenom);
    return robust_normalize_diff(tangent, vec2<f32>(0.0, 0.0));
  }
  let oneMinusT = 1.0 - t;
  let tangent =
    (3.0 * oneMinusT * oneMinusT * (p1 - p0)) +
    (6.0 * oneMinusT * t * (p2 - p1)) +
    (3.0 * t * t * (p3 - p2));
  return robust_normalize_diff(tangent, vec2<f32>(0.0, 0.0));
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

fn restrict_join_stroke_outset(
  strokeOutset: f32,
  turn: f32,
  tan0: vec2<f32>,
  tan1: vec2<f32>,
) -> f32 {
  if (tangents_nearly_parallel(turn, tan0, tan1) && dot(tan0, tan1) >= 0.0) {
    return strokeOutset;
  }
  return select(max(strokeOutset, 0.0), min(strokeOutset, 0.0), turn < 0.0);
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) p0: vec2<f32>,
  @location(1) p1: vec2<f32>,
  @location(2) p2: vec2<f32>,
  @location(3) p3: vec2<f32>,
  @location(4) joinControlPoint: vec2<f32>,
  @location(5) stroke: vec2<f32>,
  @location(6) curveMeta: vec4<f32>,
) -> VertexOut {
  var edgeID = f32(vertexIndex >> 1u);
  if ((vertexIndex & 1u) != 0u) {
    edgeID = -edgeID;
  }
  let affine = affine_matrix();
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
  var strokeRadius = stroke.x;
  var joinType = stroke.y;
  let lastControlPoint = joinControlPoint;
  let maxScale = max_scale_factor(affine);
  var numParametricSegments: f32;
  if (weight < 0.0) {
    if (all(curveP0 == curveP1) && all(curveP2 == curveP3)) {
      numParametricSegments = 1.0;
    } else {
      numParametricSegments = wangs_formula_cubic(curveP0, curveP1, curveP2, curveP3, affine);
    }
  } else {
    if (all(curveP0 == curveP1) || all(curveP1 == curveP2)) {
      numParametricSegments = 1.0;
    } else {
      numParametricSegments = wangs_formula_conic(curveP0, curveP1, curveP2, weight, affine);
    }
  }
  let isHairline = strokeRadius == 0.0;
  let numRadialSegmentsPerRadian = num_radial_segments_per_radian(
    select(maxScale * strokeRadius, 0.5, isHairline),
  );
  if (isHairline) {
    strokeRadius = 0.5;
  }
  var prevTan = robust_normalize_diff(curveP0, lastControlPoint);
  var tan0 = robust_normalize_diff(select(select(curveP2, curveP3, all(curveP1 == curveP2)), curveP1, !all(curveP0 == curveP1)), curveP0);
  var tan1 = robust_normalize_diff(curveP3, select(select(curveP1, curveP0, all(curveP2 == curveP1)), curveP2, !all(curveP3 == curveP2)));
  if (length(tan0) <= 1e-5) {
    joinType = 0.0;
    if (weight < 0.0) {
      tan0 = vec2<f32>(1.0, 0.0);
      tan1 = vec2<f32>(-1.0, 0.0);
    } else {
      weight = -1.0;
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
  let maxEdges = f32(SEGMENTS);
  var numEdgesInJoin = stroke_join_edges(joinType, prevTan, tan0, strokeRadius);
  if (joinType < 0.0) {
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
    if (combinedEdgeID < 0.0) {
      combinedEdgeID = 0.0;
    } else if (!tangents_nearly_parallel(turn, joinTan0, joinTan1) || dot(joinTan0, joinTan1) < 0.0) {
      strokeOutset = select(max(strokeOutset, 0.0), min(strokeOutset, 0.0), turn < 0.0);
    }
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
  if (abs(edgeID) == 2.0 && joinType > 0.0) {
    strokeOutset *= miter_extent(cosTheta, joinType);
  }
  var strokeCoord: vec2<f32>;
  var curveTangent: vec2<f32>;
  if (combinedEdgeID != 0.0 && !isFinalEdge) {
        var parametricT = combinedEdgeID / numCombinedSegments;
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
              coeffB = (curveP2 - (2.0 * curveP1)) + curveP0;
              coeffC = curveP1 - curveP0;
            }
          } else {
            coeffC *= weight;
            coeffB = (0.5 * deltaP) - coeffC;
            coeffA = (weight - 1.0) * deltaP;
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
        var exp = 32.0;
        loop {
          if (exp < 1.0) {
            break;
          }
          let testParametricID = lastParametricEdgeID + exp;
          if (testParametricID <= maxParametricEdgeID) {
            var testTan = (coeffA * testParametricID) + coeffBScaled;
            testTan = (testTan * testParametricID) + coeffCScaled;
            let cosRotationAtTest = dot(normalize(testTan), joinTan0);
            let maxRotation = min((testParametricID * negAbsRadsPerSegment) + maxRotation0, 3.14159265359);
            if (cosRotationAtTest >= cos(maxRotation)) {
              lastParametricEdgeID = testParametricID;
            }
          }
          exp *= 0.5;
        }
        parametricT = lastParametricEdgeID / numParametricSegments;
        let lastRadialEdgeID = combinedEdgeID - lastParametricEdgeID;
        let angle0 = select(acos(clamp(joinTan0.x, -1.0, 1.0)), -acos(clamp(joinTan0.x, -1.0, 1.0)), joinTan0.y < 0.0);
        let radialAngle = (lastRadialEdgeID * radsPerSegment) + angle0;
        let radialTangent = vec2<f32>(cos(radialAngle), sin(radialAngle));
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
        let rootChoiceA = abs((rootQ * rootQ) + (-0.5 * rootQ * quadraticA));
        let rootChoiceB = abs((quadraticA * quadraticC) + (-0.5 * rootQ * quadraticA));
        let rootNumer = select(quadraticC, rootQ, rootChoiceA < rootChoiceB);
        let rootDenom = select(rootQ, quadraticA, rootChoiceA < rootChoiceB);
        let radialT = select(0.0, clamp(rootNumer / rootDenom, 0.0, 1.0), lastRadialEdgeID != 0.0 && rootDenom != 0.0);
        let finalT = max(parametricT, radialT);
        var tangentAtT = radialTangent;
        if (curveType < 2.5) {
          if (curveType < 1.5) {
            if (curveType < 0.5) {
              let ab = mix(curveP0, curveP1, finalT);
              let bc = mix(curveP1, curveP2, finalT);
              let cd = mix(curveP2, curveP3, finalT);
              let abc = mix(ab, bc, finalT);
              let bcd = mix(bc, cd, finalT);
              strokeCoord = mix(abc, bcd, finalT);
              if (finalT != radialT) {
                tangentAtT = robust_normalize_diff(bcd, abc);
              }
            } else {
              let ab = mix(curveP0, curveP1, finalT);
              let bc = mix(curveP1, curveP2, finalT);
              strokeCoord = mix(ab, bc, finalT);
              if (finalT != radialT) {
                tangentAtT = robust_normalize_diff(bc, ab);
              }
            }
          } else {
            let weightedCurveP1 = curveP1 * weight;
            let ab = mix(curveP0, weightedCurveP1, finalT);
            let bc = mix(weightedCurveP1, curveP2, finalT);
            let abc = mix(ab, bc, finalT);
            let u = mix(1.0, weight, finalT);
            let v = weight + 1.0 - u;
            let uv = mix(u, v, finalT);
            strokeCoord = abc / max(uv, 1e-5);
            if (finalT != radialT) {
              tangentAtT = robust_normalize_diff(bc * u, ab * v);
            }
          }
        } else {
          let ab = mix(curveP0, curveP1, finalT);
          let bc = mix(curveP1, curveP2, finalT);
          let cd = mix(curveP2, curveP3, finalT);
          let abc = mix(ab, bc, finalT);
          let bcd = mix(bc, cd, finalT);
          strokeCoord = mix(abc, bcd, finalT);
          if (finalT != radialT) {
            tangentAtT = robust_normalize_diff(bcd, abc);
          }
        }
    curveTangent = tangentAtT;
  } else {
    curveTangent = select(joinTan0, joinTan1, isFinalEdge);
    strokeCoord = select(curveP0, curveP3, isFinalEdge);
  }
  let ortho = vec2<f32>(curveTangent.y, -curveTangent.x);
  let local = strokeCoord + (ortho * strokeRadius * strokeOutset);
  let devicePosition = local_to_device(local);
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.color = step.color;
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  var clipCoverage = 1.0;
  if (step.params.y > 0.5) {
    let uv = (in.devicePosition - step.clipAtlas.xy) * step.clipAtlas.zw;
    clipCoverage *= textureSample(clipMaskTexture, clipMaskSampler, uv).a;
  }
  if (step.params.z > 0.5) {
    let local = in.devicePosition - step.clipAnalytic.xy;
    let inside = local.x >= 0.0 && local.y >= 0.0 &&
      local.x <= step.clipAnalytic.z && local.y <= step.clipAnalytic.w;
    clipCoverage *= select(0.0, 1.0, inside);
  }
  var color = in.color;
  if (step.params.w > 0.5) {
    color *= step.clipShader;
  }
  color.a *= clipCoverage;
  return color;
}
`;

const createStencilFaceState = (
  passOp: GPUStencilOperation,
  compare: GPUCompareFunction = 'always',
): GPUStencilFaceState => ({
  compare,
  failOp: 'keep',
  depthFailOp: 'keep',
  passOp,
});

const createFillStencilFaceState = (
  frontPassOp: GPUStencilOperation,
  backPassOp: GPUStencilOperation,
): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: false,
  depthCompare: 'always',
  stencilReadMask: 0xff,
  stencilWriteMask: 0xff,
  stencilFront: createStencilFaceState(frontPassOp),
  stencilBack: createStencilFaceState(backPassOp),
});

const createStencilCoverState = (): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: false,
  depthCompare: 'always',
  stencilReadMask: 0xff,
  stencilWriteMask: 0x00,
  stencilFront: createStencilFaceState('keep', 'not-equal'),
  stencilBack: createStencilFaceState('keep', 'not-equal'),
});

const createDirectDepthLessState = (): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: true,
  depthCompare: 'less',
});

const createClipCoverDepthLessState = (): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: true,
  depthCompare: 'less',
  stencilReadMask: 0xff,
  stencilWriteMask: 0x00,
  stencilFront: createStencilFaceState('keep', 'equal'),
  stencilBack: createStencilFaceState('keep', 'equal'),
});

const createPathShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-path-shader',
    code: fillPathShaderSource,
  });

const createWedgePatchShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-wedge-patch-shader',
    code: wedgePatchShaderSource,
  });

const createCurvePatchShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-curve-patch-shader',
    code: curvePatchShaderSource,
  });

const createStrokePatchShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-stroke-patch-shader',
    code: strokePatchShaderSource,
  });

const canonicalizeSamplerDescriptor = (
  descriptor: DrawingSamplerDescriptor = {},
): Required<DrawingSamplerDescriptor> => ({
  label: descriptor.label ?? '',
  magFilter: descriptor.magFilter ?? 'nearest',
  minFilter: descriptor.minFilter ?? 'nearest',
  mipmapFilter: descriptor.mipmapFilter ?? 'nearest',
  addressModeU: descriptor.addressModeU ?? 'clamp-to-edge',
  addressModeV: descriptor.addressModeV ?? 'clamp-to-edge',
  addressModeW: descriptor.addressModeW ?? 'clamp-to-edge',
});

const createSamplerCacheKey = (
  descriptor: Required<DrawingSamplerDescriptor>,
): string =>
  [
    descriptor.magFilter,
    descriptor.minFilter,
    descriptor.mipmapFilter,
    descriptor.addressModeU,
    descriptor.addressModeV,
    descriptor.addressModeW,
  ].join('|');

export const createDawnResourceProvider = (
  backend: DawnBackendContext,
  options: Readonly<{
    caps?: DawnCaps;
    resourceBudget?: number;
  }> = {},
): DawnResourceProvider => {
  const caps = options.caps;
  let viewportBindGroupLayout: GPUBindGroupLayout | null = null;
  let stepBindGroupLayout: GPUBindGroupLayout | null = null;
  let clipTextureBindGroupLayout: GPUBindGroupLayout | null = null;
  let drawingPipelineLayout: GPUPipelineLayout | null = null;
  let stencilAttachment:
    | Readonly<{
      width: number;
      height: number;
      sampleCount: number;
      texture: GPUTexture;
      view: GPUTextureView;
    }>
    | null = null;
  const samplerCache = new Map<string, GPUSampler>();
  const shaderModuleCache = new Map<string, GPUShaderModule>();
  const graphicsPipelineCache = new Map<string, GPURenderPipeline>();
  let defaultClipTextureView: GPUTextureView | null = null;

  const createVertexLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * floatsPerVertex,
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: 'float32x2',
      },
      {
        shaderLocation: 1,
        offset: floatBytes * 2,
        format: 'float32x4',
      },
    ],
  });

  const createWedgePatchLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 14,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x4' },
      { shaderLocation: 5, offset: floatBytes * 12, format: 'float32x2' },
    ],
  });

  const createCurvePatchLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 12,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x4' },
    ],
  });

  const createStrokePatchLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 16,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x2' },
      { shaderLocation: 5, offset: floatBytes * 10, format: 'float32x2' },
      { shaderLocation: 6, offset: floatBytes * 12, format: 'float32x4' },
    ],
  });

  const sampleCount = caps?.supportsSampleCount(
      backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1,
      backend.target.format,
    )
    ? backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1
    : caps?.defaultSampleCount ?? 1;

  const getViewportBindGroupLayout = (): GPUBindGroupLayout => {
    if (viewportBindGroupLayout) {
      return viewportBindGroupLayout;
    }

    viewportBindGroupLayout = backend.device.createBindGroupLayout({
      label: 'drawing-viewport-bind-group-layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: 'uniform',
        },
      }],
    });
    return viewportBindGroupLayout;
  };

  const getStepBindGroupLayout = (): GPUBindGroupLayout => {
    if (stepBindGroupLayout) {
      return stepBindGroupLayout;
    }

    stepBindGroupLayout = backend.device.createBindGroupLayout({
      label: 'drawing-step-bind-group-layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {
          type: 'uniform',
        },
      }],
    });
    return stepBindGroupLayout;
  };

  const getClipTextureBindGroupLayout = (): GPUBindGroupLayout => {
    if (clipTextureBindGroupLayout) {
      return clipTextureBindGroupLayout;
    }

    clipTextureBindGroupLayout = backend.device.createBindGroupLayout({
      label: 'drawing-clip-texture-bind-group-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {
            type: 'filtering',
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            sampleType: 'float',
            viewDimension: '2d',
            multisampled: false,
          },
        },
      ],
    });
    return clipTextureBindGroupLayout;
  };

  const getDefaultClipTextureView = (): GPUTextureView => {
    if (defaultClipTextureView) {
      return defaultClipTextureView;
    }

    const texture = backend.device.createTexture({
      label: 'drawing-default-clip-texture',
      size: {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: textureBindingUsage | renderAttachmentUsage | textureCopyDstUsage,
    });
    if (
      'writeTexture' in backend.queue &&
      typeof backend.queue.writeTexture === 'function'
    ) {
      const pixel = new Uint8Array([255, 255, 255, 255]);
      backend.queue.writeTexture(
        { texture },
        pixel,
        { bytesPerRow: 4, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
    }
    defaultClipTextureView = texture.createView();
    return defaultClipTextureView;
  };

  const getDrawingPipelineLayout = (): GPUPipelineLayout => {
    if (drawingPipelineLayout) {
      return drawingPipelineLayout;
    }

    drawingPipelineLayout = backend.device.createPipelineLayout({
      label: 'drawing-pipeline-layout',
      bindGroupLayouts: [
        getViewportBindGroupLayout(),
        getStepBindGroupLayout(),
        getClipTextureBindGroupLayout(),
      ],
    });
    return drawingPipelineLayout;
  };
  const getOrCreateShaderModule = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): GPUShaderModule => {
    const cacheKey = descriptor.shader;
    const existing = shaderModuleCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const shaderModule = descriptor.shader === 'path'
      ? createPathShaderModule(backend)
      : descriptor.shader === 'wedge-patch'
      ? createWedgePatchShaderModule(backend)
      : descriptor.shader === 'curve-patch'
      ? createCurvePatchShaderModule(backend)
      : createStrokePatchShaderModule(backend);
    shaderModuleCache.set(cacheKey, shaderModule);
    return shaderModule;
  };

  const getVertexLayout = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): GPUVertexBufferLayout =>
    descriptor.vertexLayout === 'device-vertex'
      ? createVertexLayout()
      : descriptor.vertexLayout === 'wedge-patch-instance'
      ? createWedgePatchLayout()
      : descriptor.vertexLayout === 'curve-patch-instance'
      ? createCurvePatchLayout()
      : createStrokePatchLayout();

  const getDepthStencil = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): GPUDepthStencilState | undefined =>
    descriptor.depthStencil === 'none'
      ? undefined
      : descriptor.depthStencil === 'clip-stencil-write'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFront: createStencilFaceState('replace'),
        stencilBack: createStencilFaceState('replace'),
      }
      : descriptor.depthStencil === 'clip-stencil-intersect'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFront: createStencilFaceState('replace', 'equal'),
        stencilBack: createStencilFaceState('replace', 'equal'),
      }
      : descriptor.depthStencil === 'clip-stencil-difference'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFront: createStencilFaceState('zero', 'equal'),
        stencilBack: createStencilFaceState('zero', 'equal'),
      }
      : descriptor.depthStencil === 'clip-cover'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0x00,
        stencilFront: createStencilFaceState('keep', 'equal'),
        stencilBack: createStencilFaceState('keep', 'equal'),
      }
      : descriptor.depthStencil === 'clip-cover-depth-less'
      ? createClipCoverDepthLessState()
      : descriptor.depthStencil === 'direct-depth-less'
      ? createDirectDepthLessState()
      : descriptor.depthStencil === 'fill-stencil-evenodd'
      ? createFillStencilFaceState('invert', 'invert')
      : descriptor.depthStencil === 'fill-stencil-nonzero'
      ? createFillStencilFaceState('increment-wrap', 'decrement-wrap')
      : createStencilCoverState();

  const createGraphicsPipelineCacheKey = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): string =>
    [
      descriptor.label,
      descriptor.shader,
      descriptor.vertexLayout,
      descriptor.depthStencil,
      descriptor.topology,
      descriptor.colorWriteDisabled ? '1' : '0',
      backend.target.format,
      sampleCount,
    ].join('|');

  const createGraphicsPipelineDescriptor = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): GPURenderPipelineDescriptor => ({
    label: descriptor.label,
    layout: getDrawingPipelineLayout(),
    vertex: {
      module: getOrCreateShaderModule(descriptor),
      entryPoint: 'vs_main',
      buffers: [getVertexLayout(descriptor)],
    },
    fragment: {
      module: getOrCreateShaderModule(descriptor),
      entryPoint: 'fs_main',
      targets: [{
        format: backend.target.format,
        blend: descriptor.colorWriteDisabled ? undefined : srcOverBlend,
        writeMask: descriptor.colorWriteDisabled ? noColorWrites : undefined,
      }],
    },
    primitive: {
      topology: descriptor.topology,
      cullMode: 'none',
      frontFace: descriptor.colorWriteDisabled ? 'ccw' : undefined,
    },
    multisample: {
      count: sampleCount,
    },
    depthStencil: getDepthStencil(descriptor),
  });

  const provider: DawnResourceProvider = {
    backend,
    resourceBudget: options.resourceBudget ?? Number.POSITIVE_INFINITY,
    createBuffer: (descriptor) => backend.device.createBuffer(descriptor),
    createTexture: (descriptor) => {
      const normalizedSampleCount = descriptor.sampleCount &&
          caps?.supportsSampleCount(descriptor.sampleCount, descriptor.format) === false
        ? 1
        : descriptor.sampleCount;
      const supportedUsage = caps?.getSupportedTextureUsages(descriptor.format);
      const needsTextureBinding = (descriptor.usage & textureBindingUsage) !== 0;
      const needsRenderAttachment = (descriptor.usage & renderAttachmentUsage) !== 0;
      if (supportedUsage) {
        if (needsTextureBinding && !supportedUsage.has('sample')) {
          throw new Error(`Format ${descriptor.format} does not support texture binding`);
        }
        if (needsRenderAttachment && !supportedUsage.has('render')) {
          throw new Error(`Format ${descriptor.format} does not support render attachment usage`);
        }
      }
      return backend.device.createTexture({
        ...descriptor,
        sampleCount: normalizedSampleCount,
      });
    },
    createViewportBindGroup: (buffer) =>
      backend.device.createBindGroup({
        label: 'drawing-viewport-bind-group',
        layout: getViewportBindGroupLayout(),
        entries: [{
          binding: 0,
          resource: {
            buffer,
          },
        }],
      }),
    createStepBindGroup: (buffer) =>
      backend.device.createBindGroup({
        label: 'drawing-step-bind-group',
        layout: getStepBindGroupLayout(),
        entries: [{
          binding: 0,
          resource: {
            buffer,
          },
        }],
      }),
    createClipTextureBindGroup: (textureView) =>
      backend.device.createBindGroup({
        label: 'drawing-clip-texture-bind-group',
        layout: getClipTextureBindGroupLayout(),
        entries: [
          {
            binding: 0,
            resource: provider.createSampler({
              label: 'drawing-clip-texture-sampler',
              magFilter: 'linear',
              minFilter: 'linear',
            }),
          },
          {
            binding: 1,
            resource: textureView ?? getDefaultClipTextureView(),
          },
        ],
      }),
    createGraphicsPipelineHandle: (descriptor) => ({
      key: createGraphicsPipelineCacheKey(descriptor),
      descriptor,
    }),
    resolveGraphicsPipelineHandle: (handle) => {
      const existing = graphicsPipelineCache.get(handle.key);
      if (existing) {
        return existing;
      }

      const pipeline = backend.device.createRenderPipeline(
        createGraphicsPipelineDescriptor(handle.descriptor),
      );
      graphicsPipelineCache.set(handle.key, pipeline);
      return pipeline;
    },
    createSampler: (descriptor = {}) => {
      const normalized = canonicalizeSamplerDescriptor(descriptor);
      const key = createSamplerCacheKey(normalized);
      const existing = samplerCache.get(key);
      if (existing) {
        return existing;
      }

      const sampler = backend.device.createSampler({
        ...normalized,
        label: descriptor.label,
      });
      samplerCache.set(key, sampler);
      return sampler;
    },
    findOrCreateGraphicsPipeline: (descriptor) => {
      return provider.resolveGraphicsPipelineHandle(
        provider.createGraphicsPipelineHandle(descriptor),
      );
    },
    getStencilAttachmentView: () => {
      const sampleCount = caps?.supportsSampleCount(
          backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1,
          stencilFormat,
        )
        ? backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1
        : 1;
      if (
        stencilAttachment &&
        stencilAttachment.width === backend.target.width &&
        stencilAttachment.height === backend.target.height &&
        stencilAttachment.sampleCount === sampleCount
      ) {
        return stencilAttachment.view;
      }

      const texture = backend.device.createTexture({
        label: 'drawing-stencil',
        size: {
          width: backend.target.width,
          height: backend.target.height,
          depthOrArrayLayers: 1,
        },
        format: stencilFormat,
        sampleCount,
        usage: renderAttachmentUsage,
      });
      const view = texture.createView();
      stencilAttachment = {
        width: backend.target.width,
        height: backend.target.height,
        sampleCount,
        texture,
        view,
      };
      return view;
    },
  };

  return provider;
};
