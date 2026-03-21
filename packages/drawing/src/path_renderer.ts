import type { PathFillRule2D, Path2D, Point2D, Rect } from '@rieul3d/geometry';
import type {
  DrawingClipRect,
  DrawingPaint,
  DrawingPath2D,
  DrawPathCommand,
  DrawShapeCommand,
} from './types.ts';

type FlattenedSubpath = Readonly<{
  points: readonly Point2D[];
  closed: boolean;
}>;

export type DrawingPreparedClip = Readonly<{
  path?: DrawingPath2D;
  bounds?: Rect;
}>;

export type DrawingPreparedPathFill = Readonly<{
  kind: 'pathFill';
  triangles: readonly Point2D[];
  fillRule: PathFillRule2D;
  color: readonly [number, number, number, number];
  bounds: Rect;
  clipRect?: DrawingClipRect;
  clip?: DrawingPreparedClip;
  usesStencil: true;
}>;

export type DrawingPreparedPathStroke = Readonly<{
  kind: 'pathStroke';
  triangles: readonly Point2D[];
  color: readonly [number, number, number, number];
  bounds: Rect;
  clipRect?: DrawingClipRect;
  clip?: DrawingPreparedClip;
  usesStencil: false;
}>;

export type DrawingPreparedDraw = DrawingPreparedPathFill | DrawingPreparedPathStroke;

export type DrawingDrawPreparation = Readonly<
  | { supported: true; draw: DrawingPreparedDraw }
  | { supported: false; reason: string }
>;

const defaultFillColor: readonly [number, number, number, number] = [0, 0, 0, 1];
const epsilon = 1e-5;
const maxCurveSubdivisionDepth = 6;
const curveFlatnessTolerance = 0.75;
const roundStrokeSegments = 8;

const resolveFillColor = (paint: DrawingPaint): readonly [number, number, number, number] =>
  paint.color ?? defaultFillColor;

const pointsEqual = (left: Point2D, right: Point2D): boolean =>
  Math.abs(left[0] - right[0]) <= epsilon && Math.abs(left[1] - right[1]) <= epsilon;

const cross = (origin: Point2D, a: Point2D, b: Point2D): number =>
  ((a[0] - origin[0]) * (b[1] - origin[1])) - ((a[1] - origin[1]) * (b[0] - origin[0]));

const dot = (left: Point2D, right: Point2D): number => (left[0] * right[0]) + (left[1] * right[1]);

const subtract = (left: Point2D, right: Point2D): Point2D => [left[0] - right[0], left[1] - right[1]];

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
        if (candidateIndex === prev || candidateIndex === current || candidateIndex === next) continue;
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

const flattenQuadraticRecursive = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  depth: number,
  out: Point2D[],
): void => {
  if (depth >= maxCurveSubdivisionDepth || distanceFromLine(control, from, to) <= curveFlatnessTolerance) {
    out.push(to);
    return;
  }
  const p01 = midpoint(from, control);
  const p12 = midpoint(control, to);
  const split = midpoint(p01, p12);
  flattenQuadraticRecursive(from, p01, split, depth + 1, out);
  flattenQuadraticRecursive(split, p12, to, depth + 1, out);
};

const flattenCubicRecursive = (
  from: Point2D,
  control1: Point2D,
  control2: Point2D,
  to: Point2D,
  depth: number,
  out: Point2D[],
): void => {
  const flatness = Math.max(
    distanceFromLine(control1, from, to),
    distanceFromLine(control2, from, to),
  );
  if (depth >= maxCurveSubdivisionDepth || flatness <= curveFlatnessTolerance) {
    out.push(to);
    return;
  }
  const p01 = midpoint(from, control1);
  const p12 = midpoint(control1, control2);
  const p23 = midpoint(control2, to);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);
  flattenCubicRecursive(from, p01, p012, split, depth + 1, out);
  flattenCubicRecursive(split, p123, p23, to, depth + 1, out);
};

const flattenSubpaths = (path: DrawingPath2D): readonly FlattenedSubpath[] | null => {
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
        points.push(verb.to);
        currentPoint = verb.to;
        break;
      case 'lineTo':
        if (!currentPoint) return null;
        points.push(verb.to);
        currentPoint = verb.to;
        break;
      case 'quadTo':
        if (!currentPoint) return null;
        flattenQuadraticRecursive(currentPoint, verb.control, verb.to, 0, points);
        currentPoint = verb.to;
        break;
      case 'cubicTo':
        if (!currentPoint) return null;
        flattenCubicRecursive(currentPoint, verb.control1, verb.control2, verb.to, 0, points);
        currentPoint = verb.to;
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

const prepareFillTriangles = (subpaths: readonly FlattenedSubpath[]): readonly Point2D[] | null => {
  const triangles: Point2D[] = [];
  for (const subpath of subpaths) {
    if (!subpath.closed || subpath.points.length < 3) return null;
    const contourTriangles = triangulatePolygon(subpath.points);
    if (!contourTriangles) return null;
    triangles.push(...contourTriangles);
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
      const miterLength = Math.hypot(miterPoint[0] - point[0], miterPoint[1] - point[1]) / halfWidth;
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
): readonly Point2D[] | null => {
  const halfWidth = Math.max(0.5, paint.strokeWidth ?? 1) / 2;
  const join = paint.strokeJoin ?? 'miter';
  const cap = paint.strokeCap ?? 'butt';
  const miterLimit = Math.max(1, paint.miterLimit ?? 4);
  const triangles: Point2D[] = [];

  for (const subpath of subpaths) {
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
        segmentData.push({ start, end, direction, normal, leftStart, rightStart, leftEnd, rightEnd });
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

  return triangles.length > 0 ? Object.freeze(triangles) : null;
};

const prepareClip = (clipPath: Path2D | undefined): DrawingPreparedClip | undefined => {
  if (!clipPath) return undefined;
  const subpaths = flattenSubpaths(clipPath);
  if (!subpaths || subpaths.length === 0) return { path: clipPath };
  return {
    path: clipPath,
    bounds: unionBounds(subpaths.map((subpath) => computeBounds(subpath.points))),
  };
};

const preparePathFill = (command: DrawPathCommand | DrawShapeCommand): DrawingDrawPreparation => {
  const subpaths = flattenSubpaths(command.path);
  if (!subpaths) {
    return { supported: false, reason: 'path does not resolve to subpaths' };
  }

  const clip = prepareClip(command.clipPath);
  const style = command.paint.style ?? 'fill';
  if (style === 'fill') {
    const triangles = prepareFillTriangles(subpaths);
    if (!triangles) {
      return { supported: false, reason: 'path fill triangulation failed' };
    }
    return {
      supported: true,
      draw: {
        kind: 'pathFill',
        triangles,
        fillRule: command.path.fillRule,
        color: resolveFillColor(command.paint),
        bounds: unionBounds(subpaths.map((subpath) => computeBounds(subpath.points))),
        clipRect: command.clipRect,
        clip,
        usesStencil: true,
      },
    };
  }

  const strokeTriangles = prepareStrokeTriangles(subpaths, command.paint);
  if (!strokeTriangles) {
    return { supported: false, reason: 'path stroke expansion failed' };
  }
  return {
    supported: true,
    draw: {
      kind: 'pathStroke',
      triangles: strokeTriangles,
      color: resolveFillColor(command.paint),
      bounds: computeBounds(strokeTriangles),
      clipRect: command.clipRect,
      clip,
      usesStencil: false,
    },
  };
};

export const prepareDrawingPathCommand = (
  command: DrawPathCommand | DrawShapeCommand,
): DrawingDrawPreparation => preparePathFill(command);
