import { exportPngRgba } from '@goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import {
  createRect,
  createRectPath2d,
  createTranslationMatrix2d,
  type Path2d,
  transformPath2d,
} from '@goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitToDawnQueueManager,
} from '@goldlight/drawing';
import { buildGlyphClusters, createTextHost } from '@goldlight/text';

const outputWidth = 960;
const outputHeight = 720;
const supersampleScale = 2;
const pagePadding = 36;

type ClusterSample = Readonly<{
  label: string;
  text: string;
  familyCandidates: readonly string[];
  language?: string;
}>;

type RenderedSampleSummary = Readonly<{
  label: string;
  family: string;
  glyphCount: number;
  clusterCount: number;
}>;

const clusterSamples: readonly ClusterSample[] = [
  {
    label: 'Latin ligatures',
    text: 'office affine offline',
    familyCandidates: ['Segoe UI', 'Arial', 'Calibri'],
    language: 'en',
  },
  {
    label: 'Combining marks',
    text: 'A\u0301me\u0301lie coo\u0308perate',
    familyCandidates: ['Segoe UI', 'Arial', 'Calibri'],
    language: 'en',
  },
  {
    label: 'Hangul syllables',
    text: '\uD55C\uAE00 \uD074\uB7EC\uC2A4\uD130 \uD14C\uC2A4\uD2B8',
    familyCandidates: ['Malgun Gothic', 'Segoe UI', 'Arial Unicode MS'],
    language: 'ko',
  },
];

const downsampleRgba = (
  bytes: Uint8Array,
  width: number,
  height: number,
  scale: number,
): Uint8Array => {
  const nextWidth = Math.floor(width / scale);
  const nextHeight = Math.floor(height / scale);
  const downsampled = new Uint8Array(nextWidth * nextHeight * 4);

  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sampleY = 0; sampleY < scale; sampleY += 1) {
        for (let sampleX = 0; sampleX < scale; sampleX += 1) {
          const sourceX = (x * scale) + sampleX;
          const sourceY = (y * scale) + sampleY;
          const sourceOffset = ((sourceY * width) + sourceX) * 4;
          r += bytes[sourceOffset];
          g += bytes[sourceOffset + 1];
          b += bytes[sourceOffset + 2];
          a += bytes[sourceOffset + 3];
        }
      }
      const targetOffset = ((y * nextWidth) + x) * 4;
      const sampleCount = scale * scale;
      downsampled[targetOffset] = Math.round(r / sampleCount);
      downsampled[targetOffset + 1] = Math.round(g / sampleCount);
      downsampled[targetOffset + 2] = Math.round(b / sampleCount);
      downsampled[targetOffset + 3] = Math.round(a / sampleCount);
    }
  }

  return downsampled;
};

const drawHorizontalRule = (
  recorder: ReturnType<(typeof requestDrawingContext)> extends Promise<infer T>
    ? T extends { createRecorder: () => infer R } ? R : never
    : never,
  x: number,
  y: number,
  width: number,
  color: readonly [number, number, number, number],
  thickness = 1,
): void => {
  recordDrawPath(recorder, createRectPath2d(createRect(x, y, width, thickness)), {
    style: 'fill',
    color,
  });
};

const matchCandidateTypeface = (
  host: ReturnType<typeof createTextHost>,
  candidates: readonly string[],
) => {
  for (const candidate of candidates) {
    const typeface = host.matchTypeface({ family: candidate });
    if (typeface !== null) {
      return { family: candidate, typeface };
    }
  }

  for (const family of host.listFamilies()) {
    const typeface = host.matchTypeface({ family });
    if (typeface !== null) {
      return { family, typeface };
    }
  }

  return null;
};

const getPathBounds = (path: Path2d) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
      case 'lineTo':
        includePoint(verb.to[0], verb.to[1]);
        break;
      case 'quadTo':
      case 'conicTo':
        includePoint(verb.control[0], verb.control[1]);
        includePoint(verb.to[0], verb.to[1]);
        break;
      case 'cubicTo':
        includePoint(verb.control1[0], verb.control1[1]);
        includePoint(verb.control2[0], verb.control2[1]);
        includePoint(verb.to[0], verb.to[1]);
        break;
      case 'arcTo':
        includePoint(verb.center[0] - verb.radius, verb.center[1] - verb.radius);
        includePoint(verb.center[0] + verb.radius, verb.center[1] + verb.radius);
        break;
      case 'close':
        break;
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

export const renderGlyphClustersSnapshot = async (): Promise<
  Readonly<{
    png: Uint8Array;
    passCount: number;
    unsupportedCommandCount: number;
    summaries: readonly RenderedSampleSummary[];
  }>
> => {
  const drawingContext = await requestDrawingContext({
    target: {
      kind: 'offscreen',
      width: outputWidth * supersampleScale,
      height: outputHeight * supersampleScale,
      format: 'rgba8unorm',
      msaaSampleCount: 4,
    },
  });

  const textHost = createTextHost();
  try {
    const binding = createOffscreenBinding(drawingContext.backend);
    const recorder = drawingContext.createRecorder();

    saveDrawingRecorder(recorder);
    scaleDrawingRecorder(recorder, supersampleScale, supersampleScale);

    recordClear(recorder, [0.95, 0.94, 0.91, 1]);
    recordDrawPath(recorder, createRectPath2d(createRect(24, 24, 912, 672)), {
      style: 'fill',
      color: [0.1, 0.11, 0.13, 1],
    });

    const summaries: RenderedSampleSummary[] = [];
    let y = pagePadding;

    for (const [sampleIndex, sample] of clusterSamples.entries()) {
      const matched = matchCandidateTypeface(textHost, sample.familyCandidates);
      if (!matched) {
        continue;
      }

      const fontSize = 32;
      const metrics = textHost.getFontMetrics(matched.typeface, fontSize);
      const shapedRun = textHost.shapeText({
        typeface: matched.typeface,
        text: sample.text,
        size: fontSize,
        direction: 'ltr',
        language: sample.language,
      });
      const clusters = buildGlyphClusters(shapedRun);
      const glyphPaths = Array.from(
        shapedRun.glyphIDs,
        (glyphID) => textHost.getGlyphPath(matched.typeface, glyphID, fontSize),
      );

      summaries.push({
        label: sample.label,
        family: matched.family,
        glyphCount: shapedRun.glyphIDs.length,
        clusterCount: clusters.length,
      });

      const baselineY = y + 52;
      const textLeft = pagePadding + 180;
      const ascentTop = baselineY + metrics.ascent;
      const descentBottom = baselineY + metrics.descent;
      const rowHeight = Math.max(92, descentBottom - ascentTop + 40);

      recordDrawPath(recorder, createRectPath2d(createRect(pagePadding, y, 888, rowHeight)), {
        style: 'fill',
        color: sampleIndex % 2 === 0 ? [0.14, 0.15, 0.18, 1] : [0.12, 0.13, 0.16, 1],
      });

      drawHorizontalRule(recorder, textLeft, baselineY, 700, [0.96, 0.79, 0.24, 0.95], 2);
      drawHorizontalRule(recorder, textLeft, ascentTop, 700, [0.34, 0.74, 0.95, 0.65], 1);
      drawHorizontalRule(recorder, textLeft, descentBottom, 700, [0.95, 0.36, 0.31, 0.65], 1);

      for (const [clusterIndex, cluster] of clusters.entries()) {
        let clusterMinX = Number.POSITIVE_INFINITY;
        let clusterMinY = Number.POSITIVE_INFINITY;
        let clusterMaxX = Number.NEGATIVE_INFINITY;
        let clusterMaxY = Number.NEGATIVE_INFINITY;

        for (let glyphIndex = cluster.glyphStart; glyphIndex < cluster.glyphEnd; glyphIndex += 1) {
          const glyphPath = glyphPaths[glyphIndex];
          if (!glyphPath) {
            continue;
          }
          const bounds = getPathBounds(glyphPath);
          if (!bounds) {
            continue;
          }
          const glyphX = textLeft + shapedRun.positions[glyphIndex * 2] +
            shapedRun.offsets[glyphIndex * 2];
          const glyphY = baselineY + shapedRun.positions[(glyphIndex * 2) + 1] +
            shapedRun.offsets[(glyphIndex * 2) + 1];
          clusterMinX = Math.min(clusterMinX, glyphX + bounds.minX);
          clusterMinY = Math.min(clusterMinY, glyphY + bounds.minY);
          clusterMaxX = Math.max(clusterMaxX, glyphX + bounds.maxX);
          clusterMaxY = Math.max(clusterMaxY, glyphY + bounds.maxY);
        }

        if (!Number.isFinite(clusterMinX)) {
          clusterMinX = textLeft + shapedRun.positions[cluster.glyphStart * 2];
          clusterMinY = ascentTop;
          clusterMaxX = clusterMinX + Math.max(2, cluster.advanceX);
          clusterMaxY = descentBottom;
        }

        const color = clusterIndex % 2 === 0
          ? [0.18, 0.78, 0.98, 0.95] as const
          : [0.98, 0.46, 0.18, 0.95] as const;
        recordDrawPath(
          recorder,
          createRectPath2d(
            createRect(
              clusterMinX,
              clusterMinY,
              Math.max(1, clusterMaxX - clusterMinX),
              Math.max(1, clusterMaxY - clusterMinY),
            ),
          ),
          {
            style: 'fill',
            color,
          },
        );
        recordDrawPath(
          recorder,
          createRectPath2d(
            createRect(
              clusterMinX,
              clusterMinY,
              Math.max(1, clusterMaxX - clusterMinX),
              Math.max(1, clusterMaxY - clusterMinY),
            ),
          ),
          {
            style: 'stroke',
            strokeWidth: 2,
            color: [1, 1, 1, 1],
          },
        );
      }

      for (let glyphIndex = 0; glyphIndex < shapedRun.glyphIDs.length; glyphIndex += 1) {
        const glyphPath = glyphPaths[glyphIndex];
        if (!glyphPath) {
          continue;
        }
        const positionedGlyphPath = transformPath2d(
          glyphPath,
          createTranslationMatrix2d(
            textLeft + shapedRun.positions[glyphIndex * 2] + shapedRun.offsets[glyphIndex * 2],
            baselineY + shapedRun.positions[(glyphIndex * 2) + 1] +
              shapedRun.offsets[(glyphIndex * 2) + 1],
          ),
        );
        recordDrawPath(recorder, positionedGlyphPath, {
          style: 'fill',
          color: [1, 1, 1, 0.35],
        });
        recordDrawPath(recorder, positionedGlyphPath, {
          style: 'stroke',
          strokeWidth: 1.5,
          strokeJoin: 'round',
          strokeCap: 'round',
          color: [1, 1, 1, 1],
        });
      }

      y += rowHeight + 20;
    }

    const recording = finishDrawingRecorder(recorder);
    const commandBuffer = encodeDawnCommandBuffer(drawingContext.sharedContext, recording, binding);

    submitToDawnQueueManager(drawingContext.sharedContext.queueManager, commandBuffer);
    await drawingContext.tick();
    await checkForFinishedDawnQueueWork(drawingContext.sharedContext.queueManager, 'yes');

    const snapshot = await readOffscreenSnapshot(
      { device: drawingContext.backend.device, queue: drawingContext.backend.queue },
      binding,
    );
    const downsampled = downsampleRgba(
      snapshot.bytes,
      snapshot.width,
      snapshot.height,
      supersampleScale,
    );

    return {
      png: exportPngRgba({
        width: outputWidth,
        height: outputHeight,
        bytes: downsampled,
      }),
      passCount: commandBuffer.passCount,
      unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
      summaries,
    };
  } finally {
    textHost.close();
  }
};
