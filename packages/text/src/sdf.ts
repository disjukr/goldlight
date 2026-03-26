import type { SdfGlyph, SdfSubRun, ShapedRun, TextHost } from './types.ts';

export type CreateGlyphSdfOptions = Readonly<{
  inset?: number;
  radius?: number;
}>;

export const buildSdfSubRun = (
  host: TextHost,
  run: ShapedRun,
  options: CreateGlyphSdfOptions = {},
): SdfSubRun => {
  const sdfInset = Math.max(1, Math.floor(options.inset ?? 8));
  const sdfRadius = Math.max(1, options.radius ?? sdfInset);
  const glyphs: SdfGlyph[] = [];

  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index]!;
    const x = run.positions[index * 2]! + run.offsets[index * 2]!;
    const y = run.positions[(index * 2) + 1]! + run.offsets[(index * 2) + 1]!;
    const mask = host.getGlyphMask(run.typeface, glyphID, run.size);
    glyphs.push({
      glyphID,
      x,
      y,
      mask,
      sdf: host.getGlyphSdf(run.typeface, glyphID, run.size, {
        inset: sdfInset,
        radius: sdfRadius,
      }),
      sdfInset,
      sdfRadius,
    });
  }

  return {
    typeface: run.typeface,
    size: run.size,
    glyphs,
    sdfInset,
    sdfRadius,
  };
};
