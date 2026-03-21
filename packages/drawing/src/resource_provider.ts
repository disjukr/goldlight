import type { DawnBackendContext } from './dawn_backend_context.ts';

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
}>;

export const createDawnResourceProvider = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnResourceProvider => ({
  backend,
  resourceBudget: options.resourceBudget ?? Number.POSITIVE_INFINITY,
  createBuffer: (descriptor) => backend.device.createBuffer(descriptor),
  createTexture: (descriptor) => backend.device.createTexture(descriptor),
  createSampler: (descriptor = {}) => backend.device.createSampler(descriptor),
});
