import type {
  FontMetrics,
  FontQuery,
  ShapedRun,
  ShapeTextInput,
  TextHost,
  TypefaceHandle,
} from './types.ts';

export class TextFontManager {
  readonly #host: TextHost;

  constructor(host: TextHost) {
    this.#host = host;
  }

  listFamilies(): readonly string[] {
    return this.#host.listFamilies();
  }

  matchTypeface(query: FontQuery): TypefaceHandle | null {
    return this.#host.matchTypeface(query);
  }

  getFontMetrics(typeface: TypefaceHandle, size: number): FontMetrics {
    return this.#host.getFontMetrics(typeface, size);
  }

  shapeText(input: ShapeTextInput): ShapedRun {
    return this.#host.shapeText(input);
  }

  getGlyphPath(typeface: TypefaceHandle, glyphID: number, size: number) {
    return this.#host.getGlyphPath(typeface, glyphID, size);
  }

  getGlyphMask(
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
    subpixelOffset?: { x: number; y: number },
  ) {
    return this.#host.getGlyphMask(typeface, glyphID, size, subpixelOffset);
  }

  getGlyphSdf(
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
  ) {
    return this.#host.getGlyphSdf(typeface, glyphID, size);
  }

  close(): void {
    this.#host.close();
  }
}
