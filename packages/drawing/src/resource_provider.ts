import type { PathFillRule2D } from '@rieul3d/geometry';
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

export const createDawnResourceProvider = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnResourceProvider => {
  const pathStencilPipelines = new Map<PathFillRule2D, GPURenderPipeline>();
  let clipStencilWritePipeline: GPURenderPipeline | null = null;
  let pathFillCoverPipeline: GPURenderPipeline | null = null;
  let pathFillClipCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokeCoverPipeline: GPURenderPipeline | null = null;
  let pathStrokeClipCoverPipeline: GPURenderPipeline | null = null;
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

  const sampleCount = backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1;

  const createPathStencilPipeline = (fillRule: PathFillRule2D): GPURenderPipeline => {
    const shaderModule = createPathShaderModule(backend);
    const stencilFace = fillRule === 'evenodd' ? createStencilFaceState('invert') : undefined;

    return backend.device.createRenderPipeline({
      label: `drawing-path-stencil-${fillRule}`,
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
        stencilFront: stencilFace ?? createStencilFaceState('increment-wrap'),
        stencilBack: stencilFace ?? createStencilFaceState('decrement-wrap'),
      },
    });
  };

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
      depthStencil: {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0x00,
        stencilFront: createStencilFaceState('keep', 'not-equal'),
        stencilBack: createStencilFaceState('keep', 'not-equal'),
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
        case 'path-fill-nonzero-stencil': {
          const cached = pathStencilPipelines.get('nonzero');
          if (cached) {
            return cached;
          }
          const pipeline = createPathStencilPipeline('nonzero');
          pathStencilPipelines.set('nonzero', pipeline);
          return pipeline;
        }
        case 'path-fill-evenodd-stencil': {
          const cached = pathStencilPipelines.get('evenodd');
          if (cached) {
            return cached;
          }
          const pipeline = createPathStencilPipeline('evenodd');
          pathStencilPipelines.set('evenodd', pipeline);
          return pipeline;
        }
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
        case 'path-stroke-cover':
          if (pathStrokeCoverPipeline) {
            return pathStrokeCoverPipeline;
          }
          pathStrokeCoverPipeline = createPathStrokeCoverPipeline();
          return pathStrokeCoverPipeline;
        case 'path-stroke-clip-cover':
          if (pathStrokeClipCoverPipeline) {
            return pathStrokeClipCoverPipeline;
          }
          pathStrokeClipCoverPipeline = createClipAwareColorPipeline('drawing-path-stroke-clip-cover');
          return pathStrokeClipCoverPipeline;
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
