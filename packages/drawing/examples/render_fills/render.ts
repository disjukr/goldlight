import { exportPngRgba } from '@rieul3d/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@rieul3d/gpu';
import {
  createPath2D,
  createRect,
  createRectPath2D,
  type Point2D,
  withPath2DFillRule,
} from '@rieul3d/geometry';
import {
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
} from '@rieul3d/drawing';

const outputWidth = 720;
const outputHeight = 980;
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

const createRoundedDiamondPath = (
  center: Point2D,
  radiusX: number,
  radiusY: number,
) => createPath2D(
  { kind: 'moveTo', to: [center[0], center[1] - radiusY] },
  {
    kind: 'quadTo',
    control: [center[0] + radiusX, center[1] - radiusY * 0.2],
    to: [center[0] + radiusX, center[1]],
  },
  {
    kind: 'quadTo',
    control: [center[0] + radiusX * 0.2, center[1] + radiusY],
    to: [center[0], center[1] + radiusY],
  },
  {
    kind: 'quadTo',
    control: [center[0] - radiusX, center[1] + radiusY * 0.2],
    to: [center[0] - radiusX, center[1]],
  },
  {
    kind: 'quadTo',
    control: [center[0] - radiusX * 0.2, center[1] - radiusY],
    to: [center[0], center[1] - radiusY],
  },
  { kind: 'close' },
);

const createKitePath = (
  center: Point2D,
  width: number,
  height: number,
) => {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return createPath2D(
    { kind: 'moveTo', to: [center[0], top] },
    { kind: 'lineTo', to: [right, center[1] - height * 0.12] },
    { kind: 'lineTo', to: [center[0] + width * 0.18, bottom] },
    { kind: 'lineTo', to: [left, center[1] + height * 0.08] },
    { kind: 'close' },
  );
};

const createWobblyDiamondPath = (
  center: Point2D,
  width: number,
  height: number,
) => {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return createPath2D(
    { kind: 'moveTo', to: [center[0], top] },
    {
      kind: 'cubicTo',
      control1: [center[0] + width * 0.22, top + height * 0.08],
      control2: [right + width * 0.06, center[1] - height * 0.12],
      to: [right, center[1] - height * 0.02],
    },
    {
      kind: 'cubicTo',
      control1: [right - width * 0.06, center[1] + height * 0.2],
      control2: [center[0] + width * 0.3, bottom + height * 0.04],
      to: [center[0] + width * 0.08, bottom],
    },
    {
      kind: 'cubicTo',
      control1: [center[0] - width * 0.12, bottom - height * 0.02],
      control2: [left + width * 0.22, center[1] + height * 0.32],
      to: [left, center[1] + height * 0.1],
    },
    {
      kind: 'cubicTo',
      control1: [left + width * 0.18, center[1] - height * 0.18],
      control2: [center[0] - width * 0.16, top + height * 0.14],
      to: [center[0], top],
    },
    { kind: 'close' },
  );
};

const createConcaveKitePath = (
  center: Point2D,
  width: number,
  height: number,
) => {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return createPath2D(
    { kind: 'moveTo', to: [center[0], top] },
    {
      kind: 'quadTo',
      control: [right + width * 0.04, center[1] - height * 0.22],
      to: [right, center[1] - height * 0.06],
    },
    {
      kind: 'cubicTo',
      control1: [right - width * 0.26, center[1] + height * 0.08],
      control2: [center[0] + width * 0.08, center[1] + height * 0.02],
      to: [center[0] + width * 0.12, center[1] + height * 0.16],
    },
    {
      kind: 'quadTo',
      control: [center[0] - width * 0.04, bottom + height * 0.04],
      to: [center[0] - width * 0.18, bottom],
    },
    {
      kind: 'quadTo',
      control: [left - width * 0.08, center[1] + height * 0.04],
      to: [left, center[1] - height * 0.02],
    },
    {
      kind: 'quadTo',
      control: [center[0] - width * 0.08, center[1] - height * 0.24],
      to: [center[0], top],
    },
    { kind: 'close' },
  );
};

const createTrianglePath = (
  a: Point2D,
  b: Point2D,
  c: Point2D,
) => createPath2D(
  { kind: 'moveTo', to: a },
  { kind: 'lineTo', to: b },
  { kind: 'lineTo', to: c },
  { kind: 'close' },
);

const createSelfIntersectingStarPath = (
  center: Point2D,
  radius: number,
) => {
  const points: Point2D[] = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = (-Math.PI / 2) + ((index * Math.PI * 2) / 5);
    points.push([
      center[0] + (Math.cos(angle) * radius),
      center[1] + (Math.sin(angle) * radius),
    ]);
  }

  return withPath2DFillRule(
    createPath2D(
      { kind: 'moveTo', to: points[0]! },
      { kind: 'lineTo', to: points[2]! },
      { kind: 'lineTo', to: points[4]! },
      { kind: 'lineTo', to: points[1]! },
      { kind: 'lineTo', to: points[3]! },
      { kind: 'close' },
    ),
    'evenodd',
  );
};

const createDiamondCutoutRectPath = (
  x: number,
  y: number,
  width: number,
  height: number,
  holeRadiusX: number,
  holeRadiusY: number,
) => {
  const center: Point2D = [x + width / 2, y + height / 2];
  return createPath2D(
    ...createRectPath2D(createRect(x, y, width, height)).verbs,
    { kind: 'moveTo', to: [center[0], center[1] - holeRadiusY] },
    { kind: 'lineTo', to: [center[0] - holeRadiusX, center[1]] },
    { kind: 'lineTo', to: [center[0], center[1] + holeRadiusY] },
    { kind: 'lineTo', to: [center[0] + holeRadiusX, center[1]] },
    { kind: 'close' },
  );
};

const createFigureEightPath = (
  center: Point2D,
  width: number,
  height: number,
) => {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return createPath2D(
    { kind: 'moveTo', to: [left, center[1] - height * 0.18] },
    {
      kind: 'cubicTo',
      control1: [left + width * 0.22, top],
      control2: [center[0] - width * 0.08, top],
      to: [center[0], center[1]],
    },
    {
      kind: 'cubicTo',
      control1: [center[0] + width * 0.08, bottom],
      control2: [right - width * 0.22, bottom],
      to: [right, center[1] + height * 0.18],
    },
    {
      kind: 'cubicTo',
      control1: [right - width * 0.18, top + height * 0.02],
      control2: [center[0] + width * 0.1, top + height * 0.08],
      to: [center[0], center[1]],
    },
    {
      kind: 'cubicTo',
      control1: [center[0] - width * 0.12, bottom - height * 0.08],
      control2: [left + width * 0.18, bottom - height * 0.02],
      to: [left, center[1] - height * 0.18],
    },
    { kind: 'close' },
  );
};

const createNestedDiamondPath = (
  center: Point2D,
  width: number,
  height: number,
  innerScale = 0.52,
) =>
  createPath2D(
    ...createRoundedDiamondPath(center, width / 2, height / 2).verbs,
    ...createRoundedDiamondPath(
      center,
      (width * innerScale) / 2,
      (height * innerScale) / 2,
    ).verbs,
  );

export const renderFillsSnapshot = async (): Promise<
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
  recordDrawPath(recorder, createRectPath2D(createRect(44, 44, 632, 892)), {
    style: 'fill',
    color: [0.14, 0.15, 0.18, 1],
  });

  recordDrawPath(recorder, createTrianglePath([92, 226], [182, 88], [274, 226]), {
    style: 'fill',
    color: [0.91, 0.37, 0.23, 1],
  });
  recordDrawPath(recorder, createWobblyDiamondPath([370, 156], 186, 134), {
    style: 'fill',
    color: [0.98, 0.8, 0.33, 1],
  });
  recordDrawPath(recorder, createRoundedDiamondPath([558, 160], 88, 72), {
    style: 'fill',
    color: [0.22, 0.58, 0.47, 1],
  });

  recordDrawPath(recorder, createDiamondCutoutRectPath(84, 304, 170, 152, 34, 42), {
    style: 'fill',
    color: [0.19, 0.54, 0.79, 0.94],
  });
  recordDrawPath(recorder, createSelfIntersectingStarPath([336, 350], 72), {
    style: 'fill',
    color: [0.64, 0.38, 0.84, 0.92],
  });
  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 58, 326);
  recordDrawPath(recorder, createTrianglePath([0, 0], [146, 0], [0, 118]), {
    style: 'fill',
    color: [0.78, 0.46, 0.82, 0.72],
  });
  restoreDrawingRecorder(recorder);
  recordDrawPath(recorder, createConcaveKitePath([528, 382], 120, 142), {
    style: 'fill',
    color: [0.9, 0.59, 0.18, 1],
  });

  recordDrawPath(recorder, createTrianglePath([94, 714], [152, 614], [212, 714]), {
    style: 'fill',
    color: [0.95, 0.46, 0.28, 0.54],
  });
  recordDrawPath(recorder, createTrianglePath([152, 736], [278, 606], [322, 742]), {
    style: 'fill',
    color: [0.2, 0.47, 0.9, 0.42],
  });
  recordDrawPath(recorder, createRoundedDiamondPath([252, 690], 104, 114), {
    style: 'fill',
    color: [0.13, 0.65, 0.52, 0.4],
  });
  recordDrawPath(recorder, createNestedDiamondPath([482, 834], 124, 92), {
    style: 'fill',
    color: [0.96, 0.73, 0.36, 0.88],
  });
  recordDrawPath(recorder, withPath2DFillRule(createNestedDiamondPath([608, 834], 124, 92), 'evenodd'), {
    style: 'fill',
    color: [0.48, 0.77, 0.86, 0.88],
  });

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 370, 556);
  recordDrawPath(recorder, createRectPath2D(createRect(0, 0, 210, 220)), {
    style: 'fill',
    color: [0.16, 0.18, 0.24, 0.96],
  });
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 388, 576);
  recordDrawPath(recorder, createRoundedDiamondPath([80, 92], 68, 88), {
    style: 'fill',
    color: [0.96, 0.82, 0.35, 0.95],
  });
  recordDrawPath(recorder, createTrianglePath([48, 170], [124, 34], [166, 170]), {
    style: 'fill',
    color: [0.28, 0.63, 0.55, 0.72],
  });
  restoreDrawingRecorder(recorder);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [88, 850] },
      { kind: 'lineTo', to: [282, 850] },
      { kind: 'lineTo', to: [282, 890] },
      {
        kind: 'cubicTo',
        control1: [248, 926],
        control2: [122, 926],
        to: [88, 890],
      },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.86, 0.34, 0.43, 1] },
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
