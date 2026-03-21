import type { Matrix2D, Path2D, Point2D, Rect, Shape2D, Size2D } from '@rieul3d/geometry';

export type DrawingPoint2D = Point2D;
export type DrawingSize2D = Size2D;
export type DrawingPath2D = Path2D;
export type DrawingShapeDescriptor = Shape2D;
export type DrawingMatrix2D = Matrix2D;
export type DrawingClipRect = Rect;
export type DrawingClip = Readonly<
  | {
    kind: 'rect';
    rect: DrawingClipRect;
    transform: DrawingMatrix2D;
  }
  | {
    kind: 'path';
    path: DrawingPath2D;
    transform: DrawingMatrix2D;
  }
>;

export type DrawingBackendKind = 'graphite-dawn';

export type DrawingPaint = Readonly<{
  color?: readonly [number, number, number, number];
  style?: 'fill' | 'stroke';
  strokeWidth?: number;
  strokeJoin?: 'miter' | 'bevel' | 'round';
  strokeCap?: 'butt' | 'square' | 'round';
  miterLimit?: number;
  dashArray?: readonly number[];
  dashOffset?: number;
}>;

export type ClearCommand = Readonly<{
  kind: 'clear';
  color: readonly [number, number, number, number];
}>;

export type DrawPathCommand = Readonly<{
  kind: 'drawPath';
  path: DrawingPath2D;
  paint: DrawingPaint;
  transform: DrawingMatrix2D;
  clips: readonly DrawingClip[];
}>;

export type DrawShapeCommand = Readonly<{
  kind: 'drawShape';
  shape: DrawingShapeDescriptor;
  path: DrawingPath2D;
  paint: DrawingPaint;
  transform: DrawingMatrix2D;
  clips: readonly DrawingClip[];
}>;

export type DrawingCommand = ClearCommand | DrawPathCommand | DrawShapeCommand;

export type DrawingSubmission = Readonly<{
  backend: DrawingBackendKind;
  commands: readonly DrawingCommand[];
}>;
