import { exportPngRgba } from '@goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import { createPath2D, createRect, createRectPath2D, withPath2DFillRule } from '@goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  clipDrawingRecorderPath,
  clipDrawingRecorderRect,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitToDawnQueueManager,
  translateDrawingRecorder,
} from '@goldlight/drawing';

const outputSize = 512;
const supersampleScale = 2;

const downsampleRgba = (
  bytes: Uint8Array,
  width: number,
  height: number,
  scale: number,
): Uint8Array => {
  const nextWidth = Math.floor(width / scale);
  const nextHeight = Math.floor(height / scale);
  const downsampled = new Uint8Array(nextWidth * nextHeight * 4);

  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sampleY = 0; sampleY < scale; sampleY += 1) {
        for (let sampleX = 0; sampleX < scale; sampleX += 1) {
          const sourceX = (x * scale) + sampleX;
          const sourceY = (y * scale) + sampleY;
          const sourceOffset = ((sourceY * width) + sourceX) * 4;
          sums[0] += bytes[sourceOffset];
          sums[1] += bytes[sourceOffset + 1];
          sums[2] += bytes[sourceOffset + 2];
          sums[3] += bytes[sourceOffset + 3];
        }
      }
      const targetOffset = ((y * nextWidth) + x) * 4;
      const sampleCount = scale * scale;
      downsampled[targetOffset] = Math.round(sums[0] / sampleCount);
      downsampled[targetOffset + 1] = Math.round(sums[1] / sampleCount);
      downsampled[targetOffset + 2] = Math.round(sums[2] / sampleCount);
      downsampled[targetOffset + 3] = Math.round(sums[3] / sampleCount);
    }
  }

  return downsampled;
};

export const renderBasicPathsSnapshot = async (): Promise<
  Readonly<{
    png: Uint8Array;
    passCount: number;
    unsupportedCommandCount: number;
  }>
> => {
  const drawingContext = await requestDrawingContext({
    target: {
      kind: 'offscreen',
      width: outputSize * supersampleScale,
      height: outputSize * supersampleScale,
      format: 'rgba8unorm',
      sampleCount: 4,
    },
  });

  const binding = createOffscreenBinding(drawingContext.backend);
  const recorder = drawingContext.createRecorder();

  saveDrawingRecorder(recorder);
  scaleDrawingRecorder(recorder, supersampleScale, supersampleScale);
  recordClear(recorder, [0.96, 0.95, 0.91, 1]);
  recordDrawPath(recorder, createRectPath2D(createRect(48, 48, 416, 416)), {
    style: 'fill',
    color: [0.14, 0.15, 0.18, 1],
  });

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 12, 0);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [84, 384] },
      { kind: 'lineTo', to: [244, 96] },
      { kind: 'lineTo', to: [404, 384] },
      { kind: 'close' },
    ),
    {
      style: 'fill',
      color: [0.88, 0.36, 0.22, 1],
    },
  );
  restoreDrawingRecorder(recorder);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [148, 332] },
      { kind: 'cubicTo', control1: [192, 168], control2: [320, 168], to: [364, 332] },
      { kind: 'lineTo', to: [148, 332] },
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

  saveDrawingRecorder(recorder);
  clipDrawingRecorderRect(recorder, createRect(280, 280, 140, 140));
  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [292, 292] },
      { kind: 'lineTo', to: [408, 292] },
      { kind: 'lineTo', to: [350, 408] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [280, 360] },
      { kind: 'cubicTo', control1: [320, 240], control2: [380, 240], to: [420, 360] },
      { kind: 'lineTo', to: [420, 420] },
    ),
    {
      style: 'stroke',
      strokeWidth: 10,
      strokeJoin: 'round',
      strokeCap: 'square',
      color: [0.12, 0.38, 0.82, 1],
    },
  );
  restoreDrawingRecorder(recorder);

  const recording = finishDrawingRecorder(recorder);
  const commandBuffer = encodeDawnCommandBuffer(
    drawingContext.sharedContext,
    recording,
    binding,
  );

  submitToDawnQueueManager(drawingContext.sharedContext.queueManager, commandBuffer);
  await drawingContext.tick();
  await checkForFinishedDawnQueueWork(drawingContext.sharedContext.queueManager, 'yes');

  const snapshot = await readOffscreenSnapshot(
    {
      device: drawingContext.backend.device,
      queue: drawingContext.backend.queue,
    },
    binding,
  );
  const downsampled = downsampleRgba(
    snapshot.bytes,
    snapshot.width,
    snapshot.height,
    supersampleScale,
  );

  return {
    png: exportPngRgba({
      width: outputSize,
      height: outputSize,
      bytes: downsampled,
    }),
    passCount: commandBuffer.passCount,
    unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
  };
};
