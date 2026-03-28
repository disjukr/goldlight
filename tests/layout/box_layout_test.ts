import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import {
  computeLayout,
  createBoxLayoutNode,
  createTextLayoutNode,
  type LayoutAvailableSize,
  type ParagraphTextStyle,
  prepareParagraph,
} from '@disjukr/goldlight/layout';
import type {
  FontMetrics,
  FontQuery,
  GlyphMask,
  ShapedRun,
  ShapeTextInput,
  TextHost,
  TypefaceHandle,
} from '@disjukr/goldlight/text';
import type { Path2d } from '@disjukr/goldlight/geometry';

const typeface: TypefaceHandle = 1n;
const encoder = new TextEncoder();

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

const createMockRun = (input: ShapeTextInput): ShapedRun => {
  const bytes = encoder.encode(input.text);
  const positions = new Float32Array((bytes.length + 1) * 2);
  const glyphIDs = new Uint32Array(bytes.length);
  const offsets = new Float32Array(bytes.length * 2);
  const clusterIndices = new Uint32Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    glyphIDs[index] = index + 1;
    clusterIndices[index] = index;
    positions[(index + 1) * 2] = index + 1;
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
  matchTypeface(_query: FontQuery): TypefaceHandle | null {
    return typeface;
  },
  getFontMetrics(): FontMetrics {
    return mockMetrics;
  },
  shapeText(input): ShapedRun {
    return createMockRun(input);
  },
  getGlyphPath(): Path2d | null {
    return null;
  },
  getGlyphMask(): GlyphMask | null {
    return null;
  },
  getGlyphSdf(): GlyphMask | null {
    return null;
  },
  close(): void {},
};

const defaultStyle: ParagraphTextStyle = {
  fontSize: 10,
  direction: 'ltr',
};

const definite = (width: number, height: number): LayoutAvailableSize => ({
  width: { kind: 'definite', value: width },
  height: { kind: 'definite', value: height },
});

Deno.test('computeLayout stacks text nodes in a column with padding and gap', () => {
  const first = createTextLayoutNode(prepareParagraph(mockHost, 'hello world', defaultStyle));
  const second = createTextLayoutNode(prepareParagraph(mockHost, 'bye', defaultStyle));
  const root = createBoxLayoutNode([first, second], {
    padding: 10,
    gap: 5,
    width: 80,
  });

  const layout = computeLayout(root, definite(80, 600));
  assertEquals(layout.kind, 'box');
  assertEquals(layout.width, 80);
  assertEquals(layout.children.length, 2);
  assertEquals(layout.children[0]?.x, 10);
  assertEquals(layout.children[0]?.y, 10);
  assertEquals(layout.children[0]?.width, 11);
  assertEquals(layout.children[1]?.y, layout.children[0]!.y + layout.children[0]!.height + 5);
});

Deno.test('computeLayout measures row children with max-content widths', () => {
  const left = createTextLayoutNode(prepareParagraph(mockHost, 'abc', defaultStyle));
  const right = createTextLayoutNode(prepareParagraph(mockHost, 'defg', defaultStyle));
  const root = createBoxLayoutNode([left, right], {
    direction: 'row',
    padding: { left: 4, right: 4, top: 2, bottom: 2 },
    gap: 3,
  });

  const layout = computeLayout(root, definite(200, 200));
  assertEquals(layout.kind, 'box');
  assertEquals(layout.children[0]?.width, 3);
  assertEquals(layout.children[1]?.width, 4);
  assertEquals(layout.children[1]?.x, 4 + 3 + 3);
  assertEquals(layout.width, 4 + 3 + 3 + 4 + 4);
});
