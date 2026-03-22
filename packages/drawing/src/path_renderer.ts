import {
  identityMatrix2D,
  type PathFillRule2D,
  type Point2D,
  type Rect,
  transformPoint2D,
} from '@rieul3d/geometry';
import {
  type DrawingPreparedClip,
  type DrawingPreparedClipElement,
  visitDrawingClipStackForDraw,
} from './clip_stack.ts';
import type {
  DrawingClipRect,
  DrawingPaint,
  DrawingPath2D,
  DrawingStrokeStyle,
  DrawPathCommand,
  DrawShapeCommand,
} from './types.ts';
import {
  type DrawingRendererKind,
  selectPathFillRenderer,
  selectPathStrokeRenderer,
} from './renderer_provider.ts';

type FlattenedSubpath = Readonly<{
  points: readonly Point2D[];
  closed: boolean;
}>;

export type DrawingPreparedVertex = Readonly<{
  point: Point2D;
  color: readonly [number, number, number, number];
}>;

type DrawingPreparedPatchBase = Readonly<{
  fanPoint?: Point2D;
  resolveLevel: number;
  wangsFormulaP4: number;
}>;

export type DrawingPreparedPatch = Readonly<
  | (DrawingPreparedPatchBase & {
    kind: 'line';
    points: readonly [Point2D, Point2D];
  })
  | (DrawingPreparedPatchBase & {
    kind: 'quadratic';
    points: readonly [Point2D, Point2D, Point2D];
  })
  | (DrawingPreparedPatchBase & {
    kind: 'conic';
    points: readonly [Point2D, Point2D, Point2D];
    weight: number;
  })
  | (DrawingPreparedPatchBase & {
    kind: 'cubic';
    points: readonly [Point2D, Point2D, Point2D, Point2D];
  })
>;

export type DrawingPreparedStrokePatch = Readonly<{
  patch: DrawingPreparedPatch;
  prevPoint: Point2D;
  joinControlPoint: Point2D;
  contourStart: boolean;
  contourEnd: boolean;
  startCap: 'none' | 'butt' | 'square' | 'round';
  endCap: 'none' | 'butt' | 'square' | 'round';
}>;

type DrawingPatchDefinition =
  | Readonly<{
    kind: 'line';
    points: readonly [Point2D, Point2D];
    fanPoint?: Point2D;
  }>
  | Readonly<{
    kind: 'quadratic';
    points: readonly [Point2D, Point2D, Point2D];
    fanPoint?: Point2D;
  }>
  | Readonly<{
    kind: 'conic';
    points: readonly [Point2D, Point2D, Point2D];
    weight: number;
    fanPoint?: Point2D;
  }>
  | Readonly<{
    kind: 'cubic';
    points: readonly [Point2D, Point2D, Point2D, Point2D];
    fanPoint?: Point2D;
  }>;

type DrawingStrokePatchContour = Readonly<{
  patches: readonly DrawingPreparedPatch[];
  closed: boolean;
  record: DrawingStrokeContourRecord;
}>;

type DrawingStrokeContourEvent = Readonly<{
  patch: DrawingPreparedPatch;
  contourStart: boolean;
  contourEnd: boolean;
  startCap: 'none' | 'butt' | 'square' | 'round';
  endCap: 'none' | 'butt' | 'square' | 'round';
  joinControlPoint?: Point2D;
}>;

type DrawingStrokeIteratorContourState = Readonly<{
  deferredFirstPatch: DrawingStrokeContourEvent;
  leadingPatches: readonly DrawingStrokeContourEvent[];
  bodyPatches: readonly DrawingStrokeContourEvent[];
  trailingPatches: readonly DrawingStrokeContourEvent[];
  joinBarrier: 'join' | 'moveWithinContour';
}>;

type DrawingStrokeIteratorVerb =
  | Readonly<{ kind: 'patch'; event: DrawingStrokeContourEvent }>
  | Readonly<{ kind: 'moveWithinContour' }>
  | Readonly<{ kind: 'contourFinished' }>;

type DrawingStrokeContourRecord = Readonly<{
  points: readonly Point2D[];
  closed: boolean;
  segments: readonly DrawingStrokeSegmentRecord[];
  degeneratePoint?: Point2D;
  firstPoint?: Point2D;
  lastPoint?: Point2D;
  startTangent?: Point2D;
  endTangent?: Point2D;
}>;

type DrawingStrokeSegmentRecord = Readonly<{
  start: Point2D;
  end: Point2D;
  direction: Point2D;
  normal: Point2D;
  leftStart: Point2D;
  rightStart: Point2D;
  leftEnd: Point2D;
  rightEnd: Point2D;
}>;

export type DrawingPreparedPathFill = Readonly<{
  kind: 'pathFill';
  renderer: DrawingRendererKind;
  triangles: readonly Point2D[];
  fringeVertices?: readonly DrawingPreparedVertex[];
  patches: readonly DrawingPreparedPatch[];
  fillRule: PathFillRule2D;
  color: readonly [number, number, number, number];
  transform: readonly [number, number, number, number, number, number];
  bounds: Rect;
  clipRect?: DrawingClipRect;
  clip?: DrawingPreparedClip;
  usesStencil: boolean;
}>;

export type DrawingPreparedPathStroke = Readonly<{
  kind: 'pathStroke';
  renderer: DrawingRendererKind;
  triangles: readonly Point2D[];
  fringeVertices?: readonly DrawingPreparedVertex[];
  patches: readonly DrawingPreparedStrokePatch[];
  usesTessellatedStrokePatches: boolean;
  color: readonly [number, number, number, number];
  strokeStyle: DrawingStrokeStyle;
  transform: readonly [number, number, number, number, number, number];
  bounds: Rect;
  clipRect?: DrawingClipRect;
  clip?: DrawingPreparedClip;
  usesStencil: boolean;
}>;

export type DrawingPreparedDraw = DrawingPreparedPathFill | DrawingPreparedPathStroke;

export type DrawingDrawPreparation = Readonly<
  | { supported: true; draw: DrawingPreparedDraw }
  | { supported: false; reason: string }
>;

const defaultFillColor: readonly [number, number, number, number] = [0, 0, 0, 1];
const epsilon = 1e-5;
const maxCurveSubdivisionDepth = 8;
const curveFlatnessTolerance = 0.75;
const patchPrecision = 4;
const maxPatchResolveLevel = 5;
const hairlineCoverageWidth = 1;
const aaFringeWidth = 1;
const cuspDerivativeEpsilon = 0.5;
const tessellationPrecision = 4;

const resolveFillColor = (paint: DrawingPaint): readonly [number, number, number, number] =>
  paint.color ?? defaultFillColor;

const resolveStrokeColor = (paint: DrawingPaint): readonly [number, number, number, number] => {
  const color = paint.color ?? defaultFillColor;
  const strokeWidth = paint.strokeWidth ?? 1;
  if (strokeWidth >= hairlineCoverageWidth) {
    return color;
  }
  const coverage = Math.max(0, strokeWidth / hairlineCoverageWidth);
  return [color[0], color[1], color[2], color[3] * coverage];
};

const resolveStrokeStyle = (paint: DrawingPaint): DrawingStrokeStyle => {
  const strokeWidth = Math.max(paint.strokeWidth ?? 1, epsilon);
  const halfWidth = Math.max(0.5, strokeWidth) / 2;
  const join = paint.strokeJoin ?? 'miter';
  return {
    halfWidth,
    joinLimit: join === 'round' ? -1 : join === 'bevel' ? 0 : Math.max(1, paint.miterLimit ?? 4),
    cap: paint.strokeCap ?? 'butt',
  };
};

const pointsEqual = (left: Point2D, right: Point2D): boolean =>
  Math.abs(left[0] - right[0]) <= epsilon && Math.abs(left[1] - right[1]) <= epsilon;

const cross = (origin: Point2D, a: Point2D, b: Point2D): number =>
  ((a[0] - origin[0]) * (b[1] - origin[1])) - ((a[1] - origin[1]) * (b[0] - origin[0]));

const dot = (left: Point2D, right: Point2D): number => (left[0] * right[0]) + (left[1] * right[1]);

const subtract = (
  left: Point2D,
  right: Point2D,
): Point2D => [left[0] - right[0], left[1] - right[1]];

const add = (left: Point2D, right: Point2D): Point2D => [left[0] + right[0], left[1] + right[1]];

const scale = (point: Point2D, factor: number): Point2D => [point[0] * factor, point[1] * factor];

const normalize = (point: Point2D): Point2D | null => {
  const length = Math.hypot(point[0], point[1]);
  if (length <= epsilon) {
    return null;
  }
  return [point[0] / length, point[1] / length];
};

const perpendicular = (vector: Point2D): Point2D => [-vector[1], vector[0]];

const midpoint = (a: Point2D, b: Point2D): Point2D => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const lerp = (a: Point2D, b: Point2D, t: number): Point2D => [
  a[0] + ((b[0] - a[0]) * t),
  a[1] + ((b[1] - a[1]) * t),
];

const distanceFromLine = (point: Point2D, start: Point2D, end: Point2D): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= epsilon) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  return Math.abs((dy * point[0]) - (dx * point[1]) + (end[0] * start[1]) - (end[1] * start[0])) /
    length;
};

const calcNumRadialSegmentsPerRadian = (approxStrokeRadius: number): number => {
  const radius = Math.max(approxStrokeRadius, 0.5);
  const cosTheta = 1 - ((1 / tessellationPrecision) / radius);
  return 0.5 / Math.acos(Math.max(cosTheta, -1));
};

const approximateQuadraticSegments = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
): number => {
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const controlPolygon = Math.hypot(control[0] - from[0], control[1] - from[1]) +
    Math.hypot(to[0] - control[0], to[1] - control[1]);
  const curvature = Math.max(0, controlPolygon - chord);
  return Math.max(
    1,
    Math.min(
      1 << maxCurveSubdivisionDepth,
      Math.ceil(Math.sqrt(curvature / Math.max(curveFlatnessTolerance, epsilon))),
    ),
  );
};

const approximateCubicSegments = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
): number => {
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const controlPolygon = Math.hypot(control1[0] - from[0], control1[1] - from[1]) +
    Math.hypot(control2[0] - control1[0], control2[1] - control1[1]) +
    Math.hypot(to[0] - control2[0], to[1] - control2[1]);
  const curvature = Math.max(0, controlPolygon - chord);
  return Math.max(
    1,
    Math.min(
      1 << maxCurveSubdivisionDepth,
      Math.ceil(Math.sqrt(curvature / Math.max(curveFlatnessTolerance * 0.75, epsilon))),
    ),
  );
};

const nextLog2 = (value: number): number => {
  if (!Number.isFinite(value) || value <= 1) {
    return 0;
  }
  return Math.ceil(Math.log2(value));
};

const quadraticWangsFormulaP4 = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
): number => {
  const vx = from[0] - (2 * control[0]) + to[0];
  const vy = from[1] - (2 * control[1]) + to[1];
  const lengthSquared = (vx * vx) + (vy * vy);
  return lengthSquared * patchPrecision * patchPrecision * 0.25;
};

const cubicWangsFormulaP4 = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
): number => {
  const v1x = from[0] - (2 * control1[0]) + control2[0];
  const v1y = from[1] - (2 * control1[1]) + control2[1];
  const v2x = control1[0] - (2 * control2[0]) + to[0];
  const v2y = control1[1] - (2 * control2[1]) + to[1];
  const maxLengthSquared = Math.max((v1x * v1x) + (v1y * v1y), (v2x * v2x) + (v2y * v2y));
  return maxLengthSquared * patchPrecision * patchPrecision * (81 / 64);
};

const conicWangsFormulaP2 = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  weight: number,
): number => {
  const center: Point2D = [
    (Math.min(from[0], control[0], to[0]) + Math.max(from[0], control[0], to[0])) * 0.5,
    (Math.min(from[1], control[1], to[1]) + Math.max(from[1], control[1], to[1])) * 0.5,
  ];
  const centered: readonly [Point2D, Point2D, Point2D] = [
    subtract(from, center),
    subtract(control, center),
    subtract(to, center),
  ];
  const maxLength = Math.max(
    Math.hypot(centered[0][0], centered[0][1]),
    Math.hypot(centered[1][0], centered[1][1]),
    Math.hypot(centered[2][0], centered[2][1]),
  );
  const dp = subtract(add(centered[0], centered[2]), scale(centered[1], 2 * weight));
  const dw = Math.abs(2 - (2 * weight));
  const rpMinusOne = Math.max(0, (maxLength * patchPrecision) - 1);
  const numerator = (Math.hypot(dp[0], dp[1]) * patchPrecision) + (rpMinusOne * dw);
  const denominator = 4 * Math.min(weight, 1);
  if (denominator <= epsilon) {
    return Infinity;
  }
  return Math.max(0, numerator / denominator);
};

const resolveLevelFromWangsFormulaP4 = (p4: number): number => Math.min(
  maxPatchResolveLevel,
  Math.max(0, Math.ceil(Math.log2(Math.sqrt(Math.sqrt(Math.max(p4, 1)))))),
);

const resolveLevelFromWangsFormulaP2 = (p2: number): number => Math.min(
  maxPatchResolveLevel,
  Math.max(0, nextLog2(Math.sqrt(Math.max(p2, 1)))),
);

const patchWangsFormulaP4 = (patch: DrawingPatchDefinition): number => {
  switch (patch.kind) {
    case 'line':
      return 1;
    case 'quadratic': {
      return quadraticWangsFormulaP4(patch.points[0], patch.points[1], patch.points[2]);
    }
    case 'conic': {
      const n2 = conicWangsFormulaP2(patch.points[0], patch.points[1], patch.points[2], patch.weight);
      return n2 * n2;
    }
    case 'cubic':
      return cubicWangsFormulaP4(patch.points[0], patch.points[1], patch.points[2], patch.points[3]);
  }
};

const resolvePatchLevel = (patch: DrawingPatchDefinition): number => {
  switch (patch.kind) {
    case 'line':
      return 0;
    case 'quadratic':
      return resolveLevelFromWangsFormulaP4(
        quadraticWangsFormulaP4(patch.points[0], patch.points[1], patch.points[2]),
      );
    case 'conic':
      return resolveLevelFromWangsFormulaP2(
        conicWangsFormulaP2(patch.points[0], patch.points[1], patch.points[2], patch.weight),
      );
    case 'cubic':
      return resolveLevelFromWangsFormulaP4(
        cubicWangsFormulaP4(patch.points[0], patch.points[1], patch.points[2], patch.points[3]),
      );
  }
};

const finalizePatch = (
  patch: DrawingPatchDefinition,
  extras: Readonly<{ fanPoint?: Point2D }> = {},
): DrawingPreparedPatch => {
  const resolveLevel = resolvePatchLevel(patch);
  const wangsFormulaP4 = patchWangsFormulaP4(patch);
  switch (patch.kind) {
    case 'line':
      return { ...patch, ...extras, resolveLevel, wangsFormulaP4 };
    case 'quadratic':
      return { ...patch, ...extras, resolveLevel, wangsFormulaP4 };
    case 'conic':
      return { ...patch, ...extras, resolveLevel, wangsFormulaP4 };
    case 'cubic':
      return { ...patch, ...extras, resolveLevel, wangsFormulaP4 };
  }
};

const maxStrokeCubicResolveLevelBeforeChop = 4;
const maxStrokeConicResolveLevelBeforeChop = 5;
const maxParametricSegments = 1 << maxPatchResolveLevel;
const maxParametricSegmentsP4 = maxParametricSegments ** 4;
const maxSegmentsPerCurve = 1024;
const maxSegmentsPerCurveP4 = maxSegmentsPerCurve ** 4;

const accountForStrokeCurve = (wangsFormulaP4: number): number => {
  if (wangsFormulaP4 <= maxParametricSegmentsP4) {
    return 0;
  }
  return Math.ceil(Math.sqrt(Math.sqrt(Math.min(wangsFormulaP4, maxSegmentsPerCurveP4) / maxParametricSegmentsP4)));
};

const accountForStrokeConic = (wangsFormulaP4: number): number => {
  if (wangsFormulaP4 <= maxParametricSegmentsP4) {
    return 0;
  }
  return Math.ceil(Math.sqrt(Math.sqrt(Math.min(wangsFormulaP4, maxSegmentsPerCurveP4) / maxParametricSegmentsP4)));
};

const chopAndWriteStrokeCubics = (
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  numPatches: number,
): readonly DrawingPreparedPatch[] => {
  const prepared: DrawingPreparedPatch[] = [];
  let currentP0 = p0;
  let currentP1 = p1;
  let currentP2 = p2;
  let currentP3 = p3;

  for (; numPatches >= 3; numPatches -= 2) {
    const t0 = 1 / numPatches;
    const t1 = 2 / numPatches;
    const ab0 = lerp(currentP0, currentP1, t0);
    const bc0 = lerp(currentP1, currentP2, t0);
    const cd0 = lerp(currentP2, currentP3, t0);
    const abc0 = lerp(ab0, bc0, t0);
    const bcd0 = lerp(bc0, cd0, t0);
    const abcd0 = lerp(abc0, bcd0, t0);

    const ab1 = lerp(currentP0, currentP1, t1);
    const bc1 = lerp(currentP1, currentP2, t1);
    const cd1 = lerp(currentP2, currentP3, t1);
    const abc1 = lerp(ab1, bc1, t1);
    const bcd1 = lerp(bc1, cd1, t1);
    const abcd1 = lerp(abc1, bcd1, t1);
    const middleP1 = lerp(abc0, bcd0, t1);
    const middleP2 = lerp(abc1, bcd1, t0);

    prepared.push(finalizePatch({ kind: 'cubic', points: [currentP0, ab0, abc0, abcd0] }));
    prepared.push(finalizePatch({ kind: 'cubic', points: [abcd0, middleP1, middleP2, abcd1] }));

    currentP0 = abcd1;
    currentP1 = bcd1;
    currentP2 = cd1;
  }

  if (numPatches === 2) {
    const [left, right] = splitCubicAt(currentP0, currentP1, currentP2, currentP3, 0.5);
    prepared.push(finalizePatch({ kind: 'cubic', points: left }));
    prepared.push(finalizePatch({ kind: 'cubic', points: right }));
  } else {
    prepared.push(
      finalizePatch({ kind: 'cubic', points: [currentP0, currentP1, currentP2, currentP3] }),
    );
  }

  return Object.freeze(prepared);
};

const chopAndWriteStrokeConics = (
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  weight: number,
  numPatches: number,
): readonly DrawingPreparedPatch[] => {
  const prepared: DrawingPreparedPatch[] = [];
  let h0: [number, number, number, number] = [p0[0], p0[1], 1, 1];
  let h1: [number, number, number, number] = [p1[0] * weight, p1[1] * weight, weight, weight];
  const h2: [number, number, number, number] = [p2[0], p2[1], 1, 1];

  for (; numPatches >= 2; numPatches -= 1) {
    const t = 1 / numPatches;
    const ab: [number, number, number, number] = [
      h0[0] + ((h1[0] - h0[0]) * t),
      h0[1] + ((h1[1] - h0[1]) * t),
      h0[2] + ((h1[2] - h0[2]) * t),
      h0[3] + ((h1[3] - h0[3]) * t),
    ];
    const bc: [number, number, number, number] = [
      h1[0] + ((h2[0] - h1[0]) * t),
      h1[1] + ((h2[1] - h1[1]) * t),
      h1[2] + ((h2[2] - h1[2]) * t),
      h1[3] + ((h2[3] - h1[3]) * t),
    ];
    const abc: [number, number, number, number] = [
      ab[0] + ((bc[0] - ab[0]) * t),
      ab[1] + ((bc[1] - ab[1]) * t),
      ab[2] + ((bc[2] - ab[2]) * t),
      ab[3] + ((bc[3] - ab[3]) * t),
    ];
    const midpoint: Point2D = [abc[0] / abc[3], abc[1] / abc[3]];
    const firstControl: Point2D = [ab[0] / ab[3], ab[1] / ab[3]];
    const firstWeight = ab[3] / Math.sqrt(Math.max(h0[3] * abc[3], epsilon));
    prepared.push(finalizePatch({
      kind: 'conic',
      points: [[h0[0] / h0[3], h0[1] / h0[3]], firstControl, midpoint],
      weight: firstWeight,
    }));
    h0 = abc;
    h1 = bc;
  }

  const finalControl: Point2D = [h1[0] / h1[3], h1[1] / h1[3]];
  const finalWeight = h1[3] / Math.sqrt(Math.max(h0[3], epsilon));
  prepared.push(finalizePatch({
    kind: 'conic',
    points: [[h0[0] / h0[3], h0[1] / h0[3]], finalControl, [h2[0], h2[1]]],
    weight: finalWeight,
  }));

  return Object.freeze(prepared);
};

const subdivideStrokePreparedPatch = (
  patch: DrawingPreparedPatch,
): readonly DrawingPreparedPatch[] => {
  const normalizedPatch = patch.kind === 'quadratic'
    ? finalizePatch({
      kind: 'cubic',
      points: [
        patch.points[0],
        add(patch.points[0], scale(subtract(patch.points[1], patch.points[0]), 2 / 3)),
        add(patch.points[2], scale(subtract(patch.points[1], patch.points[2]), 2 / 3)),
        patch.points[2],
      ],
    })
    : patch;
  if (normalizedPatch.kind !== 'cubic') {
    if (normalizedPatch.kind === 'conic') {
      const numPatches = accountForStrokeConic(normalizedPatch.wangsFormulaP4);
      return numPatches > 0
        ? chopAndWriteStrokeConics(
          normalizedPatch.points[0],
          normalizedPatch.points[1],
          normalizedPatch.points[2],
          normalizedPatch.weight,
          numPatches,
        )
        : Object.freeze([normalizedPatch]);
    }
    return Object.freeze([normalizedPatch]);
  }
  const numPatches = accountForStrokeCurve(normalizedPatch.wangsFormulaP4);
  return numPatches > 0
    ? chopAndWriteStrokeCubics(
      normalizedPatch.points[0],
      normalizedPatch.points[1],
      normalizedPatch.points[2],
      normalizedPatch.points[3],
      numPatches,
    )
    : Object.freeze([normalizedPatch]);
};

const prepareStrokePatches = (
  path: DrawingPath2D,
): readonly DrawingPreparedPatch[] =>
  Object.freeze(
    preparePatches(path, identityMatrix2D, false).flatMap((patch) =>
      subdivideStrokePreparedPatch(patch)
    ),
  );

const getPatchStartPoint = (patch: DrawingPreparedPatch): Point2D => {
  switch (patch.kind) {
    case 'line':
      return patch.points[0];
    case 'quadratic':
      return patch.points[0];
    case 'conic':
      return patch.points[0];
    case 'cubic':
      return patch.points[0];
  }
};

const getPatchEndPoint = (patch: DrawingPreparedPatch): Point2D => {
  switch (patch.kind) {
    case 'line':
      return patch.points[1];
    case 'quadratic':
      return patch.points[2];
    case 'conic':
      return patch.points[2];
    case 'cubic':
      return patch.points[3];
  }
};

const getPatchPoints4 = (
  patch: DrawingPreparedPatch,
): readonly [Point2D, Point2D, Point2D, Point2D] =>
  patch.kind === 'line'
    ? [patch.points[0], patch.points[0], patch.points[1], patch.points[1]]
    : patch.kind === 'quadratic'
    ? quadraticToCubicPoints(patch.points[0], patch.points[1], patch.points[2])
    : patch.kind === 'conic'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];

const resolvePatchTangentControlPoint = (
  anchor: Point2D,
  controlA: Point2D,
  controlB: Point2D,
  fallback: Point2D,
): Point2D => {
  if (!pointsEqual(controlA, anchor)) {
    return controlA;
  }
  if (!pointsEqual(controlB, anchor)) {
    return controlB;
  }
  return fallback;
};

const getPatchFirstControlPoint = (patch: DrawingPreparedPatch): Point2D => {
  const [p0, p1, p2, p3] = getPatchPoints4(patch);
  return resolvePatchTangentControlPoint(p0, p1, p2, p3);
};

const getPatchOutgoingJoinControlPoint = (patch: DrawingPreparedPatch): Point2D => {
  const [p0, p1, p2, p3] = getPatchPoints4(patch);
  return resolvePatchTangentControlPoint(p3, p2, p1, p0);
};

const getPatchIncomingTangent = (patch: DrawingPreparedPatch): Point2D | null =>
  normalize(subtract(getPatchFirstControlPoint(patch), getPatchStartPoint(patch))) ??
    normalize(subtract(getPatchEndPoint(patch), getPatchStartPoint(patch)));

const getPatchOutgoingTangent = (patch: DrawingPreparedPatch): Point2D | null =>
  normalize(subtract(getPatchEndPoint(patch), getPatchOutgoingJoinControlPoint(patch))) ??
    normalize(subtract(getPatchEndPoint(patch), getPatchStartPoint(patch)));

const isCuspLikeStrokeTurn = (
  previousPatch: DrawingPreparedPatch,
  currentPatch: DrawingPreparedPatch,
): boolean => {
  const outgoing = getPatchOutgoingTangent(previousPatch);
  const incoming = getPatchIncomingTangent(currentPatch);
  if (!outgoing || !incoming) {
    return false;
  }
  const cosine = (outgoing[0] * incoming[0]) + (outgoing[1] * incoming[1]);
  return cosine < -0.95;
};

const createDegenerateSquareStrokePatch = (
  center: Point2D,
  joinTo: Point2D,
): DrawingPreparedStrokePatch => ({
  patch: {
    kind: 'conic',
    points: [center, center, center],
    weight: 1,
    resolveLevel: 0,
    wangsFormulaP4: 1,
  },
  prevPoint: joinTo,
  joinControlPoint: joinTo,
  contourStart: false,
  contourEnd: false,
  startCap: 'none',
  endCap: 'none',
});

const createDegenerateRoundStrokePatch = (
  center: Point2D,
): DrawingPreparedStrokePatch => ({
  patch: {
    kind: 'cubic',
    points: [center, center, center, center],
    resolveLevel: Math.min(maxPatchResolveLevel, 4),
    wangsFormulaP4: 1,
  },
  prevPoint: center,
  joinControlPoint: center,
  contourStart: true,
  contourEnd: true,
  startCap: 'round',
  endCap: 'round',
});

const createStrokeLinePatch = (
  from: Point2D,
  to: Point2D,
): DrawingPreparedPatch => ({
  kind: 'line',
  points: [from, to],
  resolveLevel: 0,
  wangsFormulaP4: 1,
});

const quadraticToCubicPoints = (
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
): readonly [Point2D, Point2D, Point2D, Point2D] => {
  const c1 = add(p0, scale(subtract(p1, p0), 2 / 3));
  const c2 = add(p2, scale(subtract(p1, p2), 2 / 3));
  return [p0, c1, c2, p2];
};

const createArcConicPatches = (
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean,
  transform: readonly [number, number, number, number, number, number],
): readonly DrawingPatchDefinition[] => {
  const turn = Math.PI * 2;
  let sweep = endAngle - startAngle;
  if (counterClockwise) {
    while (sweep <= 0) {
      sweep += turn;
    }
  } else {
    while (sweep >= 0) {
      sweep -= turn;
    }
  }
  const segmentCount = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const segmentSweep = sweep / segmentCount;
  const patches: DrawingPatchDefinition[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const theta0 = startAngle + (segmentSweep * index);
    const theta1 = theta0 + segmentSweep;
    const thetaMid = (theta0 + theta1) / 2;
    const halfSweep = segmentSweep / 2;
    const weight = Math.cos(halfSweep);
    const start: Point2D = [
      center[0] + (Math.cos(theta0) * radius),
      center[1] + (Math.sin(theta0) * radius),
    ];
    const end: Point2D = [
      center[0] + (Math.cos(theta1) * radius),
      center[1] + (Math.sin(theta1) * radius),
    ];
    const controlDistance = radius / Math.max(weight, 1e-5);
    const control: Point2D = [
      center[0] + (Math.cos(thetaMid) * controlDistance),
      center[1] + (Math.sin(thetaMid) * controlDistance),
    ];
    patches.push({
      kind: 'conic',
      points: [
        transformPoint2D(start, transform),
        transformPoint2D(control, transform),
        transformPoint2D(end, transform),
      ],
      weight,
    });
  }

  return Object.freeze(patches);
};

const createPreparedStrokePatches = (
  contours: readonly DrawingStrokeContourRecord[],
  patches: readonly DrawingPreparedPatch[],
  cap: NonNullable<DrawingPaint['strokeCap']>,
  strokeStyle: DrawingStrokeStyle,
): readonly DrawingPreparedStrokePatch[] => {
  const prepared: DrawingPreparedStrokePatch[] = [];
  for (const contour of contours) {
    if (contour.points.length >= 2 || !contour.degeneratePoint) {
      continue;
    }
    if (cap === 'round') {
      prepared.push(createDegenerateRoundStrokePatch(contour.degeneratePoint));
      continue;
    }
    if (cap === 'square') {
      prepared.push(
        createDegenerateSquareStrokePatch(contour.degeneratePoint, contour.degeneratePoint),
      );
    }
  }
  if (patches.length === 0) {
    return Object.freeze(prepared);
  }
  const groupedContours = groupStrokePatchContours(contours, patches);
  for (const contour of groupedContours) {
    prepared.push(...createPreparedStrokeContourPatches(contour, cap, strokeStyle));
  }
  return Object.freeze(prepared);
};

const groupStrokePatchContours = (
  contours: readonly DrawingStrokeContourRecord[],
  patches: readonly DrawingPreparedPatch[],
): readonly DrawingStrokePatchContour[] => {
  if (patches.length === 0 || contours.length === 0) {
    return Object.freeze([]);
  }
  const grouped: DrawingStrokePatchContour[] = [];
  let patchIndex = 0;
  for (const contour of contours) {
    const contourPatches: DrawingPreparedPatch[] = [];
    if (contour.points.length < 2) {
      continue;
    }
    const contourStart = contour.points[0]!;
    let expectedStart = contourStart;
    while (patchIndex < patches.length) {
      const patch = patches[patchIndex]!;
      const patchStart = getPatchStartPoint(patch);
      if (!pointsEqual(patchStart, expectedStart)) {
        break;
      }
      contourPatches.push(patch);
      patchIndex += 1;
      expectedStart = getPatchEndPoint(patch);
      if (contour.closed) {
        if (pointsEqual(expectedStart, contourStart)) {
          break;
        }
      } else if (pointsEqual(expectedStart, contour.points[contour.points.length - 1]!)) {
        break;
      }
    }
    if (contourPatches.length > 0) {
      grouped.push({
        patches: Object.freeze(contourPatches),
        closed: contour.closed,
        record: contour,
      });
    }
  }
  return Object.freeze(grouped);
};

const createPreparedStrokeContourPatches = (
  contour: DrawingStrokePatchContour,
  cap: NonNullable<DrawingPaint['strokeCap']>,
  strokeStyle: DrawingStrokeStyle,
): readonly DrawingPreparedStrokePatch[] => {
  if (contour.patches.length === 0) {
    return Object.freeze([]);
  }
  const prepared: DrawingPreparedStrokePatch[] = [];
  const firstPatch = contour.patches[0]!;
  const deferredJoinControlPoint = getPatchFirstControlPoint(firstPatch);
  const lastPatch = contour.patches[contour.patches.length - 1]!;
  const halfWidth = strokeStyle.halfWidth;
  const firstStart = contour.record.firstPoint ?? getPatchStartPoint(firstPatch);
  const lastEnd = contour.record.lastPoint ?? getPatchEndPoint(lastPatch);
  const firstTangent = contour.record.startTangent ?? getPatchIncomingTangent(firstPatch);
  const lastTangent = contour.record.endTangent ?? getPatchOutgoingTangent(lastPatch);
  const hasPrependedSquareCap = !contour.closed && cap === 'square' && Boolean(firstTangent);
  const hasAppendedSquareCap = !contour.closed && cap === 'square' && Boolean(lastTangent);
  const iteratorState: DrawingStrokeIteratorContourState = (() => {
    const leadingPatches: DrawingStrokeContourEvent[] = [];
    const bodyPatches: DrawingStrokeContourEvent[] = [];
    const trailingPatches: DrawingStrokeContourEvent[] = [];
    if (!contour.closed && cap === 'round') {
      leadingPatches.push({
        patch: createDegenerateRoundStrokePatch(firstStart).patch,
        contourStart: false,
        contourEnd: false,
        startCap: 'round',
        endCap: 'round',
        joinControlPoint: firstStart,
      });
      trailingPatches.push({
        patch: createDegenerateRoundStrokePatch(lastEnd).patch,
        contourStart: false,
        contourEnd: false,
        startCap: 'round',
        endCap: 'round',
        joinControlPoint: lastEnd,
      });
    }
    if (hasPrependedSquareCap && firstTangent) {
      leadingPatches.push({
        patch: createStrokeLinePatch(add(firstStart, scale(firstTangent, -halfWidth)), firstStart),
        contourStart: true,
        contourEnd: false,
        startCap: 'none',
        endCap: 'none',
      });
    }
    const deferredFirstPatch: DrawingStrokeContourEvent = {
      patch: firstPatch,
      contourStart: !hasPrependedSquareCap,
      contourEnd: !hasAppendedSquareCap && contour.patches.length === 1,
      startCap: !contour.closed && !hasPrependedSquareCap && cap !== 'round' ? cap : 'none',
      endCap:
        !contour.closed && !hasAppendedSquareCap && contour.patches.length === 1 && cap !== 'round'
          ? cap
          : 'none',
    };
    for (let index = 1; index < contour.patches.length; index += 1) {
      bodyPatches.push({
        patch: contour.patches[index]!,
        contourStart: false,
        contourEnd: !hasAppendedSquareCap && index + 1 === contour.patches.length,
        startCap: 'none',
        endCap: !contour.closed && !hasAppendedSquareCap && index + 1 === contour.patches.length &&
            cap !== 'round'
          ? cap
          : 'none',
      });
    }
    if (hasAppendedSquareCap && lastTangent) {
      trailingPatches.push({
        patch: createStrokeLinePatch(lastEnd, add(lastEnd, scale(lastTangent, halfWidth))),
        contourStart: false,
        contourEnd: true,
        startCap: 'none',
        endCap: 'none',
      });
    }
    return {
      deferredFirstPatch,
      leadingPatches: Object.freeze(leadingPatches),
      bodyPatches: Object.freeze(bodyPatches),
      trailingPatches: Object.freeze(trailingPatches),
      joinBarrier: contour.closed ? 'join' : 'moveWithinContour',
    };
  })();
  const iteratorVerbs: readonly DrawingStrokeIteratorVerb[] = (() => {
    const verbs: DrawingStrokeIteratorVerb[] = [];
    const usesRoundCapBarrier = !contour.closed && cap === 'round';
    if (usesRoundCapBarrier) {
      for (const event of iteratorState.bodyPatches) {
        verbs.push({ kind: 'patch', event });
      }
      for (const event of iteratorState.trailingPatches) {
        verbs.push({ kind: 'patch', event });
      }
      if (iteratorState.joinBarrier === 'moveWithinContour') {
        verbs.push({ kind: 'moveWithinContour' });
      }
      for (const event of iteratorState.leadingPatches) {
        verbs.push({ kind: 'patch', event });
      }
      verbs.push({ kind: 'patch', event: iteratorState.deferredFirstPatch });
    } else {
      for (const event of iteratorState.leadingPatches) {
        verbs.push({ kind: 'patch', event });
      }
      verbs.push({ kind: 'patch', event: iteratorState.deferredFirstPatch });
      for (const event of iteratorState.bodyPatches) {
        verbs.push({ kind: 'patch', event });
      }
      for (const event of iteratorState.trailingPatches) {
        verbs.push({ kind: 'patch', event });
      }
      if (iteratorState.joinBarrier === 'moveWithinContour') {
        verbs.push({ kind: 'moveWithinContour' });
      }
    }
    verbs.push({ kind: 'contourFinished' });
    return Object.freeze(verbs);
  })();
  let previousJoinControlPoint = deferredJoinControlPoint;
  let deferredFirstConsumed = false;
  for (const verb of iteratorVerbs) {
    switch (verb.kind) {
      case 'patch': {
        const event = verb.event;
        const joinControlPoint =
          event.joinControlPoint ??
          ((!deferredFirstConsumed && event === iteratorState.deferredFirstPatch)
            ? iteratorState.joinBarrier === 'join'
              ? getPatchOutgoingJoinControlPoint(lastPatch)
              : deferredJoinControlPoint
            : previousJoinControlPoint);
        prepared.push({
          patch: event.patch,
          prevPoint: joinControlPoint,
          joinControlPoint,
          contourStart: event.contourStart,
          contourEnd: event.contourEnd,
          startCap: event.startCap,
          endCap: event.endCap,
        });
        previousJoinControlPoint = getPatchOutgoingJoinControlPoint(event.patch);
        if (event === iteratorState.deferredFirstPatch) {
          deferredFirstConsumed = true;
        }
        break;
      }
      case 'moveWithinContour':
        previousJoinControlPoint = deferredJoinControlPoint;
        break;
      case 'contourFinished':
        break;
    }
  }
  return Object.freeze(prepared);
};

const evaluateConic = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  weight: number,
  t: number,
): Point2D => {
  const oneMinusT = 1 - t;
  const denominator = (oneMinusT * oneMinusT) + (2 * weight * oneMinusT * t) + (t * t);
  const x = ((oneMinusT * oneMinusT * from[0]) +
    (2 * weight * oneMinusT * t * control[0]) +
    (t * t * to[0])) / denominator;
  const y = ((oneMinusT * oneMinusT * from[1]) +
    (2 * weight * oneMinusT * t * control[1]) +
    (t * t * to[1])) / denominator;
  return [x, y];
};

const derivativeConic = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  weight: number,
  t: number,
): Point2D => {
  const dt = 1e-3;
  const left = evaluateConic(from, control, to, weight, Math.max(0, t - dt));
  const right = evaluateConic(from, control, to, weight, Math.min(1, t + dt));
  return [(right[0] - left[0]) / (2 * dt), (right[1] - left[1]) / (2 * dt)];
};

const derivativeCubic = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
  t: number,
): Point2D => {
  const oneMinusT = 1 - t;
  return [
    (3 * oneMinusT * oneMinusT * (control1[0] - from[0])) +
    (6 * oneMinusT * t * (control2[0] - control1[0])) +
    (3 * t * t * (to[0] - control2[0])),
    (3 * oneMinusT * oneMinusT * (control1[1] - from[1])) +
    (6 * oneMinusT * t * (control2[1] - control1[1])) +
    (3 * t * t * (to[1] - control2[1])),
  ];
};

const splitQuadraticAt = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  t: number,
): readonly [
  readonly [Point2D, Point2D, Point2D],
  readonly [Point2D, Point2D, Point2D],
] => {
  const p01 = lerp(from, control, t);
  const p12 = lerp(control, to, t);
  const split = lerp(p01, p12, t);
  return [
    [from, p01, split],
    [split, p12, to],
  ];
};

const splitCubicAt = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
  t: number,
): readonly [
  readonly [Point2D, Point2D, Point2D, Point2D],
  readonly [Point2D, Point2D, Point2D, Point2D],
] => {
  const p01 = lerp(from, control1, t);
  const p12 = lerp(control1, control2, t);
  const p23 = lerp(control2, to, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const split = lerp(p012, p123, t);
  return [
    [from, p01, p012, split],
    [split, p123, p23, to],
  ];
};

const splitCubicAtMany = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
  ts: readonly number[],
): readonly (readonly [Point2D, Point2D, Point2D, Point2D])[] => {
  if (ts.length === 0) {
    return Object.freeze([[from, control1, control2, to]]);
  }
  const sorted = [...ts].filter((t) => t > epsilon && t < 1 - epsilon).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return Object.freeze([[from, control1, control2, to]]);
  }
  const segments: (readonly [Point2D, Point2D, Point2D, Point2D])[] = [];
  let current: readonly [Point2D, Point2D, Point2D, Point2D] = [from, control1, control2, to];
  let lastT = 0;
  for (const t of sorted) {
    const localT = (t - lastT) / Math.max(1 - lastT, epsilon);
    const [left, right] = splitCubicAt(current[0], current[1], current[2], current[3], localT);
    segments.push(left);
    current = right;
    lastT = t;
  }
  segments.push(current);
  return Object.freeze(segments);
};

const findQuadraticCuspT = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
): number | null => {
  const a = subtract(control, from);
  const b = subtract(to, control);
  const crossValue = Math.abs((a[0] * b[1]) - (a[1] * b[0]));
  const dotValue = dot(a, b);
  if (crossValue <= epsilon && dotValue < 0) {
    return 0.5;
  }
  return null;
};

const findCuspTBySampling = (
  sampleDerivative: (t: number) => Point2D,
): number | null => {
  let bestT: number | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  for (let index = 1; index < 32; index += 1) {
    const t = index / 32;
    const derivative = sampleDerivative(t);
    const length = Math.hypot(derivative[0], derivative[1]);
    if (length < bestLength) {
      bestLength = length;
      bestT = t;
    }
  }
  return bestLength <= cuspDerivativeEpsilon && bestT !== null && bestT > epsilon &&
      bestT < 1 - epsilon
    ? bestT
    : null;
};

const cubicConvex180ChopEpsilon = 1 / (1 << 11);

const findCubicConvex180Chops = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
): Readonly<{ ts: readonly number[]; areCusps: boolean }> => {
  const cross2 = (lhs: Point2D, rhs: Point2D): number => (lhs[0] * rhs[1]) - (lhs[1] * rhs[0]);
  const c = subtract(control1, from);
  const d = subtract(control2, control1);
  const e = subtract(to, from);
  const b = subtract(d, c);
  const a = subtract(e, scale(d, 3));

  let qa = cross2(a, b);
  let qbOverMinus2 = -0.5 * cross2(a, c);
  let qc = cross2(b, c);
  let discrOver4 = (qbOverMinus2 * qbOverMinus2) - (qa * qc);
  let cuspThreshold = qa * (cubicConvex180ChopEpsilon / 2);
  cuspThreshold *= cuspThreshold;

  if (discrOver4 < -cuspThreshold) {
    const root = qbOverMinus2 !== 0 ? qc / qbOverMinus2 : Number.NaN;
    return root > cubicConvex180ChopEpsilon && root < 1 - cubicConvex180ChopEpsilon
      ? { ts: Object.freeze([root]), areCusps: false }
      : { ts: Object.freeze([]), areCusps: false };
  }

  let areCusps = discrOver4 <= cuspThreshold;
  if (areCusps) {
    if (qa !== 0 || qbOverMinus2 !== 0 || qc !== 0) {
      const root = qa !== 0 ? qbOverMinus2 / qa : Number.NaN;
      return root > cubicConvex180ChopEpsilon && root < 1 - cubicConvex180ChopEpsilon
        ? { ts: Object.freeze([root]), areCusps: true }
        : { ts: Object.freeze([]), areCusps: true };
    }

    const tan0 = (Math.abs(c[0]) > epsilon || Math.abs(c[1]) > epsilon)
      ? c
      : subtract(control2, from);
    qa = dot(tan0, a);
    qbOverMinus2 = -dot(tan0, b);
    qc = dot(tan0, c);
    discrOver4 = (qbOverMinus2 * qbOverMinus2) - (qa * qc);
    if (discrOver4 < -cuspThreshold) {
      return { ts: Object.freeze([]), areCusps: false };
    }
    discrOver4 = Math.max(discrOver4, 0);
  }

  let q = Math.sqrt(Math.max(discrOver4, 0));
  q = Math.sign(qbOverMinus2 || 1) * q + qbOverMinus2;
  const roots = [
    qa !== 0 ? q / qa : Number.NaN,
    q !== 0 ? qc / q : Number.NaN,
  ].filter((root) => root > cubicConvex180ChopEpsilon && root < 1 - cubicConvex180ChopEpsilon);

  const uniqueSorted = [...new Set(roots.map((root) => Number(root.toFixed(9))))].sort((lhs, rhs) =>
    lhs - rhs
  );
  return { ts: Object.freeze(uniqueSorted), areCusps };
};

const flattenConic = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  weight: number,
  out: Point2D[],
): void => {
  const cuspT = findCuspTBySampling((t) => derivativeConic(from, control, to, weight, t));
  if (cuspT !== null) {
    const cuspPoint = evaluateConic(from, control, to, weight, cuspT);
    flattenConic(from, lerp(from, control, cuspT), cuspPoint, weight, out);
    flattenConic(cuspPoint, lerp(control, to, cuspT), to, weight, out);
    return;
  }
  const segments = Math.max(
    2,
    Math.min(
      1 << maxCurveSubdivisionDepth,
      Math.ceil(Math.sqrt(approximateQuadraticSegments(from, control, to) * Math.max(weight, 1))),
    ),
  );
  for (let index = 1; index <= segments; index += 1) {
    out.push(evaluateConic(from, control, to, weight, index / segments));
  }
};

const flattenArc = (
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean,
  transform: readonly [number, number, number, number, number, number],
  out: Point2D[],
): void => {
  let span = endAngle - startAngle;
  if (counterClockwise && span > 0) {
    span -= Math.PI * 2;
  } else if (!counterClockwise && span < 0) {
    span += Math.PI * 2;
  }
  const segments = Math.max(4, Math.ceil(Math.abs(span) / (Math.PI / 12)));
  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + ((span * index) / segments);
    out.push(transformPoint2D([
      center[0] + (Math.cos(angle) * radius),
      center[1] + (Math.sin(angle) * radius),
    ], transform));
  }
};

const polygonArea = (points: readonly Point2D[]): number => {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += (current[0] * next[1]) - (current[1] * next[0]);
  }
  return area / 2;
};

const computeBounds = (points: readonly Point2D[]): Rect => {
  if (points.length === 0) {
    return { origin: [0, 0], size: { width: 0, height: 0 } };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return {
    origin: [minX, minY],
    size: { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) },
  };
};

const unionBounds = (bounds: readonly Rect[]): Rect => {
  if (bounds.length === 0) {
    return { origin: [0, 0], size: { width: 0, height: 0 } };
  }
  return computeBounds(bounds.flatMap((bound) => [
    bound.origin,
    [bound.origin[0] + bound.size.width, bound.origin[1] + bound.size.height] as Point2D,
  ]));
};

const intersectBounds = (left: Rect | undefined, right: Rect): Rect | undefined => {
  if (!left) return right;
  const x0 = Math.max(left.origin[0], right.origin[0]);
  const y0 = Math.max(left.origin[1], right.origin[1]);
  const x1 = Math.min(left.origin[0] + left.size.width, right.origin[0] + right.size.width);
  const y1 = Math.min(left.origin[1] + left.size.height, right.origin[1] + right.size.height);
  return {
    origin: [x0, y0],
    size: {
      width: Math.max(0, x1 - x0),
      height: Math.max(0, y1 - y0),
    },
  };
};

const orientation = (a: Point2D, b: Point2D, c: Point2D): number => {
  const value = ((b[1] - a[1]) * (c[0] - b[0])) - ((b[0] - a[0]) * (c[1] - b[1]));
  if (Math.abs(value) <= epsilon) return 0;
  return value > 0 ? 1 : 2;
};

const onSegment = (a: Point2D, b: Point2D, c: Point2D): boolean =>
  Math.min(a[0], c[0]) - epsilon <= b[0] &&
  b[0] <= Math.max(a[0], c[0]) + epsilon &&
  Math.min(a[1], c[1]) - epsilon <= b[1] &&
  b[1] <= Math.max(a[1], c[1]) + epsilon;

const segmentsIntersect = (a0: Point2D, a1: Point2D, b0: Point2D, b1: Point2D): boolean => {
  const o1 = orientation(a0, a1, b0);
  const o2 = orientation(a0, a1, b1);
  const o3 = orientation(b0, b1, a0);
  const o4 = orientation(b0, b1, a1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a0, b0, a1)) return true;
  if (o2 === 0 && onSegment(a0, b1, a1)) return true;
  if (o3 === 0 && onSegment(b0, a0, b1)) return true;
  if (o4 === 0 && onSegment(b0, a1, b1)) return true;
  return false;
};

const segmentIntersectionPoint = (
  a0: Point2D,
  a1: Point2D,
  b0: Point2D,
  b1: Point2D,
): Point2D | null => {
  const a = subtract(a1, a0);
  const b = subtract(b1, b0);
  const det = (a[0] * b[1]) - (a[1] * b[0]);
  if (Math.abs(det) <= epsilon) return null;
  const delta = subtract(b0, a0);
  const t = ((delta[0] * b[1]) - (delta[1] * b[0])) / det;
  const u = ((delta[0] * a[1]) - (delta[1] * a[0])) / det;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null;
  return add(a0, scale(a, t));
};

const isSelfIntersecting = (points: readonly Point2D[]): boolean => {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    const a0 = points[first]!;
    const a1 = points[firstNext]!;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (first === 0 && secondNext === 0) continue;
      if (segmentsIntersect(a0, a1, points[second]!, points[secondNext]!)) return true;
    }
  }
  return false;
};

const isConvexPolygon = (points: readonly Point2D[]): boolean => {
  if (points.length < 3 || isSelfIntersecting(points)) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const c = points[(index + 2) % points.length]!;
    const turn = cross(a, b, c);
    if (Math.abs(turn) <= epsilon) continue;
    const nextSign = turn > 0 ? 1 : -1;
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return sign !== 0;
};

const isPointInTriangle = (point: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean => {
  const area0 = cross(point, a, b);
  const area1 = cross(point, b, c);
  const area2 = cross(point, c, a);
  const hasNegative = area0 < -epsilon || area1 < -epsilon || area2 < -epsilon;
  const hasPositive = area0 > epsilon || area1 > epsilon || area2 > epsilon;
  return !(hasNegative && hasPositive);
};

const triangulatePolygon = (points: readonly Point2D[]): readonly Point2D[] | null => {
  if (points.length < 3 || isSelfIntersecting(points)) return null;
  const winding = polygonArea(points) >= 0 ? 1 : -1;
  const indices = points.map((_, index) => index);
  const triangles: Point2D[] = [];
  let guard = 0;
  while (indices.length > 3 && guard < points.length * points.length) {
    let earFound = false;
    for (let index = 0; index < indices.length; index += 1) {
      const prev = indices[(index + indices.length - 1) % indices.length]!;
      const current = indices[index]!;
      const next = indices[(index + 1) % indices.length]!;
      const a = points[prev]!;
      const b = points[current]!;
      const c = points[next]!;
      const turn = cross(a, b, c);
      if ((winding > 0 && turn <= epsilon) || (winding < 0 && turn >= -epsilon)) continue;
      let containsPoint = false;
      for (const candidateIndex of indices) {
        if (candidateIndex === prev || candidateIndex === current || candidateIndex === next) {
          continue;
        }
        if (isPointInTriangle(points[candidateIndex]!, a, b, c)) {
          containsPoint = true;
          break;
        }
      }
      if (containsPoint) continue;
      triangles.push(...(winding > 0 ? [a, b, c] : [a, c, b]));
      indices.splice(index, 1);
      earFound = true;
      break;
    }
    if (!earFound) return null;
    guard += 1;
  }
  if (indices.length === 3) {
    const a = points[indices[0]!]!;
    const b = points[indices[1]!]!;
    const c = points[indices[2]!]!;
    triangles.push(...(winding > 0 ? [a, b, c] : [a, c, b]));
  }
  return Object.freeze(triangles);
};

const lineSegmentIntersection = (
  start: Point2D,
  end: Point2D,
  clipStart: Point2D,
  clipEnd: Point2D,
): Point2D => {
  const direction = subtract(end, start);
  const clipDirection = subtract(clipEnd, clipStart);
  const denominator = (direction[0] * clipDirection[1]) - (direction[1] * clipDirection[0]);
  if (Math.abs(denominator) <= epsilon) {
    return end;
  }
  const delta = subtract(clipStart, start);
  const t = ((delta[0] * clipDirection[1]) - (delta[1] * clipDirection[0])) / denominator;
  return add(start, scale(direction, t));
};

const ensureCounterClockwise = (points: readonly Point2D[]): readonly Point2D[] =>
  polygonArea(points) >= 0 ? points : Object.freeze([...points].reverse());

const clipPolygonAgainstEdge = (
  polygon: readonly Point2D[],
  clipStart: Point2D,
  clipEnd: Point2D,
): readonly Point2D[] => {
  if (polygon.length === 0) return polygon;
  const output: Point2D[] = [];
  const isInside = (point: Point2D): boolean => cross(clipStart, clipEnd, point) >= -epsilon;

  let previous = polygon[polygon.length - 1]!;
  let previousInside = isInside(previous);
  for (const current of polygon) {
    const currentInside = isInside(current);
    if (currentInside) {
      if (!previousInside) {
        output.push(lineSegmentIntersection(previous, current, clipStart, clipEnd));
      }
      output.push(current);
    } else if (previousInside) {
      output.push(lineSegmentIntersection(previous, current, clipStart, clipEnd));
    }
    previous = current;
    previousInside = currentInside;
  }

  return Object.freeze(output);
};

const clipTrianglesAgainstConvexPolygon = (
  triangles: readonly Point2D[],
  clipPolygon: readonly Point2D[],
): readonly Point2D[] => {
  const clip = ensureCounterClockwise(clipPolygon);
  const clipped: Point2D[] = [];

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    let polygon: readonly Point2D[] = [
      triangles[index]!,
      triangles[index + 1]!,
      triangles[index + 2]!,
    ];
    for (let clipIndex = 0; clipIndex < clip.length; clipIndex += 1) {
      polygon = clipPolygonAgainstEdge(
        polygon,
        clip[clipIndex]!,
        clip[(clipIndex + 1) % clip.length]!,
      );
      if (polygon.length === 0) break;
    }
    if (polygon.length >= 3) {
      for (let polygonIndex = 1; polygonIndex + 1 < polygon.length; polygonIndex += 1) {
        clipped.push(polygon[0]!, polygon[polygonIndex]!, polygon[polygonIndex + 1]!);
      }
    }
  }

  return Object.freeze(clipped);
};

type ScanEdge = Readonly<{
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  winding: number;
}>;

type ScanEvent = Readonly<{
  x: number;
  winding: number;
}>;

const buildScanEdges = (subpaths: readonly FlattenedSubpath[]): readonly ScanEdge[] => {
  const edges: ScanEdge[] = [];
  for (const subpath of subpaths) {
    if (!subpath.closed || subpath.points.length < 3) continue;
    for (let index = 0; index < subpath.points.length; index += 1) {
      const start = subpath.points[index]!;
      const end = subpath.points[(index + 1) % subpath.points.length]!;
      if (Math.abs(start[1] - end[1]) <= epsilon) continue;
      if (start[1] < end[1]) {
        edges.push({ x0: start[0], y0: start[1], x1: end[0], y1: end[1], winding: 1 });
      } else {
        edges.push({ x0: end[0], y0: end[1], x1: start[0], y1: start[1], winding: -1 });
      }
    }
  }
  return Object.freeze(edges);
};

const collectScanBands = (subpaths: readonly FlattenedSubpath[]): readonly number[] => {
  const ys = new Set<number>();
  for (const subpath of subpaths) {
    for (const point of subpath.points) {
      ys.add(point[1]);
    }
  }
  const edges = buildScanEdges(subpaths);
  for (let first = 0; first < edges.length; first += 1) {
    for (let second = first + 1; second < edges.length; second += 1) {
      const edgeA = edges[first]!;
      const edgeB = edges[second]!;
      const intersection = segmentIntersectionPoint(
        [edgeA.x0, edgeA.y0],
        [edgeA.x1, edgeA.y1],
        [edgeB.x0, edgeB.y0],
        [edgeB.x1, edgeB.y1],
      );
      if (intersection) {
        ys.add(intersection[1]);
      }
    }
  }
  return Object.freeze([...ys].sort((left, right) => left - right));
};

const scanlineIntersectionX = (edge: ScanEdge, y: number): number =>
  edge.x0 + (((y - edge.y0) / (edge.y1 - edge.y0)) * (edge.x1 - edge.x0));

const buildFillIntervals = (
  events: readonly ScanEvent[],
  fillRule: PathFillRule2D,
): readonly (readonly [number, number])[] => {
  const intervals: Array<readonly [number, number]> = [];
  if (fillRule === 'evenodd') {
    for (let index = 0; index + 1 < events.length; index += 2) {
      intervals.push([events[index]!.x, events[index + 1]!.x]);
    }
    return Object.freeze(intervals);
  }

  let winding = 0;
  let intervalStart: number | null = null;
  for (const event of events) {
    const previous = winding;
    winding += event.winding;
    if (previous === 0 && winding !== 0) {
      intervalStart = event.x;
    } else if (previous !== 0 && winding === 0 && intervalStart !== null) {
      intervals.push([intervalStart, event.x]);
      intervalStart = null;
    }
  }
  return Object.freeze(intervals);
};

const scanlineTessellate = (
  subpaths: readonly FlattenedSubpath[],
  fillRule: PathFillRule2D,
): readonly Point2D[] | null => {
  const ys = collectScanBands(subpaths);
  if (ys.length < 2) return null;
  const edges = buildScanEdges(subpaths);
  const triangles: Point2D[] = [];

  for (let band = 0; band < ys.length - 1; band += 1) {
    const y0 = ys[band]!;
    const y1 = ys[band + 1]!;
    if (y1 - y0 <= epsilon) continue;
    const sampleY = (y0 + y1) / 2;
    const events: ScanEvent[] = [];
    for (const edge of edges) {
      if (sampleY < edge.y0 || sampleY >= edge.y1) continue;
      events.push({
        x: scanlineIntersectionX(edge, sampleY),
        winding: edge.winding,
      });
    }
    events.sort((left, right) => left.x - right.x);
    const intervals = buildFillIntervals(events, fillRule);
    for (const [x0, x1] of intervals) {
      if (x1 - x0 <= epsilon) continue;
      const topLeft: Point2D = [x0, y0];
      const topRight: Point2D = [x1, y0];
      const bottomRight: Point2D = [x1, y1];
      const bottomLeft: Point2D = [x0, y1];
      appendQuad(triangles, topLeft, topRight, bottomRight, bottomLeft);
    }
  }

  return triangles.length > 0 ? Object.freeze(triangles) : null;
};

const flattenQuadraticRecursive = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  depth: number,
  targetDepth: number,
  out: Point2D[],
): void => {
  const cuspT = depth === 0 ? findQuadraticCuspT(from, control, to) : null;
  if (cuspT !== null) {
    const [left, right] = splitQuadraticAt(from, control, to, cuspT);
    flattenQuadraticRecursive(left[0], left[1], left[2], depth + 1, targetDepth, out);
    flattenQuadraticRecursive(right[0], right[1], right[2], depth + 1, targetDepth, out);
    return;
  }
  if (
    depth >= targetDepth ||
    depth >= maxCurveSubdivisionDepth ||
    distanceFromLine(control, from, to) <= curveFlatnessTolerance
  ) {
    out.push(to);
    return;
  }
  const p01 = midpoint(from, control);
  const p12 = midpoint(control, to);
  const split = midpoint(p01, p12);
  flattenQuadraticRecursive(from, p01, split, depth + 1, targetDepth, out);
  flattenQuadraticRecursive(split, p12, to, depth + 1, targetDepth, out);
};

const flattenCubicRecursive = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
  depth: number,
  targetDepth: number,
  out: Point2D[],
): void => {
  const cuspT = depth === 0
    ? findCuspTBySampling((t) => derivativeCubic(from, control1, control2, to, t))
    : null;
  if (cuspT !== null) {
    const [left, right] = splitCubicAt(from, control1, control2, to, cuspT);
    flattenCubicRecursive(left[0], left[1], left[2], left[3], depth + 1, targetDepth, out);
    flattenCubicRecursive(right[0], right[1], right[2], right[3], depth + 1, targetDepth, out);
    return;
  }
  const flatness = Math.max(
    distanceFromLine(control1, from, to),
    distanceFromLine(control2, from, to),
  );
  if (
    depth >= targetDepth || depth >= maxCurveSubdivisionDepth || flatness <= curveFlatnessTolerance
  ) {
    out.push(to);
    return;
  }
  const p01 = midpoint(from, control1);
  const p12 = midpoint(control1, control2);
  const p23 = midpoint(control2, to);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);
  flattenCubicRecursive(from, p01, p012, split, depth + 1, targetDepth, out);
  flattenCubicRecursive(split, p123, p23, to, depth + 1, targetDepth, out);
};

const flattenSubpaths = (
  path: DrawingPath2D,
  transform: readonly [number, number, number, number, number, number],
): readonly FlattenedSubpath[] | null => {
  const subpaths: FlattenedSubpath[] = [];
  let points: Point2D[] = [];
  let currentPoint: Point2D | null = null;
  let sawClose = false;

  const flush = (): void => {
    if (points.length === 0) {
      currentPoint = null;
      sawClose = false;
      return;
    }
    const normalized = [...points];
    if (normalized.length > 1 && pointsEqual(normalized[0]!, normalized[normalized.length - 1]!)) {
      normalized.pop();
      sawClose = true;
    }
    subpaths.push(Object.freeze({ points: Object.freeze(normalized), closed: sawClose }));
    points = [];
    currentPoint = null;
    sawClose = false;
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
        flush();
        points.push(transformPoint2D(verb.to, transform));
        currentPoint = transformPoint2D(verb.to, transform);
        break;
      case 'lineTo':
        if (!currentPoint) return null;
        points.push(transformPoint2D(verb.to, transform));
        currentPoint = transformPoint2D(verb.to, transform);
        break;
      case 'quadTo':
        if (!currentPoint) return null;
        {
          const control = transformPoint2D(verb.control, transform);
          const to = transformPoint2D(verb.to, transform);
          const targetDepth = Math.ceil(
            Math.log2(approximateQuadraticSegments(currentPoint, control, to)),
          );
          flattenQuadraticRecursive(
            currentPoint,
            control,
            to,
            0,
            targetDepth,
            points,
          );
          currentPoint = to;
        }
        break;
      case 'cubicTo':
        if (!currentPoint) return null;
        {
          const control1 = transformPoint2D(verb.control1, transform);
          const control2 = transformPoint2D(verb.control2, transform);
          const to = transformPoint2D(verb.to, transform);
          const targetDepth = Math.ceil(Math.log2(approximateCubicSegments(
            currentPoint,
            control1,
            control2,
            to,
          )));
          flattenCubicRecursive(
            currentPoint,
            control1,
            control2,
            to,
            0,
            targetDepth,
            points,
          );
          currentPoint = to;
        }
        break;
      case 'conicTo':
        if (!currentPoint) return null;
        {
          const control = transformPoint2D(verb.control, transform);
          const to = transformPoint2D(verb.to, transform);
          flattenConic(currentPoint, control, to, verb.weight, points);
          currentPoint = to;
        }
        break;
      case 'arcTo':
        if (!currentPoint) {
          const startPoint = transformPoint2D([
            verb.center[0] + (Math.cos(verb.startAngle) * verb.radius),
            verb.center[1] + (Math.sin(verb.startAngle) * verb.radius),
          ], transform);
          points.push(startPoint);
          currentPoint = startPoint;
        }
        flattenArc(
          verb.center,
          verb.radius,
          verb.startAngle,
          verb.endAngle,
          verb.counterClockwise ?? false,
          transform,
          points,
        );
        currentPoint = points[points.length - 1] ?? currentPoint;
        break;
      case 'close':
        if (!currentPoint) return null;
        sawClose = true;
        flush();
        break;
    }
  }

  flush();
  return Object.freeze(subpaths);
};

const preparePatches = (
  path: DrawingPath2D,
  transform: readonly [number, number, number, number, number, number],
  includeFanPoint: boolean,
): readonly DrawingPreparedPatch[] => {
  const patches: DrawingPreparedPatch[] = [];
  let currentPoint: Point2D | null = null;
  let contourStart: Point2D | null = null;
  let contourPoints: Point2D[] = [];
  let contourPatches: DrawingPatchDefinition[] = [];

  const pushPatch = (patch: DrawingPatchDefinition): void => {
    if (includeFanPoint) {
      contourPatches.push(patch);
      return;
    }
    patches.push(finalizePatch(patch));
  };

  const flushWedges = (): void => {
    if (!includeFanPoint) {
      contourPatches = [];
      contourPoints = [];
      contourStart = null;
      return;
    }
    if (contourPoints.length < 3 || contourPatches.length === 0) {
      contourPatches = [];
      contourPoints = [];
      contourStart = null;
      return;
    }
    const fanPoint = computeContourMidpoint(contourPoints);
    for (const patch of contourPatches) {
      patches.push(finalizePatch(patch, { fanPoint }));
    }
    contourPatches = [];
    contourPoints = [];
    contourStart = null;
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo': {
        flushWedges();
        const to = transformPoint2D(verb.to, transform);
        currentPoint = to;
        contourStart = to;
        contourPoints = [to];
        break;
      }
      case 'lineTo': {
        if (!currentPoint) break;
        const to = transformPoint2D(verb.to, transform);
        pushPatch({ kind: 'line', points: [currentPoint, to] });
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'quadTo': {
        if (!currentPoint) break;
        const control = transformPoint2D(verb.control, transform);
        const to = transformPoint2D(verb.to, transform);
        const cuspT = findQuadraticCuspT(currentPoint, control, to);
        if (cuspT !== null) {
          const [left, right] = splitQuadraticAt(currentPoint, control, to, cuspT);
          pushPatch({ kind: 'quadratic', points: left });
          pushPatch({ kind: 'quadratic', points: right });
        } else {
          pushPatch({ kind: 'quadratic', points: [currentPoint, control, to] });
        }
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'conicTo': {
        if (!currentPoint) break;
        const control = transformPoint2D(verb.control, transform);
        const to = transformPoint2D(verb.to, transform);
        const cuspT = findCuspTBySampling((t) =>
          derivativeConic(currentPoint!, control, to, verb.weight, t)
        );
        if (cuspT !== null) {
          const cusp = evaluateConic(currentPoint, control, to, verb.weight, cuspT);
          pushPatch({ kind: 'line', points: [currentPoint, cusp] });
          pushPatch({ kind: 'line', points: [cusp, to] });
        } else {
          pushPatch({
            kind: 'conic',
            points: [currentPoint, control, to],
            weight: verb.weight,
          });
        }
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'cubicTo': {
        if (!currentPoint) break;
        const control1 = transformPoint2D(verb.control1, transform);
        const control2 = transformPoint2D(verb.control2, transform);
        const to = transformPoint2D(verb.to, transform);
        const chops = findCubicConvex180Chops(currentPoint, control1, control2, to);
        if (chops.ts.length > 0) {
          const chopped = splitCubicAtMany(currentPoint, control1, control2, to, chops.ts);
          for (let index = 0; index < chopped.length; index += 1) {
            const points = chopped[index]!;
            pushPatch({ kind: 'cubic', points });
            if (chops.areCusps && index + 1 < chopped.length) {
              const cuspPoint = points[3];
              pushPatch({
                kind: 'cubic',
                points: [cuspPoint, cuspPoint, cuspPoint, cuspPoint],
              });
            }
          }
        } else {
          pushPatch({ kind: 'cubic', points: [currentPoint, control1, control2, to] });
        }
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'arcTo': {
        if (!currentPoint) break;
        const arcPatches = createArcConicPatches(
          verb.center,
          verb.radius,
          verb.startAngle,
          verb.endAngle,
          verb.counterClockwise ?? false,
          transform,
        );
        for (const arcPatch of arcPatches) {
          pushPatch(arcPatch);
          contourPoints.push(arcPatch.points[arcPatch.points.length - 1]!);
        }
        currentPoint = contourPoints[contourPoints.length - 1] ?? currentPoint;
        break;
      }
      case 'close':
        if (currentPoint && contourStart && !pointsEqual(currentPoint, contourStart)) {
          pushPatch({ kind: 'line', points: [currentPoint, contourStart] });
        }
        flushWedges();
        currentPoint = contourStart;
        break;
    }
  }

  flushWedges();
  return Object.freeze(patches);
};

const prepareFillTriangles = (
  subpaths: readonly FlattenedSubpath[],
  fillRule: PathFillRule2D,
): readonly Point2D[] | null => {
  const canTriangulateDirectly = subpaths.length === 1 &&
    subpaths[0]!.closed &&
    !isSelfIntersecting(subpaths[0]!.points);

  if (!canTriangulateDirectly) {
    const scanlineTriangles = scanlineTessellate(subpaths, fillRule);
    if (scanlineTriangles && scanlineTriangles.length > 0) {
      return scanlineTriangles;
    }
  }

  const triangles: Point2D[] = [];
  for (const subpath of subpaths) {
    if (!subpath.closed || subpath.points.length < 3) return null;
    const contourTriangles = triangulatePolygon(subpath.points);
    if (!contourTriangles) {
      return scanlineTessellate(subpaths, fillRule);
    }
    triangles.push(...contourTriangles);
  }
  return Object.freeze(triangles);
};

const tessellateFillFromPatches = (
  patches: readonly DrawingPreparedPatch[],
): readonly Point2D[] | null => {
  const triangles: Point2D[] = [];
  let sawWedge = false;
  for (const patch of patches) {
    if (!patch.fanPoint) {
      continue;
    }
    sawWedge = true;
    const endPoint = patch.kind === 'cubic'
      ? patch.points[3]
      : patch.points[patch.points.length - 1];
    triangles.push(patch.fanPoint, patch.points[0], endPoint);
  }
  return sawWedge ? Object.freeze(triangles) : null;
};

const middleOutFanTriangulate = (
  points: readonly Point2D[],
): readonly Point2D[] | null => {
  if (points.length < 3 || !isConvexPolygon(points)) {
    return null;
  }
  const triangles: Point2D[] = [];
  let left = 1;
  let right = points.length - 1;
  let anchor = 0;
  while (left < right) {
    appendTriangle(triangles, points[anchor]!, points[left]!, points[right]!);
    anchor = left;
    left += 1;
    if (left >= right) {
      break;
    }
    appendTriangle(triangles, points[anchor]!, points[right]!, points[left]!);
    anchor = right;
    right -= 1;
  }
  if (triangles.length === 0) {
    return triangulatePolygon(points);
  }
  return Object.freeze(triangles);
};

const lineIntersection = (
  p0: Point2D,
  d0: Point2D,
  p1: Point2D,
  d1: Point2D,
): Point2D | null => {
  const det = (d0[0] * d1[1]) - (d0[1] * d1[0]);
  if (Math.abs(det) <= epsilon) return null;
  const delta = subtract(p1, p0);
  const t = ((delta[0] * d1[1]) - (delta[1] * d1[0])) / det;
  return add(p0, scale(d0, t));
};

const appendTriangle = (triangles: Point2D[], a: Point2D, b: Point2D, c: Point2D): void => {
  triangles.push(a, b, c);
};

const appendQuad = (triangles: Point2D[], a: Point2D, b: Point2D, c: Point2D, d: Point2D): void => {
  triangles.push(a, b, c, a, c, d);
};

const appendColoredQuad = (
  triangles: DrawingPreparedVertex[],
  a: DrawingPreparedVertex,
  b: DrawingPreparedVertex,
  c: DrawingPreparedVertex,
  d: DrawingPreparedVertex,
): void => {
  triangles.push(a, b, c, a, c, d);
};

const appendRoundFan = (
  triangles: Point2D[],
  center: Point2D,
  start: Point2D,
  end: Point2D,
  approxStrokeRadius: number,
): void => {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  while (endAngle <= startAngle) {
    endAngle += Math.PI * 2;
  }
  const span = endAngle - startAngle;
  const steps = Math.max(2, Math.ceil(span * calcNumRadialSegmentsPerRadian(approxStrokeRadius)));
  let previous = start;
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  for (let index = 1; index <= steps; index += 1) {
    const angle = startAngle + ((span * index) / steps);
    const next: Point2D = [
      center[0] + (Math.cos(angle) * radius),
      center[1] + (Math.sin(angle) * radius),
    ];
    appendTriangle(triangles, center, previous, next);
    previous = next;
  }
};

const buildFillFringe = (
  subpaths: readonly FlattenedSubpath[],
  color: readonly [number, number, number, number],
): readonly DrawingPreparedVertex[] | undefined => {
  const transparent: readonly [number, number, number, number] = [color[0], color[1], color[2], 0];
  const fringe: DrawingPreparedVertex[] = [];
  for (const subpath of subpaths) {
    if (!subpath.closed || subpath.points.length < 2) {
      continue;
    }
    const winding = polygonArea(subpath.points) >= 0 ? 1 : -1;
    for (let index = 0; index < subpath.points.length; index += 1) {
      const start = subpath.points[index]!;
      const end = subpath.points[(index + 1) % subpath.points.length]!;
      const direction = normalize(subtract(end, start));
      if (!direction) {
        continue;
      }
      const outward = scale(perpendicular(direction), winding > 0 ? -aaFringeWidth : aaFringeWidth);
      const outerStart = add(start, outward);
      const outerEnd = add(end, outward);
      appendColoredQuad(
        fringe,
        { point: start, color },
        { point: end, color },
        { point: outerEnd, color: transparent },
        { point: outerStart, color: transparent },
      );
    }
  }
  return fringe.length > 0 ? Object.freeze(fringe) : undefined;
};

const appendStrokeCap = (
  triangles: Point2D[],
  point: Point2D,
  direction: Point2D,
  normal: Point2D,
  halfWidth: number,
  cap: NonNullable<DrawingPaint['strokeCap']>,
  atStart: boolean,
): void => {
  const signedDirection = atStart ? scale(direction, -1) : direction;
  const left = add(point, scale(normal, halfWidth));
  const right = add(point, scale(normal, -halfWidth));
  if (cap === 'butt') return;
  if (cap === 'square') {
    const extension = scale(signedDirection, halfWidth);
    appendQuad(triangles, add(left, extension), add(right, extension), right, left);
    return;
  }
  const start = atStart ? right : left;
  const end = atStart ? left : right;
  appendRoundFan(triangles, point, start, end, halfWidth);
};

const appendDegenerateStrokeCap = (
  triangles: Point2D[],
  point: Point2D,
  halfWidth: number,
  cap: NonNullable<DrawingPaint['strokeCap']>,
): void => {
  if (cap === 'butt') {
    return;
  }
  if (cap === 'square') {
    appendQuad(
      triangles,
      [point[0] - halfWidth, point[1] - halfWidth],
      [point[0] + halfWidth, point[1] - halfWidth],
      [point[0] + halfWidth, point[1] + halfWidth],
      [point[0] - halfWidth, point[1] + halfWidth],
    );
    return;
  }
  appendRoundFan(
    triangles,
    point,
    [point[0] + halfWidth, point[1]],
    [point[0] + halfWidth, point[1]],
    halfWidth,
  );
};

const appendStrokeJoin = (
  triangles: Point2D[],
  point: Point2D,
  inDirection: Point2D,
  outDirection: Point2D,
  halfWidth: number,
  join: NonNullable<DrawingPaint['strokeJoin']>,
  miterLimit: number,
): void => {
  const inNormal = perpendicular(inDirection);
  const outNormal = perpendicular(outDirection);
  const turn = cross([0, 0], inDirection, outDirection);
  if (Math.abs(turn) <= epsilon) return;
  const outerSign = turn > 0 ? 1 : -1;
  const outerStart = add(point, scale(inNormal, halfWidth * outerSign));
  const outerEnd = add(point, scale(outNormal, halfWidth * outerSign));

  if (join === 'round') {
    appendRoundFan(triangles, point, outerStart, outerEnd, halfWidth);
    return;
  }

  if (join === 'miter') {
    const miterPoint = lineIntersection(
      outerStart,
      inDirection,
      outerEnd,
      outDirection,
    );
    if (miterPoint) {
      const miterLength = Math.hypot(miterPoint[0] - point[0], miterPoint[1] - point[1]) /
        halfWidth;
      if (miterLength <= miterLimit) {
        appendTriangle(triangles, point, outerStart, miterPoint);
        appendTriangle(triangles, point, miterPoint, outerEnd);
        return;
      }
    }
  }

  appendTriangle(triangles, point, outerStart, outerEnd);
};

const buildStrokeSegmentRecords = (
  points: readonly Point2D[],
  closed: boolean,
  halfWidth: number,
): DrawingStrokeSegmentRecord[] => {
  const segmentData: DrawingStrokeSegmentRecord[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const direction = normalize(subtract(end, start));
    if (!direction) {
      continue;
    }
    const normal = perpendicular(direction);
    const leftStart = add(start, scale(normal, halfWidth));
    const rightStart = add(start, scale(normal, -halfWidth));
    const leftEnd = add(end, scale(normal, halfWidth));
    const rightEnd = add(end, scale(normal, -halfWidth));
    segmentData.push({
      start,
      end,
      direction,
      normal,
      leftStart,
      rightStart,
      leftEnd,
      rightEnd,
    });
  }
  if (closed && points.length > 2) {
    const start = points[points.length - 1]!;
    const end = points[0]!;
    const direction = normalize(subtract(end, start));
    if (direction) {
      const normal = perpendicular(direction);
      const leftStart = add(start, scale(normal, halfWidth));
      const rightStart = add(start, scale(normal, -halfWidth));
      const leftEnd = add(end, scale(normal, halfWidth));
      const rightEnd = add(end, scale(normal, -halfWidth));
      segmentData.push({
        start,
        end,
        direction,
        normal,
        leftStart,
        rightStart,
        leftEnd,
        rightEnd,
      });
    }
  }
  return segmentData;
};

const prepareStrokeTriangles = (
  contours: readonly DrawingStrokeContourRecord[],
  paint: DrawingPaint,
):
  | Readonly<{
    triangles: readonly Point2D[];
    fringeVertices?: readonly DrawingPreparedVertex[];
  }>
  | null => {
  const strokeStyle = resolveStrokeStyle(paint);
  const halfWidth = strokeStyle.halfWidth;
  const cap = strokeStyle.cap;
  const join = strokeStyle.joinLimit < 0
    ? 'round'
    : strokeStyle.joinLimit === 0
    ? 'bevel'
    : 'miter';
  const miterLimit = Math.max(1, strokeStyle.joinLimit);
  const triangles: Point2D[] = [];
  const fringeVertices: DrawingPreparedVertex[] = [];
  const color = resolveStrokeColor(paint);
  const transparent: readonly [number, number, number, number] = [color[0], color[1], color[2], 0];

  for (const subpath of contours) {
    if (subpath.points.length < 2) {
      if (subpath.degeneratePoint) {
        appendDegenerateStrokeCap(triangles, subpath.degeneratePoint, halfWidth, cap);
      }
      continue;
    }
    const segmentData = subpath.segments;
    for (const segment of segmentData) {
      appendQuad(
        triangles,
        segment.leftStart,
        segment.leftEnd,
        segment.rightEnd,
        segment.rightStart,
      );
      const leftOuterStart = add(segment.start, scale(segment.normal, halfWidth + aaFringeWidth));
      const leftOuterEnd = add(segment.end, scale(segment.normal, halfWidth + aaFringeWidth));
      const rightOuterStart = add(
        segment.start,
        scale(segment.normal, -(halfWidth + aaFringeWidth)),
      );
      const rightOuterEnd = add(segment.end, scale(segment.normal, -(halfWidth + aaFringeWidth)));
      appendColoredQuad(
        fringeVertices,
        { point: segment.leftStart, color },
        { point: segment.leftEnd, color },
        { point: leftOuterEnd, color: transparent },
        { point: leftOuterStart, color: transparent },
      );
      appendColoredQuad(
        fringeVertices,
        { point: segment.rightEnd, color },
        { point: segment.rightStart, color },
        { point: rightOuterStart, color: transparent },
        { point: rightOuterEnd, color: transparent },
      );
    }
    if (segmentData.length === 0) continue;
    if (subpath.closed) {
      for (let index = 0; index < segmentData.length; index += 1) {
        const incoming = segmentData[(index + segmentData.length - 1) % segmentData.length]!;
        const outgoing = segmentData[index]!;
        appendStrokeJoin(
          triangles,
          outgoing.start,
          incoming.direction,
          outgoing.direction,
          halfWidth,
          join,
          miterLimit,
        );
      }
    } else {
      appendStrokeCap(
        triangles,
        segmentData[0]!.start,
        segmentData[0]!.direction,
        segmentData[0]!.normal,
        halfWidth,
        cap,
        true,
      );
      appendStrokeCap(
        triangles,
        segmentData[segmentData.length - 1]!.end,
        segmentData[segmentData.length - 1]!.direction,
        segmentData[segmentData.length - 1]!.normal,
        halfWidth,
        cap,
        false,
      );
      for (let index = 1; index < segmentData.length; index += 1) {
        appendStrokeJoin(
          triangles,
          segmentData[index]!.start,
          segmentData[index - 1]!.direction,
          segmentData[index]!.direction,
          halfWidth,
          join,
          miterLimit,
        );
      }
    }
  }

  return triangles.length > 0
    ? {
      triangles: Object.freeze(triangles),
      fringeVertices: undefined,
    }
    : null;
};

const normalizeDashArray = (paint: DrawingPaint): readonly number[] | null => {
  const dashArray = paint.dashArray?.filter((value) => value > epsilon) ?? [];
  if (dashArray.length === 0) {
    return null;
  }
  if (dashArray.length % 2 === 1) {
    return Object.freeze([...dashArray, ...dashArray]);
  }
  return Object.freeze(dashArray);
};

const buildDashedPolyline = (
  points: readonly Point2D[],
  closed: boolean,
  dashArray: readonly number[],
  dashOffset: number,
): readonly FlattenedSubpath[] => {
  if (points.length < 2) {
    return [];
  }

  const totalPatternLength = dashArray.reduce((sum, value) => sum + value, 0);
  if (totalPatternLength <= epsilon) {
    return [];
  }

  let offset = ((dashOffset % totalPatternLength) + totalPatternLength) % totalPatternLength;
  let dashIndex = 0;
  while (offset > dashArray[dashIndex]!) {
    offset -= dashArray[dashIndex]!;
    dashIndex = (dashIndex + 1) % dashArray.length;
  }
  let dashRemaining = dashArray[dashIndex]! - offset;
  let drawing = dashIndex % 2 === 0;

  const segments: Array<readonly [Point2D, Point2D]> = [];
  const pointCount = closed ? points.length + 1 : points.length;
  for (let index = 1; index < pointCount; index += 1) {
    let start = points[(index - 1) % points.length]!;
    const end = points[index % points.length]!;
    let remaining = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (remaining <= epsilon) {
      continue;
    }

    while (remaining > epsilon) {
      const step = Math.min(remaining, dashRemaining);
      const t = step / remaining;
      const split = lerp(start, end, t);
      if (drawing) {
        segments.push([start, split]);
      }
      start = split;
      remaining -= step;
      dashRemaining -= step;
      if (dashRemaining <= epsilon) {
        dashIndex = (dashIndex + 1) % dashArray.length;
        dashRemaining = dashArray[dashIndex]!;
        drawing = dashIndex % 2 === 0;
      }
    }
  }

  const dashed: FlattenedSubpath[] = [];
  let current: Point2D[] = [];
  for (const [start, end] of segments) {
    if (current.length === 0) {
      current.push(start, end);
      continue;
    }
    if (pointsEqual(current[current.length - 1]!, start)) {
      current.push(end);
      continue;
    }
    dashed.push({ points: Object.freeze(current), closed: false });
    current = [start, end];
  }
  if (current.length > 0) {
    dashed.push({ points: Object.freeze(current), closed: false });
  }
  return Object.freeze(dashed);
};

const applyDashPattern = (
  subpaths: readonly FlattenedSubpath[],
  paint: DrawingPaint,
): readonly FlattenedSubpath[] => {
  const dashArray = normalizeDashArray(paint);
  if (!dashArray) {
    return subpaths;
  }
  const dashOffset = paint.dashOffset ?? 0;
  const dashed: FlattenedSubpath[] = [];
  for (const subpath of subpaths) {
    dashed.push(...buildDashedPolyline(subpath.points, subpath.closed, dashArray, dashOffset));
  }
  return Object.freeze(dashed);
};

const createStrokeContourRecords = (
  subpaths: readonly FlattenedSubpath[],
): readonly DrawingStrokeContourRecord[] =>
  Object.freeze(subpaths.map((subpath) => {
    const segments = buildStrokeSegmentRecords(subpath.points, subpath.closed, 0.5);
    const firstPoint = subpath.points[0];
    const lastPoint = subpath.points[subpath.points.length - 1];
    let startTangent: Point2D | undefined;
    let endTangent: Point2D | undefined;
    if (segments.length > 0) {
      startTangent = segments[0]!.direction;
      endTangent = segments[segments.length - 1]!.direction;
    }
    return {
      points: subpath.points,
      closed: subpath.closed,
      segments: Object.freeze(segments),
      degeneratePoint: subpath.points.length === 1 ? subpath.points[0] : undefined,
      firstPoint,
      lastPoint,
      startTangent,
      endTangent,
    };
  }));

const createLinePatchesFromContours = (
  contours: readonly DrawingStrokeContourRecord[],
): readonly DrawingPreparedPatch[] => {
  const patches: DrawingPreparedPatch[] = [];
  for (const contour of contours) {
    for (const segment of contour.segments) {
      patches.push({
        kind: 'line',
        points: [segment.start, segment.end],
        resolveLevel: 0,
        wangsFormulaP4: 1,
      });
    }
  }
  return Object.freeze(patches);
};

const computeStrokeBounds = (
  subpaths: readonly FlattenedSubpath[],
  halfWidth: number,
): Rect => {
  const points = subpaths.flatMap((subpath) => subpath.points);
  if (points.length === 0) {
    return { origin: [0, 0], size: { width: 0, height: 0 } };
  }
  const bounds = computeBounds(points);
  const outset = halfWidth + aaFringeWidth;
  return {
    origin: [bounds.origin[0] - outset, bounds.origin[1] - outset],
    size: {
      width: bounds.size.width + (2 * outset),
      height: bounds.size.height + (2 * outset),
    },
  };
};

const canUseTessellatedStrokePatches = (
  patches: readonly DrawingPreparedStrokePatch[],
  subpaths: readonly FlattenedSubpath[],
  paint: DrawingPaint,
): boolean => {
  return patches.length > 0 &&
    subpaths.length > 0 &&
    subpaths.every((subpath) => subpath.points.length >= 1);
};

const shouldPrepareStrokePatches = (paint: DrawingPaint): boolean => {
  return true;
};

const transformPoints = (
  points: readonly Point2D[],
  transform: readonly [number, number, number, number, number, number],
): readonly Point2D[] => Object.freeze(points.map((point) => transformPoint2D(point, transform)));

const computeContourMidpoint = (points: readonly Point2D[]): Point2D => {
  if (points.length === 0) {
    return [0, 0];
  }
  if (points.length === 1) {
    return points[0]!;
  }

  const closedPoints = pointsEqual(points[0]!, points[points.length - 1]!)
    ? points
    : [...points, points[0]!];
  let totalLength = 0;
  for (let index = 1; index < closedPoints.length; index += 1) {
    totalLength += Math.hypot(
      closedPoints[index]![0] - closedPoints[index - 1]![0],
      closedPoints[index]![1] - closedPoints[index - 1]![1],
    );
  }
  if (totalLength <= epsilon) {
    return points[0]!;
  }

  const targetLength = totalLength / 2;
  let traversed = 0;
  for (let index = 1; index < closedPoints.length; index += 1) {
    const start = closedPoints[index - 1]!;
    const end = closedPoints[index]!;
    const segmentLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (traversed + segmentLength >= targetLength) {
      const t = (targetLength - traversed) / Math.max(segmentLength, epsilon);
      return lerp(start, end, t);
    }
    traversed += segmentLength;
  }
  return points[0]!;
};

const preparePathFill = (command: DrawPathCommand | DrawShapeCommand): DrawingDrawPreparation => {
  const subpaths = flattenSubpaths(command.path, identityMatrix2D);
  if (!subpaths) {
    return { supported: false, reason: 'path does not resolve to subpaths' };
  }

  const preparedClipStack = visitDrawingClipStackForDraw(
    command.clipStack,
    (path, transform) => {
      const subpaths = flattenSubpaths(path, transform);
      if (!subpaths || subpaths.length === 0) {
        return null;
      }
      return {
        bounds: unionBounds(subpaths.map((subpath) => computeBounds(subpath.points))),
        triangles: prepareFillTriangles(subpaths, path.fillRule) ?? undefined,
      };
    },
    (bounds, candidate) => candidate ? intersectBounds(bounds, candidate) : bounds,
    computeBounds,
  );
  const style = command.paint.style ?? 'fill';
  if (style === 'fill') {
    const patches = preparePatches(command.path, identityMatrix2D, true);
    const hasCurves = patches.some((patch) =>
      patch.kind === 'quadratic' || patch.kind === 'conic' || patch.kind === 'cubic'
    );
    const hasWedges = patches.some((patch) => patch.fanPoint !== undefined);
    const isSingleConvexContour = subpaths.length === 1 &&
      subpaths[0]!.closed &&
      isConvexPolygon(subpaths[0]!.points);
    const renderer = selectPathFillRenderer({
      fillRule: command.path.fillRule,
      patchCount: patches.length,
      hasCurves,
      hasWedges,
      isSingleConvexContour,
    });

    let baseTriangles: readonly Point2D[] = [];
    switch (renderer) {
      case 'middle-out-fan':
        baseTriangles = middleOutFanTriangulate(subpaths[0]!.points) ?? [];
        break;
      case 'stencil-tessellated-wedges':
        baseTriangles = tessellateFillFromPatches(patches) ??
          prepareFillTriangles(subpaths, command.path.fillRule) ?? [];
        break;
      case 'stencil-tessellated-curves':
        baseTriangles = prepareFillTriangles(subpaths, command.path.fillRule) ??
          tessellateFillFromPatches(patches) ?? [];
        break;
      default:
        baseTriangles = prepareFillTriangles(subpaths, command.path.fillRule) ?? [];
        break;
    }
    const fringeVertices = buildFillFringe(subpaths, resolveFillColor(command.paint));
    if (!baseTriangles) {
      return { supported: false, reason: 'path fill triangulation failed' };
    }
    return {
      supported: true,
      draw: {
        kind: 'pathFill',
        renderer,
        triangles: baseTriangles,
        fringeVertices,
        patches,
        fillRule: command.path.fillRule,
        color: resolveFillColor(command.paint),
        transform: command.transform,
        bounds: computeBounds(transformPoints(baseTriangles, command.transform)),
        clipRect: preparedClipStack.bounds,
        clip: preparedClipStack.stencilClip
          ? {
            ...preparedClipStack.stencilClip,
            deferredClipDraws: preparedClipStack.deferredClipDraws,
            analyticClip: preparedClipStack.analyticClip,
            atlasClip: preparedClipStack.atlasClip,
            shader: preparedClipStack.shader,
          }
          : preparedClipStack.analyticClip || preparedClipStack.atlasClip ||
              preparedClipStack.shader
          ? {
            bounds: preparedClipStack.bounds,
            deferredClipDraws: preparedClipStack.deferredClipDraws,
            analyticClip: preparedClipStack.analyticClip,
            atlasClip: preparedClipStack.atlasClip,
            shader: preparedClipStack.shader,
          }
          : undefined,
        usesStencil: Boolean(preparedClipStack.stencilClip?.elements?.length),
      },
    };
  }

  const strokeStyle = resolveStrokeStyle(command.paint);
  const dashedStrokeSubpaths = applyDashPattern(subpaths, command.paint);
  const strokeContours = createStrokeContourRecords(dashedStrokeSubpaths);
  const lineOnlyStrokeContours = strokeContours.every((contour) =>
    contour.points.length <= 2 || contour.points.every((_, index) => index < 2)
  );
  const patches = shouldPrepareStrokePatches(command.paint)
    ? createPreparedStrokePatches(
      strokeContours,
      (command.paint.dashArray?.length ?? 0) > 0 || lineOnlyStrokeContours
        ? createLinePatchesFromContours(strokeContours)
        : prepareStrokePatches(command.path),
      strokeStyle.cap,
      strokeStyle,
    )
    : Object.freeze([] as DrawingPreparedStrokePatch[]);
  const usesTessellatedStrokePatches = canUseTessellatedStrokePatches(
    patches,
    dashedStrokeSubpaths,
    command.paint,
  );
  const preparedStroke = prepareStrokeTriangles(strokeContours, command.paint);
  const strokedBounds = computeStrokeBounds(
    dashedStrokeSubpaths,
    strokeStyle.halfWidth,
  );
  const strokeTriangles = preparedStroke?.triangles ?? [];
  if (!preparedStroke) {
    return { supported: false, reason: 'path stroke expansion failed' };
  }
  return {
    supported: true,
    draw: {
      kind: 'pathStroke',
      renderer: selectPathStrokeRenderer(patches.map((patch) => patch.patch)),
      triangles: strokeTriangles,
      fringeVertices: preparedStroke.fringeVertices,
      patches,
      usesTessellatedStrokePatches,
      color: resolveStrokeColor(command.paint),
      strokeStyle,
      transform: command.transform,
      bounds: computeBounds(transformPoints([
        strokedBounds.origin,
        [
          strokedBounds.origin[0] + strokedBounds.size.width,
          strokedBounds.origin[1] + strokedBounds.size.height,
        ] as Point2D,
      ], command.transform)),
      clipRect: preparedClipStack.bounds,
      clip: preparedClipStack.stencilClip
        ? {
          ...preparedClipStack.stencilClip,
          deferredClipDraws: preparedClipStack.deferredClipDraws,
          analyticClip: preparedClipStack.analyticClip,
          atlasClip: preparedClipStack.atlasClip,
          shader: preparedClipStack.shader,
        }
        : preparedClipStack.analyticClip || preparedClipStack.atlasClip || preparedClipStack.shader
        ? {
          bounds: preparedClipStack.bounds,
          deferredClipDraws: preparedClipStack.deferredClipDraws,
          analyticClip: preparedClipStack.analyticClip,
          atlasClip: preparedClipStack.atlasClip,
          shader: preparedClipStack.shader,
        }
        : undefined,
      usesStencil: Boolean(preparedClipStack.stencilClip?.elements?.length),
    },
  };
};

export const prepareDrawingPathCommand = (
  command: DrawPathCommand | DrawShapeCommand,
): DrawingDrawPreparation => preparePathFill(command);
