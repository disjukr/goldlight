import { exportPngRgba } from '@disjukr/goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@disjukr/goldlight/gpu';
import {
  createPath2d,
  createRect,
  createRectPath2d,
  type Point2d,
  withPath2dFillRule,
} from '@disjukr/goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
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

const outputWidth = 720;
const outputHeight = 980;

const createRoundedDiamondPath = (
  center: Point2d,
  radiusX: number,
  radiusY: number,
) =>
  createPath2d(
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

const createWobblyDiamondPath = (
  center: Point2d,
  width: number,
  height: number,
) => {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return createPath2d(
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
  center: Point2d,
  width: number,
  height: number,
) => {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return createPath2d(
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
  a: Point2d,
  b: Point2d,
  c: Point2d,
) =>
  createPath2d(
    { kind: 'moveTo', to: a },
    { kind: 'lineTo', to: b },
    { kind: 'lineTo', to: c },
    { kind: 'close' },
  );

const createSelfIntersectingStarPath = (
  center: Point2d,
  radius: number,
) => {
  const points: Point2d[] = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = (-Math.PI / 2) + ((index * Math.PI * 2) / 5);
    points.push([
      center[0] + (Math.cos(angle) * radius),
      center[1] + (Math.sin(angle) * radius),
    ]);
  }

  return withPath2dFillRule(
    createPath2d(
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

const createSoftStarPath = (
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

  const verbs: Parameters<typeof createPath2d>[number][] = [
    { kind: 'moveTo', to: points[0]! },
  ];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const control: Point2d = [
      ((current[0] + next[0]) / 2) + ((center[0] - (current[0] + next[0]) / 2) * 0.08),
      ((current[1] + next[1]) / 2) + ((center[1] - (current[1] + next[1]) / 2) * 0.08),
    ];
    verbs.push({ kind: 'quadTo', control, to: next });
  }
  verbs.push({ kind: 'close' });
  return createPath2d(...verbs);
};

const createDiamondCutoutRectPath = (
  x: number,
  y: number,
  width: number,
  height: number,
  holeRadiusX: number,
  holeRadiusY: number,
) => {
  const center: Point2d = [x + width / 2, y + height / 2];
  return createPath2d(
    ...createRectPath2d(createRect(x, y, width, height)).verbs,
    { kind: 'moveTo', to: [center[0], center[1] - holeRadiusY] },
    { kind: 'lineTo', to: [center[0] - holeRadiusX, center[1]] },
    { kind: 'lineTo', to: [center[0], center[1] + holeRadiusY] },
    { kind: 'lineTo', to: [center[0] + holeRadiusX, center[1]] },
    { kind: 'close' },
  );
};

const createNestedDiamondPath = (
  center: Point2d,
  width: number,
  height: number,
  innerScale = 0.52,
) =>
  createPath2d(
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
      width: outputWidth,
      height: outputHeight,
      format: 'rgba8unorm',
      msaaSampleCount: 1,
    },
  });

  const binding = createOffscreenBinding(drawingContext.backend);
  const recorder = drawingContext.createRecorder();

  saveDrawingRecorder(recorder);

  recordClear(recorder, [0.97, 0.95, 0.9, 1]);
  recordDrawPath(recorder, createRectPath2d(createRect(44, 44, 632, 892)), {
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
  recordDrawPath(recorder, createSoftStarPath([236, 688], 92, 46), {
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
  recordDrawPath(
    recorder,
    withPath2dFillRule(createNestedDiamondPath([608, 834], 124, 92), 'evenodd'),
    {
      style: 'fill',
      color: [0.48, 0.77, 0.86, 0.88],
    },
  );

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 370, 556);
  recordDrawPath(recorder, createRectPath2d(createRect(0, 0, 210, 220)), {
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
    createPath2d(
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
