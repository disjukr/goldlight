import { exportPngRgba } from '@goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import { createRect, createRectPath2D } from '@goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitToDawnQueueManager,
} from '@goldlight/drawing';

const cellSize = 50;
const numColumns = 2;
const numRows = 9;
const padSize = 10;
const outputWidth = numColumns * (cellSize + padSize);
const outputHeight = numRows * (cellSize + padSize);
const supersampleScale = 4;

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
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sampleY = 0; sampleY < scale; sampleY += 1) {
        for (let sampleX = 0; sampleX < scale; sampleX += 1) {
          const sourceX = (x * scale) + sampleX;
          const sourceY = (y * scale) + sampleY;
          const sourceOffset = ((sourceY * width) + sourceX) * 4;
          r += bytes[sourceOffset];
          g += bytes[sourceOffset + 1];
          b += bytes[sourceOffset + 2];
          a += bytes[sourceOffset + 3];
        }
      }
      const targetOffset = ((y * nextWidth) + x) * 4;
      const sampleCount = scale * scale;
      downsampled[targetOffset] = Math.round(r / sampleCount);
      downsampled[targetOffset + 1] = Math.round(g / sampleCount);
      downsampled[targetOffset + 2] = Math.round(b / sampleCount);
      downsampled[targetOffset + 3] = Math.round(a / sampleCount);
    }
  }

  return downsampled;
};

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
      width: outputWidth * supersampleScale,
      height: outputHeight * supersampleScale,
      format: 'rgba8unorm',
      sampleCount: 4,
    },
  });

  const binding = createOffscreenBinding(drawingContext.backend);
  const recorder = drawingContext.createRecorder();

  saveDrawingRecorder(recorder);
  scaleDrawingRecorder(recorder, supersampleScale, supersampleScale);

  recordClear(recorder, [1, 1, 1, 1]);

  for (let row = 0; row < gradientCases.length; row += 1) {
    const y = row * (cellSize + padSize);
    const stops = gradientCases[row]!;
    const linearRect = createRect(0, y, cellSize, cellSize);
    const radialRect = createRect(cellSize + padSize, y, cellSize, cellSize);

    recordDrawPath(recorder, createRectPath2D(linearRect), {
      style: 'fill',
      shader: {
        kind: 'linear-gradient',
        start: [cellSize, y],
        end: [cellSize, y + cellSize],
        stops,
      },
    });

    recordDrawPath(recorder, createRectPath2D(radialRect), {
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
  const downsampled = downsampleRgba(
    snapshot.bytes,
    snapshot.width,
    snapshot.height,
    supersampleScale,
  );

  return {
    png: exportPngRgba({
      width: outputWidth,
      height: outputHeight,
      bytes: downsampled,
    }),
    passCount: commandBuffer.passCount,
    unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
  };
};
