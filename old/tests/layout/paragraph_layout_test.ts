import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import {
  layoutNextParagraphLine,
  layoutParagraph,
  type ParagraphCursor,
  prepareParagraph,
  walkParagraphLineRanges,
} from '@disjukr/goldlight/layout';
import type { Path2d } from '@disjukr/goldlight/geometry';
import type {
  FontMetrics,
  GlyphMask,
  ShapedRun,
  ShapeTextInput,
  TextHost,
  TypefaceHandle,
} from '@disjukr/goldlight/text';

const mockTypeface = 1n satisfies TypefaceHandle;

const mockMetrics: FontMetrics = {
  unitsPerEm: 1000,
  ascent: 8,
  descent: 2,
  lineGap: 2,
  xHeight: 5,
  capHeight: 7,
  underlinePosition: -1,
  underlineThickness: 1,
  strikeoutPosition: 3,
  strikeoutThickness: 1,
};

const encoder = new TextEncoder();

const createMockRun = (input: ShapeTextInput): ShapedRun => {
  const bytes = encoder.encode(input.text);
  const positions = new Float32Array((bytes.length + 1) * 2);
  const glyphIDs = new Uint32Array(bytes.length);
  const offsets = new Float32Array(bytes.length * 2);
  const clusterIndices = new Uint32Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    glyphIDs[i] = i + 1;
    clusterIndices[i] = i;
    positions[(i + 1) * 2] = i + 1;
  }
  return {
    typeface: input.typeface,
    text: input.text,
    size: input.size,
    direction: input.direction ?? 'ltr',
    bidiLevel: 0,
    scriptTag: input.scriptTag ?? 'Latn',
    language: input.language ?? 'en',
    glyphIDs,
    positions,
    offsets,
    clusterIndices,
    advanceX: bytes.length,
    advanceY: 0,
    utf8RangeStart: 0,
    utf8RangeEnd: bytes.length,
  };
};

const mockHost: TextHost = {
  listFamilies: () => ['Mock Sans'],
  matchTypeface: () => mockTypeface,
  getFontMetrics: () => mockMetrics,
  shapeText: createMockRun,
  getGlyphPath: (): Path2d | null => null,
  getGlyphMask: (): GlyphMask | null => null,
  getGlyphSdf: (): GlyphMask | null => null,
  close: () => {},
};

Deno.test('prepareParagraph computes intrinsic widths and preserves bidi-safe runs', () => {
  const prepared = prepareParagraph(mockHost, 'hello world', {
    fontSize: 12,
    fontFamily: 'Mock Sans',
  });

  assertEquals(prepared.runs.length, 1);
  assertEquals(prepared.minContentWidth, 6);
  assertEquals(prepared.maxContentWidth, 11);
  assertEquals(prepared.runs[0]?.clusters.length, 11);
});

Deno.test('layoutParagraph wraps on whitespace and returns run-based lines', () => {
  const prepared = prepareParagraph(mockHost, 'hello world', {
    fontSize: 12,
    fontFamily: 'Mock Sans',
    lineHeight: 16,
  });

  const layout = layoutParagraph(prepared, 6, 16);

  assertEquals(layout.lineCount, 2);
  assertEquals(layout.height, 32);
  assertEquals(layout.lines[0]?.runs.length, 1);
  assertEquals(layout.lines[0]?.width, 6);
  assertEquals(layout.lines[1]?.width, 5);
});

Deno.test('walkParagraphLineRanges and layoutNextParagraphLine share logical cursors', () => {
  const prepared = prepareParagraph(mockHost, 'a bb ccc', {
    fontSize: 12,
    fontFamily: 'Mock Sans',
  });

  const widths: number[] = [];
  const lineCount = walkParagraphLineRanges(prepared, 4, (line) => widths.push(line.width));
  assertEquals(lineCount, 3);
  assertEquals(widths, [2, 3, 3]);

  const start: ParagraphCursor = { runIndex: 0, clusterIndex: 0 };
  const line1 = layoutNextParagraphLine(prepared, start, 4);
  assertEquals(line1?.end.clusterIndex, 2);
  const line2 = layoutNextParagraphLine(prepared, line1!.end, 4);
  assertEquals(line2?.start.clusterIndex, 2);
  assertEquals(line2?.width, 3);
});

Deno.test('layoutParagraph excludes trailing newline clusters from paint glyph ranges', () => {
  const prepared = prepareParagraph(mockHost, 'alpha\nbeta', {
    fontSize: 12,
    fontFamily: 'Mock Sans',
    lineHeight: 16,
  });

  const layout = layoutParagraph(prepared, 100, 16);

  assertEquals(layout.lineCount, 2);
  assertEquals(layout.lines[0]?.runs[0]?.glyphEnd, 5);
  assertEquals(layout.lines[1]?.runs[0]?.glyphStart, 6);
});
