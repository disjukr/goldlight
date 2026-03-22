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
  createGraphicsPipelineHandle: (descriptor: DrawingGraphicsPipelineDesc) => DrawingGraphicsPipelineHandle;
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
const maxPatchResolveLevel = 6;
const curveFillSegments = 1 << maxPatchResolveLevel;
const strokePatchSegments = 1 << maxPatchResolveLevel;
const stepUniformFloats = 28;
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

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) p0: vec2<f32>,
  @location(1) p1: vec2<f32>,
  @location(2) p2: vec2<f32>,
  @location(3) p3: vec2<f32>,
  @location(4) prevPoint: vec2<f32>,
  @location(5) stroke: vec2<f32>,
  @location(6) curveMeta: vec4<f32>,
) -> VertexOut {
  let quadVertex = vertexIndex % 6u;
  let segmentIndex = vertexIndex / 6u;
  let activeSegments = max(1u, 1u << u32(clamp(curveMeta.z, 0.0, MAX_RESOLVE_LEVEL)));
  let t0 = f32(segmentIndex) / f32(activeSegments);
  let t1 = f32(min(segmentIndex + 1u, activeSegments)) / f32(activeSegments);
  let curveType = curveMeta.x;
  let weight = curveMeta.y;
  let flags = u32(max(curveMeta.w, 0.0));
  var a = eval_patch(curveType, weight, p0, p1, p2, p3, t0);
  var b = eval_patch(curveType, weight, p0, p1, p2, p3, t1);
  var local = p3;
  if (segmentIndex < activeSegments) {
    var delta = b - a;
    if (length(delta) <= 1e-5) {
      delta = a - prevPoint;
    }
    let deltaLength = max(length(delta), 1e-5);
    let tangent = delta / deltaLength;
    let squareStart = (flags & 4u) != 0u;
    let squareEnd = (flags & 8u) != 0u;
    if (segmentIndex == 0u && squareStart) {
      a -= tangent * stroke.x;
    }
    if (segmentIndex + 1u == activeSegments && squareEnd) {
      b += tangent * stroke.x;
    }
    let normal = vec2<f32>(-delta.y / deltaLength, delta.x / deltaLength) * stroke.x;
    let corners = array<vec2<f32>, 4>(a + normal, b + normal, b - normal, a - normal);
    let indices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
    local = corners[indices[quadVertex]];
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
        writeMask: descriptor.colorWriteDisabled ? noColorWrites : undefined,
      }],
    },
    primitive: {
      topology: 'triangle-list',
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
      return provider.resolveGraphicsPipelineHandle(provider.createGraphicsPipelineHandle(descriptor));
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
