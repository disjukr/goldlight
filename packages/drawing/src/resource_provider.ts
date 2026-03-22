import type { DawnBackendContext } from './dawn_backend_context.ts';
import type { DrawingGraphicsPipelineDesc } from './draw_pass.ts';

type LegacyPipelineKey =
  | 'clip-stencil-write'
  | 'path-fill-stencil-evenodd'
  | 'path-fill-stencil-nonzero'
  | 'path-fill-patch-stencil-evenodd'
  | 'path-fill-patch-stencil-nonzero'
  | 'path-fill-curve-patch-stencil-evenodd'
  | 'path-fill-curve-patch-stencil-nonzero'
  | 'path-fill-cover'
  | 'path-fill-stencil-cover'
  | 'path-fill-patch-cover'
  | 'path-fill-curve-patch-cover'
  | 'path-fill-clip-cover'
  | 'path-fill-patch-clip-cover'
  | 'path-fill-curve-patch-clip-cover'
  | 'path-stroke-cover'
  | 'path-stroke-patch-cover'
  | 'path-stroke-clip-cover'
  | 'path-stroke-patch-clip-cover';

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

export type DawnResourceProvider = Readonly<{
  backend: DawnBackendContext;
  resourceBudget: number;
  createBuffer: (descriptor: DrawingBufferDescriptor) => GPUBuffer;
  createTexture: (descriptor: DrawingTextureDescriptor) => GPUTexture;
  createSampler: (descriptor?: DrawingSamplerDescriptor) => GPUSampler;
  createViewportBindGroup: (buffer: GPUBuffer) => GPUBindGroup;
  findOrCreateGraphicsPipeline: (descriptor: DrawingGraphicsPipelineDesc) => GPURenderPipeline;
  getPipeline: (key: LegacyPipelineKey) => GPURenderPipeline;
  getStencilAttachmentView: () => GPUTextureView;
}>;

const renderAttachmentUsage = 0x10;
const floatBytes = Float32Array.BYTES_PER_ELEMENT;
const floatsPerVertex = 6;
const stencilFormat = 'depth24plus-stencil8';
const noColorWrites = 0;
const maxPatchResolveLevel = 6;
const curveFillSegments = 1 << maxPatchResolveLevel;
const strokePatchSegments = 1 << maxPatchResolveLevel;

const fillPathShaderSource = `
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

@vertex
fn vs_main(
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>,
) -> VertexOut {
  var out: VertexOut;
  out.position = device_to_ndc(position);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
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

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
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
  @location(6) color: vec4<f32>,
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
    local = triVertex == 0u ? fanPoint : p3;
  } else if (triVertex == 0u) {
    local = fanPoint;
  } else if (triVertex == 1u) {
    local = a;
  } else {
    local = b;
  }
  var out: VertexOut;
  out.position = device_to_ndc(local);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
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

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
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
  @location(5) color: vec4<f32>,
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
  var out: VertexOut;
  out.position = device_to_ndc(local);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
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

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, 0.0, 1.0);
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
  @location(5) strokeMeta: vec2<f32>,
  @location(6) color: vec4<f32>,
) -> VertexOut {
  let quadVertex = vertexIndex % 6u;
  let segmentIndex = vertexIndex / 6u;
  let activeSegments = max(1u, 1u << u32(clamp(curveMeta.z, 0.0, MAX_RESOLVE_LEVEL)));
  let t0 = f32(segmentIndex) / f32(activeSegments);
  let t1 = f32(min(segmentIndex + 1u, activeSegments)) / f32(activeSegments);
  let a = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t0);
  let b = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t1);
  var local = p3;
  if (segmentIndex < activeSegments) {
    let delta = b - a;
    let deltaLength = max(length(delta), 1e-5);
    let normal = vec2<f32>(-delta.y / deltaLength, delta.x / deltaLength) * strokeMeta.x;
    let corners = array<vec2<f32>, 4>(a + normal, b + normal, b - normal, a - normal);
    let indices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
    local = corners[indices[quadVertex]];
  }
  var out: VertexOut;
  out.position = device_to_ndc(local);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
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

const legacyPipelineKeyByLabel: Readonly<Record<string, LegacyPipelineKey>> = {
  'drawing-clip-stencil-write': 'clip-stencil-write',
  'drawing-path-fill-stencil-evenodd': 'path-fill-stencil-evenodd',
  'drawing-path-fill-stencil-nonzero': 'path-fill-stencil-nonzero',
  'drawing-path-fill-patch-stencil-evenodd': 'path-fill-patch-stencil-evenodd',
  'drawing-path-fill-patch-stencil-nonzero': 'path-fill-patch-stencil-nonzero',
  'drawing-path-fill-curve-patch-stencil-evenodd': 'path-fill-curve-patch-stencil-evenodd',
  'drawing-path-fill-curve-patch-stencil-nonzero': 'path-fill-curve-patch-stencil-nonzero',
  'drawing-path-fill-cover': 'path-fill-cover',
  'drawing-path-fill-stencil-cover': 'path-fill-stencil-cover',
  'drawing-path-fill-patch-cover': 'path-fill-patch-cover',
  'drawing-path-fill-curve-patch-cover': 'path-fill-curve-patch-cover',
  'drawing-path-fill-clip-cover': 'path-fill-clip-cover',
  'drawing-path-fill-patch-clip-cover': 'path-fill-patch-clip-cover',
  'drawing-path-fill-curve-patch-clip-cover': 'path-fill-curve-patch-clip-cover',
  'drawing-path-stroke-cover': 'path-stroke-cover',
  'drawing-path-stroke-patch-cover': 'path-stroke-patch-cover',
  'drawing-path-stroke-clip-cover': 'path-stroke-clip-cover',
  'drawing-path-stroke-patch-clip-cover': 'path-stroke-patch-clip-cover',
};

export const createDawnResourceProvider = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnResourceProvider => {
  let clipStencilWritePipeline: GPURenderPipeline | null = null;
  let pathFillStencilEvenOddPipeline: GPURenderPipeline | null = null;
  let pathFillStencilNonZeroPipeline: GPURenderPipeline | null = null;
  let pathFillPatchStencilEvenOddPipeline: GPURenderPipeline | null = null;
  let pathFillPatchStencilNonZeroPipeline: GPURenderPipeline | null = null;
  let pathFillCurvePatchStencilEvenOddPipeline: GPURenderPipeline | null = null;
  let pathFillCurvePatchStencilNonZeroPipeline: GPURenderPipeline | null = null;
  let pathFillCoverPipeline: GPURenderPipeline | null = null;
  let pathFillStencilCoverPipeline: GPURenderPipeline | null = null;
  let pathFillPatchCoverPipeline: GPURenderPipeline | null = null;
  let pathFillCurvePatchCoverPipeline: GPURenderPipeline | null = null;
  let pathFillClipCoverPipeline: GPURenderPipeline | null = null;
  let pathFillPatchClipCoverPipeline: GPURenderPipeline | null = null;
  let pathFillCurvePatchClipCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokeCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokePatchCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokeClipCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokePatchClipCoverPipeline: GPURenderPipeline | null = null;
  let viewportBindGroupLayout: GPUBindGroupLayout | null = null;
  let viewportPipelineLayout: GPUPipelineLayout | null = null;
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
    arrayStride: floatBytes * 18,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x4' },
      { shaderLocation: 5, offset: floatBytes * 12, format: 'float32x2' },
      { shaderLocation: 6, offset: floatBytes * 14, format: 'float32x4' },
    ],
  });

  const createCurvePatchLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 16,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x4' },
      { shaderLocation: 5, offset: floatBytes * 12, format: 'float32x4' },
    ],
  });

  const createStrokePatchLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 18,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x4' },
      { shaderLocation: 5, offset: floatBytes * 12, format: 'float32x2' },
      { shaderLocation: 6, offset: floatBytes * 14, format: 'float32x4' },
    ],
  });

  const sampleCount = backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1;

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

  const getViewportPipelineLayout = (): GPUPipelineLayout => {
    if (viewportPipelineLayout) {
      return viewportPipelineLayout;
    }

    viewportPipelineLayout = backend.device.createPipelineLayout({
      label: 'drawing-viewport-pipeline-layout',
      bindGroupLayouts: [getViewportBindGroupLayout()],
    });
    return viewportPipelineLayout;
  };

  const createPathFillCoverPipeline = (): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);

    return backend.device.createRenderPipeline({
      label: 'drawing-path-fill-cover',
      layout: getViewportPipelineLayout(),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [createVertexLayout()],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: backend.target.format,
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      multisample: {
        count: sampleCount,
      },
    });
  };

  const createPathFillStencilCoverPipeline = (): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);

    return backend.device.createRenderPipeline({
      label: 'drawing-path-fill-stencil-cover',
      layout: getViewportPipelineLayout(),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [createVertexLayout()],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: backend.target.format,
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      multisample: {
        count: sampleCount,
      },
      depthStencil: createStencilCoverState(),
    });
  };

  const createClipStencilWritePipeline = (): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);
    return backend.device.createRenderPipeline({
      label: 'drawing-clip-stencil-write',
      layout: getViewportPipelineLayout(),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [createVertexLayout()],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: backend.target.format,
            writeMask: noColorWrites,
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      multisample: {
        count: sampleCount,
      },
      depthStencil: {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFront: createStencilFaceState('replace'),
        stencilBack: createStencilFaceState('replace'),
      },
    });
  };

  const createClipAwareColorPipeline = (label: string): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);
    return backend.device.createRenderPipeline({
      label,
      layout: getViewportPipelineLayout(),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [createVertexLayout()],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: backend.target.format,
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      multisample: {
        count: sampleCount,
      },
      depthStencil: {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0x00,
        stencilFront: createStencilFaceState('keep', 'equal'),
        stencilBack: createStencilFaceState('keep', 'equal'),
      },
    });
  };

  const createPathStrokeCoverPipeline = (): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);

    return backend.device.createRenderPipeline({
      label: 'drawing-path-stroke-cover',
      layout: getViewportPipelineLayout(),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [createVertexLayout()],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: backend.target.format,
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      multisample: {
        count: sampleCount,
      },
    });
  };

  const createPatchColorPipeline = (
    label: string,
    shaderModule: GPUShaderModule,
    layout: GPUVertexBufferLayout,
    depthStencil?: GPUDepthStencilState,
  ): GPURenderPipeline =>
    backend.device.createRenderPipeline({
      label,
      layout: getViewportPipelineLayout(),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [layout],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: backend.target.format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      multisample: {
        count: sampleCount,
      },
      depthStencil,
    });

  const createStencilOnlyPathPipeline = (
    label: string,
    shaderModule: GPUShaderModule,
    layout: GPUVertexBufferLayout,
    depthStencil: GPUDepthStencilState,
  ): GPURenderPipeline =>
    backend.device.createRenderPipeline({
      label,
      layout: getViewportPipelineLayout(),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [layout],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: backend.target.format,
          writeMask: noColorWrites,
        }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'ccw',
      },
      multisample: {
        count: sampleCount,
      },
      depthStencil,
    });

  const provider: DawnResourceProvider = {
    backend,
    resourceBudget: options.resourceBudget ?? Number.POSITIVE_INFINITY,
    createBuffer: (descriptor) => backend.device.createBuffer(descriptor),
    createTexture: (descriptor) => backend.device.createTexture(descriptor),
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
      const legacyKey = legacyPipelineKeyByLabel[descriptor.label];
      if (!legacyKey) {
        throw new Error(`unsupported graphics pipeline descriptor: ${descriptor.label}`);
      }
      return provider.getPipeline(legacyKey);
    },
    getPipeline: (key) => {
      switch (key) {
        case 'clip-stencil-write':
          if (clipStencilWritePipeline) {
            return clipStencilWritePipeline;
          }
          clipStencilWritePipeline = createClipStencilWritePipeline();
          return clipStencilWritePipeline;
        case 'path-fill-stencil-evenodd':
          if (pathFillStencilEvenOddPipeline) {
            return pathFillStencilEvenOddPipeline;
          }
          pathFillStencilEvenOddPipeline = createStencilOnlyPathPipeline(
            'drawing-path-fill-stencil-evenodd',
            createPathShaderModule(backend),
            createVertexLayout(),
            createFillStencilFaceState('invert', 'invert'),
          );
          return pathFillStencilEvenOddPipeline;
        case 'path-fill-stencil-nonzero':
          if (pathFillStencilNonZeroPipeline) {
            return pathFillStencilNonZeroPipeline;
          }
          pathFillStencilNonZeroPipeline = createStencilOnlyPathPipeline(
            'drawing-path-fill-stencil-nonzero',
            createPathShaderModule(backend),
            createVertexLayout(),
            createFillStencilFaceState('increment-wrap', 'decrement-wrap'),
          );
          return pathFillStencilNonZeroPipeline;
        case 'path-fill-patch-stencil-evenodd':
          if (pathFillPatchStencilEvenOddPipeline) {
            return pathFillPatchStencilEvenOddPipeline;
          }
          pathFillPatchStencilEvenOddPipeline = createStencilOnlyPathPipeline(
            'drawing-path-fill-patch-stencil-evenodd',
            createWedgePatchShaderModule(backend),
            createWedgePatchLayout(),
            createFillStencilFaceState('invert', 'invert'),
          );
          return pathFillPatchStencilEvenOddPipeline;
        case 'path-fill-patch-stencil-nonzero':
          if (pathFillPatchStencilNonZeroPipeline) {
            return pathFillPatchStencilNonZeroPipeline;
          }
          pathFillPatchStencilNonZeroPipeline = createStencilOnlyPathPipeline(
            'drawing-path-fill-patch-stencil-nonzero',
            createWedgePatchShaderModule(backend),
            createWedgePatchLayout(),
            createFillStencilFaceState('increment-wrap', 'decrement-wrap'),
          );
          return pathFillPatchStencilNonZeroPipeline;
        case 'path-fill-curve-patch-stencil-evenodd':
          if (pathFillCurvePatchStencilEvenOddPipeline) {
            return pathFillCurvePatchStencilEvenOddPipeline;
          }
          pathFillCurvePatchStencilEvenOddPipeline = createStencilOnlyPathPipeline(
            'drawing-path-fill-curve-patch-stencil-evenodd',
            createCurvePatchShaderModule(backend),
            createCurvePatchLayout(),
            createFillStencilFaceState('invert', 'invert'),
          );
          return pathFillCurvePatchStencilEvenOddPipeline;
        case 'path-fill-curve-patch-stencil-nonzero':
          if (pathFillCurvePatchStencilNonZeroPipeline) {
            return pathFillCurvePatchStencilNonZeroPipeline;
          }
          pathFillCurvePatchStencilNonZeroPipeline = createStencilOnlyPathPipeline(
            'drawing-path-fill-curve-patch-stencil-nonzero',
            createCurvePatchShaderModule(backend),
            createCurvePatchLayout(),
            createFillStencilFaceState('increment-wrap', 'decrement-wrap'),
          );
          return pathFillCurvePatchStencilNonZeroPipeline;
        case 'path-fill-cover':
          if (pathFillCoverPipeline) {
            return pathFillCoverPipeline;
          }
          pathFillCoverPipeline = createPathFillCoverPipeline();
          return pathFillCoverPipeline;
        case 'path-fill-stencil-cover':
          if (pathFillStencilCoverPipeline) {
            return pathFillStencilCoverPipeline;
          }
          pathFillStencilCoverPipeline = createPathFillStencilCoverPipeline();
          return pathFillStencilCoverPipeline;
        case 'path-fill-clip-cover':
          if (pathFillClipCoverPipeline) {
            return pathFillClipCoverPipeline;
          }
          pathFillClipCoverPipeline = createClipAwareColorPipeline('drawing-path-fill-clip-cover');
          return pathFillClipCoverPipeline;
        case 'path-fill-patch-cover':
          if (pathFillPatchCoverPipeline) {
            return pathFillPatchCoverPipeline;
          }
          pathFillPatchCoverPipeline = createPatchColorPipeline(
            'drawing-path-fill-patch-cover',
            createWedgePatchShaderModule(backend),
            createWedgePatchLayout(),
          );
          return pathFillPatchCoverPipeline;
        case 'path-fill-patch-clip-cover':
          if (pathFillPatchClipCoverPipeline) {
            return pathFillPatchClipCoverPipeline;
          }
          pathFillPatchClipCoverPipeline = createPatchColorPipeline(
            'drawing-path-fill-patch-clip-cover',
            createWedgePatchShaderModule(backend),
            createWedgePatchLayout(),
            {
              format: stencilFormat,
              depthWriteEnabled: false,
              depthCompare: 'always',
              stencilReadMask: 0xff,
              stencilWriteMask: 0x00,
              stencilFront: createStencilFaceState('keep', 'equal'),
              stencilBack: createStencilFaceState('keep', 'equal'),
            },
          );
          return pathFillPatchClipCoverPipeline;
        case 'path-fill-curve-patch-cover':
          if (pathFillCurvePatchCoverPipeline) {
            return pathFillCurvePatchCoverPipeline;
          }
          pathFillCurvePatchCoverPipeline = createPatchColorPipeline(
            'drawing-path-fill-curve-patch-cover',
            createCurvePatchShaderModule(backend),
            createCurvePatchLayout(),
          );
          return pathFillCurvePatchCoverPipeline;
        case 'path-fill-curve-patch-clip-cover':
          if (pathFillCurvePatchClipCoverPipeline) {
            return pathFillCurvePatchClipCoverPipeline;
          }
          pathFillCurvePatchClipCoverPipeline = createPatchColorPipeline(
            'drawing-path-fill-curve-patch-clip-cover',
            createCurvePatchShaderModule(backend),
            createCurvePatchLayout(),
            {
              format: stencilFormat,
              depthWriteEnabled: false,
              depthCompare: 'always',
              stencilReadMask: 0xff,
              stencilWriteMask: 0x00,
              stencilFront: createStencilFaceState('keep', 'equal'),
              stencilBack: createStencilFaceState('keep', 'equal'),
            },
          );
          return pathFillCurvePatchClipCoverPipeline;
        case 'path-stroke-cover':
          if (pathStrokeCoverPipeline) {
            return pathStrokeCoverPipeline;
          }
          pathStrokeCoverPipeline = createPathStrokeCoverPipeline();
          return pathStrokeCoverPipeline;
        case 'path-stroke-patch-cover':
          if (pathStrokePatchCoverPipeline) {
            return pathStrokePatchCoverPipeline;
          }
          pathStrokePatchCoverPipeline = createPatchColorPipeline(
            'drawing-path-stroke-patch-cover',
            createStrokePatchShaderModule(backend),
            createStrokePatchLayout(),
          );
          return pathStrokePatchCoverPipeline;
        case 'path-stroke-clip-cover':
          if (pathStrokeClipCoverPipeline) {
            return pathStrokeClipCoverPipeline;
          }
          pathStrokeClipCoverPipeline = createClipAwareColorPipeline(
            'drawing-path-stroke-clip-cover',
          );
          return pathStrokeClipCoverPipeline;
        case 'path-stroke-patch-clip-cover':
          if (pathStrokePatchClipCoverPipeline) {
            return pathStrokePatchClipCoverPipeline;
          }
          pathStrokePatchClipCoverPipeline = createPatchColorPipeline(
            'drawing-path-stroke-patch-clip-cover',
            createStrokePatchShaderModule(backend),
            createStrokePatchLayout(),
            {
              format: stencilFormat,
              depthWriteEnabled: false,
              depthCompare: 'always',
              stencilReadMask: 0xff,
              stencilWriteMask: 0x00,
              stencilFront: createStencilFaceState('keep', 'equal'),
              stencilBack: createStencilFaceState('keep', 'equal'),
            },
          );
          return pathStrokePatchClipCoverPipeline;
      }
    },
    getStencilAttachmentView: () => {
      const sampleCount = backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1;
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
