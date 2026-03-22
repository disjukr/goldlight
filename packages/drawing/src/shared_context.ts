import { createDawnCaps, type DawnCaps } from './caps.ts';
import { createDawnQueueManager, type DawnQueueManager } from './queue_manager.ts';
import { createDawnResourceProvider, type DawnResourceProvider } from './resource_provider.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';

export type DawnSharedContext = Readonly<{
  backend: DawnBackendContext;
  caps: DawnCaps;
  resourceProvider: DawnResourceProvider;
  queueManager: DawnQueueManager;
  noopFragmentShader: GPUShaderModule;
  uniformBufferBindGroupLayout: GPUBindGroupLayout;
  singleTextureSamplerBindGroupLayout: GPUBindGroupLayout;
  hasTick: boolean;
  recorderCount: number;
}>;

const createNoopFragmentShader = (
  backend: DawnBackendContext,
): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-noop-fragment',
    code: '@fragment fn fs_main() {}',
  });

const createUniformBufferBindGroupLayout = (
  backend: DawnBackendContext,
  caps: DawnCaps,
): GPUBindGroupLayout =>
  backend.device.createBindGroupLayout({
    label: 'drawing-uniform-buffers',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {
          type: 'uniform',
          hasDynamicOffset: true,
        },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {
          type: caps.supportsStorageBuffers ? 'read-only-storage' : 'uniform',
          hasDynamicOffset: true,
        },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: caps.supportsStorageBuffers ? 'read-only-storage' : 'uniform',
          hasDynamicOffset: true,
        },
      },
    ],
  });

const createSingleTextureSamplerBindGroupLayout = (
  backend: DawnBackendContext,
): GPUBindGroupLayout =>
  backend.device.createBindGroupLayout({
    label: 'drawing-single-texture-sampler',
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

export const createDawnSharedContext = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnSharedContext => {
  const caps = createDawnCaps(backend);
  return {
    backend,
    caps,
    resourceProvider: createDawnResourceProvider(backend, {
      resourceBudget: options.resourceBudget,
    }),
    queueManager: createDawnQueueManager(backend),
    noopFragmentShader: createNoopFragmentShader(backend),
    uniformBufferBindGroupLayout: createUniformBufferBindGroupLayout(backend, caps),
    singleTextureSamplerBindGroupLayout: createSingleTextureSamplerBindGroupLayout(backend),
    hasTick: typeof backend.tick === 'function',
    recorderCount: 0,
  };
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
