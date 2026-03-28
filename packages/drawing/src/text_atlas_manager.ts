import type { DawnBackendContext } from './dawn_backend_context.ts';
import type { DawnResourceProvider } from './resource_provider.ts';

export type DrawingTextAtlasMask = Readonly<{
  cacheKey: string;
  width: number;
  height: number;
  stride: number;
  pixels: Uint8Array;
}>;

export type DrawingTextAtlasPlacement = Readonly<{
  atlasPosition: readonly [number, number];
}>;

export type DawnTextAtlasManager = Readonly<{
  findOrCreateEntries: (
    kind: 'bitmap' | 'sdf',
    glyphs: readonly Readonly<{ mask: DrawingTextAtlasMask }>[],
  ) =>
    | Readonly<{
      view: GPUTextureView;
      width: number;
      height: number;
      placements: readonly DrawingTextAtlasPlacement[];
    }>
    | null;
  compact: () => void;
  freeGpuResources: () => void;
}>;

type DrawingTextAtlasEntry = Readonly<{
  atlasPosition: readonly [number, number];
  width: number;
  height: number;
}>;

type DrawingTextAtlasState = {
  texture: GPUTexture | null;
  view: GPUTextureView | null;
  retiredTextures: GPUTexture[];
  width: number;
  height: number;
  pixels: Uint8Array;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
  entries: Map<string, DrawingTextAtlasEntry>;
};

const textureBindingUsage = 0x04;
const copyDstUsage = 0x02;
const atlasPadding = 1;
const initialAtlasSize = 1024;
const maxAtlasSize = 4096;

const createEmptyAtlasState = (): DrawingTextAtlasState => ({
  texture: null,
  view: null,
  retiredTextures: [],
  width: initialAtlasSize,
  height: initialAtlasSize,
  pixels: new Uint8Array(initialAtlasSize * initialAtlasSize),
  cursorX: atlasPadding,
  cursorY: atlasPadding,
  rowHeight: 0,
  entries: new Map(),
});

const hashMask = (mask: DrawingTextAtlasMask): string => {
  if (mask.cacheKey.length > 0) {
    return mask.cacheKey;
  }
  let hash = 2166136261;
  hash ^= mask.width;
  hash = Math.imul(hash, 16777619);
  hash ^= mask.height;
  hash = Math.imul(hash, 16777619);
  hash ^= mask.stride;
  hash = Math.imul(hash, 16777619);
  for (let row = 0; row < mask.height; row += 1) {
    const rowStart = row * mask.stride;
    for (let column = 0; column < mask.width; column += 1) {
      hash ^= mask.pixels[rowStart + column] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${mask.width}x${mask.height}:${hash >>> 0}`;
};

const createAtlasTexture = (
  backend: DawnBackendContext,
  resourceProvider: DawnResourceProvider,
  state: DrawingTextAtlasState,
  kind: 'bitmap' | 'sdf',
): void => {
  if (state.texture) {
    state.retiredTextures.push(state.texture);
  }
  state.texture = resourceProvider.createTexture({
    label: kind === 'bitmap' ? 'drawing-text-bitmap-atlas' : 'drawing-text-sdf-atlas',
    size: {
      width: state.width,
      height: state.height,
      depthOrArrayLayers: 1,
    },
    format: 'r8unorm',
    usage: textureBindingUsage | copyDstUsage,
  });
  state.view = state.texture.createView();
  if ('writeTexture' in backend.queue && typeof backend.queue.writeTexture === 'function') {
    backend.queue.writeTexture(
      { texture: state.texture },
      new Uint8Array(state.pixels),
      { bytesPerRow: state.width, rowsPerImage: state.height },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 },
    );
  }
};

const growAtlas = (
  state: DrawingTextAtlasState,
  minWidth: number,
  minHeight: number,
): void => {
  let nextWidth = state.width;
  let nextHeight = state.height;
  while (nextWidth < minWidth && nextWidth < maxAtlasSize) {
    nextWidth *= 2;
  }
  while (nextHeight < minHeight && nextHeight < maxAtlasSize) {
    nextHeight *= 2;
  }
  if (nextWidth < minWidth || nextHeight < minHeight) {
    throw new Error('text atlas exceeded maximum supported size');
  }
  if (nextWidth === state.width && nextHeight === state.height) {
    return;
  }
  const nextPixels = new Uint8Array(nextWidth * nextHeight);
  for (let row = 0; row < state.height; row += 1) {
    const srcStart = row * state.width;
    const dstStart = row * nextWidth;
    nextPixels.set(state.pixels.subarray(srcStart, srcStart + state.width), dstStart);
  }
  state.width = nextWidth;
  state.height = nextHeight;
  state.pixels = nextPixels;
};

const reservePlacement = (
  state: DrawingTextAtlasState,
  mask: DrawingTextAtlasMask,
): readonly [number, number] => {
  if (mask.width <= 0 || mask.height <= 0) {
    return [0, 0];
  }
  if (state.cursorX + mask.width + atlasPadding > state.width) {
    state.cursorX = atlasPadding;
    state.cursorY += state.rowHeight + atlasPadding;
    state.rowHeight = 0;
  }
  if (state.cursorY + mask.height + atlasPadding > state.height) {
    growAtlas(
      state,
      Math.max(state.width, state.cursorX + mask.width + atlasPadding),
      Math.max(state.height, state.cursorY + mask.height + atlasPadding),
    );
  }
  const placement: readonly [number, number] = [state.cursorX, state.cursorY];
  state.cursorX += mask.width + atlasPadding;
  state.rowHeight = Math.max(state.rowHeight, mask.height);
  return placement;
};

const blitMaskToAtlas = (
  state: DrawingTextAtlasState,
  placement: readonly [number, number],
  mask: DrawingTextAtlasMask,
): void => {
  for (let row = 0; row < mask.height; row += 1) {
    for (let column = 0; column < mask.width; column += 1) {
      const alpha = mask.pixels[(row * mask.stride) + column] ?? 0;
      const pixelIndex = ((placement[1] + row) * state.width) + placement[0] + column;
      state.pixels[pixelIndex] = alpha;
    }
  }
};

export const createDawnTextAtlasManager = (
  backend: DawnBackendContext,
  resourceProvider: DawnResourceProvider,
): DawnTextAtlasManager => {
  const states = {
    bitmap: createEmptyAtlasState(),
    sdf: createEmptyAtlasState(),
  } satisfies Record<'bitmap' | 'sdf', DrawingTextAtlasState>;

  return {
    findOrCreateEntries: (kind, glyphs) => {
      if (glyphs.length === 0) {
        return null;
      }

      const state = states[kind];
      const placements: DrawingTextAtlasPlacement[] = [];
      let atlasChanged = false;

      for (const glyph of glyphs) {
        const key = hashMask(glyph.mask);
        const cached = state.entries.get(key);
        if (cached) {
          placements.push({ atlasPosition: cached.atlasPosition });
          continue;
        }

        const atlasPosition = reservePlacement(state, glyph.mask);
        blitMaskToAtlas(state, atlasPosition, glyph.mask);
        state.entries.set(key, {
          atlasPosition,
          width: glyph.mask.width,
          height: glyph.mask.height,
        });
        placements.push({ atlasPosition });
        atlasChanged = true;
      }

      if (!state.texture || !state.view || atlasChanged) {
        createAtlasTexture(backend, resourceProvider, state, kind);
      }

      return {
        view: state.view!,
        width: state.width,
        height: state.height,
        placements: Object.freeze(placements),
      };
    },
    compact: () => {},
    freeGpuResources: () => {
      for (const state of Object.values(states)) {
        state.texture?.destroy?.();
        for (const texture of state.retiredTextures) {
          texture.destroy?.();
        }
        state.texture = null;
        state.view = null;
        state.retiredTextures = [];
        state.entries.clear();
        state.cursorX = atlasPadding;
        state.cursorY = atlasPadding;
        state.rowHeight = 0;
        state.width = initialAtlasSize;
        state.height = initialAtlasSize;
        state.pixels = new Uint8Array(initialAtlasSize * initialAtlasSize);
      }
    },
  };
};
