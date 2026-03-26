import type { DirectMaskGlyph, DirectMaskSubRun, ShapedRun, TextHost } from './types.ts';

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
