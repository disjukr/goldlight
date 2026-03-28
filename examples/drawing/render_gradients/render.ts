import { exportPngRgba } from '@disjukr/goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@disjukr/goldlight/gpu';
import {
  createPath2d,
  createRect,
  createRectPath2d,
  type Point2d,
} from '@disjukr/goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  saveDrawingRecorder,
  submitToDawnQueueManager,
} from '@disjukr/goldlight/drawing';

const outputWidth = 960;
const outputHeight = 720;

const createBlobPath = (
  center: Point2d,
  radiusX: number,
  radiusY: number,
) =>
  createPath2d(
    { kind: 'moveTo', to: [center[0], center[1] - radiusY] },
    {
      kind: 'cubicTo',
      control1: [center[0] + radiusX * 0.7, center[1] - radiusY * 1.05],
      control2: [center[0] + radiusX * 1.1, center[1] - radiusY * 0.1],
      to: [center[0] + radiusX, center[1] + radiusY * 0.06],
    },
    {
      kind: 'cubicTo',
      control1: [center[0] + radiusX * 0.82, center[1] + radiusY * 0.94],
      control2: [center[0] - radiusX * 0.18, center[1] + radiusY * 1.14],
      to: [center[0] - radiusX * 0.16, center[1] + radiusY],
    },
    {
      kind: 'cubicTo',
      control1: [center[0] - radiusX * 0.92, center[1] + radiusY * 0.82],
      control2: [center[0] - radiusX * 1.08, center[1] - radiusY * 0.18],
      to: [center[0], center[1] - radiusY],
    },
    { kind: 'close' },
  );

const createStarPath = (
  center: Point2d,
  outerRadius: number,
  innerRadius: number,
) => {
  const points: Point2d[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (-Math.PI / 2) + (index * Math.PI / 5);
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    points.push([
      center[0] + (Math.cos(angle) * radius),
      center[1] + (Math.sin(angle) * radius),
    ]);
  }

  return createPath2d(
    { kind: 'moveTo', to: points[0]! },
    ...points.slice(1).map((point) => ({ kind: 'lineTo', to: point }) as const),
    { kind: 'close' },
  );
};

export const renderGradientsSnapshot = async (): Promise<
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

  saveDrawingRecorder(recorder);

  recordClear(recorder, [0.05, 0.07, 0.1, 1]);
  recordDrawPath(recorder, createRectPath2d(createRect(36, 36, 888, 648)), {
    style: 'fill',
    color: [0.09, 0.11, 0.15, 1],
  });

  recordDrawPath(recorder, createRectPath2d(createRect(72, 78, 244, 564)), {
    style: 'fill',
    color: [0.13, 0.15, 0.2, 1],
  });
  recordDrawPath(recorder, createRectPath2d(createRect(358, 78, 244, 564)), {
    style: 'fill',
    color: [0.13, 0.15, 0.2, 1],
  });
  recordDrawPath(recorder, createRectPath2d(createRect(644, 78, 244, 564)), {
    style: 'fill',
    color: [0.13, 0.15, 0.2, 1],
  });

  recordDrawPath(recorder, createBlobPath([194, 256], 88, 116), {
    style: 'fill',
    shader: {
      kind: 'linear-gradient',
      start: [106, 124],
      end: [282, 386],
      stops: [
        { offset: 0, color: [1, 0.53, 0.24, 1] },
        { offset: 1, color: [0.98, 0.13, 0.5, 1] },
      ],
    },
  });
  recordDrawPath(recorder, createRectPath2d(createRect(112, 408, 164, 138)), {
    style: 'fill',
    shader: {
      kind: 'linear-gradient',
      start: [112, 408],
      end: [276, 546],
      stops: [
        { offset: 0, color: [0.18, 0.86, 0.76, 1] },
        { offset: 1, color: [0.15, 0.39, 1, 1] },
      ],
    },
  });

  recordDrawPath(recorder, createBlobPath([480, 248], 94, 122), {
    style: 'fill',
    shader: {
      kind: 'two-point-conical-gradient',
      startCenter: [452, 222],
      startRadius: 12,
      endCenter: [492, 260],
      endRadius: 146,
      stops: [
        { offset: 0, color: [1, 0.96, 0.7, 1] },
        { offset: 1, color: [0.23, 0.56, 1, 1] },
      ],
    },
  });
  recordDrawPath(recorder, createStarPath([480, 468], 96, 46), {
    style: 'fill',
    shader: {
      kind: 'radial-gradient',
      center: [480, 468],
      radius: 118,
      stops: [
        { offset: 0, color: [0.96, 0.88, 0.34, 1] },
        { offset: 1, color: [0.92, 0.2, 0.38, 0.95] },
      ],
    },
  });

  recordDrawPath(recorder, createStarPath([766, 236], 110, 48), {
    style: 'fill',
    shader: {
      kind: 'sweep-gradient',
      center: [766, 236],
      startAngle: -Math.PI / 2,
      endAngle: Math.PI * 1.5,
      stops: [
        { offset: 0, color: [0.2, 1, 0.82, 1] },
        { offset: 1, color: [0.42, 0.12, 0.98, 1] },
      ],
    },
  });
  recordDrawPath(recorder, createBlobPath([766, 470], 96, 88), {
    style: 'fill',
    shader: {
      kind: 'sweep-gradient',
      center: [766, 470],
      startAngle: 0,
      endAngle: Math.PI * 2,
      stops: [
        { offset: 0, color: [1, 0.82, 0.23, 1] },
        { offset: 1, color: [0.94, 0.22, 0.46, 1] },
      ],
    },
  });

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
