import { dirname, fromFileUrl, join } from '@std/path';
import { exportPngRgba } from '@rieul3d/exporters';
import {
  createOffscreenBinding,
  readOffscreenSnapshot,
} from '@rieul3d/gpu';
import {
  createPath2D,
  createRect,
  createRectPath2D,
  withPath2DFillRule,
} from '@rieul3d/geometry';
import {
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  submitToDawnQueueManager,
} from '@rieul3d/drawing';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const outputPath = join(exampleDir, 'out.png');

const drawingContext = await requestDrawingContext({
  target: {
    kind: 'offscreen',
    width: 512,
    height: 512,
    format: 'rgba8unorm',
    sampleCount: 1,
  },
});

const binding = createOffscreenBinding(drawingContext.backend);
const recorder = drawingContext.createRecorder();

recordClear(recorder, [0.96, 0.95, 0.91, 1]);
recordDrawPath(recorder, createRectPath2D(createRect(48, 48, 416, 416)), {
  style: 'fill',
  color: [0.14, 0.15, 0.18, 1],
});
recordDrawPath(
  recorder,
  createPath2D(
    { kind: 'moveTo', to: [96, 384] },
    { kind: 'lineTo', to: [256, 96] },
    { kind: 'lineTo', to: [416, 384] },
    { kind: 'close' },
  ),
  {
    style: 'fill',
    color: [0.88, 0.36, 0.22, 1],
  },
);
recordDrawPath(
  recorder,
  createPath2D(
    { kind: 'moveTo', to: [148, 332] },
    { kind: 'lineTo', to: [256, 156] },
    { kind: 'lineTo', to: [364, 332] },
    { kind: 'close' },
  ),
  {
    style: 'fill',
    color: [0.98, 0.81, 0.33, 1],
  },
);
recordDrawPath(
  recorder,
  withPath2DFillRule(
    createPath2D(
      { kind: 'moveTo', to: [72, 72] },
      { kind: 'lineTo', to: [200, 72] },
      { kind: 'lineTo', to: [200, 200] },
      { kind: 'lineTo', to: [72, 200] },
      { kind: 'close' },
      { kind: 'moveTo', to: [104, 104] },
      { kind: 'lineTo', to: [168, 104] },
      { kind: 'lineTo', to: [168, 168] },
      { kind: 'lineTo', to: [104, 168] },
      { kind: 'close' },
    ),
    'evenodd',
  ),
  {
    style: 'fill',
    color: [0.18, 0.55, 0.46, 1],
  },
);

const recording = finishDrawingRecorder(recorder);
const commandBuffer = encodeDawnCommandBuffer(
  drawingContext.sharedContext,
  recording,
  binding,
);

submitToDawnQueueManager(drawingContext.sharedContext.queueManager, commandBuffer);
await drawingContext.tick();

const snapshot = await readOffscreenSnapshot(
  {
    device: drawingContext.backend.device,
    queue: drawingContext.backend.queue,
  },
  binding,
);
const png = exportPngRgba(snapshot);

await Deno.writeFile(outputPath, png);

console.log(`Wrote ${outputPath}`);
console.log(`Passes: ${commandBuffer.passCount}`);
console.log(`Unsupported commands: ${commandBuffer.unsupportedCommands.length}`);
