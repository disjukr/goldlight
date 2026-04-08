import { identityMatrix2d, type Matrix2d, transformPoint2d } from '@disjukr/goldlight/geometry';
import type {
  DirectMaskGlyph,
  DirectMaskSubRun,
  ShapedRun,
  TextHost,
  TransformedMaskGlyph,
  TransformedMaskSubRun,
} from './types.ts';

const directMaskSubpixelRound = 1 / 8;

const invertAffineTransform = (
  transform: Matrix2d,
): Matrix2d | null => {
  const [m00, m10, m01, m11, tx, ty] = transform;
  const determinant = (m00 * m11) - (m01 * m10);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    return null;
  }
  const invDeterminant = 1 / determinant;
  const i00 = m11 * invDeterminant;
  const i10 = -m10 * invDeterminant;
  const i01 = -m01 * invDeterminant;
  const i11 = m00 * invDeterminant;
  return [
    i00,
    i10,
    i01,
    i11,
    -((i00 * tx) + (i01 * ty)),
    -((i10 * tx) + (i11 * ty)),
  ];
};

const quantizeDirectMaskSubpixelPhase = (mapped: number): number =>
  Math.floor(
    (((mapped + directMaskSubpixelRound) - Math.floor(mapped + directMaskSubpixelRound)) * 4) +
      1e-6,
  ) & 0x3;

export const buildDirectMaskSubRun = (
  host: TextHost,
  run: ShapedRun,
  transform: Matrix2d = identityMatrix2d,
): DirectMaskSubRun => {
  const inverse = invertAffineTransform(transform);
  const glyphs: DirectMaskGlyph[] = [];
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index]!;
    const x = run.positions[index * 2]! + run.offsets[index * 2]!;
    const y = run.positions[index * 2 + 1]! + run.offsets[index * 2 + 1]!;
    const mapped = transformPoint2d([x, y], transform);
    const phaseX = quantizeDirectMaskSubpixelPhase(mapped[0]) / 4;
    const phaseY = quantizeDirectMaskSubpixelPhase(mapped[1]) / 4;
    const snappedDeviceOrigin = [
      Math.floor(mapped[0] + directMaskSubpixelRound),
      Math.floor(mapped[1] + directMaskSubpixelRound),
    ] as const;
    const snappedLocalOrigin = inverse
      ? transformPoint2d(snappedDeviceOrigin, inverse)
      : [x, y] as const;
    const mask = host.getGlyphMask(run.typeface, glyphID, run.size, { x: phaseX, y: phaseY });
    glyphs.push({
      glyphID,
      x: mask ? snappedLocalOrigin[0] + mask.offsetX : snappedLocalOrigin[0],
      y: mask ? snappedLocalOrigin[1] + mask.offsetY : snappedLocalOrigin[1],
      mask,
    });
  }
  return {
    typeface: run.typeface,
    size: run.size,
    glyphs,
  };
};

export const buildTransformedMaskSubRun = (
  host: TextHost,
  run: ShapedRun,
  strikeScale: number,
): TransformedMaskSubRun => {
  const effectiveStrikeScale = Number.isFinite(strikeScale) && strikeScale > 1 ? strikeScale : 1;
  const strikeSize = run.size * effectiveStrikeScale;
  const strikeToSourceScale = run.size / strikeSize;
  const glyphs: TransformedMaskGlyph[] = [];
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index]!;
    const x = run.positions[index * 2]! + run.offsets[index * 2]!;
    const y = run.positions[index * 2 + 1]! + run.offsets[index * 2 + 1]!;
    const mask = host.getGlyphMask(run.typeface, glyphID, strikeSize);
    glyphs.push({
      glyphID,
      x: mask ? x + (mask.offsetX * strikeToSourceScale) : x,
      y: mask ? y + (mask.offsetY * strikeToSourceScale) : y,
      mask,
      strikeToSourceScale,
    });
  }
  return {
    typeface: run.typeface,
    size: run.size,
    glyphs,
    strikeScale: effectiveStrikeScale,
  };
};
