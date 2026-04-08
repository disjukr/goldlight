// @ts-nocheck
import {
  type GpuContext,
  type GpuLostInfo,
  type RenderTarget,
  requestGpuContext,
} from '@disjukr/goldlight/gpu';

export type DawnBackendTick = (
  context: DawnBackendContext,
) => void | Promise<void>;

export type DawnBackendContext = Readonly<{
  kind: 'graphite-dawn';
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;
  target: RenderTarget;
  tick?: DawnBackendTick;
  onDeviceLost?: (info: GpuLostInfo) => void | Promise<void>;
}>;

export type DawnBackendContextOptions = Readonly<{
  target: RenderTarget;
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: readonly GPUFeatureName[];
  requiredLimits?: Record<string, number>;
  gpu?: GPU;
  tick?: DawnBackendTick;
  onDeviceLost?: (info: GpuLostInfo) => void | Promise<void>;
}>;

export const createDawnBackendContext = (
  context: GpuContext,
  options: Readonly<{
    tick?: DawnBackendTick;
    onDeviceLost?: (info: GpuLostInfo) => void | Promise<void>;
  }> = {},
): DawnBackendContext => ({
  kind: 'graphite-dawn',
  adapter: context.adapter,
  device: context.device,
  queue: context.queue,
  target: context.target,
  tick: options.tick,
  onDeviceLost: options.onDeviceLost,
});

export const requestDawnBackendContext = async (
  options: DawnBackendContextOptions,
): Promise<DawnBackendContext> => {
  const context = await requestGpuContext({
    target: options.target,
    powerPreference: options.powerPreference,
    requiredFeatures: options.requiredFeatures,
    requiredLimits: options.requiredLimits,
    gpu: options.gpu,
  });

  const backendContext = createDawnBackendContext(context, {
    tick: options.tick,
    onDeviceLost: options.onDeviceLost,
  });

  void context.device.lost.then((lost) =>
    backendContext.onDeviceLost?.({
      reason: lost.reason,
      message: lost.message,
    })
  );

  return backendContext;
};

export const tickDawnBackendContext = async (
  context: DawnBackendContext,
): Promise<void> => {
  await context.tick?.(context);
};

