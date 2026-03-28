import type {
  FontQuery,
  ShapedRun,
  TextDirection,
  TextHost,
  TypefaceHandle,
} from '@disjukr/goldlight/text';

export type LayoutAvailableSpace =
  | Readonly<{ kind: 'definite'; value: number }>
  | Readonly<{ kind: 'min-content' }>
  | Readonly<{ kind: 'max-content' }>;

export type LayoutAvailableSize = Readonly<{
  width: LayoutAvailableSpace;
  height: LayoutAvailableSpace;
}>;

export type ParagraphMeasureMode = 'content' | 'with-lines';

export type ParagraphTextStyle = Readonly<{
  fontFamily?: string | readonly string[];
  fontSize: number;
  direction?: TextDirection;
  language?: string;
  scriptTag?: string;
  lineHeight?: number;
}>;

export type ParagraphPrepareOptions = Readonly<{
  typeface?: TypefaceHandle;
  fontFamily?: string | readonly string[];
  direction?: TextDirection;
  language?: string;
  scriptTag?: string;
}>;

export type PreparedParagraphSegment = Readonly<{
  text: string;
  style: ParagraphTextStyle;
  directionHint: TextDirection | 'auto';
  language?: string;
  scriptTag?: string;
  run: ShapedRun;
}>;

export type ParagraphCluster = Readonly<{
  clusterIndex: number;
  textStart: number;
  textEnd: number;
  glyphStart: number;
  glyphEnd: number;
  advanceX: number;
  advanceY: number;
  text: string;
  breakOpportunityAfter: boolean;
  hardBreakAfter: boolean;
}>;

export type PreparedParagraphRun = Readonly<{
  segmentIndex: number;
  run: ShapedRun;
  clusters: readonly ParagraphCluster[];
  metrics: {
    ascent: number;
    descent: number;
    lineGap: number;
  };
}>;

export type ParagraphCursor = Readonly<{
  runIndex: number;
  clusterIndex: number;
}>;

export type PreparedParagraph = Readonly<{
  text: string;
  style: ParagraphTextStyle;
  segments: readonly PreparedParagraphSegment[];
  runs: readonly PreparedParagraphRun[];
  paragraphDirection: TextDirection | 'auto';
  minContentWidth: number;
  maxContentWidth: number;
}>;

export type ParagraphLineRun = Readonly<{
  logicalStart: ParagraphCursor;
  logicalEnd: ParagraphCursor;
  visualIndex: number;
  direction: TextDirection | 'neutral';
  x: number;
  width: number;
  shapedRun: ShapedRun;
  glyphStart: number;
  glyphEnd: number;
}>;

export type ParagraphLine = Readonly<{
  start: ParagraphCursor;
  end: ParagraphCursor;
  width: number;
  ascent: number;
  descent: number;
  runs: readonly ParagraphLineRun[];
}>;

export type ParagraphLayout = Readonly<{
  lineCount: number;
  width: number;
  height: number;
  lines: readonly ParagraphLine[];
}>;

export type ParagraphLineRange = Readonly<{
  start: ParagraphCursor;
  end: ParagraphCursor;
  width: number;
}>;

export type ParagraphLineWalker = (line: ParagraphLineRange) => void;

export type ParagraphTextResolver = Readonly<{
  readonly host: TextHost;
  resolveTypeface: (style: ParagraphTextStyle, options?: ParagraphPrepareOptions) => TypefaceHandle;
  shapeText: (typeface: TypefaceHandle, text: string, style: ParagraphTextStyle) => ShapedRun;
}>;

export type ParagraphTypefaceResolver = (query: FontQuery) => TypefaceHandle | null;
