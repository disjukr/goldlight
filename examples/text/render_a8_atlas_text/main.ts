import { dirname, fromFileUrl, join } from '@std/path';
import { renderA8AtlasTextSnapshot } from './render.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'out.png');
const snapshot = renderA8AtlasTextSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(
  `Atlas: ${snapshot.atlas.width}x${snapshot.atlas.height}, entries=${snapshot.atlas.entries.size}`,
);
for (const summary of snapshot.summaries) {
  console.log(
    `${summary.label}: family=${summary.family}, glyphs=${summary.glyphCount}, atlasGlyphs=${summary.atlasGlyphCount}`,
  );
}
