import { dirname, fromFileUrl, join } from '@std/path';
import { renderTextOnPathSnapshot } from './render.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'out.png');
const snapshot = await renderTextOnPathSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
for (const summary of snapshot.summaries) {
  console.log(`${summary.label}: family=${summary.family}, placements=${summary.placementCount}`);
}
