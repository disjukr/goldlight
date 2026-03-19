export type SurfaceTarget = Readonly<{
  kind: 'surface';
  width: number;
  height: number;
  format: GPUTextureFormat;
  alphaMode?: GPUCanvasAlphaMode;
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

export type SurfaceBinding = Readonly<{
  kind: 'surface';
  device: GPUDevice;
  target: SurfaceTarget;
  canvasContext: GPUCanvasContext;
  depthTexture: GPUTexture;
  depthView: GPUTextureView;
  depthWidth: number;
  depthHeight: number;
}>;

export type OffscreenBinding = Readonly<{
  kind: 'offscreen';
  target: OffscreenTarget;
  texture: GPUTexture;
  view: GPUTextureView;
  depthTexture: GPUTexture;
  depthView: GPUTextureView;
}>;

export type RenderContextBinding = SurfaceBinding | OffscreenBinding;

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
const depthTextureFormat = 'depth24plus';

const isDroppedSurfacePresentationError = (error: unknown): error is DOMException =>
  error instanceof DOMException && error.name === 'InvalidStateError';

const createDepthTexture = (
  device: Pick<GPUDevice, 'createTexture'>,
  width: number,
  height: number,
  sampleCount = 1,
): GPUTexture =>
  device.createTexture({
    label: 'render-depth',
    size: {
      width,
      height,
      depthOrArrayLayers: 1,
    },
    format: depthTextureFormat,
    sampleCount,
    usage: renderAttachmentUsage,
  });

type MutableSurfaceBinding = {
  -readonly [Key in keyof SurfaceBinding]: SurfaceBinding[Key];
};

type MutableSurfaceTarget = {
  -readonly [Key in keyof SurfaceTarget]: SurfaceTarget[Key];
};

const syncSurfaceDepthAttachment = (
  device: Pick<GPUDevice, 'createTexture'>,
  binding: SurfaceBinding,
  colorTexture: GPUTexture,
): void => {
  const width = (colorTexture as GPUTexture & { width?: number }).width ?? binding.target.width;
  const height = (colorTexture as GPUTexture & { height?: number }).height ?? binding.target.height;

  if (width === binding.depthWidth && height === binding.depthHeight) {
    return;
  }

  const depthTexture = createDepthTexture(device, width, height);
  const mutableBinding = binding as MutableSurfaceBinding;
  mutableBinding.depthTexture = depthTexture;
  mutableBinding.depthView = depthTexture.createView();
  mutableBinding.depthWidth = width;
  mutableBinding.depthHeight = height;
};

export const createSurfaceBinding = (
  context: Pick<GpuContext, 'device' | 'target'>,
  canvasContext: GPUCanvasContext,
): SurfaceBinding => {
  if (context.target.kind !== 'surface') {
    throw new Error('surface configuration requires a surface target');
  }

  canvasContext.configure({
    device: context.device,
    format: context.target.format,
    alphaMode: context.target.alphaMode ?? 'premultiplied',
  });

  const depthTexture = createDepthTexture(
    context.device,
    context.target.width,
    context.target.height,
  );

  return {
    kind: 'surface',
    device: context.device,
    target: context.target,
    canvasContext,
    depthTexture,
    depthView: depthTexture.createView(),
    depthWidth: context.target.width,
    depthHeight: context.target.height,
  };
};

export const createOffscreenBinding = (
  context: Pick<GpuContext, 'device' | 'target'>,
): OffscreenBinding => {
  if (context.target.kind !== 'offscreen') {
    throw new Error('offscreen binding requires an offscreen target');
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
  const depthTexture = createDepthTexture(
    context.device,
    context.target.width,
    context.target.height,
    context.target.sampleCount,
  );

  return {
    kind: 'offscreen',
    target: context.target,
    texture,
    view: texture.createView(),
    depthTexture,
    depthView: depthTexture.createView(),
  };
};

export const bindRenderTarget = (
  context: Pick<GpuContext, 'device' | 'target'>,
  binding:
    | { canvasContext: GPUCanvasContext; offscreen?: never }
    | { canvasContext?: never; offscreen: true },
): RenderContextBinding => {
  if (binding.canvasContext) {
    return createSurfaceBinding(context, binding.canvasContext);
  }

  return createOffscreenBinding(context);
};

export const acquireColorAttachmentView = (
  context: Readonly<{
    device: Pick<GPUDevice, 'createTexture'>;
  }>,
  binding: RenderContextBinding,
): GPUTextureView => {
  if (binding.kind === 'surface') {
    try {
      const colorTexture = binding.canvasContext.getCurrentTexture();
      syncSurfaceDepthAttachment(context.device, binding, colorTexture);
      return colorTexture.createView();
    } catch (error) {
      if (isDroppedSurfacePresentationError(error)) {
        binding.canvasContext.configure({
          device: context.device as GPUDevice,
          format: binding.target.format,
          alphaMode: binding.target.alphaMode ?? 'premultiplied',
        });
        const colorTexture = binding.canvasContext.getCurrentTexture();
        syncSurfaceDepthAttachment(context.device, binding, colorTexture);
        return colorTexture.createView();
      }
      throw error;
    }
  }

  return binding.view;
};

export const acquireDepthAttachmentView = (binding: RenderContextBinding): GPUTextureView =>
  binding.depthView;

export const resizeSurfaceBindingTarget = (
  binding: SurfaceBinding,
  width: number,
  height: number,
): void => {
  const mutableTarget = binding.target as MutableSurfaceTarget;
  mutableTarget.width = width;
  mutableTarget.height = height;
  binding.canvasContext.configure({
    device: binding.device,
    format: binding.target.format,
    alphaMode: binding.target.alphaMode ?? 'premultiplied',
  });
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
  binding: OffscreenBinding,
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
