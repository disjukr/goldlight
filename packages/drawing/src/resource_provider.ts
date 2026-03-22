import type { DawnBackendContext } from './dawn_backend_context.ts';
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

export type DawnResourceProvider = Readonly<{
  backend: DawnBackendContext;
  resourceBudget: number;
  createBuffer: (descriptor: DrawingBufferDescriptor) => GPUBuffer;
  createTexture: (descriptor: DrawingTextureDescriptor) => GPUTexture;
  createSampler: (descriptor?: DrawingSamplerDescriptor) => GPUSampler;
  createViewportBindGroup: (buffer: GPUBuffer) => GPUBindGroup;
  findOrCreateGraphicsPipeline: (descriptor: DrawingGraphicsPipelineDesc) => GPURenderPipeline;
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

export const createDawnResourceProvider = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnResourceProvider => {
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
  const shaderModuleCache = new Map<string, GPUShaderModule>();
  const graphicsPipelineCache = new Map<string, GPURenderPipeline>();

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
    layout: getViewportPipelineLayout(),
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
      const key = createGraphicsPipelineCacheKey(descriptor);
      const existing = graphicsPipelineCache.get(key);
      if (existing) {
        return existing;
      }

      const pipeline = backend.device.createRenderPipeline(
        createGraphicsPipelineDescriptor(descriptor),
      );
      graphicsPipelineCache.set(key, pipeline);
      return pipeline;
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
