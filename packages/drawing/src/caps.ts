import type { DawnBackendContext } from './dawn_backend_context.ts';

export type DrawingFeatureSet = ReadonlySet<string>;

export type DrawingTextureUsage =
  | 'sample'
  | 'render'
  | 'storage'
  | 'copySrc'
  | 'copyDst'
  | 'resolve'
  | 'msaa'
  | 'msaaRenderToSingleSampled'
  | 'transient';

export type DrawingColorTypeInfo = Readonly<{
  colorType: string;
  transferColorType: string;
  uploadable: boolean;
  renderable: boolean;
  readSwizzle?: string;
  writeSwizzle?: string;
}>;

export type DrawingFormatCapabilities = Readonly<{
  texturable: boolean;
  renderable: boolean;
  multisample: boolean;
  resolve: boolean;
  storage: boolean;
  copySrc: boolean;
  copyDst: boolean;
  transient: boolean;
  supportedSampleCounts: readonly (1 | 4)[];
  usages: ReadonlySet<DrawingTextureUsage>;
  colorTypes: readonly DrawingColorTypeInfo[];
}>;

export type DrawingLimits = Readonly<{
  maxTextureDimension2D: number;
  maxColorAttachments: number;
  maxBufferSize: number;
  minUniformBufferOffsetAlignment: number;
  minStorageBufferOffsetAlignment: number;
  maxStorageBuffersPerShaderStage: number;
  maxUniformBuffersPerShaderStage: number;
  maxInterStageShaderVariables: number;
  maxImmediateSize: number;
}>;

export type DrawingResourceBindingRequirements = Readonly<{
  backendApi: 'dawn';
  uniformBufferLayout: 'std140' | 'std140-f16';
  storageBufferLayout: 'std430' | 'std430-f16';
  separateTextureAndSamplerBinding: boolean;
  usePushConstantsForIntrinsicConstants: boolean;
  uniformsSetIndex: number;
  textureSamplerSetIndex: number;
  intrinsicBufferBinding: number;
  combinedUniformBufferBinding: number;
  gradientBufferBinding: number;
}>;

export type DrawingRuntimeCapabilities = Readonly<{
  drawBufferCanBeMapped: boolean;
  computeSupport: boolean;
  clampToBorderSupport: boolean;
  bufferMapsAreAsync: boolean;
  allowCpuSync: boolean;
  useAsyncPipelineCreation: boolean;
  allowScopedErrorChecks: boolean;
  fullCompressedUploadSizeMustAlignToBlockDims: boolean;
}>;

export type DawnCaps = Readonly<{
  backend: 'graphite-dawn';
  adapterFeatures: DrawingFeatureSet;
  deviceFeatures: DrawingFeatureSet;
  limits: DrawingLimits;
  preferredCanvasFormat: GPUTextureFormat;
  resourceBindingRequirements: DrawingResourceBindingRequirements;
  runtimeCapabilities: DrawingRuntimeCapabilities;
  supportsTimestampQuery: boolean;
  supportsCommandBufferTimestamps: boolean;
  supportsShaderF16: boolean;
  supportsStorageBuffers: boolean;
  supportsTransientAttachments: boolean;
  supportsMSAARenderToSingleSampled: boolean;
  supportsRenderPassRenderArea: boolean;
  supportsPartialLoadResolve: boolean;
  supportsLoadResolveTexture: boolean;
  differentResolveAttachmentSizeSupport: boolean;
  emulateLoadStoreResolve: boolean;
  supportsCompressedBC: boolean;
  supportsCompressedETC2: boolean;
  supportsExternalTextures: boolean;
  requiresStorageBufferWorkaround: boolean;
  requiredTransferBufferAlignment: number;
  requiredBytesPerRowAlignment: number;
  defaultSampleCount: 1 | 4;
  maxSampleCount: 1 | 4;
  getFormatCapabilities: (format: GPUTextureFormat) => DrawingFormatCapabilities;
  getSupportedTextureUsages: (format: GPUTextureFormat) => ReadonlySet<DrawingTextureUsage>;
  getSupportedSampleCounts: (format: GPUTextureFormat) => readonly (1 | 4)[];
  getColorTypeInfos: (format: GPUTextureFormat) => readonly DrawingColorTypeInfo[];
  isFormatTexturable: (format: GPUTextureFormat) => boolean;
  isFormatRenderable: (format: GPUTextureFormat) => boolean;
  isFormatStorageCompatible: (format: GPUTextureFormat) => boolean;
  canUseAsResolveTarget: (format: GPUTextureFormat) => boolean;
  supportsSampleCount: (sampleCount: number, format?: GPUTextureFormat) => boolean;
}>;

type MutableFormatCapabilities = {
  texturable: boolean;
  renderable: boolean;
  multisample: boolean;
  resolve: boolean;
  storage: boolean;
  copySrc: boolean;
  copyDst: boolean;
  transient: boolean;
  supportedSampleCounts: (1 | 4)[];
  usages: Set<DrawingTextureUsage>;
  colorTypes: DrawingColorTypeInfo[];
};

const knownFormats: readonly GPUTextureFormat[] = [
  'rgba8unorm',
  'rgba8unorm-srgb',
  'bgra8unorm',
  'bgra8unorm-srgb',
  'rgba16float',
  'r8unorm',
  'rg8unorm',
  'r16float',
  'r32float',
  'depth24plus',
  'depth24plus-stencil8',
  'bc1-rgba-unorm' as GPUTextureFormat,
  'bc1-rgba-unorm-srgb' as GPUTextureFormat,
  'etc2-rgb8unorm' as GPUTextureFormat,
  'etc2-rgb8unorm-srgb' as GPUTextureFormat,
  'etc2-rgba8unorm' as GPUTextureFormat,
  'etc2-rgba8unorm-srgb' as GPUTextureFormat,
  'external' as GPUTextureFormat,
];

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
    maxStorageBuffersPerShaderStage: get('maxStorageBuffersPerShaderStage', 0),
    maxUniformBuffersPerShaderStage: get('maxUniformBuffersPerShaderStage', 12),
    maxInterStageShaderVariables: get('maxInterStageShaderVariables', 8),
    maxImmediateSize: get('maxImmediateSize', 0),
  };
};

const choosePreferredCanvasFormat = (
  backend: DawnBackendContext,
): GPUTextureFormat => backend.target.format;

const chooseMaxSampleCount = (
  backend: DawnBackendContext,
  limits: DrawingLimits,
): 1 | 4 => {
  if (backend.target.kind === 'offscreen' && backend.target.sampleCount === 4) {
    return 4;
  }

  return limits.maxColorAttachments > 0 ? 4 : 1;
};

const freezeCapabilities = (
  capabilities: MutableFormatCapabilities,
): DrawingFormatCapabilities => ({
  ...capabilities,
  supportedSampleCounts: Object.freeze([...capabilities.supportedSampleCounts]),
  usages: new Set(capabilities.usages),
  colorTypes: Object.freeze([...capabilities.colorTypes]),
});

const createEmptyFormatCapabilities = (): MutableFormatCapabilities => ({
  texturable: false,
  renderable: false,
  multisample: false,
  resolve: false,
  storage: false,
  copySrc: false,
  copyDst: false,
  transient: false,
  supportedSampleCounts: [],
  usages: new Set<DrawingTextureUsage>(),
  colorTypes: [],
});

const addColorType = (
  capabilities: MutableFormatCapabilities,
  colorType: DrawingColorTypeInfo,
): void => {
  capabilities.colorTypes.push(colorType);
};

const finalizeFormatCapabilities = (
  _format: GPUTextureFormat,
  capabilities: MutableFormatCapabilities,
  caps: Pick<
    DawnCaps,
    | 'supportsTransientAttachments'
    | 'supportsMSAARenderToSingleSampled'
    | 'maxSampleCount'
  >,
): DrawingFormatCapabilities => {
  if (capabilities.texturable) {
    capabilities.usages.add('sample');
  }
  if (capabilities.renderable) {
    capabilities.usages.add('render');
    capabilities.supportedSampleCounts.push(1);
    if (capabilities.multisample && caps.maxSampleCount === 4) {
      capabilities.supportedSampleCounts.push(4);
      capabilities.usages.add('msaa');
    }
    if (capabilities.resolve) {
      capabilities.usages.add('resolve');
      if (caps.supportsMSAARenderToSingleSampled) {
        capabilities.usages.add('msaaRenderToSingleSampled');
      }
    }
    if (capabilities.transient && caps.supportsTransientAttachments) {
      capabilities.usages.add('transient');
    }
  }
  if (capabilities.storage) {
    capabilities.usages.add('storage');
  }
  if (capabilities.copySrc) {
    capabilities.usages.add('copySrc');
  }
  if (capabilities.copyDst) {
    capabilities.usages.add('copyDst');
  }
  if (capabilities.supportedSampleCounts.length === 0) {
    capabilities.supportedSampleCounts.push(1);
  }
  capabilities.supportedSampleCounts = capabilities.supportedSampleCounts
    .filter((count, index, counts) => counts.indexOf(count) === index)
    .sort((left, right) => left - right) as (1 | 4)[];
  return freezeCapabilities(capabilities);
};

const createFormatTable = (
  backend: DawnBackendContext,
  adapterFeatures: DrawingFeatureSet,
  deviceFeatures: DrawingFeatureSet,
  limits: DrawingLimits,
  supportsStorageBuffers: boolean,
  supportsTransientAttachments: boolean,
  supportsMSAARenderToSingleSampled: boolean,
): ReadonlyMap<GPUTextureFormat, DrawingFormatCapabilities> => {
  const formatTable = new Map<GPUTextureFormat, DrawingFormatCapabilities>();
  const maxSampleCount = chooseMaxSampleCount(backend, limits);
  const bgra8Storage = adapterFeatures.has('bgra8unorm-storage');
  const textureFormatsTier1 = deviceFeatures.has('texture-formats-tier1');
  const supportsCompressedBC = deviceFeatures.has('texture-compression-bc');
  const supportsCompressedETC2 = deviceFeatures.has('texture-compression-etc2');
  const supportsExternalTextures = deviceFeatures.has('external-texture');

  const finalize = (
    format: GPUTextureFormat,
    capabilities: MutableFormatCapabilities,
  ): void => {
    formatTable.set(
      format,
      finalizeFormatCapabilities(format, capabilities, {
        supportsTransientAttachments,
        supportsMSAARenderToSingleSampled,
        maxSampleCount,
      }),
    );
  };

  for (const format of knownFormats) {
    finalize(format, createEmptyFormatCapabilities());
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = true;
    info.storage = supportsStorageBuffers;
    info.copySrc = true;
    info.copyDst = true;
    info.transient = true;
    addColorType(info, {
      colorType: 'RGBA_8888',
      transferColorType: 'RGBA_8888',
      uploadable: true,
      renderable: true,
    });
    addColorType(info, {
      colorType: 'BGRA_8888',
      transferColorType: 'RGBA_8888',
      uploadable: true,
      renderable: true,
    });
    finalize('rgba8unorm', info);
    finalize('rgba8unorm-srgb', { ...info, colorTypes: [...info.colorTypes] });
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = true;
    info.storage = supportsStorageBuffers && bgra8Storage;
    info.copySrc = true;
    info.copyDst = true;
    info.transient = true;
    addColorType(info, {
      colorType: 'BGRA_8888',
      transferColorType: 'BGRA_8888',
      uploadable: true,
      renderable: true,
    });
    addColorType(info, {
      colorType: 'RGBA_8888',
      transferColorType: 'BGRA_8888',
      uploadable: true,
      renderable: true,
    });
    finalize('bgra8unorm', info);
    finalize('bgra8unorm-srgb', { ...info, colorTypes: [...info.colorTypes] });
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = true;
    info.storage = supportsStorageBuffers;
    info.copySrc = true;
    info.copyDst = true;
    info.transient = true;
    addColorType(info, {
      colorType: 'RGBA_F16',
      transferColorType: 'RGBA_F16',
      uploadable: true,
      renderable: true,
    });
    finalize('rgba16float', info);
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = true;
    info.storage = supportsStorageBuffers && textureFormatsTier1;
    info.copySrc = true;
    info.copyDst = true;
    info.transient = true;
    addColorType(info, {
      colorType: 'Alpha_8',
      transferColorType: 'Alpha_8',
      uploadable: true,
      renderable: true,
      readSwizzle: '000r',
      writeSwizzle: 'a000',
    });
    addColorType(info, {
      colorType: 'Gray_8',
      transferColorType: 'Gray_8',
      uploadable: true,
      renderable: false,
      readSwizzle: 'rrr1',
    });
    finalize('r8unorm', info);
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = true;
    info.storage = false;
    info.copySrc = true;
    info.copyDst = true;
    info.transient = true;
    addColorType(info, {
      colorType: 'RG_88',
      transferColorType: 'RG_88',
      uploadable: true,
      renderable: true,
    });
    finalize('rg8unorm', info);
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = true;
    info.storage = false;
    info.copySrc = true;
    info.copyDst = true;
    info.transient = true;
    addColorType(info, {
      colorType: 'A16_float',
      transferColorType: 'A16_float',
      uploadable: true,
      renderable: true,
      readSwizzle: '000r',
      writeSwizzle: 'a000',
    });
    finalize('r16float', info);
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = true;
    info.storage = supportsStorageBuffers;
    info.copySrc = true;
    info.copyDst = true;
    info.transient = true;
    addColorType(info, {
      colorType: 'R32_float',
      transferColorType: 'R32_float',
      uploadable: true,
      renderable: true,
    });
    finalize('r32float', info);
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = false;
    info.multisample = false;
    info.resolve = false;
    info.storage = false;
    info.copySrc = true;
    info.copyDst = true;
    finalize('depth24plus', info);
  }

  {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = true;
    info.multisample = true;
    info.resolve = false;
    info.storage = false;
    info.copySrc = true;
    info.copyDst = true;
    finalize('depth24plus-stencil8', info);
  }

  if (supportsCompressedBC) {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.renderable = false;
    info.multisample = false;
    info.resolve = false;
    info.storage = false;
    info.copySrc = false;
    info.copyDst = true;
    addColorType(info, {
      colorType: 'RGBA_8888',
      transferColorType: 'RGBA_8888',
      uploadable: true,
      renderable: false,
    });
    finalize('bc1-rgba-unorm' as GPUTextureFormat, info);
    finalize('bc1-rgba-unorm-srgb' as GPUTextureFormat, {
      ...info,
      colorTypes: [{
        colorType: 'SRGBA_8888',
        transferColorType: 'SRGBA_8888',
        uploadable: true,
        renderable: false,
      }],
    });
  }

  if (supportsCompressedETC2) {
    const rgbInfo = createEmptyFormatCapabilities();
    rgbInfo.texturable = true;
    rgbInfo.copyDst = true;
    addColorType(rgbInfo, {
      colorType: 'RGB_888x',
      transferColorType: 'RGB_888x',
      uploadable: true,
      renderable: false,
    });
    finalize('etc2-rgb8unorm' as GPUTextureFormat, rgbInfo);
    finalize('etc2-rgb8unorm-srgb' as GPUTextureFormat, {
      ...rgbInfo,
      colorTypes: [{
        colorType: 'SRGBA_8888',
        transferColorType: 'SRGBA_8888',
        uploadable: true,
        renderable: false,
      }],
    });

    const rgbaInfo = createEmptyFormatCapabilities();
    rgbaInfo.texturable = true;
    rgbaInfo.copyDst = true;
    addColorType(rgbaInfo, {
      colorType: 'RGBA_8888',
      transferColorType: 'RGBA_8888',
      uploadable: true,
      renderable: false,
    });
    finalize('etc2-rgba8unorm' as GPUTextureFormat, rgbaInfo);
    finalize('etc2-rgba8unorm-srgb' as GPUTextureFormat, {
      ...rgbaInfo,
      colorTypes: [{
        colorType: 'SRGBA_8888',
        transferColorType: 'SRGBA_8888',
        uploadable: true,
        renderable: false,
      }],
    });
  }

  if (supportsExternalTextures) {
    const info = createEmptyFormatCapabilities();
    info.texturable = true;
    info.copySrc = false;
    info.copyDst = false;
    addColorType(info, {
      colorType: 'RGBA_8888',
      transferColorType: 'RGBA_8888',
      uploadable: false,
      renderable: false,
    });
    addColorType(info, {
      colorType: 'RGB_888x',
      transferColorType: 'RGB_888x',
      uploadable: false,
      renderable: false,
      readSwizzle: 'rgb1',
    });
    finalize('external' as GPUTextureFormat, info);
  }

  return formatTable;
};

export const createDawnCaps = (
  backend: DawnBackendContext,
): DawnCaps => {
  const adapterFeatures = readFeatureSet(backend.adapter);
  const deviceFeatures = readFeatureSet(backend.device);
  const limits = readLimits(backend.device);
  const supportsTimestampQuery = deviceFeatures.has('timestamp-query');
  const supportsCommandBufferTimestamps = supportsTimestampQuery;
  const supportsShaderF16 = deviceFeatures.has('shader-f16');
  const supportsTransientAttachments = deviceFeatures.has('transient-attachments');
  const supportsMSAARenderToSingleSampled = deviceFeatures.has('msaa-render-to-single-sampled');
  const supportsLoadResolveTexture = deviceFeatures.has('dawn-load-resolve-texture');
  const supportsPartialLoadResolve = deviceFeatures.has('dawn-partial-load-resolve-texture');
  const supportsRenderPassRenderArea = deviceFeatures.has('render-pass-render-area');
  const supportsCompressedBC = deviceFeatures.has('texture-compression-bc');
  const supportsCompressedETC2 = deviceFeatures.has('texture-compression-etc2');
  const supportsExternalTextures = deviceFeatures.has('external-texture');
  const requiresStorageBufferWorkaround = deviceFeatures.has('disable-storage-buffers');
  const supportsStorageBuffers = !requiresStorageBufferWorkaround &&
    limits.maxStorageBuffersPerShaderStage >= 4;
  const requiredTransferBufferAlignment = 4;
  const requiredBytesPerRowAlignment = 256;
  const maxSampleCount = chooseMaxSampleCount(backend, limits);
  const defaultSampleCount: 1 | 4 =
    backend.target.kind === 'offscreen' && backend.target.sampleCount === 4 && maxSampleCount === 4
      ? 4
      : 1;
  const emulateLoadStoreResolve = !supportsPartialLoadResolve && !supportsTransientAttachments;
  const differentResolveAttachmentSizeSupport = supportsPartialLoadResolve ||
    emulateLoadStoreResolve;
  const formatTable = createFormatTable(
    backend,
    adapterFeatures,
    deviceFeatures,
    limits,
    supportsStorageBuffers,
    supportsTransientAttachments,
    supportsMSAARenderToSingleSampled,
  );
  const getFormatCapabilities = (format: GPUTextureFormat): DrawingFormatCapabilities =>
    formatTable.get(format) ?? freezeCapabilities(createEmptyFormatCapabilities());
  const resourceBindingRequirements: DrawingResourceBindingRequirements = {
    backendApi: 'dawn',
    uniformBufferLayout: supportsShaderF16 ? 'std140-f16' : 'std140',
    storageBufferLayout: supportsShaderF16 ? 'std430-f16' : 'std430',
    separateTextureAndSamplerBinding: true,
    usePushConstantsForIntrinsicConstants: limits.maxImmediateSize >= 32,
    uniformsSetIndex: 0,
    textureSamplerSetIndex: 2,
    intrinsicBufferBinding: 0,
    combinedUniformBufferBinding: 1,
    gradientBufferBinding: 2,
  };
  const runtimeCapabilities: DrawingRuntimeCapabilities = {
    drawBufferCanBeMapped: deviceFeatures.has('buffer-map-extended-usages'),
    computeSupport: true,
    clampToBorderSupport: false,
    bufferMapsAreAsync: true,
    allowCpuSync: Boolean(backend.tick),
    useAsyncPipelineCreation: Boolean(backend.tick),
    allowScopedErrorChecks: Boolean(backend.tick),
    fullCompressedUploadSizeMustAlignToBlockDims: true,
  };

  return {
    backend: 'graphite-dawn',
    adapterFeatures,
    deviceFeatures,
    limits,
    preferredCanvasFormat: choosePreferredCanvasFormat(backend),
    resourceBindingRequirements,
    runtimeCapabilities,
    supportsTimestampQuery,
    supportsCommandBufferTimestamps,
    supportsShaderF16,
    supportsStorageBuffers,
    supportsTransientAttachments,
    supportsMSAARenderToSingleSampled,
    supportsRenderPassRenderArea,
    supportsPartialLoadResolve,
    supportsLoadResolveTexture,
    differentResolveAttachmentSizeSupport,
    emulateLoadStoreResolve,
    supportsCompressedBC,
    supportsCompressedETC2,
    supportsExternalTextures,
    requiresStorageBufferWorkaround,
    requiredTransferBufferAlignment,
    requiredBytesPerRowAlignment,
    defaultSampleCount,
    maxSampleCount,
    getFormatCapabilities,
    getSupportedTextureUsages: (format) => getFormatCapabilities(format).usages,
    getSupportedSampleCounts: (format) => getFormatCapabilities(format).supportedSampleCounts,
    getColorTypeInfos: (format) => getFormatCapabilities(format).colorTypes,
    isFormatTexturable: (format) => getFormatCapabilities(format).texturable,
    isFormatRenderable: (format) => getFormatCapabilities(format).renderable,
    isFormatStorageCompatible: (format) => getFormatCapabilities(format).storage,
    canUseAsResolveTarget: (format) => getFormatCapabilities(format).resolve,
    supportsSampleCount: (sampleCount, format = backend.target.format) =>
      getFormatCapabilities(format).supportedSampleCounts.includes(sampleCount as 1 | 4),
  };
};
