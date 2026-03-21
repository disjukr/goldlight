import type { DawnBackendContext } from './dawn_backend_context.ts';
import type { DrawingPipelineKey } from './draw_pass.ts';

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
  getPipeline: (key: DrawingPipelineKey) => GPURenderPipeline;
  getStencilAttachmentView: () => GPUTextureView;
}>;

const renderAttachmentUsage = 0x10;
const floatBytes = Float32Array.BYTES_PER_ELEMENT;
const floatsPerVertex = 6;
const stencilFormat = 'depth24plus-stencil8';
const noColorWrites = 0;
const curveFillSegments = 16;
const strokePatchSegments = 16;

const fillPathShaderSource = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>,
) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
}
`;

const wedgePatchShaderSource = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) fanPoint: vec2<f32>,
  @location(1) p0: vec2<f32>,
  @location(2) p1: vec2<f32>,
  @location(3) color: vec4<f32>,
) -> VertexOut {
  var local: vec2<f32>;
  switch (vertexIndex) {
    case 0u: {
      local = fanPoint;
    }
    case 1u: {
      local = p0;
    }
    default: {
      local = p1;
    }
  }
  var out: VertexOut;
  out.position = vec4<f32>(local, 0.0, 1.0);
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

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

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
  @location(4) curveMeta: vec2<f32>,
  @location(5) color: vec4<f32>,
) -> VertexOut {
  let triVertex = vertexIndex % 3u;
  let segmentIndex = vertexIndex / 3u;
  let t0 = f32(segmentIndex) / f32(SEGMENTS);
  let t1 = f32(min(segmentIndex + 1u, SEGMENTS)) / f32(SEGMENTS);
  var local: vec2<f32>;
  if (triVertex == 0u) {
    local = p0;
  } else if (triVertex == 1u) {
    local = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t0);
  } else {
    local = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t1);
  }
  var out: VertexOut;
  out.position = vec4<f32>(local, 0.0, 1.0);
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

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

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
  @location(4) curveMeta: vec2<f32>,
  @location(5) strokeMeta: vec2<f32>,
  @location(6) color: vec4<f32>,
) -> VertexOut {
  let quadVertex = vertexIndex % 6u;
  let segmentIndex = vertexIndex / 6u;
  let t0 = f32(segmentIndex) / f32(SEGMENTS);
  let t1 = f32(min(segmentIndex + 1u, SEGMENTS)) / f32(SEGMENTS);
  let a = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t0);
  let b = eval_patch(curveMeta.x, curveMeta.y, p0, p1, p2, p3, t1);
  let delta = b - a;
  let deltaLength = max(length(delta), 1e-5);
  let normal = vec2<f32>(-delta.y / deltaLength, delta.x / deltaLength) * strokeMeta.x;
  let corners = array<vec2<f32>, 4>(a + normal, b + normal, b - normal, a - normal);
  let indices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
  let local = corners[indices[quadVertex]];
  var out: VertexOut;
  out.position = vec4<f32>(local, 0.0, 1.0);
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

export const createDawnResourceProvider = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnResourceProvider => {
  let clipStencilWritePipeline: GPURenderPipeline | null = null;
  let pathFillCoverPipeline: GPURenderPipeline | null = null;
  let pathFillPatchCoverPipeline: GPURenderPipeline | null = null;
  let pathFillCurvePatchCoverPipeline: GPURenderPipeline | null = null;
  let pathFillClipCoverPipeline: GPURenderPipeline | null = null;
  let pathFillPatchClipCoverPipeline: GPURenderPipeline | null = null;
  let pathFillCurvePatchClipCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokeCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokePatchCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokeClipCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokePatchClipCoverPipeline: GPURenderPipeline | null = null;
  let stencilAttachment:
    | Readonly<{
      width: number;
      height: number;
      sampleCount: number;
      texture: GPUTexture;
      view: GPUTextureView;
    }>
    | null = null;

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
    arrayStride: floatBytes * 10,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x4' },
    ],
  });

  const createCurvePatchLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 14,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x2' },
      { shaderLocation: 5, offset: floatBytes * 10, format: 'float32x4' },
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

  const sampleCount = backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1;

  const createPathFillCoverPipeline = (): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);

    return backend.device.createRenderPipeline({
      label: 'drawing-path-fill-cover',
      layout: 'auto',
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

  const createClipStencilWritePipeline = (): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);
    return backend.device.createRenderPipeline({
      label: 'drawing-clip-stencil-write',
      layout: 'auto',
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
      layout: 'auto',
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
      layout: 'auto',
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
      layout: 'auto',
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

  return {
    backend,
    resourceBudget: options.resourceBudget ?? Number.POSITIVE_INFINITY,
    createBuffer: (descriptor) => backend.device.createBuffer(descriptor),
    createTexture: (descriptor) => backend.device.createTexture(descriptor),
    createSampler: (descriptor = {}) => backend.device.createSampler(descriptor),
    getPipeline: (key) => {
      switch (key) {
        case 'clip-stencil-write':
          if (clipStencilWritePipeline) {
            return clipStencilWritePipeline;
          }
          clipStencilWritePipeline = createClipStencilWritePipeline();
          return clipStencilWritePipeline;
        case 'path-fill-cover':
          if (pathFillCoverPipeline) {
            return pathFillCoverPipeline;
          }
          pathFillCoverPipeline = createPathFillCoverPipeline();
          return pathFillCoverPipeline;
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
          pathStrokeClipCoverPipeline = createClipAwareColorPipeline('drawing-path-stroke-clip-cover');
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
};
