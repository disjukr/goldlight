import type { PathFillRule2D, Point2D } from '@rieul3d/geometry';
import type { DrawingPaint, DrawingPath2D, DrawPathCommand, DrawShapeCommand } from './types.ts';

export type DrawingPreparedPathFill = Readonly<{
  kind: 'pathFill';
  contours: readonly (readonly Point2D[])[];
  fillRule: PathFillRule2D;
  color: readonly [number, number, number, number];
}>;

export type DrawingPreparedDraw = DrawingPreparedPathFill;

export type DrawingDrawPreparation = Readonly<
  | {
    supported: true;
    draw: DrawingPreparedDraw;
  }
  | {
    supported: false;
    reason: string;
  }
>;

const defaultFillColor: readonly [number, number, number, number] = [0, 0, 0, 1];
const quadraticSubdivisionCount = 12;

const resolveFillColor = (
  paint: DrawingPaint,
): readonly [number, number, number, number] => paint.color ?? defaultFillColor;

const evaluateQuadraticPoint = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  t: number,
): Point2D => {
  const inverseT = 1 - t;
  return [
    (inverseT * inverseT * from[0]) + (2 * inverseT * t * control[0]) + (t * t * to[0]),
    (inverseT * inverseT * from[1]) + (2 * inverseT * t * control[1]) + (t * t * to[1]),
  ];
};

const extractClosedContours = (
  path: DrawingPath2D,
): readonly (readonly Point2D[])[] | null => {
  const contours: Array<readonly Point2D[]> = [];
  let points: Point2D[] = [];
  let firstPoint: Point2D | null = null;
  let currentPoint: Point2D | null = null;
  let sawClose = false;

  const flushContour = (): boolean => {
    if (!sawClose || points.length < 3 || firstPoint === null) {
      return false;
    }

    const lastPoint = points[points.length - 1];
    if (lastPoint && lastPoint[0] === firstPoint[0] && lastPoint[1] === firstPoint[1]) {
      points.pop();
    }
    if (points.length < 3) {
      return false;
    }

    contours.push(Object.freeze([...points]));
    points = [];
    firstPoint = null;
    currentPoint = null;
    sawClose = false;
    return true;
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
        if (points.length > 0 || sawClose) {
          if (!flushContour()) {
            return null;
          }
        }
        firstPoint = verb.to;
        currentPoint = verb.to;
        points.push(verb.to);
        break;
      case 'lineTo':
        if (currentPoint === null) {
          return null;
        }
        points.push(verb.to);
        currentPoint = verb.to;
        break;
      case 'close':
        if (currentPoint === null) {
          return null;
        }
        sawClose = true;
        break;
      case 'quadTo':
        if (currentPoint === null) {
          return null;
        }
        for (let step = 1; step <= quadraticSubdivisionCount; step += 1) {
          points.push(
            evaluateQuadraticPoint(
              currentPoint,
              verb.control,
              verb.to,
              step / quadraticSubdivisionCount,
            ),
          );
        }
        currentPoint = verb.to;
        break;
    }
  }

  if (points.length > 0 || sawClose) {
    if (!flushContour()) {
      return null;
    }
  }

  return contours.length > 0 ? Object.freeze(contours) : null;
};

const preparePathFill = (
  path: DrawingPath2D,
  paint: DrawingPaint,
): DrawingDrawPreparation => {
  if ((paint.style ?? 'fill') !== 'fill') {
    return {
      supported: false,
      reason: 'only fill style is supported',
    };
  }

  const contours = extractClosedContours(path);
  if (!contours) {
    return {
      supported: false,
      reason: 'path does not resolve to closed contours',
    };
  }

  return {
    supported: true,
    draw: {
      kind: 'pathFill',
      contours,
      fillRule: path.fillRule,
      color: resolveFillColor(paint),
    },
  };
};

export const prepareDrawingPathCommand = (
  command: DrawPathCommand | DrawShapeCommand,
): DrawingDrawPreparation => preparePathFill(command.path, command.paint);
