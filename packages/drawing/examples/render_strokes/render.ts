import { exportPngRgba } from '@rieul3d/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@rieul3d/gpu';
import { createPath2D } from '@rieul3d/geometry';
import {
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitToDawnQueueManager,
} from '@rieul3d/drawing';

const outputWidth = 680;
const outputHeight = 940;
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

export const renderStrokesSnapshot = async (): Promise<
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

  recordClear(recorder, [0.97, 0.95, 0.9, 1]);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [90, 180] },
      { kind: 'lineTo', to: [160, 80] },
      { kind: 'lineTo', to: [230, 180] },
    ),
    {
      style: 'stroke',
      strokeWidth: 28,
      strokeJoin: 'miter',
      strokeCap: 'butt',
      color: [0.88, 0.32, 0.2, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [275, 180] },
      { kind: 'lineTo', to: [345, 80] },
      { kind: 'lineTo', to: [415, 180] },
    ),
    {
      style: 'stroke',
      strokeWidth: 28,
      strokeJoin: 'bevel',
      strokeCap: 'butt',
      color: [0.23, 0.59, 0.47, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [460, 180] },
      { kind: 'lineTo', to: [530, 80] },
      { kind: 'lineTo', to: [600, 180] },
    ),
    {
      style: 'stroke',
      strokeWidth: 28,
      strokeJoin: 'round',
      strokeCap: 'butt',
      color: [0.16, 0.41, 0.82, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [90, 315] },
      { kind: 'lineTo', to: [210, 315] },
    ),
    {
      style: 'stroke',
      strokeWidth: 32,
      strokeJoin: 'round',
      strokeCap: 'butt',
      color: [0.52, 0.21, 0.72, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [260, 315] },
      { kind: 'lineTo', to: [380, 315] },
    ),
    {
      style: 'stroke',
      strokeWidth: 32,
      strokeJoin: 'round',
      strokeCap: 'square',
      color: [0.87, 0.54, 0.15, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [430, 315] },
      { kind: 'lineTo', to: [550, 315] },
    ),
    {
      style: 'stroke',
      strokeWidth: 32,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.15, 0.58, 0.76, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [88, 430] },
      { kind: 'lineTo', to: [552, 430] },
    ),
    {
      style: 'stroke',
      strokeWidth: 14,
      strokeCap: 'round',
      dashArray: [28, 18],
      dashOffset: 6,
      color: [0.62, 0.21, 0.22, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [80, 535] },
      {
        kind: 'cubicTo',
        control1: [180, 395],
        control2: [280, 675],
        to: [380, 535],
      },
      {
        kind: 'cubicTo',
        control1: [450, 445],
        control2: [540, 445],
        to: [600, 535],
      },
    ),
    {
      style: 'stroke',
      strokeWidth: 22,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.11, 0.13, 0.18, 1],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [80, 675] },
      { kind: 'quadTo', control: [185, 565], to: [300, 675] },
    ),
    {
      style: 'stroke',
      strokeWidth: 18,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.76, 0.18, 0.42, 0.55],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [410, 675] },
      {
        kind: 'arcTo',
        center: [500, 675],
        radius: 90,
        startAngle: Math.PI,
        endAngle: 0,
      },
    ),
    {
      style: 'stroke',
      strokeWidth: 18,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.13, 0.45, 0.36, 0.85],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [500, 748] },
      { kind: 'lineTo', to: [542, 878] },
      { kind: 'lineTo', to: [430, 796] },
      { kind: 'lineTo', to: [570, 796] },
      { kind: 'lineTo', to: [458, 878] },
      { kind: 'close' },
    ),
    {
      style: 'stroke',
      strokeWidth: 18,
      strokeJoin: 'miter',
      strokeCap: 'butt',
      color: [0.66, 0.22, 0.72, 0.5],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [110, 850] },
      { kind: 'lineTo', to: [300, 760] },
    ),
    {
      style: 'stroke',
      strokeWidth: 26,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.18, 0.43, 0.82, 0.45],
    },
  );

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [110, 760] },
      { kind: 'lineTo', to: [300, 850] },
    ),
    {
      style: 'stroke',
      strokeWidth: 26,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.9, 0.36, 0.18, 0.45],
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
