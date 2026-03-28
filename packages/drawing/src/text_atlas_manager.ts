import type { DawnBackendContext } from './dawn_backend_context.ts';
import type { DawnResourceProvider } from './resource_provider.ts';

export type DrawingTextAtlasMask = Readonly<{
  cacheKey: string;
  width: number;
  height: number;
  stride: number;
  pixels: Uint8Array;
}>;

export type DrawingTextAtlasFormat = 'a8' | 'argb';

export type DrawingTextAtlasPlacement = Readonly<{
  atlasIndex: number;
  atlasPosition: readonly [number, number];
}>;

export type DawnTextAtlasManager = Readonly<{
  findOrCreateEntries: (
    format: DrawingTextAtlasFormat,
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

type DrawingTextAtlasConfig = Readonly<{
  atlasWidth: number;
  atlasHeight: number;
  plotWidth: number;
  plotHeight: number;
  maxPages: number;
  bytesPerPixel: 1 | 4;
  textureFormat: GPUTextureFormat;
}>;

type DrawingTextAtlasEntry = {
  key: string;
  mask: DrawingTextAtlasMask;
  atlasIndex: number;
  plotIndex: number;
  atlasPosition: readonly [number, number];
  width: number;
  height: number;
};

type DrawingTextAtlasPlot = {
  plotIndex: number;
  origin: readonly [number, number];
  width: number;
  height: number;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
};

type DrawingTextAtlasPage = {
  texture: GPUTexture | null;
  view: GPUTextureView | null;
  pixels: Uint8Array;
  plots: DrawingTextAtlasPlot[];
};

type DrawingTextAtlasState = {
  retiredTextures: GPUTexture[];
  config: DrawingTextAtlasConfig;
  entries: Map<string, DrawingTextAtlasEntry>;
  pages: DrawingTextAtlasPage[];
};

const textureBindingUsage = 0x04;
const copyDstUsage = 0x02;
const atlasPadding = 1;
const maxAtlasDim = 2048;
const maxAtlasPages = 4;
const minGlyphCacheTextureMaximumBytes = 1 << 18;
const defaultGlyphCacheTextureMaximumBytes = 1 << 23;
const argbAtlasDimensions: readonly (readonly [number, number])[] = [
  [256, 256],
  [512, 256],
  [512, 512],
  [1024, 512],
  [1024, 1024],
  [2048, 1024],
];

const clampTextureSize = (value: number, maxTextureSize: number): number =>
  Math.min(value, Math.min(maxTextureSize, maxAtlasDim));

const createAtlasConfig = (
  format: DrawingTextAtlasFormat,
  maxTextureSize: number,
  maxBytes: number,
): DrawingTextAtlasConfig => {
  const clampedMaxBytes = Math.max(maxBytes, minGlyphCacheTextureMaximumBytes);
  const byteIndex = Math.max(clampedMaxBytes >> 18, 1);
  const dimensionsIndex = Math.min(
    Math.max(Math.floor(Math.log2(byteIndex)), 0),
    argbAtlasDimensions.length - 1,
  );
  const argbDimensions = argbAtlasDimensions[dimensionsIndex]!;
  const argbWidth = clampTextureSize(argbDimensions[0], maxTextureSize);
  const argbHeight = clampTextureSize(argbDimensions[1], maxTextureSize);

  if (format === 'a8') {
    const atlasWidth = clampTextureSize(argbWidth * 2, maxTextureSize);
    const atlasHeight = clampTextureSize(argbHeight * 2, maxTextureSize);
    const plotWidth = atlasWidth >= 2048 ? 512 : 256;
    const plotHeight = atlasHeight >= 2048 ? 512 : 256;
    return {
      atlasWidth,
      atlasHeight,
      plotWidth,
      plotHeight,
      maxPages: maxAtlasPages,
      bytesPerPixel: 1,
      textureFormat: 'r8unorm',
    };
  }

  return {
    atlasWidth: argbWidth,
    atlasHeight: argbHeight,
    plotWidth: 256,
    plotHeight: 256,
    maxPages: maxAtlasPages,
    bytesPerPixel: 4,
    textureFormat: 'rgba8unorm',
  };
};

const createPlots = (
  config: DrawingTextAtlasConfig,
): DrawingTextAtlasPlot[] => {
  const plotsX = Math.floor(config.atlasWidth / config.plotWidth);
  const plotsY = Math.floor(config.atlasHeight / config.plotHeight);
  const plots: DrawingTextAtlasPlot[] = [];
  for (let y = plotsY - 1, row = 0; y >= 0; y -= 1, row += 1) {
    for (let x = plotsX - 1, column = 0; x >= 0; x -= 1, column += 1) {
      plots.push({
        plotIndex: (row * plotsX) + column,
        origin: [x * config.plotWidth, y * config.plotHeight],
        width: config.plotWidth,
        height: config.plotHeight,
        cursorX: atlasPadding,
        cursorY: atlasPadding,
        rowHeight: 0,
      });
    }
  }
  return plots;
};

const createPagePixels = (
  config: DrawingTextAtlasConfig,
): Uint8Array => new Uint8Array(config.atlasWidth * config.atlasHeight * config.bytesPerPixel);

const createEmptyAtlasPage = (
  config: DrawingTextAtlasConfig,
): DrawingTextAtlasPage => ({
  texture: null,
  view: null,
  pixels: createPagePixels(config),
  plots: createPlots(config),
});

const createEmptyAtlasState = (
  config: DrawingTextAtlasConfig,
): DrawingTextAtlasState => ({
  retiredTextures: [],
  config,
  entries: new Map(),
  pages: [],
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
    const rowEnd = rowStart + mask.stride;
    for (let column = rowStart; column < rowEnd; column += 1) {
      hash ^= mask.pixels[column] ?? 0;
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
  format: DrawingTextAtlasFormat,
): void => {
  const page = state.pages[pageIndex]!;
  if (page.texture) {
    state.retiredTextures.push(page.texture);
  }
  page.texture = resourceProvider.createTexture({
    label: format === 'a8' ? 'drawing-text-a8-atlas' : 'drawing-text-argb-atlas',
    size: {
      width: state.config.atlasWidth,
      height: state.config.atlasHeight,
      depthOrArrayLayers: 1,
    },
    format: state.config.textureFormat,
    usage: textureBindingUsage | copyDstUsage,
  });
  page.view = page.texture.createView();
  if ('writeTexture' in backend.queue && typeof backend.queue.writeTexture === 'function') {
    backend.queue.writeTexture(
      { texture: page.texture },
      new Uint8Array(page.pixels),
      {
        bytesPerRow: state.config.atlasWidth * state.config.bytesPerPixel,
        rowsPerImage: state.config.atlasHeight,
      },
      {
        width: state.config.atlasWidth,
        height: state.config.atlasHeight,
        depthOrArrayLayers: 1,
      },
    );
  }
};

const reservePlacementInPlot = (
  plot: DrawingTextAtlasPlot,
  mask: DrawingTextAtlasMask,
): readonly [number, number] | null => {
  if (mask.width <= 0 || mask.height <= 0) {
    return plot.origin;
  }
  if (
    mask.width > plot.width - (atlasPadding * 2) ||
    mask.height > plot.height - (atlasPadding * 2)
  ) {
    return null;
  }
  if (plot.cursorX + mask.width + atlasPadding > plot.width) {
    plot.cursorX = atlasPadding;
    plot.cursorY += plot.rowHeight + atlasPadding;
    plot.rowHeight = 0;
  }
  if (plot.cursorY + mask.height + atlasPadding > plot.height) {
    return null;
  }
  const placement: readonly [number, number] = [
    plot.origin[0] + plot.cursorX,
    plot.origin[1] + plot.cursorY,
  ];
  plot.cursorX += mask.width + atlasPadding;
  plot.rowHeight = Math.max(plot.rowHeight, mask.height);
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
      const sourceIndex = (row * mask.stride) + (column * state.config.bytesPerPixel);
      const pixelIndex =
        (((placement[1] + row) * state.config.atlasWidth) + placement[0] + column) *
        state.config.bytesPerPixel;
      for (let channel = 0; channel < state.config.bytesPerPixel; channel += 1) {
        page.pixels[pixelIndex + channel] = mask.pixels[sourceIndex + channel] ?? 0;
      }
    }
  }
};

const activateNewPage = (
  state: DrawingTextAtlasState,
): DrawingTextAtlasPage => {
  const page = createEmptyAtlasPage(state.config);
  state.pages.push(page);
  return page;
};

const reservePlacementInState = (
  state: DrawingTextAtlasState,
  mask: DrawingTextAtlasMask,
):
  | Readonly<{
    atlasIndex: number;
    plotIndex: number;
    atlasPosition: readonly [number, number];
  }>
  | null => {
  for (let pageIndex = 0; pageIndex < state.pages.length; pageIndex += 1) {
    const page = state.pages[pageIndex]!;
    for (const plot of page.plots) {
      const atlasPosition = reservePlacementInPlot(plot, mask);
      if (atlasPosition) {
        return {
          atlasIndex: pageIndex,
          plotIndex: plot.plotIndex,
          atlasPosition,
        };
      }
    }
  }

  if (state.pages.length >= state.config.maxPages) {
    return null;
  }

  const page = activateNewPage(state);
  for (const plot of page.plots) {
    const atlasPosition = reservePlacementInPlot(plot, mask);
    if (atlasPosition) {
      return {
        atlasIndex: state.pages.length - 1,
        plotIndex: plot.plotIndex,
        atlasPosition,
      };
    }
  }

  return null;
};

const recreateTextures = (
  backend: DawnBackendContext,
  resourceProvider: DawnResourceProvider,
  state: DrawingTextAtlasState,
  format: DrawingTextAtlasFormat,
): void => {
  for (let pageIndex = 0; pageIndex < state.pages.length; pageIndex += 1) {
    createAtlasTexture(backend, resourceProvider, state, pageIndex, format);
  }
};

const compactState = (
  backend: DawnBackendContext,
  resourceProvider: DawnResourceProvider,
  state: DrawingTextAtlasState,
  format: DrawingTextAtlasFormat,
): void => {
  const existingEntries = [...state.entries.values()]
    .sort((left, right) =>
      left.atlasIndex - right.atlasIndex ||
      left.plotIndex - right.plotIndex ||
      left.key.localeCompare(right.key)
    );

  for (const page of state.pages) {
    if (page.texture) {
      state.retiredTextures.push(page.texture);
    }
  }

  state.pages = [];
  state.entries.clear();

  for (const entry of existingEntries) {
    const reserved = reservePlacementInState(state, entry.mask);
    if (!reserved) {
      throw new Error('text atlas compaction failed to repack glyph');
    }
    const page = state.pages[reserved.atlasIndex]!;
    blitMaskToAtlas(state, page, reserved.atlasPosition, entry.mask);
    state.entries.set(entry.key, {
      ...entry,
      atlasIndex: reserved.atlasIndex,
      plotIndex: reserved.plotIndex,
      atlasPosition: reserved.atlasPosition,
    });
  }

  recreateTextures(backend, resourceProvider, state, format);
};

const freeState = (
  state: DrawingTextAtlasState,
): void => {
  for (const page of state.pages) {
    page.texture?.destroy?.();
    page.texture = null;
    page.view = null;
  }
  for (const texture of state.retiredTextures) {
    texture.destroy?.();
  }
  state.retiredTextures = [];
  state.entries.clear();
  state.pages = [];
};

export const createDawnTextAtlasManager = (
  backend: DawnBackendContext,
  resourceProvider: DawnResourceProvider,
  options: Readonly<{
    maxTextureSize: number;
    glyphCacheTextureMaximumBytes?: number;
  }>,
): DawnTextAtlasManager => {
  const glyphCacheTextureMaximumBytes = Number.isFinite(
      options.glyphCacheTextureMaximumBytes,
    )
    ? Math.max(
      Number(options.glyphCacheTextureMaximumBytes),
      minGlyphCacheTextureMaximumBytes,
    )
    : defaultGlyphCacheTextureMaximumBytes;

  const states = {
    a8: createEmptyAtlasState(
      createAtlasConfig('a8', options.maxTextureSize, glyphCacheTextureMaximumBytes),
    ),
    argb: createEmptyAtlasState(
      createAtlasConfig('argb', options.maxTextureSize, glyphCacheTextureMaximumBytes),
    ),
  } satisfies Record<DrawingTextAtlasFormat, DrawingTextAtlasState>;

  return {
    findOrCreateEntries: (format, glyphs) => {
      if (glyphs.length === 0) {
        return null;
      }

      const state = states[format];
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

        let reserved = reservePlacementInState(state, glyph.mask);
        if (!reserved) {
          compactState(backend, resourceProvider, state, format);
          reserved = reservePlacementInState(state, glyph.mask);
        }
        if (!reserved) {
          throw new Error('text atlas exceeded maximum supported pages/plots');
        }

        const page = state.pages[reserved.atlasIndex]!;
        blitMaskToAtlas(state, page, reserved.atlasPosition, glyph.mask);
        state.entries.set(key, {
          key,
          mask: glyph.mask,
          atlasIndex: reserved.atlasIndex,
          plotIndex: reserved.plotIndex,
          atlasPosition: reserved.atlasPosition,
          width: glyph.mask.width,
          height: glyph.mask.height,
        });
        placements.push({
          atlasIndex: reserved.atlasIndex,
          atlasPosition: reserved.atlasPosition,
        });
        changedPages.add(reserved.atlasIndex);
      }

      for (let pageIndex = 0; pageIndex < state.pages.length; pageIndex += 1) {
        const page = state.pages[pageIndex]!;
        if (!page.texture || !page.view || changedPages.has(pageIndex)) {
          createAtlasTexture(backend, resourceProvider, state, pageIndex, format);
        }
      }

      return {
        views: Object.freeze(state.pages.map((page) => page.view!).filter(Boolean)),
        width: state.config.atlasWidth,
        height: state.config.atlasHeight,
        placements: Object.freeze(placements),
      };
    },
    compact: () => {
      compactState(backend, resourceProvider, states.a8, 'a8');
      compactState(backend, resourceProvider, states.argb, 'argb');
    },
    freeGpuResources: () => {
      freeState(states.a8);
      freeState(states.argb);
    },
  };
};
