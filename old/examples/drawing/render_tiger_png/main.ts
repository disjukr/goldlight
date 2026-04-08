import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBunWebGpu } from '../../shared/install_bun_webgpu.ts';
import { renderTigerSnapshot } from './render.ts';

await installBunWebGpu();
const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(exampleDir, 'tiger.png');
const snapshot = await renderTigerSnapshot();

await writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Paths: ${snapshot.pathCount}`);
console.log(`Draws: ${snapshot.drawCount}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
process.exit(0);
