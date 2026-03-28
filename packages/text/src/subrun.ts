import type {
  DirectMaskGlyph,
  DirectMaskSubRun,
  ShapedRun,
  TextHost,
  TransformedMaskGlyph,
  TransformedMaskSubRun,
} from './types.ts';

export const buildDirectMaskSubRun = (
  host: TextHost,
  run: ShapedRun,
): DirectMaskSubRun => {
  const glyphs: DirectMaskGlyph[] = [];
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index]!;
    const x = run.positions[index * 2]! + run.offsets[index * 2]!;
    const y = run.positions[index * 2 + 1]! + run.offsets[index * 2 + 1]!;
    glyphs.push({
      glyphID,
      x,
      y,
      mask: host.getGlyphMask(run.typeface, glyphID, run.size),
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
