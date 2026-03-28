import { dirname, fromFileUrl, join } from '@std/path';
import { renderBasicPathsSnapshot } from './render.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'out.png');
const snapshot = await renderBasicPathsSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
