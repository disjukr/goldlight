import type { Matrix2d, Path2d, Point2d, Rect, Shape2d, Size2d } from '@goldlight/geometry';

export type DrawingPoint2d = Point2d;
export type DrawingSize2d = Size2d;
export type DrawingPath2d = Path2d;
export type DrawingShapeDescriptor = Shape2d;
export type DrawingMatrix2d = Matrix2d;
export type DrawingClipRect = Rect;
export type DrawingClipOp = 'intersect' | 'difference';
export type DrawingClip = Readonly<
  | {
    kind: 'rect';
    op: DrawingClipOp;
    rect: DrawingClipRect;
    transform: DrawingMatrix2d;
  }
  | {
    kind: 'path';
    op: DrawingClipOp;
    path: DrawingPath2d;
    transform: DrawingMatrix2d;
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
  latestInsertion: DrawingClipStackInsertion;
  sourceRenderStep: Readonly<{
    renderStepIndex: number;
    renderStepKind: string;
    pipelineKey: string;
    requiresBarrier: boolean;
    usesFillStencil: boolean;
    usesDepth: boolean;
  }>;
}>;

export type DrawingClipStackWrapperKind = 'single' | 'stencil' | 'depth-only';

export type DrawingClipStackInsertion = Readonly<{
  layerOrder: number;
  renderStepIndex: number;
  renderStepKind: string;
  pipelineKey: string;
  bindingKey: string;
  wrapperKind: DrawingClipStackWrapperKind;
  bindingNode: unknown | null;
}>;

export type DrawingClipStackRawElementRuntimeState = Readonly<{
  preparedBounds?: DrawingClipRect;
  preparedTriangles?: readonly DrawingPoint2d[];
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

export type DrawingGradientTileMode = 'clamp' | 'repeat' | 'mirror' | 'decal';

export type DrawingGradientInterpolationColorSpace =
  | 'destination'
  | 'srgb-linear'
  | 'lab'
  | 'oklab'
  | 'oklab-gamut-map'
  | 'lch'
  | 'oklch'
  | 'oklch-gamut-map'
  | 'srgb'
  | 'hsl'
  | 'hwb';

export type DrawingGradientInterpolationHueMethod =
  | 'shorter'
  | 'longer'
  | 'increasing'
  | 'decreasing';

export type DrawingGradientInterpolation = Readonly<{
  inPremul?: boolean;
  colorSpace?: DrawingGradientInterpolationColorSpace;
  hueMethod?: DrawingGradientInterpolationHueMethod;
}>;

export type DrawingGradientStop = Readonly<{
  offset: number;
  color: readonly [number, number, number, number];
}>;

type DrawingGradientShaderBase = Readonly<{
  stops: readonly DrawingGradientStop[];
  tileMode?: DrawingGradientTileMode;
  interpolation?: DrawingGradientInterpolation;
}>;

export type DrawingLinearGradientShader =
  & DrawingGradientShaderBase
  & Readonly<{
    kind: 'linear-gradient';
    start: DrawingPoint2d;
    end: DrawingPoint2d;
  }>;

export type DrawingRadialGradientShader =
  & DrawingGradientShaderBase
  & Readonly<{
    kind: 'radial-gradient';
    center: DrawingPoint2d;
    radius: number;
  }>;

export type DrawingTwoPointConicalGradientShader =
  & DrawingGradientShaderBase
  & Readonly<{
    kind: 'two-point-conical-gradient';
    startCenter: DrawingPoint2d;
    startRadius: number;
    endCenter: DrawingPoint2d;
    endRadius: number;
  }>;

export type DrawingSweepGradientShader =
  & DrawingGradientShaderBase
  & Readonly<{
    kind: 'sweep-gradient';
    center: DrawingPoint2d;
    startAngle: number;
    endAngle?: number;
  }>;

export type DrawingPaintShader =
  | DrawingLinearGradientShader
  | DrawingRadialGradientShader
  | DrawingTwoPointConicalGradientShader
  | DrawingSweepGradientShader;

export type DrawingPaint = Readonly<{
  color?: readonly [number, number, number, number];
  shader?: DrawingPaintShader;
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
  path: DrawingPath2d;
  paint: DrawingPaint;
  transform: DrawingMatrix2d;
  clipStack: DrawingClipStackSnapshot;
}>;

export type DrawShapeCommand = Readonly<{
  kind: 'drawShape';
  shape: DrawingShapeDescriptor;
  path: DrawingPath2d;
  paint: DrawingPaint;
  transform: DrawingMatrix2d;
  clipStack: DrawingClipStackSnapshot;
}>;

export type DrawingCommand = ClearCommand | DrawPathCommand | DrawShapeCommand;

export type DrawingSubmission = Readonly<{
  backend: DrawingBackendKind;
  commands: readonly DrawingCommand[];
}>;
