import type { Point2D } from '@rieul3d/geometry';
import type { DrawingPaint, DrawingPath2D, DrawPathCommand, DrawShapeCommand } from './types.ts';

export type DrawingPreparedPathFill = Readonly<{
  kind: 'pathFill';
  points: readonly Point2D[];
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

const resolveFillColor = (
  paint: DrawingPaint,
): readonly [number, number, number, number] => paint.color ?? defaultFillColor;

const extractClosedPolygon = (
  path: DrawingPath2D,
): readonly Point2D[] | null => {
  const points: Point2D[] = [];
  let firstPoint: Point2D | null = null;
  let sawClose = false;

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
        if (points.length > 0) {
          return null;
        }
        firstPoint = verb.to;
        points.push(verb.to);
        break;
      case 'lineTo':
        if (points.length === 0) {
          return null;
        }
        points.push(verb.to);
        break;
      case 'close':
        sawClose = true;
        break;
      case 'quadTo':
        return null;
    }
  }

  if (!sawClose || points.length < 3 || firstPoint === null) {
    return null;
  }

  const lastPoint = points[points.length - 1];
  if (lastPoint && lastPoint[0] === firstPoint[0] && lastPoint[1] === firstPoint[1]) {
    points.pop();
  }

  return points.length >= 3 ? Object.freeze(points) : null;
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

  const polygon = extractClosedPolygon(path);
  if (!polygon) {
    return {
      supported: false,
      reason: 'path is not a single closed polygon made of line segments',
    };
  }

  return {
    supported: true,
    draw: {
      kind: 'pathFill',
      points: polygon,
      color: resolveFillColor(paint),
    },
  };
};

export const prepareDrawingPathCommand = (
  command: DrawPathCommand | DrawShapeCommand,
): DrawingDrawPreparation => preparePathFill(command.path, command.paint);
