import { createDawnCaps, type DawnCaps } from './caps.ts';
import { createDawnQueueManager, type DawnQueueManager } from './queue_manager.ts';
import { createDawnResourceProvider, type DawnResourceProvider } from './resource_provider.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';

export type DawnSharedContext = Readonly<{
  backend: DawnBackendContext;
  caps: DawnCaps;
  resourceProvider: DawnResourceProvider;
  queueManager: DawnQueueManager;
  hasTick: boolean;
  recorderCount: number;
  getIntrinsicBindGroupLayout: () => GPUBindGroupLayout;
  getSingleTextureSamplerBindGroupLayout: () => GPUBindGroupLayout;
  getPathPipelineLayout: () => GPUPipelineLayout;
}>;

export const createDawnSharedContext = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnSharedContext => {
  const caps = createDawnCaps(backend);
  let intrinsicBindGroupLayout: GPUBindGroupLayout | null = null;
  let singleTextureSamplerBindGroupLayout: GPUBindGroupLayout | null = null;
  let pathPipelineLayout: GPUPipelineLayout | null = null;

  const sharedContext = {
    backend,
    caps,
    resourceProvider: null as unknown as DawnResourceProvider,
    queueManager: createDawnQueueManager(backend),
    hasTick: typeof backend.tick === 'function',
    recorderCount: 0,
    getIntrinsicBindGroupLayout: (): GPUBindGroupLayout => {
      if (intrinsicBindGroupLayout) {
        return intrinsicBindGroupLayout;
      }
      intrinsicBindGroupLayout = backend.device.createBindGroupLayout({
        label: 'drawing-intrinsics-layout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: {
              type: 'uniform',
            },
          },
        ],
      });
      return intrinsicBindGroupLayout;
    },
    getSingleTextureSamplerBindGroupLayout: (): GPUBindGroupLayout => {
      if (singleTextureSamplerBindGroupLayout) {
        return singleTextureSamplerBindGroupLayout;
      }
      singleTextureSamplerBindGroupLayout = backend.device.createBindGroupLayout({
        label: 'drawing-single-texture-sampler-layout',
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
      return singleTextureSamplerBindGroupLayout;
    },
    getPathPipelineLayout: (): GPUPipelineLayout => {
      if (pathPipelineLayout) {
        return pathPipelineLayout;
      }
      pathPipelineLayout = backend.device.createPipelineLayout({
        label: 'drawing-path-pipeline-layout',
        bindGroupLayouts: [sharedContext.getIntrinsicBindGroupLayout()],
      });
      return pathPipelineLayout;
    },
  } satisfies {
    backend: DawnBackendContext;
    caps: DawnCaps;
    resourceProvider: DawnResourceProvider;
    queueManager: DawnQueueManager;
    hasTick: boolean;
    recorderCount: number;
    getIntrinsicBindGroupLayout: () => GPUBindGroupLayout;
    getSingleTextureSamplerBindGroupLayout: () => GPUBindGroupLayout;
    getPathPipelineLayout: () => GPUPipelineLayout;
  };

  sharedContext.resourceProvider = createDawnResourceProvider(sharedContext, {
    resourceBudget: options.resourceBudget,
  });
  return sharedContext;
};

export const registerDawnRecorder = (
  sharedContext: DawnSharedContext,
): number => {
  const mutable = sharedContext as {
    recorderCount: number;
  };
  mutable.recorderCount += 1;
  return mutable.recorderCount;
};
