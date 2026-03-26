import { type DrawingPaint, type DrawingRecorder, recordDrawPath } from '@goldlight/drawing';
import {
  createTranslationMatrix2d,
  type Matrix2d,
  multiplyMatrix2d,
  type Path2d,
  type Point2d,
  transformPath2d,
} from '@goldlight/geometry';
import type { ShapedRun, TextHost } from './types.ts';

export type TextOnPathAlign = 'start' | 'center' | 'end';

export type TextOnPathOptions = Readonly<{
  startOffset?: number;
  align?: TextOnPathAlign;
  normalOffset?: number;
  contour?: 'first' | 'longest';
  overflow?: 'discard' | 'clamp';
  runXBounds?: TextOnPathRunXBounds;
}>;

export type TextOnPathGlyphPlacement = Readonly<{
  glyphIndex: number;
  glyphID: number;
  distance: number;
  point: Point2d;
  tangent: Point2d;
  angle: number;
  transform: Matrix2d;
}>;

export type TextOnPathRunXBounds = Readonly<{
  minX: number;
  maxX: number;
}>;

type PathContour = Readonly<{
  points: readonly Point2d[];
  length: number;
}>;

const distanceBetween = (left: Point2d, right: Point2d): number =>
  Math.hypot(right[0] - left[0], right[1] - left[1]);

const pointsEqual = (left: Point2d, right: Point2d): boolean =>
  Math.abs(left[0] - right[0]) < 1e-6 && Math.abs(left[1] - right[1]) < 1e-6;

const lerpPoint = (from: Point2d, to: Point2d, t: number): Point2d => [
  from[0] + ((to[0] - from[0]) * t),
  from[1] + ((to[1] - from[1]) * t),
];

const normalize = (point: Point2d): Point2d => {
  const length = Math.hypot(point[0], point[1]);
  if (length <= 1e-6) {
    return [1, 0];
  }
  return [point[0] / length, point[1] / length];
};

const updateBoundsWithPoint = (
  bounds: { minX: number; maxX: number; initialized: boolean },
  point: Point2d,
): void => {
  if (!bounds.initialized) {
    bounds.minX = point[0];
    bounds.maxX = point[0];
    bounds.initialized = true;
    return;
  }
  bounds.minX = Math.min(bounds.minX, point[0]);
  bounds.maxX = Math.max(bounds.maxX, point[0]);
};

const getPathXBounds = (path: Path2d): TextOnPathRunXBounds | null => {
  const bounds = { minX: 0, maxX: 0, initialized: false };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
      case 'lineTo':
        updateBoundsWithPoint(bounds, verb.to);
        break;
      case 'quadTo':
        updateBoundsWithPoint(bounds, verb.control);
        updateBoundsWithPoint(bounds, verb.to);
        break;
      case 'conicTo':
        updateBoundsWithPoint(bounds, verb.control);
        updateBoundsWithPoint(bounds, verb.to);
        break;
      case 'cubicTo':
        updateBoundsWithPoint(bounds, verb.control1);
        updateBoundsWithPoint(bounds, verb.control2);
        updateBoundsWithPoint(bounds, verb.to);
        break;
      case 'arcTo':
        updateBoundsWithPoint(bounds, [verb.center[0] - verb.radius, verb.center[1]]);
        updateBoundsWithPoint(bounds, [verb.center[0] + verb.radius, verb.center[1]]);
        break;
      case 'close':
        break;
    }
  }

  if (!bounds.initialized) {
    return null;
  }

  return { minX: bounds.minX, maxX: bounds.maxX };
};

const evaluateQuadratic = (
  start: Point2d,
  control: Point2d,
  end: Point2d,
  t: number,
): Point2d => {
  const mt = 1 - t;
  return [
    (mt * mt * start[0]) + (2 * mt * t * control[0]) + (t * t * end[0]),
    (mt * mt * start[1]) + (2 * mt * t * control[1]) + (t * t * end[1]),
  ];
};

const evaluateConic = (
  start: Point2d,
  control: Point2d,
  end: Point2d,
  weight: number,
  t: number,
): Point2d => {
  const mt = 1 - t;
  const w0 = mt * mt;
  const w1 = 2 * weight * mt * t;
  const w2 = t * t;
  const sum = w0 + w1 + w2;
  if (sum <= 1e-6) {
    return end;
  }
  return [
    ((w0 * start[0]) + (w1 * control[0]) + (w2 * end[0])) / sum,
    ((w0 * start[1]) + (w1 * control[1]) + (w2 * end[1])) / sum,
  ];
};

const evaluateCubic = (
  start: Point2d,
  control1: Point2d,
  control2: Point2d,
  end: Point2d,
  t: number,
): Point2d => {
  const mt = 1 - t;
  return [
    (mt * mt * mt * start[0]) +
    (3 * mt * mt * t * control1[0]) +
    (3 * mt * t * t * control2[0]) +
    (t * t * t * end[0]),
    (mt * mt * mt * start[1]) +
    (3 * mt * mt * t * control1[1]) +
    (3 * mt * t * t * control2[1]) +
    (t * t * t * end[1]),
  ];
};

const wrapAngleDelta = (delta: number): number => {
  if (delta > Math.PI) {
    return delta - (Math.PI * 2);
  }
  if (delta < -Math.PI) {
    return delta + (Math.PI * 2);
  }
  return delta;
};

const appendSampledCurve = (
  points: Point2d[],
  steps: number,
  sampler: (t: number) => Point2d,
): void => {
  for (let step = 1; step <= steps; step += 1) {
    points.push(sampler(step / steps));
  }
};

const estimateSubdivisionSteps = (lengthHint: number): number =>
  Math.max(8, Math.min(96, Math.ceil(lengthHint / 8)));

const buildPathContours = (path: Path2d): readonly PathContour[] => {
  const contours: PathContour[] = [];
  let currentPoints: Point2d[] = [];
  let currentPoint: Point2d | null = null;
  let contourStart: Point2d | null = null;

  const flushContour = (): void => {
    if (currentPoints.length < 2) {
      currentPoints = [];
      currentPoint = null;
      contourStart = null;
      return;
    }
    let length = 0;
    for (let index = 1; index < currentPoints.length; index += 1) {
      length += distanceBetween(currentPoints[index - 1]!, currentPoints[index]!);
    }
    if (length > 1e-6) {
      contours.push({
        points: Object.freeze([...currentPoints]),
        length,
      });
    }
    currentPoints = [];
    currentPoint = null;
    contourStart = null;
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
        flushContour();
        currentPoint = verb.to;
        contourStart = verb.to;
        currentPoints.push(verb.to);
        break;
      case 'lineTo':
        if (!currentPoint) {
          currentPoint = verb.to;
          contourStart = verb.to;
          currentPoints.push(verb.to);
          break;
        }
        currentPoint = verb.to;
        currentPoints.push(verb.to);
        break;
      case 'quadTo': {
        if (!currentPoint) {
          currentPoint = verb.to;
          contourStart = verb.to;
          currentPoints.push(verb.to);
          break;
        }
        const lengthHint = distanceBetween(currentPoint, verb.control) +
          distanceBetween(verb.control, verb.to);
        appendSampledCurve(
          currentPoints,
          estimateSubdivisionSteps(lengthHint),
          (t) => evaluateQuadratic(currentPoint!, verb.control, verb.to, t),
        );
        currentPoint = verb.to;
        break;
      }
      case 'conicTo': {
        if (!currentPoint) {
          currentPoint = verb.to;
          contourStart = verb.to;
          currentPoints.push(verb.to);
          break;
        }
        const lengthHint = distanceBetween(currentPoint, verb.control) +
          distanceBetween(verb.control, verb.to);
        appendSampledCurve(
          currentPoints,
          estimateSubdivisionSteps(lengthHint),
          (t) => evaluateConic(currentPoint!, verb.control, verb.to, verb.weight, t),
        );
        currentPoint = verb.to;
        break;
      }
      case 'cubicTo': {
        if (!currentPoint) {
          currentPoint = verb.to;
          contourStart = verb.to;
          currentPoints.push(verb.to);
          break;
        }
        const lengthHint = distanceBetween(currentPoint, verb.control1) +
          distanceBetween(verb.control1, verb.control2) +
          distanceBetween(verb.control2, verb.to);
        appendSampledCurve(
          currentPoints,
          estimateSubdivisionSteps(lengthHint),
          (t) => evaluateCubic(currentPoint!, verb.control1, verb.control2, verb.to, t),
        );
        currentPoint = verb.to;
        break;
      }
      case 'arcTo': {
        const delta = wrapAngleDelta(verb.endAngle - verb.startAngle);
        const sweep = verb.counterClockwise ? delta : -delta;
        const arcLength = Math.abs(sweep) * verb.radius;
        appendSampledCurve(
          currentPoints,
          estimateSubdivisionSteps(arcLength),
          (t) => {
            const angle = verb.startAngle + (sweep * t);
            return [
              verb.center[0] + (Math.cos(angle) * verb.radius),
              verb.center[1] + (Math.sin(angle) * verb.radius),
            ];
          },
        );
        currentPoint = currentPoints[currentPoints.length - 1] ?? null;
        if (!contourStart && currentPoint) {
          contourStart = currentPoint;
        }
        break;
      }
      case 'close':
        if (currentPoint && contourStart && !pointsEqual(currentPoint, contourStart)) {
          currentPoints.push(contourStart);
        }
        flushContour();
        break;
    }
  }

  flushContour();
  return Object.freeze(contours);
};

const selectContour = (
  contours: readonly PathContour[],
  strategy: NonNullable<TextOnPathOptions['contour']>,
): PathContour | null => {
  if (contours.length === 0) {
    return null;
  }
  if (strategy === 'first') {
    return contours[0]!;
  }
  let longest = contours[0]!;
  for (let index = 1; index < contours.length; index += 1) {
    if (contours[index]!.length > longest.length) {
      longest = contours[index]!;
    }
  }
  return longest;
};

const sampleContour = (
  contour: PathContour,
  requestedDistance: number,
  overflow: NonNullable<TextOnPathOptions['overflow']>,
):
  | Readonly<{
    point: Point2d;
    tangent: Point2d;
    distance: number;
  }>
  | null => {
  if (contour.points.length < 2 || contour.length <= 1e-6) {
    return null;
  }
  if (overflow === 'discard' && (requestedDistance < 0 || requestedDistance > contour.length)) {
    return null;
  }
  const targetDistance = Math.max(0, Math.min(contour.length, requestedDistance));
  let traveled = 0;
  for (let index = 1; index < contour.points.length; index += 1) {
    const start = contour.points[index - 1]!;
    const end = contour.points[index]!;
    const segmentLength = distanceBetween(start, end);
    if (segmentLength <= 1e-6) {
      continue;
    }
    if (targetDistance <= traveled + segmentLength || index === contour.points.length - 1) {
      const localT = Math.max(0, Math.min(1, (targetDistance - traveled) / segmentLength));
      return {
        point: lerpPoint(start, end, localT),
        tangent: normalize([end[0] - start[0], end[1] - start[1]]),
        distance: targetDistance,
      };
    }
    traveled += segmentLength;
  }
  return null;
};

const alignOffsetForRun = (
  run: ShapedRun,
  align: NonNullable<TextOnPathOptions['align']>,
  contourLength: number,
  runXBounds?: TextOnPathRunXBounds,
): number => {
  if (runXBounds) {
    switch (align) {
      case 'center':
        return (contourLength / 2) - ((runXBounds.minX + runXBounds.maxX) / 2);
      case 'end':
        return contourLength - runXBounds.maxX;
      case 'start':
      default:
        return -runXBounds.minX;
    }
  }

  switch (align) {
    case 'center':
      return (contourLength / 2) - (run.advanceX / 2);
    case 'end':
      return contourLength - run.advanceX;
    case 'start':
    default:
      return 0;
  }
};

const createRotationMatrix = (angle: number, tx: number, ty: number): Matrix2d => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, tx, ty];
};

export const layoutTextOnPath = (
  run: ShapedRun,
  path: Path2d,
  options: TextOnPathOptions = {},
): readonly TextOnPathGlyphPlacement[] => {
  const contour = selectContour(buildPathContours(path), options.contour ?? 'longest');
  if (!contour) {
    return Object.freeze([]);
  }

  const alignOffset = alignOffsetForRun(
    run,
    options.align ?? 'start',
    contour.length,
    options.runXBounds,
  );
  const startOffset = options.startOffset ?? 0;
  const normalOffset = options.normalOffset ?? 0;
  const overflow = options.overflow ?? 'discard';
  const placements: TextOnPathGlyphPlacement[] = [];

  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const distance = startOffset + alignOffset + run.positions[index * 2]!;
    const sample = sampleContour(contour, distance, overflow);
    if (!sample) {
      continue;
    }
    const angle = Math.atan2(sample.tangent[1], sample.tangent[0]);
    const localOffsetX = run.offsets[index * 2]!;
    const localOffsetY = run.positions[(index * 2) + 1]! + run.offsets[(index * 2) + 1]! +
      normalOffset;
    const transform = multiplyMatrix2d(
      createRotationMatrix(angle, sample.point[0], sample.point[1]),
      createTranslationMatrix2d(localOffsetX, localOffsetY),
    );
    placements.push({
      glyphIndex: index,
      glyphID: run.glyphIDs[index]!,
      distance: sample.distance,
      point: sample.point,
      tangent: sample.tangent,
      angle,
      transform,
    });
  }

  return Object.freeze(placements);
};

export const measurePathFallbackRunXBounds = (
  host: TextHost,
  run: ShapedRun,
): TextOnPathRunXBounds | null => {
  let minX = 0;
  let maxX = 0;
  let initialized = false;

  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphPath = host.getGlyphPath(run.typeface, run.glyphIDs[index]!, run.size);
    if (!glyphPath) {
      continue;
    }
    const glyphBounds = getPathXBounds(glyphPath);
    if (!glyphBounds) {
      continue;
    }
    const glyphOriginX = run.positions[index * 2]! + run.offsets[index * 2]!;
    const glyphMinX = glyphOriginX + glyphBounds.minX;
    const glyphMaxX = glyphOriginX + glyphBounds.maxX;
    if (!initialized) {
      minX = glyphMinX;
      maxX = glyphMaxX;
      initialized = true;
      continue;
    }
    minX = Math.min(minX, glyphMinX);
    maxX = Math.max(maxX, glyphMaxX);
  }

  if (!initialized) {
    return null;
  }

  return {
    minX,
    maxX,
  };
};

export const recordPathFallbackRunOnPath = (
  host: TextHost,
  recorder: DrawingRecorder,
  run: ShapedRun,
  path: Path2d,
  paint: DrawingPaint = {},
  options: TextOnPathOptions = {},
): readonly TextOnPathGlyphPlacement[] => {
  const placements = layoutTextOnPath(run, path, {
    ...options,
    runXBounds: options.runXBounds ?? measurePathFallbackRunXBounds(host, run) ?? undefined,
  });
  for (const placement of placements) {
    const glyphPath = host.getGlyphPath(run.typeface, placement.glyphID, run.size);
    if (!glyphPath) {
      continue;
    }
    recordDrawPath(
      recorder,
      transformPath2d(glyphPath, placement.transform),
      paint,
    );
  }
  return placements;
};
