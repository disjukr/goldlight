import type { Point2D, Rect } from '@rieul3d/geometry';
import type { DrawingPreparedAtlasClip, DrawingPreparedClipElement } from './clip_stack.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';
import type { DawnResourceProvider } from './resource_provider.ts';

export type DawnClipAtlasManager = Readonly<{
  findOrCreateEntry: (atlasClip: DrawingPreparedAtlasClip | undefined) => GPUTextureView | null;
  compact: () => void;
  freeGpuResources: () => void;
}>;

type DrawingClipAtlasEntry = {
  key: string;
  texture: GPUTexture;
  view: GPUTextureView;
};

const textureBindingUsage = 0x04;
const copyDstUsage = 0x02;

const pointInTriangle = (
  point: Point2D,
  a: Point2D,
  b: Point2D,
  c: Point2D,
): boolean => {
  const sign = (left: Point2D, right: Point2D, third: Point2D): number =>
    (left[0] - third[0]) * (right[1] - third[1]) - (right[0] - third[0]) * (left[1] - third[1]);
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
};

const rasterizeAtlasClip = (
  bounds: Rect,
  elements: readonly DrawingPreparedClipElement[],
): Uint8Array => {
  const width = Math.max(1, Math.ceil(bounds.size.width));
  const height = Math.max(1, Math.ceil(bounds.size.height));
  const mask = new Uint8Array(width * height * 4);
  mask.fill(255);

  const coverage = new Uint8Array(width * height);
  coverage.fill(elements[0]?.op === 'difference' ? 255 : 0);

  for (const element of elements) {
    const elementMask = new Uint8Array(width * height);
    for (let triangleIndex = 0; triangleIndex < element.triangles.length; triangleIndex += 3) {
      const a = element.triangles[triangleIndex]!;
      const b = element.triangles[triangleIndex + 1]!;
      const c = element.triangles[triangleIndex + 2]!;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) - bounds.origin[0]));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) - bounds.origin[1]));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0]) - bounds.origin[0]));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1]) - bounds.origin[1]));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const sample: Point2D = [bounds.origin[0] + x + 0.5, bounds.origin[1] + y + 0.5];
          if (pointInTriangle(sample, a, b, c)) {
            elementMask[(y * width) + x] = 255;
          }
        }
      }
    }

    for (let index = 0; index < coverage.length; index += 1) {
      coverage[index] = element.op === 'difference'
        ? coverage[index]! && !elementMask[index] ? 255 : 0
        : coverage[index]! && elementMask[index] ? 255 : coverage[index] === 0 && elements[0]?.op !== 'difference'
        ? elementMask[index]!
        : coverage[index]!;
    }
  }

  for (let index = 0; index < coverage.length; index += 1) {
    const alpha = coverage[index]!;
    const pixelOffset = index * 4;
    mask[pixelOffset] = 255;
    mask[pixelOffset + 1] = 255;
    mask[pixelOffset + 2] = 255;
    mask[pixelOffset + 3] = alpha;
  }

  return mask;
};

const createClipAtlasKey = (atlasClip: DrawingPreparedAtlasClip): string =>
  JSON.stringify({
    elements: atlasClip.elements.map((element) => ({
      op: element.op,
      triangles: element.triangles,
    })),
  });

export const createDawnClipAtlasManager = (
  backend: DawnBackendContext,
  resourceProvider: DawnResourceProvider,
): DawnClipAtlasManager => {
  const entries = new Map<string, DrawingClipAtlasEntry>();

  return {
    findOrCreateEntry: (atlasClip) => {
      if (!atlasClip) {
        return null;
      }

      const key = createClipAtlasKey(atlasClip);
      const cached = entries.get(key);
      if (cached) {
        return cached.view;
      }

      const width = Math.max(1, Math.ceil(atlasClip.bounds.size.width));
      const height = Math.max(1, Math.ceil(atlasClip.bounds.size.height));
      const texture = resourceProvider.createTexture({
        label: 'drawing-clip-atlas',
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage: textureBindingUsage | copyDstUsage,
      });

      if ('writeTexture' in backend.queue && typeof backend.queue.writeTexture === 'function') {
        backend.queue.writeTexture(
          { texture },
          Uint8Array.from(rasterizeAtlasClip(atlasClip.bounds, atlasClip.elements)),
          { bytesPerRow: width * 4, rowsPerImage: height },
          { width, height, depthOrArrayLayers: 1 },
        );
      }

      const view = texture.createView();
      entries.set(key, { key, texture, view });
      return view;
    },
    compact: () => {},
    freeGpuResources: () => {
      for (const entry of entries.values()) {
        entry.texture.destroy?.();
      }
      entries.clear();
    },
  };
};
