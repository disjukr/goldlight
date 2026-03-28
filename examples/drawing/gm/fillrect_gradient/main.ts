import { dirname, fromFileUrl, join } from '@std/path';
import { renderFillrectGradientSnapshot } from './render.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'out.png');
const snapshot = await renderFillrectGradientSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
