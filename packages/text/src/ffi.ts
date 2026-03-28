/// <reference lib="deno.unstable" />

import { dirname, fromFileUrl, join } from '@std/path';
import { createPath2d, type Path2d, type PathVerb2d } from '@goldlight/geometry';

import type {
  FontMetrics,
  FontQuery,
  GlyphMask,
  ShapedRun,
  ShapeTextInput,
  TextDirection,
  TextHost,
  TextHostOptions,
  TypefaceHandle,
} from './types.ts';
import { skiaDistanceFieldInset, skiaDistanceFieldRadius } from './sdf.ts';

const textHostInitResultOk = 1;
const textHostMetricsResultOk = 1;
const textHostShapeResultOk = 1;
const textHostFamilyNameBufferMinSize = 256;
const ffiFontMetricsBufferSize = 40;
const ffiShapedRunInfoBufferSize = 32;
const ffiGlyphPathBufferMinSize = 2048;
const ffiGlyphMaskInfoBufferSize = 24;

type TextHostLibrary = Deno.DynamicLibrary<{
  text_host_init: {
    parameters: [];
    result: 'u8';
  };
  text_host_shutdown: {
    parameters: [];
    result: 'void';
  };
  text_host_get_family_count: {
    parameters: [];
    result: 'u32';
  };
  text_host_get_family_name: {
    parameters: ['u32', 'buffer', 'usize'];
    result: 'usize';
  };
  text_host_match_typeface_by_family: {
    parameters: ['buffer', 'usize'];
    result: 'u64';
  };
  text_host_get_font_metrics: {
    parameters: ['u64', 'f32', 'buffer'];
    result: 'u8';
  };
  text_host_shape_text: {
    parameters: ['u64', 'buffer', 'usize', 'f32', 'u8', 'buffer', 'usize', 'u32'];
    result: 'u64';
  };
  text_host_get_glyph_svg_path: {
    parameters: ['u64', 'u32', 'f32', 'buffer', 'usize'];
    result: 'usize';
  };
  text_host_get_glyph_mask_info: {
    parameters: ['u64', 'u32', 'f32', 'buffer'];
    result: 'u8';
  };
  text_host_copy_glyph_mask_pixels: {
    parameters: ['u64', 'u32', 'f32', 'buffer', 'usize'];
    result: 'usize';
  };
  text_host_get_glyph_sdf_info: {
    parameters: ['u64', 'u32', 'f32', 'u32', 'f32', 'buffer'];
    result: 'u8';
  };
  text_host_copy_glyph_sdf_pixels: {
    parameters: ['u64', 'u32', 'f32', 'u32', 'f32', 'buffer', 'usize'];
    result: 'usize';
  };
  text_host_shaped_run_get_info: {
    parameters: ['u64', 'buffer'];
    result: 'u8';
  };
  text_host_shaped_run_copy_glyph_ids: {
    parameters: ['u64', 'buffer', 'usize'];
    result: 'u8';
  };
  text_host_shaped_run_copy_positions: {
    parameters: ['u64', 'buffer', 'usize'];
    result: 'u8';
  };
  text_host_shaped_run_copy_offsets: {
    parameters: ['u64', 'buffer', 'usize'];
    result: 'u8';
  };
  text_host_shaped_run_copy_cluster_indices: {
    parameters: ['u64', 'buffer', 'usize'];
    result: 'u8';
  };
  text_host_shaped_run_destroy: {
    parameters: ['u64'];
    result: 'void';
  };
}>;

const repoRoot = join(dirname(fromFileUrl(import.meta.url)), '..', '..', '..');

const getDefaultTextHostLibraryPath = (): string => {
  const extension = Deno.build.os === 'windows'
    ? 'dll'
    : Deno.build.os === 'darwin'
    ? 'dylib'
    : 'so';
  const fileName = Deno.build.os === 'windows'
    ? 'goldlight_text_host.dll'
    : `libgoldlight_text_host.${extension}`;

  return join(repoRoot, 'packages', 'text', 'native', 'target', 'debug', fileName);
};

const decodeMetrics = (bytes: Uint8Array): FontMetrics => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    unitsPerEm: view.getUint16(0, true),
    ascent: view.getFloat32(4, true),
    descent: view.getFloat32(8, true),
    lineGap: view.getFloat32(12, true),
    xHeight: view.getFloat32(16, true),
    capHeight: view.getFloat32(20, true),
    underlinePosition: view.getFloat32(24, true),
    underlineThickness: view.getFloat32(28, true),
    strikeoutPosition: view.getFloat32(32, true),
    strikeoutThickness: view.getFloat32(36, true),
  };
};

const decodeGlyphMaskInfo = (
  bytes: Uint8Array,
): Omit<GlyphMask, 'pixels' | 'format'> & { formatCode: number } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    cacheKey: '',
    width: view.getUint32(0, true),
    height: view.getUint32(4, true),
    stride: view.getUint32(8, true),
    formatCode: view.getUint32(12, true),
    offsetX: view.getInt32(16, true),
    offsetY: view.getInt32(20, true),
  };
};

type NativeShapedRunInfo = Readonly<{
  glyphCount: number;
  bidiLevel: number;
  direction: TextDirection;
  scriptTagCode: number;
  advanceX: number;
  advanceY: number;
  utf8RangeStart: number;
  utf8RangeEnd: number;
}>;

const decodeShapedRunInfo = (bytes: Uint8Array): NativeShapedRunInfo => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    glyphCount: view.getUint32(0, true),
    bidiLevel: view.getUint8(4),
    direction: view.getUint8(5) === 2 ? 'rtl' : 'ltr',
    scriptTagCode: view.getUint32(8, true),
    advanceX: view.getFloat32(12, true),
    advanceY: view.getFloat32(16, true),
    utf8RangeStart: view.getUint32(20, true),
    utf8RangeEnd: view.getUint32(24, true),
  };
};

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

type SharedTextHostState = {
  libraryPath: string;
  library: TextHostLibrary;
  refCount: number;
  families: readonly string[] | null;
  typefaceCache: Map<string, TypefaceHandle | null>;
  shapedRunCache: Map<string, ShapedRun>;
  glyphPathCache: Map<string, Path2d | null>;
  glyphMaskCache: Map<string, GlyphMask | null>;
  glyphSdfCache: Map<string, GlyphMask | null>;
};

const sharedTextHostStates = new Map<string, SharedTextHostState>();

const acquireSharedTextHostState = (libraryPath: string): SharedTextHostState => {
  const existing = sharedTextHostStates.get(libraryPath);
  if (existing) {
    existing.refCount += 1;
    return existing;
  }

  const library = Deno.dlopen(libraryPath, {
    text_host_init: {
      parameters: [],
      result: 'u8',
    },
    text_host_shutdown: {
      parameters: [],
      result: 'void',
    },
    text_host_get_family_count: {
      parameters: [],
      result: 'u32',
    },
    text_host_get_family_name: {
      parameters: ['u32', 'buffer', 'usize'],
      result: 'usize',
    },
    text_host_match_typeface_by_family: {
      parameters: ['buffer', 'usize'],
      result: 'u64',
    },
    text_host_get_font_metrics: {
      parameters: ['u64', 'f32', 'buffer'],
      result: 'u8',
    },
    text_host_shape_text: {
      parameters: ['u64', 'buffer', 'usize', 'f32', 'u8', 'buffer', 'usize', 'u32'],
      result: 'u64',
    },
    text_host_get_glyph_svg_path: {
      parameters: ['u64', 'u32', 'f32', 'buffer', 'usize'],
      result: 'usize',
    },
    text_host_get_glyph_mask_info: {
      parameters: ['u64', 'u32', 'f32', 'buffer'],
      result: 'u8',
    },
    text_host_copy_glyph_mask_pixels: {
      parameters: ['u64', 'u32', 'f32', 'buffer', 'usize'],
      result: 'usize',
    },
    text_host_get_glyph_sdf_info: {
      parameters: ['u64', 'u32', 'f32', 'u32', 'f32', 'buffer'],
      result: 'u8',
    },
    text_host_copy_glyph_sdf_pixels: {
      parameters: ['u64', 'u32', 'f32', 'u32', 'f32', 'buffer', 'usize'],
      result: 'usize',
    },
    text_host_shaped_run_get_info: {
      parameters: ['u64', 'buffer'],
      result: 'u8',
    },
    text_host_shaped_run_copy_glyph_ids: {
      parameters: ['u64', 'buffer', 'usize'],
      result: 'u8',
    },
    text_host_shaped_run_copy_positions: {
      parameters: ['u64', 'buffer', 'usize'],
      result: 'u8',
    },
    text_host_shaped_run_copy_offsets: {
      parameters: ['u64', 'buffer', 'usize'],
      result: 'u8',
    },
    text_host_shaped_run_copy_cluster_indices: {
      parameters: ['u64', 'buffer', 'usize'],
      result: 'u8',
    },
    text_host_shaped_run_destroy: {
      parameters: ['u64'],
      result: 'void',
    },
  }) as TextHostLibrary;

  if (library.symbols.text_host_init() !== textHostInitResultOk) {
    library.close();
    throw new Error('Failed to initialize the goldlight text host');
  }

  const state: SharedTextHostState = {
    libraryPath,
    library,
    refCount: 1,
    families: null,
    typefaceCache: new Map(),
    shapedRunCache: new Map(),
    glyphPathCache: new Map(),
    glyphMaskCache: new Map(),
    glyphSdfCache: new Map(),
  };
  sharedTextHostStates.set(libraryPath, state);
  return state;
};

const releaseSharedTextHostState = (state: SharedTextHostState): void => {
  state.refCount -= 1;
  if (state.refCount > 0) {
    return;
  }
  state.library.symbols.text_host_shutdown();
  state.library.close();
  sharedTextHostStates.delete(state.libraryPath);
};

export const createTextHost = (options: TextHostOptions = {}): TextHost => {
  const libraryPath = options.libraryPath ?? getDefaultTextHostLibraryPath();
  const shared = acquireSharedTextHostState(libraryPath);
  const library = shared.library;
  let closed = false;

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const listFamilies = (): readonly string[] => {
    if (shared.families) {
      return shared.families;
    }
    const count = library.symbols.text_host_get_family_count();
    const families: string[] = [];
    for (let index = 0; index < count; index += 1) {
      let buffer = new Uint8Array(textHostFamilyNameBufferMinSize);
      let length = Number(
        library.symbols.text_host_get_family_name(index, buffer, BigInt(buffer.byteLength)),
      );
      if (length === 0) {
        continue;
      }
      if (length > buffer.byteLength) {
        buffer = new Uint8Array(length);
        length = Number(
          library.symbols.text_host_get_family_name(index, buffer, BigInt(buffer.byteLength)),
        );
      }
      families.push(textDecoder.decode(buffer.subarray(0, length)));
    }
    shared.families = Object.freeze(families.slice());
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
    const familyBytes = textEncoder.encode(family);
    const handle = library.symbols.text_host_match_typeface_by_family(
      familyBytes,
      BigInt(familyBytes.byteLength),
    );
    const resolved = handle === 0n ? null : handle;
    shared.typefaceCache.set(family, resolved);
    return resolved;
  };

  const getFontMetrics = (typeface: TypefaceHandle, size: number): FontMetrics => {
    const buffer = new Uint8Array(ffiFontMetricsBufferSize);
    if (
      library.symbols.text_host_get_font_metrics(typeface, size, buffer) !== textHostMetricsResultOk
    ) {
      throw new Error(`Text host failed to resolve metrics for typeface ${typeface.toString()}`);
    }
    return decodeMetrics(buffer);
  };

  const getGlyphPath = (typeface: TypefaceHandle, glyphID: number, size: number) => {
    const cacheKey = `${typeface.toString()}:${glyphID >>> 0}:${size}`;
    const cached = shared.glyphPathCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    let buffer = new Uint8Array(ffiGlyphPathBufferMinSize);
    let length = Number(
      library.symbols.text_host_get_glyph_svg_path(
        typeface,
        glyphID >>> 0,
        size,
        buffer,
        BigInt(buffer.byteLength),
      ),
    );
    if (length === 0) {
      shared.glyphPathCache.set(cacheKey, null);
      return null;
    }
    if (length > buffer.byteLength) {
      buffer = new Uint8Array(length);
      length = Number(
        library.symbols.text_host_get_glyph_svg_path(
          typeface,
          glyphID >>> 0,
          size,
          buffer,
          BigInt(buffer.byteLength),
        ),
      );
    }
    const path = parseSvgOutlinePath(textDecoder.decode(buffer.subarray(0, length)));
    shared.glyphPathCache.set(cacheKey, path);
    return path;
  };

  const getGlyphMask = (
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
  ): GlyphMask | null => {
    const cacheKey = `${typeface.toString()}:${glyphID >>> 0}:${size}`;
    const cached = shared.glyphMaskCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const infoBuffer = new Uint8Array(ffiGlyphMaskInfoBufferSize);
    if (
      library.symbols.text_host_get_glyph_mask_info(typeface, glyphID >>> 0, size, infoBuffer) !==
        textHostMetricsResultOk
    ) {
      shared.glyphMaskCache.set(cacheKey, null);
      return null;
    }

    const info = decodeGlyphMaskInfo(infoBuffer);
    if (info.formatCode !== 1) {
      throw new Error(`Unsupported glyph mask format code: ${info.formatCode}`);
    }

    const pixelLength = Math.max(0, info.stride * info.height);
    const pixels = new Uint8Array(pixelLength);
    if (pixelLength > 0) {
      const copiedLength = Number(
        library.symbols.text_host_copy_glyph_mask_pixels(
          typeface,
          glyphID >>> 0,
          size,
          pixels,
          BigInt(pixels.byteLength),
        ),
      );
      if (copiedLength !== pixelLength) {
        throw new Error(
          `Text host copied ${copiedLength} glyph mask bytes, expected ${pixelLength}`,
        );
      }
    }

    const mask = {
      cacheKey,
      width: info.width,
      height: info.height,
      stride: info.stride,
      format: 'a8',
      offsetX: info.offsetX,
      offsetY: info.offsetY,
      pixels,
    } as const;
    shared.glyphMaskCache.set(cacheKey, mask);
    return mask;
  };

  const getGlyphSdf = (
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
  ): GlyphMask | null => {
    const inset = skiaDistanceFieldInset;
    const radius = skiaDistanceFieldRadius;
    const cacheKey = `${typeface.toString()}:${glyphID >>> 0}:${size}:${inset}:${radius}`;
    const cached = shared.glyphSdfCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const infoBuffer = new Uint8Array(ffiGlyphMaskInfoBufferSize);
    if (
      library.symbols.text_host_get_glyph_sdf_info(
        typeface,
        glyphID >>> 0,
        size,
        inset >>> 0,
        radius,
        infoBuffer,
      ) !== textHostMetricsResultOk
    ) {
      shared.glyphSdfCache.set(cacheKey, null);
      return null;
    }

    const info = decodeGlyphMaskInfo(infoBuffer);
    if (info.formatCode !== 1) {
      throw new Error(`Unsupported glyph sdf format code: ${info.formatCode}`);
    }

    const pixelLength = Math.max(0, info.stride * info.height);
    const pixels = new Uint8Array(pixelLength);
    if (pixelLength > 0) {
      const copiedLength = Number(
        library.symbols.text_host_copy_glyph_sdf_pixels(
          typeface,
          glyphID >>> 0,
          size,
          inset >>> 0,
          radius,
          pixels,
          BigInt(pixels.byteLength),
        ),
      );
      if (copiedLength !== pixelLength) {
        throw new Error(
          `Text host copied ${copiedLength} glyph sdf bytes, expected ${pixelLength}`,
        );
      }
    }

    const sdf = {
      cacheKey,
      width: info.width,
      height: info.height,
      stride: info.stride,
      format: 'a8',
      offsetX: info.offsetX,
      offsetY: info.offsetY,
      pixels,
    } as const;
    shared.glyphSdfCache.set(cacheKey, sdf);
    return sdf;
  };

  const shapeText = (input: ShapeTextInput): ShapedRun => {
    const cacheKey = JSON.stringify([
      input.typeface.toString(),
      input.text,
      input.size,
      input.direction ?? 'ltr',
      input.language ?? '',
      input.scriptTag ?? '',
    ]);
    const cached = shared.shapedRunCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const textBytes = textEncoder.encode(input.text);
    const languageBytes = input.language ? textEncoder.encode(input.language) : new Uint8Array();
    const direction = encodeDirection(input.direction);
    const scriptTag = encodeScriptTag(input.scriptTag);
    const runHandle = library.symbols.text_host_shape_text(
      input.typeface,
      textBytes,
      BigInt(textBytes.byteLength),
      input.size,
      direction,
      languageBytes,
      BigInt(languageBytes.byteLength),
      scriptTag,
    );
    if (runHandle === 0n) {
      throw new Error(`Text host failed to shape "${input.text}"`);
    }

    try {
      const infoBuffer = new Uint8Array(ffiShapedRunInfoBufferSize);
      if (
        library.symbols.text_host_shaped_run_get_info(runHandle, infoBuffer) !==
          textHostShapeResultOk
      ) {
        throw new Error('Text host failed to inspect shaped run');
      }
      const info = decodeShapedRunInfo(infoBuffer);
      const glyphIDs = new Uint32Array(info.glyphCount);
      const positions = new Float32Array((info.glyphCount + 1) * 2);
      const offsets = new Float32Array((info.glyphCount + 1) * 2);
      const clusterIndices = new Uint32Array(info.glyphCount + 1);
      if (
        library.symbols.text_host_shaped_run_copy_glyph_ids(
            runHandle,
            glyphIDs,
            BigInt(glyphIDs.length),
          ) !== textHostShapeResultOk ||
        library.symbols.text_host_shaped_run_copy_positions(
            runHandle,
            positions,
            BigInt(positions.length),
          ) !== textHostShapeResultOk ||
        library.symbols.text_host_shaped_run_copy_offsets(
            runHandle,
            offsets,
            BigInt(offsets.length),
          ) !==
          textHostShapeResultOk ||
        library.symbols.text_host_shaped_run_copy_cluster_indices(
            runHandle,
            clusterIndices,
            BigInt(clusterIndices.length),
          ) !== textHostShapeResultOk
      ) {
        throw new Error('Text host failed to copy shaped run data');
      }

      const run = {
        typeface: input.typeface,
        text: input.text,
        size: input.size,
        direction: info.direction,
        bidiLevel: info.bidiLevel,
        scriptTag: input.scriptTag ?? decodeScriptTag(info.scriptTagCode),
        language: input.language ?? '',
        glyphIDs,
        positions,
        offsets,
        clusterIndices,
        advanceX: info.advanceX,
        advanceY: info.advanceY,
        utf8RangeStart: info.utf8RangeStart,
        utf8RangeEnd: info.utf8RangeEnd,
      } as const;
      shared.shapedRunCache.set(cacheKey, run);
      return run;
    } finally {
      library.symbols.text_host_shaped_run_destroy(runHandle);
    }
  };

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    releaseSharedTextHostState(shared);
  };

  return {
    listFamilies,
    matchTypeface,
    getFontMetrics,
    shapeText,
    getGlyphPath,
    getGlyphMask,
    getGlyphSdf,
    close,
  };
};
