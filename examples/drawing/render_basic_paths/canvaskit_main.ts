import { dirname, fromFileUrl, join } from '@std/path';
import { renderBasicPathsCanvasKitSnapshot } from './canvaskit.ts';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'ckout.png');
const snapshot = await renderBasicPathsCanvasKitSnapshot();

await Deno.writeFile(outputPath, snapshot.png);

console.log(`Wrote ${outputPath}`);
