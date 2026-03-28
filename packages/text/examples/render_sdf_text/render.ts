import { exportPngRgba } from '@goldlight/exporters';
import { buildSdfSubRun, createTextHost, type GlyphMask, type SdfSubRun } from '@goldlight/text';

const outputWidth = 1280;
const outputHeight = 760;
const atlasWidth = 640;
const atlasHeight = 320;
const atlasPadding = 2;
const renderScale = 2.25;

type AtlasEntry = Readonly<{
  key: string;
  glyphID: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}>;

type AtlasPage = Readonly<{
  width: number;
  height: number;
  pixels: Uint8Array;
  entries: ReadonlyMap<string, AtlasEntry>;
}>;

type TextSample = Readonly<{
  label: string;
  text: string;
  familyCandidates: readonly string[];
  language?: string;
}>;

type SampleSummary = Readonly<{
  label: string;
  family: string;
  glyphCount: number;
  atlasGlyphCount: number;
  sdfInset: number;
  sdfRadius: number;
}>;

const samples: readonly TextSample[] = [
  {
    label: 'Large Latin',
    text: 'Signed Distance Field',
    familyCandidates: ['Segoe UI', 'Arial', 'Calibri'],
    language: 'en',
  },
  {
    label: 'Combining marks',
    text: 'Am\u00e9lie coo\u0308perate',
    familyCandidates: ['Segoe UI', 'Arial', 'Calibri'],
    language: 'en',
  },
  {
    label: 'Hangul',
    text: 'SDF \uD14D\uC2A4\uD2B8',
    familyCandidates: ['Malgun Gothic', 'Segoe UI', 'Arial Unicode MS'],
    language: 'ko',
  },
];

const createRgbaSurface = (
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) => {
  const bytes = new Uint8Array(width * height * 4);
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  const a = Math.round(color[3] * 255);
  for (let index = 0; index < bytes.length; index += 4) {
    bytes[index] = r;
    bytes[index + 1] = g;
    bytes[index + 2] = b;
    bytes[index + 3] = a;
  }
  return bytes;
};

const fillRect = (
  surface: Uint8Array,
  surfaceWidth: number,
  surfaceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) => {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(surfaceWidth, Math.ceil(x + width));
  const y1 = Math.min(surfaceHeight, Math.ceil(y + height));
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  const a = Math.round(color[3] * 255);

  for (let row = y0; row < y1; row += 1) {
    for (let column = x0; column < x1; column += 1) {
      const offset = ((row * surfaceWidth) + column) * 4;
      surface[offset] = r;
      surface[offset + 1] = g;
      surface[offset + 2] = b;
      surface[offset + 3] = a;
    }
  }
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - (2 * t));
};

const sampleAtlas = (atlas: AtlasPage, x: number, y: number) => {
  const clampedX = Math.max(0, Math.min(atlas.width - 1, x));
  const clampedY = Math.max(0, Math.min(atlas.height - 1, y));
  return (atlas.pixels[(clampedY * atlas.width) + clampedX] ?? 0) / 255;
};

const sampleAtlasBilinear = (atlas: AtlasPage, x: number, y: number) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const top = (sampleAtlas(atlas, x0, y0) * (1 - tx)) + (sampleAtlas(atlas, x1, y0) * tx);
  const bottom = (sampleAtlas(atlas, x0, y1) * (1 - tx)) + (sampleAtlas(atlas, x1, y1) * tx);
  return (top * (1 - ty)) + (bottom * ty);
};

const blendPixel = (
  surface: Uint8Array,
  surfaceWidth: number,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
  alpha: number,
) => {
  if (alpha <= 0) {
    return;
  }
  const offset = ((y * surfaceWidth) + x) * 4;
  const srcA = alpha * color[3];
  const dstR = surface[offset] / 255;
  const dstG = surface[offset + 1] / 255;
  const dstB = surface[offset + 2] / 255;
  const dstA = surface[offset + 3] / 255;
  const outA = srcA + (dstA * (1 - srcA));
  const outR = (color[0] * srcA) + (dstR * (1 - srcA));
  const outG = (color[1] * srcA) + (dstG * (1 - srcA));
  const outB = (color[2] * srcA) + (dstB * (1 - srcA));
  surface[offset] = Math.round(outR * 255);
  surface[offset + 1] = Math.round(outG * 255);
  surface[offset + 2] = Math.round(outB * 255);
  surface[offset + 3] = Math.round(outA * 255);
};

const drawSdfGlyph = (
  surface: Uint8Array,
  surfaceWidth: number,
  surfaceHeight: number,
  atlas: AtlasPage,
  entry: AtlasEntry,
  destX: number,
  destY: number,
  scale: number,
  color: readonly [number, number, number, number],
) => {
  const drawWidth = Math.max(1, Math.ceil(entry.width * scale));
  const drawHeight = Math.max(1, Math.ceil(entry.height * scale));

  for (let row = 0; row < drawHeight; row += 1) {
    const targetY = destY + row;
    if (targetY < 0 || targetY >= surfaceHeight) {
      continue;
    }
    for (let column = 0; column < drawWidth; column += 1) {
      const targetX = destX + column;
      if (targetX < 0 || targetX >= surfaceWidth) {
        continue;
      }

      const atlasX = entry.x + ((column + 0.5) / scale);
      const atlasY = entry.y + ((row + 0.5) / scale);
      const distance = sampleAtlasBilinear(atlas, atlasX, atlasY);
      const alpha = smoothstep(0.42, 0.58, distance);
      blendPixel(surface, surfaceWidth, targetX, targetY, color, alpha);
    }
  }
};

const writeAtlasMask = (pixels: Uint8Array, width: number, entry: AtlasEntry, mask: GlyphMask) => {
  for (let row = 0; row < mask.height; row += 1) {
    const sourceStart = row * mask.stride;
    const targetStart = ((entry.y + row) * width) + entry.x;
    pixels.set(mask.pixels.subarray(sourceStart, sourceStart + mask.width), targetStart);
  }
};

const packSdfMasksIntoAtlas = (subruns: readonly SdfSubRun[]): AtlasPage => {
  const entries = new Map<string, AtlasEntry>();
  const pixels = new Uint8Array(atlasWidth * atlasHeight);
  let cursorX = atlasPadding;
  let cursorY = atlasPadding;
  let rowHeight = 0;

  for (const subrun of subruns) {
    for (const glyph of subrun.glyphs) {
      const mask = glyph.sdf;
      if (!mask || mask.width === 0 || mask.height === 0) {
        continue;
      }
      const key = `${subrun.typeface}:${subrun.size}:${glyph.glyphID}`;
      if (entries.has(key)) {
        continue;
      }

      if (cursorX + mask.width + atlasPadding > atlasWidth) {
        cursorX = atlasPadding;
        cursorY += rowHeight + atlasPadding;
        rowHeight = 0;
      }
      if (cursorY + mask.height + atlasPadding > atlasHeight) {
        throw new Error('Atlas page overflowed in render_sdf_text example');
      }

      const entry: AtlasEntry = {
        key,
        glyphID: glyph.glyphID,
        width: mask.width,
        height: mask.height,
        offsetX: mask.offsetX,
        offsetY: mask.offsetY,
        x: cursorX,
        y: cursorY,
      };
      entries.set(key, entry);
      writeAtlasMask(pixels, atlasWidth, entry, mask);

      cursorX += mask.width + atlasPadding;
      rowHeight = Math.max(rowHeight, mask.height);
    }
  }

  return {
    width: atlasWidth,
    height: atlasHeight,
    pixels,
    entries,
  };
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

const drawAtlasPreview = (
  surface: Uint8Array,
  atlas: AtlasPage,
  originX: number,
  originY: number,
  scale: number,
) => {
  fillRect(
    surface,
    outputWidth,
    outputHeight,
    originX - 16,
    originY - 16,
    atlas.width * scale + 32,
    atlas.height * scale + 32,
    [0.12, 0.13, 0.16, 1],
  );

  for (let row = 0; row < atlas.height; row += 1) {
    for (let column = 0; column < atlas.width; column += 1) {
      const alpha = atlas.pixels[(row * atlas.width) + column] ?? 0;
      if (alpha === 0) {
        continue;
      }
      const value = alpha / 255;
      fillRect(
        surface,
        outputWidth,
        outputHeight,
        originX + (column * scale),
        originY + (row * scale),
        scale,
        scale,
        [value, value, value, 1],
      );
    }
  }

  for (const entry of atlas.entries.values()) {
    fillRect(
      surface,
      outputWidth,
      outputHeight,
      originX + (entry.x * scale),
      originY + (entry.y * scale),
      entry.width * scale,
      1,
      [0.15, 0.78, 0.98, 1],
    );
    fillRect(
      surface,
      outputWidth,
      outputHeight,
      originX + (entry.x * scale),
      originY + ((entry.y + entry.height) * scale),
      entry.width * scale,
      1,
      [0.15, 0.78, 0.98, 1],
    );
    fillRect(
      surface,
      outputWidth,
      outputHeight,
      originX + (entry.x * scale),
      originY + (entry.y * scale),
      1,
      entry.height * scale,
      [0.15, 0.78, 0.98, 1],
    );
    fillRect(
      surface,
      outputWidth,
      outputHeight,
      originX + ((entry.x + entry.width) * scale),
      originY + (entry.y * scale),
      1,
      entry.height * scale,
      [0.15, 0.78, 0.98, 1],
    );
  }
};

export const renderSdfTextSnapshot = (): Readonly<{
  png: Uint8Array;
  atlas: AtlasPage;
  summaries: readonly SampleSummary[];
}> => {
  const textHost = createTextHost();
  try {
    const subruns: SdfSubRun[] = [];
    const summaries: SampleSummary[] = [];

    for (const sample of samples) {
      const matched = matchCandidateTypeface(textHost, sample.familyCandidates);
      if (!matched) {
        continue;
      }
      const shapedRun = textHost.shapeText({
        typeface: matched.typeface,
        text: sample.text,
        size: 42,
        direction: 'ltr',
        language: sample.language,
      });
      const subrun = buildSdfSubRun(textHost, shapedRun);
      subruns.push(subrun);
      summaries.push({
        label: sample.label,
        family: matched.family,
        glyphCount: shapedRun.glyphIDs.length,
        atlasGlyphCount: subrun.glyphs.filter((glyph) =>
          glyph.sdf && glyph.sdf.width > 0 && glyph.sdf.height > 0
        ).length,
        sdfInset: subrun.sdfInset,
        sdfRadius: subrun.sdfRadius,
      });
    }

    const atlas = packSdfMasksIntoAtlas(subruns);
    const surface = createRgbaSurface(outputWidth, outputHeight, [0.95, 0.94, 0.91, 1]);

    fillRect(surface, outputWidth, outputHeight, 24, 24, 724, 712, [0.1, 0.11, 0.13, 1]);
    fillRect(surface, outputWidth, outputHeight, 772, 24, 484, 712, [0.08, 0.09, 0.11, 1]);

    let baselineY = 128;
    for (const subrun of subruns) {
      fillRect(surface, outputWidth, outputHeight, 72, baselineY, 600, 2, [0.95, 0.79, 0.24, 0.85]);

      for (const glyph of subrun.glyphs) {
        const key = `${subrun.typeface}:${subrun.size}:${glyph.glyphID}`;
        const entry = atlas.entries.get(key);
        if (!entry) {
          continue;
        }
        drawSdfGlyph(
          surface,
          outputWidth,
          outputHeight,
          atlas,
          entry,
          Math.round(72 + (glyph.x * renderScale) + (entry.offsetX * renderScale)),
          Math.round(baselineY + (glyph.y * renderScale) + (entry.offsetY * renderScale)),
          renderScale,
          [0.98, 0.98, 0.97, 1],
        );
      }

      baselineY += 208;
    }

    drawAtlasPreview(surface, atlas, 804, 72, 1.1);

    return {
      png: exportPngRgba({
        width: outputWidth,
        height: outputHeight,
        bytes: surface,
      }),
      atlas,
      summaries,
    };
  } finally {
    textHost.close();
  }
};
