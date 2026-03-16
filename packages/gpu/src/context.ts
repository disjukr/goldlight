export type SurfaceTarget = Readonly<{
  kind: 'surface';
  width: number;
  height: number;
  format: GPUTextureFormat;
}>;

export type OffscreenTarget = Readonly<{
  kind: 'offscreen';
  width: number;
  height: number;
  format: GPUTextureFormat;
  sampleCount: number;
}>;

export type RenderTarget = SurfaceTarget | OffscreenTarget;

export type GpuContext = Readonly<{
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;
  target: RenderTarget;
}>;

export type SurfaceContext = Readonly<{
  kind: 'surface';
  target: SurfaceTarget;
  canvasContext: GPUCanvasContext;
}>;

export type OffscreenContext = Readonly<{
  kind: 'offscreen';
  target: OffscreenTarget;
  texture: GPUTexture;
  view: GPUTextureView;
}>;

export type RenderContextBinding = SurfaceContext | OffscreenContext;

export type OffscreenReadbackPlan = Readonly<{
  width: number;
  height: number;
  bytesPerPixel: number;
  bytesPerRow: number;
  paddedBytesPerRow: number;
  byteLength: number;
}>;

export type GpuReadbackContext = Readonly<{
  device: Pick<GPUDevice, 'createBuffer' | 'createCommandEncoder'>;
  queue: Pick<GPUQueue, 'submit'>;
}>;

export type GpuContextOptions = Readonly<{
  target: RenderTarget;
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: readonly GPUFeatureName[];
  requiredLimits?: Record<string, number>;
  gpu?: GPU;
}>;

export type GpuLostInfo = Readonly<{
  reason: GPUDeviceLostReason;
  message: string;
}>;

export const isWebGPUAvailable = (gpu: GPU | undefined = globalThis.navigator?.gpu) => Boolean(gpu);

export const requestGpuContext = async (
  options: GpuContextOptions,
): Promise<GpuContext> => {
  const gpu = options.gpu ?? globalThis.navigator?.gpu;
  if (!gpu) {
    throw new Error('WebGPU is not available in this runtime');
  }

  const adapter = await gpu.requestAdapter({
    powerPreference: options.powerPreference,
  });
  if (!adapter) {
    throw new Error('Failed to request WebGPU adapter');
  }

  const device = await adapter.requestDevice({
    requiredFeatures: options.requiredFeatures ? [...options.requiredFeatures] : undefined,
    requiredLimits: options.requiredLimits,
  });

  return {
    adapter,
    device,
    queue: device.queue,
    target: options.target,
  };
};

export const observeDeviceLoss = async (
  device: Pick<GPUDevice, 'lost'>,
  onLost?: (info: GpuLostInfo) => void | Promise<void>,
): Promise<GpuLostInfo> => {
  const lost = await device.lost;
  const info: GpuLostInfo = {
    reason: lost.reason,
    message: lost.message,
  };

  await onLost?.(info);
  return info;
};

const textureBindingUsage = 0x04;
const textureCopySrcUsage = 0x01;
const renderAttachmentUsage = 0x10;
const mapReadUsage = 0x0001;
const bufferCopyDstUsage = 0x0008;
const bytesPerRowAlignment = 256;

export const configureSurfaceContext = (
  context: Pick<GpuContext, 'device' | 'target'>,
  canvasContext: GPUCanvasContext,
): SurfaceContext => {
  if (context.target.kind !== 'surface') {
    throw new Error('surface configuration requires a surface target');
  }

  canvasContext.configure({
    device: context.device,
    format: context.target.format,
    alphaMode: 'premultiplied',
  });

  return {
    kind: 'surface',
    target: context.target,
    canvasContext,
  };
};

export const createOffscreenContext = (
  context: Pick<GpuContext, 'device' | 'target'>,
): OffscreenContext => {
  if (context.target.kind !== 'offscreen') {
    throw new Error('offscreen context requires an offscreen target');
  }

  const texture = context.device.createTexture({
    label: 'offscreen-color',
    size: {
      width: context.target.width,
      height: context.target.height,
      depthOrArrayLayers: 1,
    },
    format: context.target.format,
    sampleCount: context.target.sampleCount,
    usage: renderAttachmentUsage | textureBindingUsage | textureCopySrcUsage,
  });

  return {
    kind: 'offscreen',
    target: context.target,
    texture,
    view: texture.createView(),
  };
};

export const bindRenderTarget = (
  context: Pick<GpuContext, 'device' | 'target'>,
  binding:
    | { canvasContext: GPUCanvasContext; offscreen?: never }
    | { canvasContext?: never; offscreen: true },
): RenderContextBinding => {
  if (binding.canvasContext) {
    return configureSurfaceContext(context, binding.canvasContext);
  }

  return createOffscreenContext(context);
};

export const acquireColorAttachmentView = (binding: RenderContextBinding): GPUTextureView => {
  if (binding.kind === 'surface') {
    return binding.canvasContext.getCurrentTexture().createView();
  }

  return binding.view;
};

export const getRenderTargetSize = (target: RenderTarget): Readonly<{
  width: number;
  height: number;
}> => ({
  width: target.width,
  height: target.height,
});

export const getRenderTargetByteSize = (target: RenderTarget, bytesPerPixel = 4): number =>
  target.width * target.height * bytesPerPixel;

export const createOffscreenReadbackPlan = (
  target: OffscreenTarget,
  bytesPerPixel = 4,
): OffscreenReadbackPlan => {
  const bytesPerRow = target.width * bytesPerPixel;
  const paddedBytesPerRow = Math.ceil(bytesPerRow / bytesPerRowAlignment) * bytesPerRowAlignment;

  return {
    width: target.width,
    height: target.height,
    bytesPerPixel,
    bytesPerRow,
    paddedBytesPerRow,
    byteLength: paddedBytesPerRow * target.height,
  };
};

export const compactOffscreenReadback = (
  bytes: Uint8Array,
  plan: OffscreenReadbackPlan,
): Uint8Array => {
  if (plan.bytesPerRow === plan.paddedBytesPerRow) {
    return bytes.slice();
  }

  const compact = new Uint8Array(plan.bytesPerRow * plan.height);
  for (let row = 0; row < plan.height; row += 1) {
    const sourceStart = row * plan.paddedBytesPerRow;
    const sourceEnd = sourceStart + plan.bytesPerRow;
    compact.set(bytes.slice(sourceStart, sourceEnd), row * plan.bytesPerRow);
  }

  return compact;
};

export const copyOffscreenToReadbackBuffer = (
  context: GpuReadbackContext,
  binding: OffscreenContext,
  buffer: GPUBuffer,
  plan: OffscreenReadbackPlan,
): void => {
  const encoder = context.device.createCommandEncoder({
    label: 'offscreen-readback',
  });
  encoder.copyTextureToBuffer(
    {
      texture: binding.texture,
    },
    {
      buffer,
      bytesPerRow: plan.paddedBytesPerRow,
      rowsPerImage: plan.height,
    },
    {
      width: plan.width,
      height: plan.height,
      depthOrArrayLayers: 1,
    },
  );

  context.queue.submit([encoder.finish()]);
};

export const readOffscreenSnapshot = async (
  context: GpuReadbackContext,
  binding: RenderContextBinding,
): Promise<
  Readonly<{
    width: number;
    height: number;
    bytes: Uint8Array;
  }>
> => {
  if (binding.kind !== 'offscreen') {
    throw new Error('offscreen snapshot requires an offscreen binding');
  }

  const plan = createOffscreenReadbackPlan(binding.target);
  const buffer = context.device.createBuffer({
    label: 'offscreen-readback-buffer',
    size: plan.byteLength,
    usage: mapReadUsage | bufferCopyDstUsage,
  });

  copyOffscreenToReadbackBuffer(context, binding, buffer, plan);

  await buffer.mapAsync(1, 0, plan.byteLength);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const bytes = compactOffscreenReadback(mapped, plan);
  buffer.unmap();
  buffer.destroy();

  return {
    width: plan.width,
    height: plan.height,
    bytes,
  };
};
