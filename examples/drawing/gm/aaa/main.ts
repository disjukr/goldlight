import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBunWebGpu } from '../../../shared/install_bun_webgpu.ts';
import { renderAaaSnapshot } from './render.ts';

await installBunWebGpu();
const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(exampleDir, 'out.png');
const snapshot = await renderAaaSnapshot();

await writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
console.log(`Passes: ${snapshot.passCount}`);
console.log(`Unsupported commands: ${snapshot.unsupportedCommandCount}`);
process.exit(0);
