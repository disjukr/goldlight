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

export type TextHost = Readonly<{
  listFamilies: () => readonly string[];
  matchTypeface: (query: FontQuery) => TypefaceHandle | null;
  getFontMetrics: (typeface: TypefaceHandle, size: number) => FontMetrics;
  shapeText: (input: ShapeTextInput) => ShapedRun;
  getGlyphPath: (typeface: TypefaceHandle, glyphID: number, size: number) => Path2d | null;
  close: () => void;
}>;
