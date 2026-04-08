import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAaaCanvasKitSnapshot } from './canvaskit.ts';

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(exampleDir, 'ckout.png');
const snapshot = await renderAaaCanvasKitSnapshot();

await writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
