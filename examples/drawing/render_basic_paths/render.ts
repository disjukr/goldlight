import { exportPngRgba } from '@disjukr/goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@disjukr/goldlight/gpu';
import {
  createPath2d,
  createRect,
  createRectPath2d,
  withPath2dFillRule,
} from '@disjukr/goldlight/geometry';
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
  submitToDawnQueueManager,
  translateDrawingRecorder,
} from '@disjukr/goldlight/drawing';

const outputSize = 512;

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
      width: outputSize,
      height: outputSize,
      format: 'rgba8unorm',
      msaaSampleCount: 1,
    },
  });

  const binding = createOffscreenBinding(drawingContext.backend);
  const recorder = drawingContext.createRecorder();

  saveDrawingRecorder(recorder);
  recordClear(recorder, [0.96, 0.95, 0.91, 1]);
  recordDrawPath(recorder, createRectPath2d(createRect(48, 48, 416, 416)), {
    style: 'fill',
    color: [0.14, 0.15, 0.18, 1],
  });

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 12, 0);
  recordDrawPath(
    recorder,
    createPath2d(
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
    createPath2d(
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
    withPath2dFillRule(
      createPath2d(
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
    createPath2d(
      { kind: 'moveTo', to: [292, 292] },
      { kind: 'lineTo', to: [408, 292] },
      { kind: 'lineTo', to: [350, 408] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2d(
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

  return {
    png: exportPngRgba({
      width: outputSize,
      height: outputSize,
      bytes: snapshot.bytes,
    }),
    passCount: commandBuffer.passCount,
    unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
  };
};
