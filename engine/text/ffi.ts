import { createRequire } from 'node:module';

import { createPath2d, type Path2d, type PathVerb2d } from '@disjukr/goldlight/geometry';

import type {
  FontMetrics,
  FontQuery,
  GlyphMask,
  GlyphSubpixelOffset,
  ShapedRun,
  ShapeTextInput,
  TextDirection,
  TextHost,
  TextHostOptions,
  TypefaceHandle,
} from './types.ts';
import { skiaDistanceFieldInset, skiaDistanceFieldRadius } from './sdf.ts';

type NativeFontMetrics = Readonly<{
  units_per_em: number;
  unitsPerEm?: number;
  ascent: number;
  descent: number;
  line_gap: number;
  lineGap?: number;
  x_height: number;
  xHeight?: number;
  cap_height: number;
  capHeight?: number;
  underline_position: number;
  underlinePosition?: number;
  underline_thickness: number;
  underlineThickness?: number;
  strikeout_position: number;
  strikeoutPosition?: number;
  strikeout_thickness: number;
  strikeoutThickness?: number;
}>;

type NativeGlyphBitmap = Readonly<{
  width: number;
  height: number;
  stride: number;
  format_code: number;
  formatCode?: number;
  offset_x: number;
  offsetX?: number;
  offset_y: number;
  offsetY?: number;
  pixels: Uint8Array;
}>;

type NativeShapedRun = Readonly<{
  glyph_count: number;
  glyphCount?: number;
  bidi_level: number;
  bidiLevel?: number;
  direction: string;
  script_tag_code: number;
  scriptTagCode?: number;
  advance_x: number;
  advanceX?: number;
  advance_y: number;
  advanceY?: number;
  utf8_range_start: number;
  utf8RangeStart?: number;
  utf8_range_end: number;
  utf8RangeEnd?: number;
  glyph_ids: readonly number[];
  glyphIds?: readonly number[];
  positions: readonly number[];
  offsets: readonly number[];
  cluster_indices: readonly number[];
  clusterIndices?: readonly number[];
}>;

type TextHostNativeModule = Readonly<{
  initTextHost: () => boolean;
  shutdownTextHost: () => void;
  listFamilies: () => readonly string[];
  matchTypeface: (family: string) => string | null | undefined;
  getFontMetrics: (typefaceHandle: string, size: number) => NativeFontMetrics | null;
  shapeText: (
    typefaceHandle: string,
    text: string,
    size: number,
    direction: number,
    language: string,
    scriptTag: number,
  ) => NativeShapedRun | null;
  getGlyphSvgPath: (
    typefaceHandle: string,
    glyphId: number,
    size: number,
  ) => string | null;
  getGlyphMask: (
    typefaceHandle: string,
    glyphId: number,
    size: number,
    subpixelX: number,
    subpixelY: number,
  ) => NativeGlyphBitmap | null;
  getGlyphSdf: (
    typefaceHandle: string,
    glyphId: number,
    size: number,
    inset: number,
    radius: number,
  ) => NativeGlyphBitmap | null;
}>;

type SharedTextHostState = {
  refCount: number;
  families?: readonly string[];
  typefaceCache: Map<string, TypefaceHandle | null>;
  glyphPathCache: Map<string, Path2d | null>;
  glyphMaskCache: Map<string, GlyphMask | null>;
  glyphSdfCache: Map<string, GlyphMask | null>;
};

const require = createRequire(import.meta.url);
const native = require('./native/index.node') as TextHostNativeModule;

const decodeScriptTag = (tag: number): string => {
  if (tag === 0) {
    return '';
  }
  return String.fromCharCode(
    (tag >>> 24) & 0xff,
    (tag >>> 16) & 0xff,
    (tag >>> 8) & 0xff,
    tag & 0xff,
  );
};

const encodeDirection = (direction: TextDirection | undefined): number => {
  switch (direction) {
    case 'rtl':
      return 2;
    case 'ltr':
    default:
      return 1;
  }
};

const encodeScriptTag = (scriptTag: string | undefined): number => {
  if (!scriptTag) {
    return 0;
  }
  const normalized = scriptTag.slice(0, 4);
  if (normalized.length !== 4) {
    throw new Error(`Script tag must be 4 characters, got "${scriptTag}"`);
  }
  return (
    (normalized.charCodeAt(0) << 24) |
    (normalized.charCodeAt(1) << 16) |
    (normalized.charCodeAt(2) << 8) |
    normalized.charCodeAt(3)
  ) >>> 0;
};

const quantizeDirectMaskSubpixelOffset = (
  subpixelOffset: GlyphSubpixelOffset | undefined,
): readonly [number, number] => {
  if (!subpixelOffset) {
    return [0, 0] as const;
  }
  const quantizeAxis = (value: number): number => {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const wrapped = ((value % 1) + 1) % 1;
    return Math.floor((wrapped * 4) + 1e-6) & 0x3;
  };
  return [quantizeAxis(subpixelOffset.x), quantizeAxis(subpixelOffset.y)] as const;
};

const parseSvgOutlinePath = (pathData: string) => {
  const tokens = pathData.match(/[MLQCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const verbs: PathVerb2d[] = [];
  let index = 0;

  const nextNumber = (): number => {
    const token = tokens[index++];
    if (token === undefined) {
      throw new Error('Unexpected end of glyph path data');
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid glyph path number: ${token}`);
    }
    return value;
  };

  while (index < tokens.length) {
    const command = tokens[index++];
    switch (command) {
      case 'M':
        verbs.push({ kind: 'moveTo', to: [nextNumber(), nextNumber()] });
        break;
      case 'L':
        verbs.push({ kind: 'lineTo', to: [nextNumber(), nextNumber()] });
        break;
      case 'Q':
        verbs.push({
          kind: 'quadTo',
          control: [nextNumber(), nextNumber()],
          to: [nextNumber(), nextNumber()],
        });
        break;
      case 'C':
        verbs.push({
          kind: 'cubicTo',
          control1: [nextNumber(), nextNumber()],
          control2: [nextNumber(), nextNumber()],
          to: [nextNumber(), nextNumber()],
        });
        break;
      case 'Z':
        verbs.push({ kind: 'close' });
        break;
      default:
        throw new Error(`Unsupported glyph path command: ${command}`);
    }
  }

  return createPath2d(...verbs);
};

const toTypefaceHandle = (handle: string | null | undefined): TypefaceHandle | null => {
  if (handle === null || handle === undefined || handle === '' || handle === '0') {
    return null;
  }
  return BigInt(handle);
};

const toGlyphMask = (
  cacheKey: string,
  value: NativeGlyphBitmap | null,
): GlyphMask | null => {
  if (!value) {
    return null;
  }

  return {
    cacheKey,
    width: value.width,
    height: value.height,
    stride: value.stride,
    format: 'a8',
    offsetX: value.offset_x ?? value.offsetX ?? 0,
    offsetY: value.offset_y ?? value.offsetY ?? 0,
    pixels: new Uint8Array(value.pixels),
  };
};

let sharedState: SharedTextHostState | undefined;

const acquireSharedTextHostState = (): SharedTextHostState => {
  if (sharedState) {
    sharedState.refCount += 1;
    return sharedState;
  }

  if (!native.initTextHost()) {
    throw new Error('Failed to initialize the goldlight text host');
  }

  sharedState = {
    refCount: 1,
    typefaceCache: new Map(),
    glyphPathCache: new Map(),
    glyphMaskCache: new Map(),
    glyphSdfCache: new Map(),
  };
  return sharedState;
};

const releaseSharedTextHostState = (state: SharedTextHostState): void => {
  state.refCount -= 1;
  if (state.refCount > 0) {
    return;
  }

  native.shutdownTextHost();
  sharedState = undefined;
};

export const createTextHost = (_options: TextHostOptions = {}): TextHost => {
  const shared = acquireSharedTextHostState();

  const listFamilies = (): readonly string[] => {
    if (shared.families) {
      return shared.families;
    }
    shared.families = Object.freeze([...native.listFamilies()]);
    return shared.families;
  };

  const matchTypeface = (query: FontQuery): TypefaceHandle | null => {
    const family = query.family?.trim();
    if (!family) {
      return null;
    }
    const cached = shared.typefaceCache.get(family);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = toTypefaceHandle(native.matchTypeface(family));
    shared.typefaceCache.set(family, resolved);
    return resolved;
  };

  const getFontMetrics = (typeface: TypefaceHandle, size: number): FontMetrics => {
    const metrics = native.getFontMetrics(typeface.toString(), size);
    if (!metrics) {
      throw new Error(`Text host failed to resolve metrics for typeface ${typeface.toString()}`);
    }
    return {
      unitsPerEm: metrics.units_per_em ?? metrics.unitsPerEm ?? 0,
      ascent: metrics.ascent,
      descent: metrics.descent,
      lineGap: metrics.line_gap ?? metrics.lineGap ?? 0,
      xHeight: metrics.x_height ?? metrics.xHeight ?? 0,
      capHeight: metrics.cap_height ?? metrics.capHeight ?? 0,
      underlinePosition: metrics.underline_position ?? metrics.underlinePosition ?? 0,
      underlineThickness: metrics.underline_thickness ?? metrics.underlineThickness ?? 0,
      strikeoutPosition: metrics.strikeout_position ?? metrics.strikeoutPosition ?? 0,
      strikeoutThickness: metrics.strikeout_thickness ?? metrics.strikeoutThickness ?? 0,
    };
  };

  const getGlyphPath = (typeface: TypefaceHandle, glyphID: number, size: number) => {
    const cacheKey = `${typeface.toString()}:${glyphID >>> 0}:${size}`;
    const cached = shared.glyphPathCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const svgPath = native.getGlyphSvgPath(typeface.toString(), glyphID >>> 0, size);
    if (!svgPath) {
      shared.glyphPathCache.set(cacheKey, null);
      return null;
    }

    const path = parseSvgOutlinePath(svgPath);
    shared.glyphPathCache.set(cacheKey, path);
    return path;
  };

  const getGlyphMask = (
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
    subpixelOffset?: GlyphSubpixelOffset,
  ) => {
    const [subpixelX, subpixelY] = quantizeDirectMaskSubpixelOffset(subpixelOffset);
    const cacheKey = `${typeface.toString()}:${glyphID >>> 0}:${size}:${subpixelX}:${subpixelY}`;
    const cached = shared.glyphMaskCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const mask = toGlyphMask(
      cacheKey,
      native.getGlyphMask(typeface.toString(), glyphID >>> 0, size, subpixelX / 4, subpixelY / 4),
    );
    shared.glyphMaskCache.set(cacheKey, mask);
    return mask;
  };

  const getGlyphSdf = (
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
  ) => {
    const inset = skiaDistanceFieldInset;
    const radius = skiaDistanceFieldRadius;
    const cacheKey = `${typeface.toString()}:${glyphID >>> 0}:${size}:${inset}:${radius}`;
    const cached = shared.glyphSdfCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const sdf = toGlyphMask(
      cacheKey,
      native.getGlyphSdf(typeface.toString(), glyphID >>> 0, size, inset, radius),
    );
    shared.glyphSdfCache.set(cacheKey, sdf);
    return sdf;
  };

  const shapeText = (input: ShapeTextInput): ShapedRun => {
    const run = native.shapeText(
      input.typeface.toString(),
      input.text,
      input.size,
      encodeDirection(input.direction),
      input.language ?? '',
      encodeScriptTag(input.scriptTag),
    );
    if (!run) {
      throw new Error(`Text host failed to shape text for typeface ${input.typeface.toString()}`);
    }

    return {
      typeface: input.typeface,
      text: input.text,
      size: input.size,
      direction: run.direction === 'rtl' ? 'rtl' : 'ltr',
      bidiLevel: run.bidi_level ?? run.bidiLevel ?? 0,
      scriptTag: decodeScriptTag(run.script_tag_code ?? run.scriptTagCode ?? 0),
      language: input.language ?? '',
      glyphIDs: Uint32Array.from(run.glyph_ids ?? run.glyphIds ?? []),
      positions: Float32Array.from(run.positions),
      offsets: Float32Array.from(run.offsets),
      clusterIndices: Uint32Array.from(run.cluster_indices ?? run.clusterIndices ?? []),
      advanceX: run.advance_x ?? run.advanceX ?? 0,
      advanceY: run.advance_y ?? run.advanceY ?? 0,
      utf8RangeStart: run.utf8_range_start ?? run.utf8RangeStart ?? 0,
      utf8RangeEnd: run.utf8_range_end ?? run.utf8RangeEnd ?? input.text.length,
    };
  };

  return {
    listFamilies,
    matchTypeface,
    getFontMetrics,
    shapeText,
    getGlyphPath,
    getGlyphMask,
    getGlyphSdf,
    close: () => {
      releaseSharedTextHostState(shared);
    },
  };
};
