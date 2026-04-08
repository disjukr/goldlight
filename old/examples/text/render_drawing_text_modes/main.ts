import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBunWebGpu } from '../../shared/install_bun_webgpu.ts';
import { renderDrawingTextModesSnapshot } from './render.ts';

await installBunWebGpu();
const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(exampleDir, 'out.png');
const snapshot = await renderDrawingTextModesSnapshot();

await writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
for (const summary of snapshot.summaries) {
  console.log(
    `${summary.label}: family=${summary.family}, glyphs=${summary.glyphCount}`,
  );
}
process.exit(0);
