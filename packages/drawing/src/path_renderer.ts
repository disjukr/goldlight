import { type PathFillRule2D, type Point2D, type Rect, transformPoint2D } from '@rieul3d/geometry';
import type {
  DrawingClip,
  DrawingClipOp,
  DrawingClipRect,
  DrawingPaint,
  DrawingPath2D,
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

export type DrawingPreparedClip = Readonly<{
  bounds?: Rect;
  elements?: readonly DrawingPreparedClipElement[];
}>;

export type DrawingPreparedClipElement = Readonly<{
  op: DrawingClipOp;
  triangles: readonly Point2D[];
}>;

type DrawingPreparedPatchBase = Readonly<{
  fanPoint?: Point2D;
  resolveLevel: number;
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

export type DrawingPreparedPathFill = Readonly<{
  kind: 'pathFill';
  renderer: DrawingRendererKind;
  triangles: readonly Point2D[];
  fringeVertices?: readonly DrawingPreparedVertex[];
  patches: readonly DrawingPreparedPatch[];
  fillRule: PathFillRule2D;
  color: readonly [number, number, number, number];
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
  patches: readonly DrawingPreparedPatch[];
  color: readonly [number, number, number, number];
  halfWidth: number;
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
const patchPrecision = 1 / Math.max(curveFlatnessTolerance, epsilon);
const maxPatchResolveLevel = 6;
const roundStrokeSegments = 12;
const hairlineCoverageWidth = 1;
const aaFringeWidth = 1;
const cuspDerivativeEpsilon = 0.5;

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

const quadraticWangsFormulaResolveLevel = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
): number => {
  const vx = from[0] - (2 * control[0]) + to[0];
  const vy = from[1] - (2 * control[1]) + to[1];
  const lengthSquared = (vx * vx) + (vy * vy);
  const p4 = lengthSquared * patchPrecision * patchPrecision * 0.25;
  return Math.min(
    maxPatchResolveLevel,
    Math.max(0, Math.ceil(Math.log2(Math.sqrt(Math.sqrt(p4))))),
  );
};

const cubicWangsFormulaResolveLevel = (
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
  const p4 = maxLengthSquared * patchPrecision * patchPrecision * (81 / 64);
  return Math.min(
    maxPatchResolveLevel,
    Math.max(0, Math.ceil(Math.log2(Math.sqrt(Math.sqrt(p4))))),
  );
};

const conicWangsFormulaResolveLevel = (
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
    return maxPatchResolveLevel;
  }
  return Math.min(maxPatchResolveLevel, nextLog2(Math.sqrt(Math.max(0, numerator / denominator))));
};

const resolvePatchLevel = (patch: DrawingPatchDefinition): number => {
  switch (patch.kind) {
    case 'line':
      return 0;
    case 'quadratic':
      return quadraticWangsFormulaResolveLevel(patch.points[0], patch.points[1], patch.points[2]);
    case 'conic':
      return conicWangsFormulaResolveLevel(
        patch.points[0],
        patch.points[1],
        patch.points[2],
        patch.weight,
      );
    case 'cubic':
      return cubicWangsFormulaResolveLevel(
        patch.points[0],
        patch.points[1],
        patch.points[2],
        patch.points[3],
      );
  }
};

const finalizePatch = (
  patch: DrawingPatchDefinition,
  extras: Readonly<{ fanPoint?: Point2D }> = {},
): DrawingPreparedPatch => {
  const resolveLevel = resolvePatchLevel(patch);
  switch (patch.kind) {
    case 'line':
      return { ...patch, ...extras, resolveLevel };
    case 'quadratic':
      return { ...patch, ...extras, resolveLevel };
    case 'conic':
      return { ...patch, ...extras, resolveLevel };
    case 'cubic':
      return { ...patch, ...extras, resolveLevel };
  }
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
        const cuspT = findCuspTBySampling((t) =>
          derivativeCubic(currentPoint!, control1, control2, to, t)
        );
        if (cuspT !== null) {
          const [left, right] = splitCubicAt(currentPoint, control1, control2, to, cuspT);
          pushPatch({ kind: 'cubic', points: left });
          pushPatch({ kind: 'cubic', points: right });
        } else {
          pushPatch({ kind: 'cubic', points: [currentPoint, control1, control2, to] });
        }
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'arcTo': {
        if (!currentPoint) break;
        const points: Point2D[] = [currentPoint];
        flattenArc(
          verb.center,
          verb.radius,
          verb.startAngle,
          verb.endAngle,
          verb.counterClockwise ?? false,
          transform,
          points,
        );
        for (let index = 1; index < points.length; index += 1) {
          pushPatch({ kind: 'line', points: [points[index - 1]!, points[index]!] });
          contourPoints.push(points[index]!);
        }
        currentPoint = points[points.length - 1] ?? currentPoint;
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
): void => {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  while (endAngle <= startAngle) {
    endAngle += Math.PI * 2;
  }
  const span = endAngle - startAngle;
  const steps = Math.max(2, Math.ceil((span / (Math.PI * 2)) * roundStrokeSegments));
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
  appendRoundFan(triangles, point, start, end);
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
    appendRoundFan(triangles, point, outerStart, outerEnd);
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

const prepareStrokeTriangles = (
  subpaths: readonly FlattenedSubpath[],
  paint: DrawingPaint,
):
  | Readonly<{
    triangles: readonly Point2D[];
    fringeVertices?: readonly DrawingPreparedVertex[];
  }>
  | null => {
  const strokeWidth = Math.max(paint.strokeWidth ?? 1, epsilon);
  const halfWidth = Math.max(0.5, strokeWidth) / 2;
  const join = paint.strokeJoin ?? 'miter';
  const cap = paint.strokeCap ?? 'butt';
  const miterLimit = Math.max(1, paint.miterLimit ?? 4);
  const triangles: Point2D[] = [];
  const fringeVertices: DrawingPreparedVertex[] = [];
  const color = resolveStrokeColor(paint);
  const transparent: readonly [number, number, number, number] = [color[0], color[1], color[2], 0];

  for (const subpath of applyDashPattern(subpaths, paint)) {
    if (subpath.points.length < 2) continue;
    const segmentData = [];
    for (let index = 0; index < subpath.points.length - 1; index += 1) {
      const start = subpath.points[index]!;
      const end = subpath.points[index + 1]!;
      const direction = normalize(subtract(end, start));
      if (!direction) continue;
      const normal = perpendicular(direction);
      const leftStart = add(start, scale(normal, halfWidth));
      const rightStart = add(start, scale(normal, -halfWidth));
      const leftEnd = add(end, scale(normal, halfWidth));
      const rightEnd = add(end, scale(normal, -halfWidth));
      appendQuad(triangles, leftStart, leftEnd, rightEnd, rightStart);
      const leftOuterStart = add(start, scale(normal, halfWidth + aaFringeWidth));
      const leftOuterEnd = add(end, scale(normal, halfWidth + aaFringeWidth));
      const rightOuterStart = add(start, scale(normal, -(halfWidth + aaFringeWidth)));
      const rightOuterEnd = add(end, scale(normal, -(halfWidth + aaFringeWidth)));
      appendColoredQuad(
        fringeVertices,
        { point: leftStart, color },
        { point: leftEnd, color },
        { point: leftOuterEnd, color: transparent },
        { point: leftOuterStart, color: transparent },
      );
      appendColoredQuad(
        fringeVertices,
        { point: rightEnd, color },
        { point: rightStart, color },
        { point: rightOuterStart, color: transparent },
        { point: rightOuterEnd, color: transparent },
      );
      segmentData.push({ start, end, direction, normal, leftStart, rightStart, leftEnd, rightEnd });
    }
    if (subpath.closed && subpath.points.length > 2) {
      const start = subpath.points[subpath.points.length - 1]!;
      const end = subpath.points[0]!;
      const direction = normalize(subtract(end, start));
      if (direction) {
        const normal = perpendicular(direction);
        const leftStart = add(start, scale(normal, halfWidth));
        const rightStart = add(start, scale(normal, -halfWidth));
        const leftEnd = add(end, scale(normal, halfWidth));
        const rightEnd = add(end, scale(normal, -halfWidth));
        appendQuad(triangles, leftStart, leftEnd, rightEnd, rightStart);
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
      fringeVertices: fringeVertices.length > 0 ? Object.freeze(fringeVertices) : undefined,
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

type PreparedClipStack = Readonly<{
  bounds?: Rect;
  convexPolygons: readonly (readonly Point2D[])[];
  stencilClip?: DrawingPreparedClip;
}>;

const createPolygonTriangles = (polygon: readonly Point2D[]): readonly Point2D[] => {
  if (polygon.length < 3) {
    return Object.freeze([]) as readonly Point2D[];
  }

  const triangles: Point2D[] = [];
  for (let index = 1; index < polygon.length - 1; index += 1) {
    triangles.push(polygon[0]!, polygon[index]!, polygon[index + 1]!);
  }
  return Object.freeze(triangles);
};

const createRectClipPolygon = (
  clipRect: DrawingClipRect,
  transform: readonly [number, number, number, number, number, number],
): readonly Point2D[] => {
  const x0 = clipRect.origin[0];
  const y0 = clipRect.origin[1];
  const x1 = x0 + clipRect.size.width;
  const y1 = y0 + clipRect.size.height;
  return Object.freeze([
    transformPoint2D([x0, y0], transform),
    transformPoint2D([x1, y0], transform),
    transformPoint2D([x1, y1], transform),
    transformPoint2D([x0, y1], transform),
  ]);
};

const prepareClipStack = (clips: readonly DrawingClip[]): PreparedClipStack | undefined => {
  if (clips.length === 0) return undefined;

  const convexPolygons: Point2D[][] = [];
  let bounds: Rect | undefined;
  const stencilElements: DrawingPreparedClipElement[] = [];

  for (const clip of clips) {
    if (clip.kind === 'rect') {
      const polygon = createRectClipPolygon(clip.rect, clip.transform);
      if (clip.op === 'intersect') {
        convexPolygons.push([...polygon]);
        bounds = intersectBounds(bounds, computeBounds(polygon));
      } else {
        stencilElements.push({
          op: clip.op,
          triangles: createPolygonTriangles(polygon),
        });
      }
      continue;
    }

    const subpaths = flattenSubpaths(clip.path, clip.transform);
    if (!subpaths || subpaths.length === 0) {
      continue;
    }

    const clipBounds = unionBounds(subpaths.map((subpath) => computeBounds(subpath.points)));
    if (clip.op === 'intersect') {
      bounds = intersectBounds(bounds, clipBounds);
    }

    if (
      clip.op === 'intersect' &&
      subpaths.length === 1 &&
      subpaths[0]!.closed &&
      isConvexPolygon(subpaths[0]!.points)
    ) {
      convexPolygons.push([...subpaths[0]!.points]);
      continue;
    }

    const clipTriangles = prepareFillTriangles(subpaths, clip.path.fillRule);
    if (clipTriangles && clipTriangles.length > 0) {
      stencilElements.push({
        op: clip.op,
        triangles: Object.freeze([...clipTriangles]),
      });
    }
  }

  const stencilClip = stencilElements.length > 0
    ? {
      bounds,
      elements: Object.freeze(stencilElements),
    }
    : undefined;

  return {
    bounds,
    convexPolygons: Object.freeze(convexPolygons.map((polygon) => Object.freeze(polygon))),
    stencilClip,
  };
};

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

const applyConvexClipStack = (
  triangles: readonly Point2D[],
  clipStack: PreparedClipStack | undefined,
): readonly Point2D[] => {
  if (!clipStack || clipStack.convexPolygons.length === 0) {
    return triangles;
  }

  let clipped = triangles;
  for (const polygon of clipStack.convexPolygons) {
    clipped = clipTrianglesAgainstConvexPolygon(clipped, polygon);
    if (clipped.length === 0) {
      break;
    }
  }
  return clipped;
};

const preparePathFill = (command: DrawPathCommand | DrawShapeCommand): DrawingDrawPreparation => {
  const subpaths = flattenSubpaths(command.path, command.transform);
  if (!subpaths) {
    return { supported: false, reason: 'path does not resolve to subpaths' };
  }

  const preparedClipStack = prepareClipStack(command.clips);
  const style = command.paint.style ?? 'fill';
  if (style === 'fill') {
    const patches = preparePatches(command.path, command.transform, true);
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
    const requiresExactConvexClipFallback = (preparedClipStack?.convexPolygons.length ?? 0) > 0 &&
      renderer !== 'middle-out-fan';
    const clippedFringeVertices = requiresExactConvexClipFallback
      ? undefined
      : buildFillFringe(subpaths, resolveFillColor(command.paint));
    const triangles = applyConvexClipStack(
      baseTriangles,
      preparedClipStack,
    );
    if (!triangles) {
      return { supported: false, reason: 'path fill triangulation failed' };
    }
    return {
      supported: true,
      draw: {
        kind: 'pathFill',
        renderer: requiresExactConvexClipFallback ? 'middle-out-fan' : renderer,
        triangles,
        fringeVertices: clippedFringeVertices,
        patches: requiresExactConvexClipFallback ? [] : patches,
        fillRule: command.path.fillRule,
        color: resolveFillColor(command.paint),
        bounds: computeBounds(triangles),
        clipRect: preparedClipStack?.bounds,
        clip: preparedClipStack?.stencilClip,
        usesStencil: Boolean(preparedClipStack?.stencilClip?.elements?.length),
      },
    };
  }

  const patches = preparePatches(command.path, command.transform, false);
  const preparedStroke = prepareStrokeTriangles(subpaths, command.paint);
  const requiresExactConvexClipFallback = (preparedClipStack?.convexPolygons.length ?? 0) > 0;
  const strokeTriangles = applyConvexClipStack(
    preparedStroke?.triangles ?? [],
    preparedClipStack,
  );
  if (!strokeTriangles) {
    return { supported: false, reason: 'path stroke expansion failed' };
  }
  return {
    supported: true,
    draw: {
      kind: 'pathStroke',
      renderer: selectPathStrokeRenderer(patches),
      triangles: strokeTriangles,
      fringeVertices: requiresExactConvexClipFallback ? undefined : preparedStroke?.fringeVertices,
      patches: requiresExactConvexClipFallback ? [] : patches,
      color: resolveStrokeColor(command.paint),
      halfWidth: Math.max(0.5, Math.max(command.paint.strokeWidth ?? 1, epsilon)) / 2,
      bounds: computeBounds(strokeTriangles),
      clipRect: preparedClipStack?.bounds,
      clip: preparedClipStack?.stencilClip,
      usesStencil: Boolean(preparedClipStack?.stencilClip?.elements?.length),
    },
  };
};

export const prepareDrawingPathCommand = (
  command: DrawPathCommand | DrawShapeCommand,
): DrawingDrawPreparation => preparePathFill(command);
