import type { DawnBackendContext } from './dawn_backend_context.ts';

export type DrawingFeatureSet = ReadonlySet<string>;

export type DrawingFormatCapabilities = Readonly<{
  texturable: boolean;
  renderable: boolean;
  multisample: boolean;
  storage: boolean;
}>;

export type DrawingLimits = Readonly<{
  maxTextureDimension2D: number;
  maxColorAttachments: number;
  maxBufferSize: number;
  minUniformBufferOffsetAlignment: number;
  minStorageBufferOffsetAlignment: number;
}>;

export type DawnCaps = Readonly<{
  backend: 'graphite-dawn';
  adapterFeatures: DrawingFeatureSet;
  deviceFeatures: DrawingFeatureSet;
  limits: DrawingLimits;
  preferredCanvasFormat: GPUTextureFormat;
  supportsTimestampQuery: boolean;
  supportsStorageBuffers: boolean;
  defaultSampleCount: 1 | 4;
  maxSampleCount: 1 | 4;
  isFormatTexturable: (format: GPUTextureFormat) => boolean;
  isFormatRenderable: (format: GPUTextureFormat) => boolean;
  getFormatCapabilities: (format: GPUTextureFormat) => DrawingFormatCapabilities;
  supportsSampleCount: (sampleCount: number) => boolean;
}>;

const renderableFormats = new Set<GPUTextureFormat>([
  'bgra8unorm',
  'bgra8unorm-srgb',
  'rgba8unorm',
  'rgba8unorm-srgb',
  'rgba16float',
  'r32float',
]);

const texturableFormats = new Set<GPUTextureFormat>([
  'bgra8unorm',
  'bgra8unorm-srgb',
  'rgba8unorm',
  'rgba8unorm-srgb',
  'rgba16float',
  'r32float',
  'depth24plus',
]);

const storageFormats = new Set<GPUTextureFormat>([
  'bgra8unorm',
  'bgra8unorm-srgb',
  'rgba8unorm',
  'rgba8unorm-srgb',
  'rgba16float',
  'r32float',
]);

const readFeatureSet = (
  source: { features?: Iterable<string> } | undefined,
): DrawingFeatureSet => new Set(source?.features ? [...source.features] : []);

const readLimits = (
  source: { limits?: Record<string, number> | GPUSupportedLimits } | undefined,
): DrawingLimits => {
  const limits = source?.limits;
  const get = (key: keyof DrawingLimits, fallback: number): number => {
    const value = limits?.[key as keyof typeof limits];
    return typeof value === 'number' ? value : fallback;
  };

  return {
    maxTextureDimension2D: get('maxTextureDimension2D', 4096),
    maxColorAttachments: get('maxColorAttachments', 4),
    maxBufferSize: get('maxBufferSize', 256 * 1024 * 1024),
    minUniformBufferOffsetAlignment: get('minUniformBufferOffsetAlignment', 256),
    minStorageBufferOffsetAlignment: get('minStorageBufferOffsetAlignment', 256),
  };
};

const choosePreferredCanvasFormat = (
  backend: DawnBackendContext,
): GPUTextureFormat => backend.target.format;

const hasFeature = (features: DrawingFeatureSet, feature: string): boolean => features.has(feature);

const supportsStorageForFormat = (
  format: GPUTextureFormat,
  deviceFeatures: DrawingFeatureSet,
): boolean => {
  if (!storageFormats.has(format)) {
    return false;
  }
  if (format === 'bgra8unorm' || format === 'bgra8unorm-srgb') {
    return hasFeature(deviceFeatures, 'bgra8unorm-storage');
  }
  return true;
};

const createFormatCapabilities = (
  format: GPUTextureFormat,
  deviceFeatures: DrawingFeatureSet,
  maxSampleCount: 1 | 4,
): DrawingFormatCapabilities => ({
  texturable: texturableFormats.has(format),
  renderable: renderableFormats.has(format),
  multisample: renderableFormats.has(format) && maxSampleCount > 1,
  storage: supportsStorageForFormat(format, deviceFeatures),
});

export const createDawnCaps = (
  backend: DawnBackendContext,
): DawnCaps => {
  const adapterFeatures = readFeatureSet(backend.adapter);
  const deviceFeatures = readFeatureSet(backend.device);
  const limits = readLimits(backend.device);
  const supportsTimestampQuery = deviceFeatures.has('timestamp-query');
  const supportsStorageBuffers = limits.maxBufferSize > 0 &&
    limits.minStorageBufferOffsetAlignment > 0;
  const preferredCanvasFormat = choosePreferredCanvasFormat(backend);
  const maxSampleCount: 1 | 4 = renderableFormats.has(preferredCanvasFormat) &&
      limits.maxColorAttachments > 0
    ? 4
    : 1;
  const defaultSampleCount: 1 | 4 = backend.target.kind === 'offscreen' &&
      backend.target.sampleCount === 4 &&
      maxSampleCount === 4
    ? 4
    : 1;

  return {
    backend: 'graphite-dawn',
    adapterFeatures,
    deviceFeatures,
    limits,
    preferredCanvasFormat,
    supportsTimestampQuery,
    supportsStorageBuffers,
    defaultSampleCount,
    maxSampleCount,
    isFormatTexturable: (format) =>
      createFormatCapabilities(format, deviceFeatures, maxSampleCount).texturable,
    isFormatRenderable: (format) =>
      createFormatCapabilities(format, deviceFeatures, maxSampleCount).renderable,
    getFormatCapabilities: (format) =>
      createFormatCapabilities(format, deviceFeatures, maxSampleCount),
    supportsSampleCount: (sampleCount) => sampleCount === 1 || sampleCount === maxSampleCount,
  };
};
