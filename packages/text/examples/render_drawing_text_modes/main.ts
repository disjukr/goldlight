import { dirname, fromFileUrl, join } from 'jsr:@std/path@^1.0.8';
import { renderDrawingTextModesSnapshot } from './render.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'out.png');
const snapshot = await renderDrawingTextModesSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
for (const summary of snapshot.summaries) {
  console.log(
    `${summary.label}: family=${summary.family}, glyphs=${summary.glyphCount}`,
  );
}
