import { exportPngRgba } from '@goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import { createRect, createRectPath2d } from '@goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  saveDrawingRecorder,
  submitToDawnQueueManager,
} from '@goldlight/drawing';

const cellSize = 50;
const numColumns = 2;
const numRows = 9;
const padSize = 10;
const outputWidth = numColumns * (cellSize + padSize);
const outputHeight = numRows * (cellSize + padSize);

type GradientStop = Readonly<{
  offset: number;
  color: readonly [number, number, number, number];
}>;

const green: readonly [number, number, number, number] = [0, 1, 0, 1];
const white: readonly [number, number, number, number] = [1, 1, 1, 1];
const red: readonly [number, number, number, number] = [1, 0, 0, 1];
const blue: readonly [number, number, number, number] = [0, 0, 1, 1];
const yellow: readonly [number, number, number, number] = [1, 1, 0, 1];
const gray: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 1];
const cyan: readonly [number, number, number, number] = [0, 1, 1, 1];

const gradientCases: readonly (readonly GradientStop[])[] = [
  Object.freeze([
    { offset: 0, color: green },
    { offset: 1, color: white },
  ]),
  Object.freeze([
    { offset: 0, color: green },
    { offset: 0.5, color: white },
    { offset: 1, color: red },
  ]),
  Object.freeze([
    { offset: 0.4, color: green },
    { offset: 0.5, color: white },
    { offset: 0.6, color: red },
  ]),
  Object.freeze([{ offset: 0, color: red }]),
  Object.freeze([{ offset: 1, color: red }]),
  Object.freeze([{ offset: 0.5, color: red }]),
  Object.freeze([
    { offset: 0, color: blue },
    { offset: 0.5, color: white },
    { offset: 0.5, color: red },
    { offset: 1, color: yellow },
  ]),
  Object.freeze([
    { offset: 0, color: blue },
    { offset: 0.5, color: white },
    { offset: 0.5, color: gray },
    { offset: 0.5, color: cyan },
    { offset: 0.5, color: red },
    { offset: 1, color: yellow },
  ]),
  Object.freeze([
    { offset: 0.5, color: white },
    { offset: 0.5, color: gray },
    { offset: 1, color: yellow },
    { offset: 0.5, color: cyan },
    { offset: 0.5, color: red },
    { offset: 0, color: blue },
  ]),
];

export const renderFillrectGradientSnapshot = async (): Promise<
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

  recordClear(recorder, [1, 1, 1, 1]);

  for (let row = 0; row < gradientCases.length; row += 1) {
    const y = row * (cellSize + padSize);
    const stops = gradientCases[row]!;
    const linearRect = createRect(0, y, cellSize, cellSize);
    const radialRect = createRect(cellSize + padSize, y, cellSize, cellSize);

    recordDrawPath(recorder, createRectPath2d(linearRect), {
      style: 'fill',
      shader: {
        kind: 'linear-gradient',
        start: [cellSize, y],
        end: [cellSize, y + cellSize],
        stops,
      },
    });

    recordDrawPath(recorder, createRectPath2d(radialRect), {
      style: 'fill',
      shader: {
        kind: 'radial-gradient',
        center: [cellSize + padSize + (cellSize / 2), y + (cellSize / 2)],
        radius: cellSize / 2,
        stops,
      },
    });
  }

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
