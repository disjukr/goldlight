import { dirname, fromFileUrl, join } from '@std/path';
import { renderAaaCanvasKitSnapshot } from './canvaskit.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'ckout.png');
const snapshot = await renderAaaCanvasKitSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
