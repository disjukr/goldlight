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
  atlasIndex: number;
  atlasPosition: readonly [number, number];
}>;

export type DawnTextAtlasManager = Readonly<{
  findOrCreateEntries: (
    kind: 'bitmap' | 'sdf',
    glyphs: readonly Readonly<{ mask: DrawingTextAtlasMask }>[],
  ) =>
    | Readonly<{
      views: readonly GPUTextureView[];
      width: number;
      height: number;
      placements: readonly DrawingTextAtlasPlacement[];
    }>
    | null;
  compact: () => void;
  freeGpuResources: () => void;
}>;

type DrawingTextAtlasEntry = Readonly<{
  atlasIndex: number;
  atlasPosition: readonly [number, number];
  width: number;
  height: number;
}>;

type DrawingTextAtlasPage = {
  texture: GPUTexture | null;
  view: GPUTextureView | null;
  pixels: Uint8Array;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
};

type DrawingTextAtlasState = {
  retiredTextures: GPUTexture[];
  width: number;
  height: number;
  entries: Map<string, DrawingTextAtlasEntry>;
  pages: DrawingTextAtlasPage[];
};

const textureBindingUsage = 0x04;
const copyDstUsage = 0x02;
const atlasPadding = 1;
const initialAtlasSize = 1024;
const maxAtlasPages = 4;

const createEmptyAtlasPage = (): DrawingTextAtlasPage => ({
  texture: null,
  view: null,
  pixels: new Uint8Array(initialAtlasSize * initialAtlasSize),
  cursorX: atlasPadding,
  cursorY: atlasPadding,
  rowHeight: 0,
});

const createEmptyAtlasState = (): DrawingTextAtlasState => ({
  retiredTextures: [],
  width: initialAtlasSize,
  height: initialAtlasSize,
  entries: new Map(),
  pages: [createEmptyAtlasPage()],
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
  pageIndex: number,
  kind: 'bitmap' | 'sdf',
): void => {
  const page = state.pages[pageIndex]!;
  if (page.texture) {
    state.retiredTextures.push(page.texture);
  }
  page.texture = resourceProvider.createTexture({
    label: kind === 'bitmap' ? 'drawing-text-bitmap-atlas' : 'drawing-text-sdf-atlas',
    size: {
      width: state.width,
      height: state.height,
      depthOrArrayLayers: 1,
    },
    format: 'r8unorm',
    usage: textureBindingUsage | copyDstUsage,
  });
  page.view = page.texture.createView();
  if ('writeTexture' in backend.queue && typeof backend.queue.writeTexture === 'function') {
    backend.queue.writeTexture(
      { texture: page.texture },
      new Uint8Array(page.pixels),
      { bytesPerRow: state.width, rowsPerImage: state.height },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 },
    );
  }
};

const reservePlacement = (
  state: DrawingTextAtlasState,
  page: DrawingTextAtlasPage,
  mask: DrawingTextAtlasMask,
): readonly [number, number] | null => {
  if (mask.width <= 0 || mask.height <= 0) {
    return [0, 0];
  }
  if (page.cursorX + mask.width + atlasPadding > state.width) {
    page.cursorX = atlasPadding;
    page.cursorY += page.rowHeight + atlasPadding;
    page.rowHeight = 0;
  }
  if (page.cursorY + mask.height + atlasPadding > state.height) {
    return null;
  }
  const placement: readonly [number, number] = [page.cursorX, page.cursorY];
  page.cursorX += mask.width + atlasPadding;
  page.rowHeight = Math.max(page.rowHeight, mask.height);
  return placement;
};

const blitMaskToAtlas = (
  state: DrawingTextAtlasState,
  page: DrawingTextAtlasPage,
  placement: readonly [number, number],
  mask: DrawingTextAtlasMask,
): void => {
  for (let row = 0; row < mask.height; row += 1) {
    for (let column = 0; column < mask.width; column += 1) {
      const alpha = mask.pixels[(row * mask.stride) + column] ?? 0;
      const pixelIndex = ((placement[1] + row) * state.width) + placement[0] + column;
      page.pixels[pixelIndex] = alpha;
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
      const changedPages = new Set<number>();

      for (const glyph of glyphs) {
        const key = hashMask(glyph.mask);
        const cached = state.entries.get(key);
        if (cached) {
          placements.push({
            atlasIndex: cached.atlasIndex,
            atlasPosition: cached.atlasPosition,
          });
          continue;
        }

        let placementPageIndex = -1;
        let atlasPosition: readonly [number, number] | null = null;
        for (let pageIndex = 0; pageIndex < state.pages.length; pageIndex += 1) {
          const candidate = reservePlacement(state, state.pages[pageIndex]!, glyph.mask);
          if (candidate) {
            placementPageIndex = pageIndex;
            atlasPosition = candidate;
            break;
          }
        }
        if (placementPageIndex < 0 || !atlasPosition) {
          if (state.pages.length >= maxAtlasPages) {
            throw new Error('text atlas exceeded maximum supported pages');
          }
          const pageIndex = state.pages.length;
          state.pages.push(createEmptyAtlasPage());
          const candidate = reservePlacement(state, state.pages[pageIndex]!, glyph.mask);
          if (!candidate) {
            throw new Error('text atlas page could not fit glyph');
          }
          placementPageIndex = pageIndex;
          atlasPosition = candidate;
        }
        if (!atlasPosition) {
          throw new Error('text atlas placement failed');
        }
        const page = state.pages[placementPageIndex]!;
        blitMaskToAtlas(state, page, atlasPosition, glyph.mask);
        state.entries.set(key, {
          atlasIndex: placementPageIndex,
          atlasPosition,
          width: glyph.mask.width,
          height: glyph.mask.height,
        });
        placements.push({ atlasIndex: placementPageIndex, atlasPosition });
        changedPages.add(placementPageIndex);
      }

      for (let pageIndex = 0; pageIndex < state.pages.length; pageIndex += 1) {
        const page = state.pages[pageIndex]!;
        if (!page.texture || !page.view || changedPages.has(pageIndex)) {
          createAtlasTexture(backend, resourceProvider, state, pageIndex, kind);
        }
      }

      return {
        views: Object.freeze(state.pages.map((page) => page.view!).filter(Boolean)),
        width: state.width,
        height: state.height,
        placements: Object.freeze(placements),
      };
    },
    compact: () => {},
    freeGpuResources: () => {
      for (const state of Object.values(states)) {
        for (const page of state.pages) {
          page.texture?.destroy?.();
          page.texture = null;
          page.view = null;
          page.pixels = new Uint8Array(initialAtlasSize * initialAtlasSize);
          page.cursorX = atlasPadding;
          page.cursorY = atlasPadding;
          page.rowHeight = 0;
        }
        for (const texture of state.retiredTextures) {
          texture.destroy?.();
        }
        state.retiredTextures = [];
        state.entries.clear();
        state.width = initialAtlasSize;
        state.height = initialAtlasSize;
        state.pages = [createEmptyAtlasPage()];
      }
    },
  };
};
