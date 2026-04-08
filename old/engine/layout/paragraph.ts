import {
  buildGlyphClusters,
  type FontQuery,
  type ShapedRun,
  type TextHost,
  type TypefaceHandle,
} from '@disjukr/goldlight/text';
import type {
  ParagraphCluster,
  ParagraphCursor,
  ParagraphLayout,
  ParagraphLine,
  ParagraphLineRange,
  ParagraphLineRun,
  ParagraphLineWalker,
  ParagraphPrepareOptions,
  ParagraphTextResolver,
  ParagraphTextStyle,
  PreparedParagraph,
  PreparedParagraphRun,
  PreparedParagraphSegment,
} from './types.ts';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const measureClusterAdvance = (cluster: { advanceX: number; advanceY: number }): number =>
  Math.hypot(cluster.advanceX, cluster.advanceY);

const decodeUtf8Slice = (encoded: Uint8Array, start: number, end: number): string =>
  textDecoder.decode(encoded.subarray(start, end));

const isPureHardBreakCluster = (cluster: ParagraphCluster): boolean =>
  cluster.hardBreakAfter && cluster.text.replaceAll('\r', '').replaceAll('\n', '').length === 0;

const createParagraphResolver = (
  host: TextHost,
  options: ParagraphPrepareOptions = {},
): ParagraphTextResolver => {
  const familyCache = new Map<string, TypefaceHandle>();

  const tryResolveTypeface = (query: FontQuery): TypefaceHandle | null => {
    const family = query.family ?? '';
    if (familyCache.has(family)) {
      return familyCache.get(family) ?? null;
    }
    const typeface = host.matchTypeface(query);
    if (typeface !== null) {
      familyCache.set(family, typeface);
    }
    return typeface;
  };

  const resolveTypeface = (
    style: ParagraphTextStyle,
    prepareOptions: ParagraphPrepareOptions = options,
  ): TypefaceHandle => {
    if (prepareOptions.typeface !== undefined) {
      return prepareOptions.typeface;
    }

    const families = prepareOptions.fontFamily ?? style.fontFamily;
    const familyList = families === undefined
      ? []
      : Array.isArray(families)
      ? families
      : [families];

    for (const family of familyList) {
      const typeface = tryResolveTypeface({ family });
      if (typeface !== null) {
        return typeface;
      }
    }

    const fallback = tryResolveTypeface({});
    if (fallback === null) {
      throw new Error('No matching typeface found for paragraph text');
    }
    return fallback;
  };

  const shapeText = (
    typeface: TypefaceHandle,
    text: string,
    style: ParagraphTextStyle,
  ): ShapedRun =>
    host.shapeText({
      typeface,
      text,
      size: style.fontSize,
      direction: style.direction,
      language: style.language,
      scriptTag: style.scriptTag,
    });

  return { host, resolveTypeface, shapeText };
};

const createParagraphClusters = (
  segment: PreparedParagraphSegment,
): readonly ParagraphCluster[] => {
  const encoded = textEncoder.encode(segment.text);
  return buildGlyphClusters(segment.run).map((cluster, clusterIndex) => {
    const clusterText = decodeUtf8Slice(encoded, cluster.textStart, cluster.textEnd);
    const hardBreakAfter = clusterText.includes('\n');
    const breakOpportunityAfter = hardBreakAfter || /\s$/u.test(clusterText);
    return {
      clusterIndex,
      textStart: cluster.textStart,
      textEnd: cluster.textEnd,
      glyphStart: cluster.glyphStart,
      glyphEnd: cluster.glyphEnd,
      advanceX: cluster.advanceX,
      advanceY: cluster.advanceY,
      text: clusterText,
      breakOpportunityAfter,
      hardBreakAfter,
    };
  });
};

const computeIntrinsicWidths = (runs: readonly PreparedParagraphRun[]): {
  minContentWidth: number;
  maxContentWidth: number;
} => {
  let maxContentWidth = 0;
  let minContentWidth = 0;

  for (const run of runs) {
    let currentUnbreakableWidth = 0;
    for (const cluster of run.clusters) {
      const advance = measureClusterAdvance(cluster);
      maxContentWidth += advance;
      currentUnbreakableWidth += advance;
      if (cluster.hardBreakAfter) {
        minContentWidth = Math.max(minContentWidth, currentUnbreakableWidth - advance);
        currentUnbreakableWidth = 0;
        continue;
      }
      if (cluster.breakOpportunityAfter) {
        minContentWidth = Math.max(minContentWidth, currentUnbreakableWidth);
        currentUnbreakableWidth = 0;
      }
    }
    minContentWidth = Math.max(minContentWidth, currentUnbreakableWidth);
  }

  return { minContentWidth, maxContentWidth };
};

const createPreparedRuns = (
  resolver: ParagraphTextResolver,
  segments: readonly PreparedParagraphSegment[],
): readonly PreparedParagraphRun[] =>
  segments.map((segment, segmentIndex) => {
    const metrics = resolver.host.getFontMetrics(segment.run.typeface, segment.run.size);
    return {
      segmentIndex,
      run: segment.run,
      clusters: createParagraphClusters(segment),
      metrics: {
        ascent: metrics.ascent,
        descent: metrics.descent,
        lineGap: metrics.lineGap,
      },
    };
  });

const createLineRun = (
  run: PreparedParagraphRun,
  startClusterIndex: number,
  endClusterIndexExclusive: number,
  x: number,
): ParagraphLineRun => {
  const firstCluster = run.clusters[startClusterIndex]!;
  let paintEndClusterIndexExclusive = endClusterIndexExclusive;
  while (paintEndClusterIndexExclusive > startClusterIndex) {
    const candidate = run.clusters[paintEndClusterIndexExclusive - 1]!;
    if (!isPureHardBreakCluster(candidate)) {
      break;
    }
    paintEndClusterIndexExclusive -= 1;
  }
  const endCluster = run.clusters[Math.max(startClusterIndex, paintEndClusterIndexExclusive - 1)]!;
  let width = 0;
  for (let index = startClusterIndex; index < paintEndClusterIndexExclusive; index += 1) {
    width += measureClusterAdvance(run.clusters[index]!);
  }
  const glyphStart = paintEndClusterIndexExclusive > startClusterIndex
    ? firstCluster.glyphStart
    : 0;
  const glyphEnd = paintEndClusterIndexExclusive > startClusterIndex ? endCluster.glyphEnd : 0;
  return {
    logicalStart: { runIndex: run.segmentIndex, clusterIndex: startClusterIndex },
    logicalEnd: { runIndex: run.segmentIndex, clusterIndex: endClusterIndexExclusive },
    visualIndex: 0,
    direction: run.run.direction,
    x,
    width,
    shapedRun: run.run,
    glyphStart,
    glyphEnd,
  };
};

const createLineFromClusters = (
  run: PreparedParagraphRun,
  startClusterIndex: number,
  endClusterIndexExclusive: number,
): ParagraphLine => {
  const lineRun = createLineRun(run, startClusterIndex, endClusterIndexExclusive, 0);
  return {
    start: lineRun.logicalStart,
    end: lineRun.logicalEnd,
    width: lineRun.width,
    ascent: run.metrics.ascent,
    descent: run.metrics.descent,
    runs: [lineRun],
  };
};

const lineRangeFromLine = (line: ParagraphLine): ParagraphLineRange => ({
  start: line.start,
  end: line.end,
  width: line.width,
});

const layoutRunLines = (
  run: PreparedParagraphRun,
  maxWidth: number,
  onLine?: ParagraphLineWalker,
): readonly ParagraphLine[] => {
  const lines: ParagraphLine[] = [];
  const clusters = run.clusters;
  if (clusters.length === 0) {
    return lines;
  }

  let lineStart = 0;
  let lineWidth = 0;
  let lastBreakOpportunity = -1;
  let widthAtLastBreak = 0;

  const pushLine = (endExclusive: number): void => {
    if (endExclusive <= lineStart) {
      return;
    }
    const line = createLineFromClusters(run, lineStart, endExclusive);
    lines.push(line);
    onLine?.(lineRangeFromLine(line));
    lineStart = endExclusive;
    lineWidth = 0;
    lastBreakOpportunity = -1;
    widthAtLastBreak = 0;
  };

  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
    const cluster = clusters[clusterIndex]!;
    const advance = measureClusterAdvance(cluster);

    if (cluster.hardBreakAfter) {
      lineWidth += advance;
      pushLine(clusterIndex + 1);
      continue;
    }

    if (lineWidth > 0 && lineWidth + advance > maxWidth) {
      if (lastBreakOpportunity >= lineStart) {
        pushLine(lastBreakOpportunity + 1);
        clusterIndex = lineStart - 1;
        continue;
      }
      pushLine(clusterIndex);
      clusterIndex = lineStart - 1;
      continue;
    }

    lineWidth += advance;
    if (cluster.breakOpportunityAfter) {
      lastBreakOpportunity = clusterIndex;
      widthAtLastBreak = lineWidth;
      lineWidth = widthAtLastBreak;
    }
  }

  pushLine(clusters.length);
  return lines;
};

export const prepareParagraph = (
  host: TextHost,
  text: string,
  style: ParagraphTextStyle,
  options: ParagraphPrepareOptions = {},
): PreparedParagraph => {
  const resolver = createParagraphResolver(host, options);
  const typeface = resolver.resolveTypeface(style, options);
  const run = resolver.shapeText(typeface, text, {
    ...style,
    direction: options.direction ?? style.direction,
    language: options.language ?? style.language,
    scriptTag: options.scriptTag ?? style.scriptTag,
  });
  const segment: PreparedParagraphSegment = {
    text,
    style,
    directionHint: style.direction ?? 'auto',
    language: style.language,
    scriptTag: style.scriptTag,
    run,
  };
  const runs = createPreparedRuns(resolver, [segment]);
  const intrinsic = computeIntrinsicWidths(runs);
  return {
    text,
    style,
    segments: [segment],
    runs,
    paragraphDirection: style.direction ?? 'auto',
    minContentWidth: intrinsic.minContentWidth,
    maxContentWidth: intrinsic.maxContentWidth,
  };
};

export const walkParagraphLineRanges = (
  prepared: PreparedParagraph,
  maxWidth: number,
  onLine: ParagraphLineWalker,
): number => {
  let lineCount = 0;
  for (const run of prepared.runs) {
    lineCount += layoutRunLines(run, maxWidth, onLine).length;
  }
  return lineCount;
};

export const layoutNextParagraphLine = (
  prepared: PreparedParagraph,
  start: ParagraphCursor,
  maxWidth: number,
): ParagraphLine | null => {
  const run = prepared.runs[start.runIndex];
  if (run === undefined) {
    return null;
  }
  const lines = layoutRunLines(run, maxWidth);
  for (const line of lines) {
    if (line.start.clusterIndex >= start.clusterIndex) {
      return line;
    }
  }
  for (let runIndex = start.runIndex + 1; runIndex < prepared.runs.length; runIndex += 1) {
    const nextLines = layoutRunLines(prepared.runs[runIndex]!, maxWidth);
    if (nextLines.length > 0) {
      return nextLines[0]!;
    }
  }
  return null;
};

export const layoutParagraph = (
  prepared: PreparedParagraph,
  maxWidth: number,
  lineHeight = prepared.style.lineHeight ?? prepared.style.fontSize,
): ParagraphLayout => {
  const lines: ParagraphLine[] = [];
  for (const run of prepared.runs) {
    lines.push(...layoutRunLines(run, maxWidth));
  }
  const width = lines.reduce((max, line) => Math.max(max, line.width), 0);
  return {
    lineCount: lines.length,
    width,
    height: lines.length * lineHeight,
    lines,
  };
};
