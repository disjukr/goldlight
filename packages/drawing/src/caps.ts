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

type MutableFormatCapabilities = {
  texturable?: boolean;
  renderable?: boolean;
  multisample?: boolean;
  storage?: boolean;
};

const defaultFormatCapabilities: DrawingFormatCapabilities = {
  texturable: false,
  renderable: false,
  multisample: false,
  storage: false,
};

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

const supportsStorageBuffers = (
  backend: DawnBackendContext,
): boolean => {
  const limits = backend.device.limits as unknown as Record<string, number> | undefined;
  const perStage = limits?.maxStorageBuffersPerShaderStage;
  const bindingSize = limits?.maxStorageBufferBindingSize;
  return typeof perStage === 'number' &&
    perStage >= 4 &&
    typeof bindingSize === 'number' &&
    bindingSize > 0;
};

const setCapabilities = (
  table: Map<GPUTextureFormat, MutableFormatCapabilities>,
  format: GPUTextureFormat,
  capabilities: MutableFormatCapabilities,
): void => {
  table.set(format, {
    ...(table.get(format) ?? {}),
    ...capabilities,
  });
};

const finalizeCapabilities = (
  capabilities: MutableFormatCapabilities | undefined,
): DrawingFormatCapabilities => ({
  texturable: capabilities?.texturable ?? false,
  renderable: capabilities?.renderable ?? false,
  multisample: capabilities?.multisample ?? false,
  storage: capabilities?.storage ?? false,
});

const createFormatCapabilityTable = (
  backend: DawnBackendContext,
  storageBuffersSupported: boolean,
): ReadonlyMap<GPUTextureFormat, DrawingFormatCapabilities> => {
  const table = new Map<GPUTextureFormat, MutableFormatCapabilities>();

  for (
    const format of [
      'r8unorm',
      'rg8unorm',
      'rgba8unorm',
      'rgba8unorm-srgb',
      'bgra8unorm',
      'bgra8unorm-srgb',
      'rgb10a2unorm',
      'r16float',
      'rg16float',
      'rgba16float',
      'r32float',
      'rg32float',
      'rgba32float',
      'depth16unorm',
      'depth24plus',
      'depth24plus-stencil8',
      'depth32float',
      'stencil8',
    ] as const
  ) {
    setCapabilities(table, format, { texturable: true });
  }

  for (
    const format of [
      'rgba8unorm',
      'rgba8unorm-srgb',
      'bgra8unorm',
      'bgra8unorm-srgb',
      'rgb10a2unorm',
      'rgba16float',
      'r32float',
      'rg32float',
      'rgba32float',
      'depth16unorm',
      'depth24plus',
      'depth24plus-stencil8',
      'depth32float',
      'stencil8',
    ] as const
  ) {
    setCapabilities(table, format, { renderable: true, multisample: true });
  }

  if (storageBuffersSupported) {
    for (
      const format of [
        'rgba8unorm',
        'rgba8unorm-srgb',
        'rgba16float',
        'r32float',
        'rg32float',
        'rgba32float',
      ] as const
    ) {
      setCapabilities(table, format, { storage: true });
    }

    const combinedFeatures = new Set<string>([
      ...readFeatureSet(backend.adapter),
      ...readFeatureSet(backend.device),
    ]);
    if (combinedFeatures.has('bgra8unorm-storage')) {
      setCapabilities(table, 'bgra8unorm', { storage: true });
      setCapabilities(table, 'bgra8unorm-srgb', { storage: true });
    }
  }

  return new Map(
    [...table.entries()].map(([format, capabilities]) => [
      format,
      finalizeCapabilities(capabilities),
    ]),
  );
};

const createMaxSampleCount = (
  limits: DrawingLimits,
  preferredCanvasFormat: GPUTextureFormat,
  formatTable: ReadonlyMap<GPUTextureFormat, DrawingFormatCapabilities>,
): 1 | 4 => {
  if (limits.maxColorAttachments < 1) {
    return 1;
  }

  const preferred = formatTable.get(preferredCanvasFormat) ?? defaultFormatCapabilities;
  return preferred.multisample ? 4 : 1;
};

export const createDawnCaps = (
  backend: DawnBackendContext,
): DawnCaps => {
  const adapterFeatures = readFeatureSet(backend.adapter);
  const deviceFeatures = readFeatureSet(backend.device);
  const limits = readLimits(backend.device);
  const preferredCanvasFormat = choosePreferredCanvasFormat(backend);
  const storageBufferSupport = supportsStorageBuffers(backend);
  const formatTable = createFormatCapabilityTable(backend, storageBufferSupport);
  const maxSampleCount = createMaxSampleCount(limits, preferredCanvasFormat, formatTable);
  const supportsTimestampQuery = deviceFeatures.has('timestamp-query');
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
    supportsStorageBuffers: storageBufferSupport,
    defaultSampleCount,
    maxSampleCount,
    isFormatTexturable: (format) =>
      (formatTable.get(format) ?? defaultFormatCapabilities).texturable,
    isFormatRenderable: (format) =>
      (formatTable.get(format) ?? defaultFormatCapabilities).renderable,
    getFormatCapabilities: (format) => formatTable.get(format) ?? defaultFormatCapabilities,
    supportsSampleCount: (sampleCount) => sampleCount === 1 || sampleCount === maxSampleCount,
  };
};
