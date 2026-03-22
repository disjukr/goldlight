import type { Matrix2D, Path2D, Point2D, Rect, Shape2D, Size2D } from '@rieul3d/geometry';

export type DrawingPoint2D = Point2D;
export type DrawingSize2D = Size2D;
export type DrawingPath2D = Path2D;
export type DrawingShapeDescriptor = Shape2D;
export type DrawingMatrix2D = Matrix2D;
export type DrawingClipRect = Rect;
export type DrawingClipOp = 'intersect' | 'difference';
export type DrawingClip = Readonly<
  | {
    kind: 'rect';
    op: DrawingClipOp;
    rect: DrawingClipRect;
    transform: DrawingMatrix2D;
  }
  | {
    kind: 'path';
    op: DrawingClipOp;
    path: DrawingPath2D;
    transform: DrawingMatrix2D;
  }
>;

export type DrawingClipStackState = 'empty' | 'wideOpen' | 'deviceRect' | 'complex';

export type DrawingClipShader = Readonly<{
  kind: 'solidColor';
  color: readonly [number, number, number, number];
}>;

export type DrawingClipStackSaveRecord = Readonly<{
  startingElementIndex: number;
  oldestValidIndex: number;
  elementCount: number;
  deferredSaveCount: number;
  state: DrawingClipStackState;
  bounds?: DrawingClipRect;
  clipShader?: DrawingClipShader;
}>;

export type DrawingClipStackElement = Readonly<{
  clip: DrawingClip;
  saveRecordIndex: number;
  invalidatedByIndex?: number;
}>;

export type DrawingClipStackSnapshot = Readonly<{
  elements: readonly DrawingClipStackElement[];
  saveRecords: readonly DrawingClipStackSaveRecord[];
}>;

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

export type DrawingStrokeStyle = Readonly<{
  halfWidth: number;
  joinLimit: number;
  cap: 'butt' | 'square' | 'round';
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
  clipStack: DrawingClipStackSnapshot;
}>;

export type DrawShapeCommand = Readonly<{
  kind: 'drawShape';
  shape: DrawingShapeDescriptor;
  path: DrawingPath2D;
  paint: DrawingPaint;
  transform: DrawingMatrix2D;
  clipStack: DrawingClipStackSnapshot;
}>;

export type DrawingCommand = ClearCommand | DrawPathCommand | DrawShapeCommand;

export type DrawingSubmission = Readonly<{
  backend: DrawingBackendKind;
  commands: readonly DrawingCommand[];
}>;
