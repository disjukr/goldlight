import type { Path2d } from '@goldlight/geometry';

export type TextHostOptions = Readonly<{
  libraryPath?: string;
}>;

export type FontQuery = Readonly<{
  family?: string;
}>;

export type TypefaceHandle = bigint;
export type TextDirection = 'ltr' | 'rtl';

export type ShapeTextInput = Readonly<{
  typeface: TypefaceHandle;
  text: string;
  size: number;
  direction?: TextDirection;
  language?: string;
  scriptTag?: string;
}>;

export type FontMetrics = Readonly<{
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  xHeight: number;
  capHeight: number;
  underlinePosition: number;
  underlineThickness: number;
  strikeoutPosition: number;
  strikeoutThickness: number;
}>;

export type GlyphMaskFormat = 'a8';

export type GlyphMask = Readonly<{
  width: number;
  height: number;
  stride: number;
  format: GlyphMaskFormat;
  offsetX: number;
  offsetY: number;
  pixels: Uint8Array;
}>;

export type ShapedRun = Readonly<{
  typeface: TypefaceHandle;
  text: string;
  size: number;
  direction: TextDirection;
  bidiLevel: number;
  scriptTag: string;
  language: string;
  glyphIDs: Uint32Array;
  positions: Float32Array;
  offsets: Float32Array;
  clusterIndices: Uint32Array;
  advanceX: number;
  advanceY: number;
  utf8RangeStart: number;
  utf8RangeEnd: number;
}>;

export type GlyphCluster = Readonly<{
  textStart: number;
  textEnd: number;
  glyphStart: number;
  glyphEnd: number;
  advanceX: number;
  advanceY: number;
}>;

export type DirectMaskGlyph = Readonly<{
  glyphID: number;
  x: number;
  y: number;
  mask: GlyphMask | null;
}>;

export type DirectMaskSubRun = Readonly<{
  typeface: TypefaceHandle;
  size: number;
  glyphs: readonly DirectMaskGlyph[];
}>;

export type SdfGlyph = Readonly<{
  glyphID: number;
  x: number;
  y: number;
  mask: GlyphMask | null;
  sdf: GlyphMask | null;
  sdfInset: number;
  sdfRadius: number;
}>;

export type SdfSubRun = Readonly<{
  typeface: TypefaceHandle;
  size: number;
  glyphs: readonly SdfGlyph[];
  sdfInset: number;
  sdfRadius: number;
}>;

export type TextHost = Readonly<{
  listFamilies: () => readonly string[];
  matchTypeface: (query: FontQuery) => TypefaceHandle | null;
  getFontMetrics: (typeface: TypefaceHandle, size: number) => FontMetrics;
  shapeText: (input: ShapeTextInput) => ShapedRun;
  getGlyphPath: (typeface: TypefaceHandle, glyphID: number, size: number) => Path2d | null;
  getGlyphMask: (typeface: TypefaceHandle, glyphID: number, size: number) => GlyphMask | null;
  getGlyphSdf: (
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
    options?: Readonly<{ inset?: number; radius?: number }>,
  ) => GlyphMask | null;
  close: () => void;
}>;
