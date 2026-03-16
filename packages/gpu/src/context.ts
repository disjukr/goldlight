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

export type GpuContextOptions = Readonly<{
  target: RenderTarget;
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: readonly GPUFeatureName[];
  requiredLimits?: Record<string, number>;
  gpu?: GPU;
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
