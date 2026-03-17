import type { OffscreenTarget, SurfaceTarget } from '@rieul3d/gpu';

export const createSurfaceTarget = (
  width: number,
  height: number,
  format: GPUTextureFormat = 'bgra8unorm',
): SurfaceTarget => ({
  kind: 'surface',
  width,
  height,
  format,
});

export const createBrowserSurfaceTarget = createSurfaceTarget;
export const createDenoSurfaceTarget = createSurfaceTarget;

export const createHeadlessTarget = (
  width: number,
  height: number,
  format: GPUTextureFormat = 'rgba8unorm',
  sampleCount = 1,
): OffscreenTarget => ({
  kind: 'offscreen',
  width,
  height,
  format,
  sampleCount,
});

export const createDenoTarget = createHeadlessTarget;
