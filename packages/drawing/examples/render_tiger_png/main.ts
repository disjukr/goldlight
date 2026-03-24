import { dirname, fromFileUrl, join } from '@std/path';
import { renderTigerSnapshot } from './render.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'tiger.png');
const snapshot = await renderTigerSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Paths: ${snapshot.pathCount}`);
console.log(`Draws: ${snapshot.drawCount}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
