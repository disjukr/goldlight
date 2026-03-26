import { exportPngRgba } from '@goldlight/exporters';
import {
  buildDirectMaskSubRun,
  createTextHost,
  type DirectMaskSubRun,
  type GlyphMask,
} from '@goldlight/text';

const outputWidth = 1200;
const outputHeight = 720;
const atlasWidth = 512;
const atlasHeight = 256;
const atlasPadding = 2;

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
  direction?: 'ltr' | 'rtl';
}>;

type SampleSummary = Readonly<{
  label: string;
  family: string;
  glyphCount: number;
  atlasGlyphCount: number;
}>;

const samples: readonly TextSample[] = [
  {
    label: 'Latin UI',
    text: 'Direct mask atlas text',
    familyCandidates: ['Segoe UI', 'Arial', 'Calibri'],
    language: 'en',
  },
  {
    label: 'Combining marks',
    text: 'Am\u00e9lie coo\u0308perate resume\u0301',
    familyCandidates: ['Segoe UI', 'Arial', 'Calibri'],
    language: 'en',
  },
  {
    label: 'Hangul',
    text: '\uD55C\uAE00 A8 \uC544\uD2C0\uB77C\uC2A4 \uD14D\uC2A4\uD2B8',
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

const blitAtlasGlyph = (
  surface: Uint8Array,
  surfaceWidth: number,
  surfaceHeight: number,
  destX: number,
  destY: number,
  atlas: AtlasPage,
  entry: AtlasEntry,
  color: readonly [number, number, number, number],
) => {
  const colorR = color[0];
  const colorG = color[1];
  const colorB = color[2];
  const colorA = color[3];

  for (let row = 0; row < entry.height; row += 1) {
    const targetY = destY + row;
    if (targetY < 0 || targetY >= surfaceHeight) {
      continue;
    }
    for (let column = 0; column < entry.width; column += 1) {
      const targetX = destX + column;
      if (targetX < 0 || targetX >= surfaceWidth) {
        continue;
      }
      const alpha = (atlas.pixels[((entry.y + row) * atlas.width) + entry.x + column] ?? 0) / 255;
      const sourceAlpha = alpha * colorA;
      if (sourceAlpha <= 0) {
        continue;
      }
      const offset = ((targetY * surfaceWidth) + targetX) * 4;
      const destR = surface[offset] / 255;
      const destG = surface[offset + 1] / 255;
      const destB = surface[offset + 2] / 255;
      const destA = surface[offset + 3] / 255;
      const outA = sourceAlpha + (destA * (1 - sourceAlpha));
      const outR = (colorR * sourceAlpha) + (destR * (1 - sourceAlpha));
      const outG = (colorG * sourceAlpha) + (destG * (1 - sourceAlpha));
      const outB = (colorB * sourceAlpha) + (destB * (1 - sourceAlpha));
      surface[offset] = Math.round(outR * 255);
      surface[offset + 1] = Math.round(outG * 255);
      surface[offset + 2] = Math.round(outB * 255);
      surface[offset + 3] = Math.round(outA * 255);
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

const packMasksIntoAtlas = (subruns: readonly DirectMaskSubRun[]): AtlasPage => {
  const entries = new Map<string, AtlasEntry>();
  const pixels = new Uint8Array(atlasWidth * atlasHeight);
  let cursorX = atlasPadding;
  let cursorY = atlasPadding;
  let rowHeight = 0;

  for (const subrun of subruns) {
    for (const glyph of subrun.glyphs) {
      const mask = glyph.mask;
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
        throw new Error('Atlas page overflowed in render_a8_atlas_text example');
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
      [0.1, 0.8, 1, 1],
    );
    fillRect(
      surface,
      outputWidth,
      outputHeight,
      originX + (entry.x * scale),
      originY + ((entry.y + entry.height) * scale),
      entry.width * scale,
      1,
      [0.1, 0.8, 1, 1],
    );
    fillRect(
      surface,
      outputWidth,
      outputHeight,
      originX + (entry.x * scale),
      originY + (entry.y * scale),
      1,
      entry.height * scale,
      [0.1, 0.8, 1, 1],
    );
    fillRect(
      surface,
      outputWidth,
      outputHeight,
      originX + ((entry.x + entry.width) * scale),
      originY + (entry.y * scale),
      1,
      entry.height * scale,
      [0.1, 0.8, 1, 1],
    );
  }
};

export const renderA8AtlasTextSnapshot = (): Readonly<{
  png: Uint8Array;
  atlas: AtlasPage;
  summaries: readonly SampleSummary[];
}> => {
  const textHost = createTextHost();
  try {
    const subruns: DirectMaskSubRun[] = [];
    const summaries: SampleSummary[] = [];

    for (const sample of samples) {
      const matched = matchCandidateTypeface(textHost, sample.familyCandidates);
      if (!matched) {
        continue;
      }
      const shapedRun = textHost.shapeText({
        typeface: matched.typeface,
        text: sample.text,
        size: 40,
        direction: sample.direction ?? 'ltr',
        language: sample.language,
      });
      const subrun = buildDirectMaskSubRun(textHost, shapedRun);
      subruns.push(subrun);
      summaries.push({
        label: sample.label,
        family: matched.family,
        glyphCount: shapedRun.glyphIDs.length,
        atlasGlyphCount: subrun.glyphs.filter((glyph) =>
          glyph.mask && glyph.mask.width > 0 && glyph.mask.height > 0
        ).length,
      });
    }

    const atlas = packMasksIntoAtlas(subruns);
    const surface = createRgbaSurface(outputWidth, outputHeight, [0.95, 0.94, 0.91, 1]);

    fillRect(surface, outputWidth, outputHeight, 24, 24, 660, 672, [0.1, 0.11, 0.13, 1]);
    fillRect(surface, outputWidth, outputHeight, 708, 24, 468, 672, [0.08, 0.09, 0.11, 1]);
    fillRect(surface, outputWidth, outputHeight, 60, 84, 560, 2, [0.95, 0.79, 0.24, 0.85]);
    fillRect(surface, outputWidth, outputHeight, 60, 220, 560, 2, [0.95, 0.79, 0.24, 0.85]);
    fillRect(surface, outputWidth, outputHeight, 60, 356, 560, 2, [0.95, 0.79, 0.24, 0.85]);

    let baselineY = 84;
    for (const subrun of subruns) {
      for (const glyph of subrun.glyphs) {
        const key = `${subrun.typeface}:${subrun.size}:${glyph.glyphID}`;
        const entry = atlas.entries.get(key);
        if (!entry) {
          continue;
        }
        blitAtlasGlyph(
          surface,
          outputWidth,
          outputHeight,
          Math.round(60 + glyph.x + entry.offsetX),
          Math.round(baselineY + glyph.y + entry.offsetY),
          atlas,
          entry,
          [0.98, 0.98, 0.97, 1],
        );
      }
      baselineY += 136;
    }

    drawAtlasPreview(surface, atlas, 736, 72, 1.5);

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
