import {
  type DrawingPaint,
  type DrawingRecorder,
  recordDrawDirectMaskText,
  recordDrawPath,
  recordDrawSdfText,
  recordDrawTransformedMaskText,
} from '@goldlight/drawing';
import { createTranslationMatrix2d, transformPath2d } from '@goldlight/geometry';
import type { DirectMaskSubRun, SdfSubRun, TextHost, TransformedMaskSubRun } from './types.ts';

export const recordDirectMaskSubRun = (
  recorder: DrawingRecorder,
  subRun: DirectMaskSubRun,
  paint: DrawingPaint = {},
): void => {
  recordDrawDirectMaskText(
    recorder,
    subRun.glyphs,
    paint,
  );
};

export const recordSdfSubRun = (
  recorder: DrawingRecorder,
  subRun: SdfSubRun,
  paint: DrawingPaint = {},
): void => {
  recordDrawSdfText(
    recorder,
    subRun.glyphs,
    paint,
  );
};

export const recordTransformedMaskSubRun = (
  recorder: DrawingRecorder,
  subRun: TransformedMaskSubRun,
  paint: DrawingPaint = {},
): void => {
  recordDrawTransformedMaskText(
    recorder,
    subRun.glyphs,
    paint,
  );
};

export const recordPathFallbackRun = (
  host: TextHost,
  recorder: DrawingRecorder,
  run: Readonly<{
    typeface: bigint;
    size: number;
    glyphIDs: Uint32Array;
    positions: Float32Array;
    offsets: Float32Array;
  }>,
  paint: DrawingPaint = {},
): void => {
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index]!;
    const path = host.getGlyphPath(run.typeface, glyphID, run.size);
    if (!path) {
      continue;
    }
    const x = run.positions[index * 2]! + run.offsets[index * 2]!;
    const y = run.positions[index * 2 + 1]! + run.offsets[index * 2 + 1]!;
    recordDrawPath(
      recorder,
      transformPath2d(path, createTranslationMatrix2d(x, y)),
      paint,
    );
  }
};
