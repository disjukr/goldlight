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

export type DrawingClipStackRawElementPendingDraw = Readonly<{
  drawId: number;
  usageBounds: DrawingClipRect;
  scissorBounds: DrawingClipRect;
  maxDepthIndex: number;
  maxDepth: number;
  firstUseOrder: number;
  paintOrder: number;
  stencilIndex: number;
}>;

export type DrawingClipStackInsertion = Readonly<{
  layerOrder: number;
  bindingNode: unknown | null;
}>;

export type DrawingClipStackRawElementRuntimeState = Readonly<{
  preparedBounds?: DrawingClipRect;
  preparedTriangles?: readonly DrawingPoint2D[];
  latestInsertion?: DrawingClipStackInsertion;
  usageBounds?: DrawingClipRect;
  pendingDraw?: DrawingClipStackRawElementPendingDraw;
}>;

export type DrawingClipStackRawElement = Readonly<{
  id: number;
  clip: DrawingClip;
  runtimeState?: DrawingClipStackRawElementRuntimeState;
}>;

export type DrawingClipStackElement = Readonly<{
  id: number;
  clip: DrawingClip;
  saveRecordIndex: number;
  invalidatedByIndex?: number;
  rawElement: DrawingClipStackRawElement;
}>;

export type DrawingClipStackSnapshot = Readonly<{
  elements: readonly DrawingClipStackElement[];
  saveRecords: readonly DrawingClipStackSaveRecord[];
}>;

export type DrawingBackendKind = 'graphite-dawn';

export type DrawingBlendMode =
  | 'clear'
  | 'src'
  | 'dst'
  | 'src-over'
  | 'dst-over'
  | 'src-in'
  | 'dst-in'
  | 'src-out'
  | 'dst-out'
  | 'src-atop'
  | 'dst-atop'
  | 'xor'
  | 'plus'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type DrawingCoverageMode = 'auto' | 'single-channel' | 'lcd';

export type DrawingArithmeticBlender = Readonly<{
  kind: 'arithmetic';
  coefficients: readonly [number, number, number, number];
}>;

export type DrawingCustomBlender = DrawingArithmeticBlender;

export type DrawingPaint = Readonly<{
  color?: readonly [number, number, number, number];
  blendMode?: DrawingBlendMode;
  coverage?: DrawingCoverageMode;
  blender?: DrawingCustomBlender;
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
