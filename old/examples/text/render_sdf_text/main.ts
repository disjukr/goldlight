import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBunWebGpu } from '../../shared/install_bun_webgpu.ts';
import { renderSdfTextSnapshot } from './render.ts';

await installBunWebGpu();
const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(exampleDir, 'out.png');
const snapshot = renderSdfTextSnapshot();

await writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(
  `Atlas: ${snapshot.atlas.width}x${snapshot.atlas.height}, entries=${snapshot.atlas.entries.size}`,
);
for (const summary of snapshot.summaries) {
  console.log(
    `${summary.label}: family=${summary.family}, glyphs=${summary.glyphCount}, atlasGlyphs=${summary.atlasGlyphCount}, sdfInset=${summary.sdfInset}, sdfRadius=${summary.sdfRadius}`,
  );
}
process.exit(0);
