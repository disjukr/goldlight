import { dirname, fromFileUrl, join } from '@std/path';
import { renderFillrectGradientCanvasKitSnapshot } from './canvaskit.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'ckout.png');
const snapshot = await renderFillrectGradientCanvasKitSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
