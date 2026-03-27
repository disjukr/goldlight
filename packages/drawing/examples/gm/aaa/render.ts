import { exportPngRgba } from '@goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import {
  createCirclePath2d,
  createPath2d,
  createRect,
  createRectPath2d,
  withPath2dFillRule,
} from '@goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  concatDrawingRecorderTransform,
  type DrawingRecorder,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  submitToDawnQueueManager,
  translateDrawingRecorder,
} from '@goldlight/drawing';

const gmWidth = 800;
const gmHeight = 800;
const outputWidth = gmWidth;
const outputHeight = gmHeight * 3;

type Point = readonly [number, number];
type Matrix2d = readonly [number, number, number, number, number, number];
type PathVerb = ReturnType<typeof createPath2d>['verbs'][number];

const red: readonly [number, number, number, number] = [1, 0, 0, 1];
const white: readonly [number, number, number, number] = [1, 1, 1, 1];

const createRotationMatrix2d = (degrees: number): Matrix2d => {
  const radians = degrees * (Math.PI / 180);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, s, -s, c, 0, 0];
};

const drawAnalyticAntialiasConvex = (recorder: DrawingRecorder): void => {
  const rotation = createRotationMatrix2d(1);

  saveDrawingRecorder(recorder);
  concatDrawingRecorderTransform(recorder, rotation);
  recordDrawPath(recorder, createRectPath2d(createRect(20, 20, 180, 180)), {
    style: 'fill',
    color: red,
  });
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 0, 200);
  concatDrawingRecorderTransform(recorder, rotation);
  recordDrawPath(recorder, createRectPath2d(createRect(20, 20, 0.2, 180)), {
    style: 'fill',
    color: red,
  });
  recordDrawPath(recorder, createRectPath2d(createRect(20, 200, 180, 0.1)), {
    style: 'fill',
    color: red,
  });
  recordDrawPath(recorder, createCirclePath2d({ center: [100, 100], radius: 30 }, 256), {
    style: 'fill',
    color: red,
  });
  restoreDrawingRecorder(recorder);

  const emptyBugPath = createPath2d(
    { kind: 'moveTo', to: [77.8073, 231.626] },
    {
      kind: 'cubicTo',
      control1: [77.8075, 231.626],
      control2: [77.8074, 231.625],
      to: [77.8073, 231.625],
    },
    { kind: 'lineTo', to: [77.8073, 231.626] },
    { kind: 'close' },
  );
  recordDrawPath(recorder, emptyBugPath, { style: 'fill', color: red });

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 0, 400);
  recordDrawPath(
    recorder,
    createPath2d(
      { kind: 'moveTo', to: [1.98009784, 9.0162744] },
      { kind: 'lineTo', to: [47.843992, 10.1922744] },
      { kind: 'lineTo', to: [47.804008, 11.7597256] },
      { kind: 'lineTo', to: [1.93990216, 10.5837256] },
      { kind: 'close' },
    ),
    { style: 'fill', color: red },
  );
  restoreDrawingRecorder(recorder);

  recordDrawPath(recorder, createRectPath2d(createRect(700, 266, 10, 268)), {
    style: 'fill',
    color: red,
  });
};

const drawAnalyticAntialiasGeneral = (recorder: DrawingRecorder): void => {
  const rotation = createRotationMatrix2d(1);
  const radius = 115.2;
  const center: Point = [128, 128];
  const points: Point[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = 2.6927937 * index;
    points.push([
      center[0] + (radius * Math.cos(angle)),
      center[1] + (radius * Math.sin(angle)),
    ]);
  }
  const path = createPath2d(
    { kind: 'moveTo', to: points[0]! },
    ...points.slice(1).map((point) => ({ kind: 'lineTo', to: point }) as const),
  );

  saveDrawingRecorder(recorder);
  concatDrawingRecorderTransform(recorder, rotation);
  recordDrawPath(recorder, path, { style: 'fill', color: red });
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 200, 0);
  concatDrawingRecorderTransform(recorder, rotation);
  recordDrawPath(recorder, path, {
    style: 'stroke',
    strokeWidth: 5,
    color: red,
  });
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 0, 300);
  recordDrawPath(
    recorder,
    createPath2d(
      ...createRectPath2d(createRect(20, 20, 80.4999, 80)).verbs,
      ...createRectPath2d(createRect(100.5001, 20, 99.4999, 80)).verbs,
    ),
    { style: 'fill', color: red },
  );
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 300, 300);
  recordDrawPath(
    recorder,
    createPath2d(
      ...createRectPath2d(createRect(20, 20, 80.1, 80)).verbs,
      ...createRectPath2d(createRect(100.9, 20, 99.1, 80)).verbs,
    ),
    { style: 'fill', color: red },
  );
  restoreDrawingRecorder(recorder);
};

const drawAnalyticAntialiasInverse = (recorder: DrawingRecorder): void => {
  const path = withPath2dFillRule(
    createPath2d(
      ...createRectPath2d(createRect(0, 0, gmWidth, gmHeight)).verbs,
      ...createCirclePath2d({ center: [100, 100], radius: 30 }, 256).verbs,
    ),
    'evenodd',
  );
  recordDrawPath(recorder, path, {
    style: 'fill',
    color: red,
  });
};

export const renderAaaSnapshot = async (): Promise<
  Readonly<{
    png: Uint8Array;
    passCount: number;
    unsupportedCommandCount: number;
  }>
> => {
  const drawingContext = await requestDrawingContext({
    target: {
      kind: 'offscreen',
      width: outputWidth,
      height: outputHeight,
      format: 'rgba8unorm',
      msaaSampleCount: 1,
    },
  });

  const binding = createOffscreenBinding(drawingContext.backend);
  const recorder = drawingContext.createRecorder();

  recordClear(recorder, white);
  drawAnalyticAntialiasConvex(recorder);
  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 0, gmHeight);
  drawAnalyticAntialiasGeneral(recorder);
  restoreDrawingRecorder(recorder);
  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 0, gmHeight * 2);
  drawAnalyticAntialiasInverse(recorder);
  restoreDrawingRecorder(recorder);

  const recording = finishDrawingRecorder(recorder);
  const commandBuffer = encodeDawnCommandBuffer(drawingContext.sharedContext, recording, binding);
  submitToDawnQueueManager(drawingContext.sharedContext.queueManager, commandBuffer);
  await drawingContext.tick();
  await checkForFinishedDawnQueueWork(drawingContext.sharedContext.queueManager, 'yes');

  const snapshot = await readOffscreenSnapshot(
    { device: drawingContext.backend.device, queue: drawingContext.backend.queue },
    binding,
  );

  return {
    png: exportPngRgba({
      width: outputWidth,
      height: outputHeight,
      bytes: snapshot.bytes,
    }),
    passCount: commandBuffer.passCount,
    unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
  };
};
