import {
  identityMatrix2D,
  type PathFillRule2D,
  type Point2D,
  type Rect,
  transformPoint2D,
} from '@rieul3d/geometry';
import { type DrawingPreparedClip, visitDrawingClipStackForDraw } from './clip_stack.ts';
import type {
  DrawingBlendMode,
  DrawingCoverageMode,
  DrawingCustomBlender,
  DrawingClipRect,
  DrawingPaint,
  DrawingPath2D,
  DrawingStrokeStyle,
  DrawPathCommand,
  DrawShapeCommand,
} from './types.ts';
import type { DrawingRecording } from './recording.ts';
import { type DrawingRenderer, type DrawingRendererProvider } from './renderer_provider.ts';

type FlattenedSubpath = Readonly<{
  points: readonly Point2D[];
  closed: boolean;
}>;

export type DrawingPreparedVertex = Readonly<{
  point: Point2D;
  color: readonly [number, number, number, number];
}>;

export type DrawingCoverage = 'none' | 'single-channel' | 'lcd';

export const drawingDstUsage = {
  none: 0,
  dependsOnDst: 0b0001,
  dstReadRequired: 0b0010,
  advancedBlend: 0b0100,
  dstOnlyUsedByRenderer: 0b1000,
} as const;

export type DrawingDstUsage = number;

export const drawingBlendModeCodes = {
  clear: 0,
  src: 1,
  dst: 2,
  srcOver: 3,
  dstOver: 4,
  srcIn: 5,
  dstIn: 6,
  srcOut: 7,
  dstOut: 8,
  srcAtop: 9,
  dstAtop: 10,
  xor: 11,
  plus: 12,
  multiply: 13,
  screen: 14,
  overlay: 15,
  darken: 16,
  lighten: 17,
  colorDodge: 18,
  colorBurn: 19,
  hardLight: 20,
  softLight: 21,
  difference: 22,
  exclusion: 23,
  hue: 24,
  saturation: 25,
  color: 26,
  luminosity: 27,
  arithmetic: 100,
} as const;

export const toDrawingBlendModeCode = (
  blendMode: DrawingBlendMode,
  blender?: DrawingCustomBlender,
): number =>
  blender?.kind === 'arithmetic'
    ? drawingBlendModeCodes.arithmetic
    : blendMode === 'clear'
    ? drawingBlendModeCodes.clear
    : blendMode === 'src'
    ? drawingBlendModeCodes.src
    : blendMode === 'dst'
    ? drawingBlendModeCodes.dst
    : blendMode === 'src-over'
    ? drawingBlendModeCodes.srcOver
    : blendMode === 'dst-over'
    ? drawingBlendModeCodes.dstOver
    : blendMode === 'src-in'
    ? drawingBlendModeCodes.srcIn
    : blendMode === 'dst-in'
    ? drawingBlendModeCodes.dstIn
    : blendMode === 'src-out'
    ? drawingBlendModeCodes.srcOut
    : blendMode === 'dst-out'
    ? drawingBlendModeCodes.dstOut
    : blendMode === 'src-atop'
    ? drawingBlendModeCodes.srcAtop
    : blendMode === 'dst-atop'
    ? drawingBlendModeCodes.dstAtop
    : blendMode === 'xor'
    ? drawingBlendModeCodes.xor
    : blendMode === 'plus'
    ? drawingBlendModeCodes.plus
    : blendMode === 'multiply'
    ? drawingBlendModeCodes.multiply
    : blendMode === 'screen'
    ? drawingBlendModeCodes.screen
    : blendMode === 'overlay'
    ? drawingBlendModeCodes.overlay
    : blendMode === 'darken'
    ? drawingBlendModeCodes.darken
    : blendMode === 'lighten'
    ? drawingBlendModeCodes.lighten
    : blendMode === 'color-dodge'
    ? drawingBlendModeCodes.colorDodge
    : blendMode === 'color-burn'
    ? drawingBlendModeCodes.colorBurn
    : blendMode === 'hard-light'
    ? drawingBlendModeCodes.hardLight
    : blendMode === 'soft-light'
    ? drawingBlendModeCodes.softLight
    : blendMode === 'difference'
    ? drawingBlendModeCodes.difference
    : blendMode === 'exclusion'
    ? drawingBlendModeCodes.exclusion
    : blendMode === 'hue'
    ? drawingBlendModeCodes.hue
    : blendMode === 'saturation'
    ? drawingBlendModeCodes.saturation
    : blendMode === 'color'
    ? drawingBlendModeCodes.color
    : drawingBlendModeCodes.luminosity;

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

type DrawingStrokeContourSequenceItem =
  | Readonly<{
    kind: 'basePatch';
    patch: DrawingPreparedPatch;
    contourStart?: boolean;
    contourEnd?: boolean;
    startCap?: 'none' | 'butt' | 'square' | 'round';
    endCap?: 'none' | 'butt' | 'square' | 'round';
  }>
  | Readonly<{
    kind: 'preparedPatch';
    prepared: DrawingPreparedStrokePatch;
  }>
  | Readonly<{
    kind: 'moveWithinContour';
    anchor: Point2D;
  }>
  | Readonly<{
    kind: 'contourFinished';
  }>;

type DrawingStrokeContourPatchItem = Extract<
  DrawingStrokeContourSequenceItem,
  Readonly<{ kind: 'basePatch' }> | Readonly<{ kind: 'preparedPatch' }>
>;

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
  renderer: DrawingRenderer;
  triangles: readonly Point2D[];
  fringeVertices?: readonly DrawingPreparedVertex[];
  patches: readonly DrawingPreparedPatch[];
  innerFillBounds?: Rect;
  fillRule: PathFillRule2D;
  color: readonly [number, number, number, number];
  blendMode: DrawingBlendMode;
  coverage: DrawingCoverage;
  blender?: DrawingCustomBlender;
  dstUsage: DrawingDstUsage;
  transform: readonly [number, number, number, number, number, number];
  bounds: Rect;
  clipRect?: DrawingClipRect;
  clip?: DrawingPreparedClip;
  usesStencil: boolean;
}>;

export type DrawingPreparedPathStroke = Readonly<{
  kind: 'pathStroke';
  renderer: DrawingRenderer;
  triangles: readonly Point2D[];
  fringeVertices?: readonly DrawingPreparedVertex[];
  patches: readonly DrawingPreparedStrokePatch[];
  usesTessellatedStrokePatches: boolean;
  color: readonly [number, number, number, number];
  blendMode: DrawingBlendMode;
  coverage: DrawingCoverage;
  blender?: DrawingCustomBlender;
  dstUsage: DrawingDstUsage;
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
const defaultBlendMode: DrawingBlendMode = 'src-over';
const coeffBlendModes = new Set<DrawingBlendMode>([
  'clear',
  'src',
  'dst',
  'src-over',
  'dst-over',
  'src-in',
  'dst-in',
  'src-out',
  'dst-out',
  'src-atop',
  'dst-atop',
  'xor',
  'plus',
  'screen',
]);
const advancedBlendModes = new Set<DrawingBlendMode>([
  'multiply',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);
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

const resolveBlendMode = (paint: DrawingPaint): DrawingBlendMode =>
  paint.blendMode ?? defaultBlendMode;

const resolveCoverage = (
  paint: DrawingPaint,
  hasCoverage: boolean,
): DrawingCoverage =>
  !hasCoverage
    ? 'none'
    : paint.coverage === 'lcd'
    ? 'lcd'
    : paint.coverage === 'single-channel'
    ? 'single-channel'
    : 'single-channel';

const formatAutoClamps = (format: GPUTextureFormat): boolean =>
  format !== 'rgba16float' && format !== 'r16float' && format !== 'r32float';

const insetRect = (rect: Rect, inset: number): Rect | undefined => {
  const width = rect.size.width - (2 * inset);
  const height = rect.size.height - (2 * inset);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    origin: [rect.origin[0] + inset, rect.origin[1] + inset],
    size: { width, height },
  };
};

const blendModeDependsOnDst = (
  blendMode: DrawingBlendMode,
  srcIsOpaque: boolean,
): boolean => {
  if (blendMode === 'src' || blendMode === 'clear') {
    return false;
  }
  if (blendMode === 'src-over' || blendMode === 'dst-out') {
    return !srcIsOpaque;
  }
  return true;
};

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

const computeDstUsage = (
  recording: Pick<DrawingRecording, 'caps' | 'targetFormat'>,
  color: readonly [number, number, number, number],
  clip: DrawingPreparedClip | undefined,
  rendererCoverage: DrawingCoverage,
  blendMode: DrawingBlendMode,
  blender: DrawingCustomBlender | undefined,
): DrawingDstUsage => {
  const hasNonMsaaClip = Boolean(clip?.analyticClip) || Boolean(clip?.atlasClip);
  let dstUsage = clip?.shader || hasNonMsaaClip
    ? drawingDstUsage.dependsOnDst
    : rendererCoverage !== 'none'
    ? drawingDstUsage.dependsOnDst | drawingDstUsage.dstOnlyUsedByRenderer
    : drawingDstUsage.none;
  const advancedBlendMode = advancedBlendModes.has(blendMode);
  const dstIsFast = recording.caps.dstReadStrategy !== 'texture-copy';
  const canUseHardwareBlend = !(
    (rendererCoverage === 'lcd' && blendMode !== 'src-over') ||
    (blendMode === 'plus' && (dstIsFast || !formatAutoClamps(recording.targetFormat))) ||
    Boolean(blender) ||
    (advancedBlendMode && !recording.caps.supportsHardwareAdvancedBlending)
  );
  const paintDependsOnDst = blendModeDependsOnDst(blendMode, color[3] >= 1 - epsilon);
  if (paintDependsOnDst) {
    dstUsage |= drawingDstUsage.dependsOnDst;
    dstUsage &= ~drawingDstUsage.dstOnlyUsedByRenderer;
  }
  if (!canUseHardwareBlend) {
    dstUsage |= drawingDstUsage.dependsOnDst | drawingDstUsage.dstReadRequired;
    dstUsage &= ~drawingDstUsage.dstOnlyUsedByRenderer;
  }
  if (advancedBlendMode) {
    dstUsage |= drawingDstUsage.advancedBlend;
  }
  return dstUsage;
};

const createPreparedDrawClip = (
  preparedClipStack: ReturnType<typeof visitDrawingClipStackForDraw>,
): DrawingPreparedClip | undefined =>
  preparedClipStack.stencilClip
    ? {
      ...preparedClipStack.stencilClip,
      deferredClipDraws: preparedClipStack.deferredClipDraws,
      effectiveElementIds: preparedClipStack.effectiveElements.map((element) => element.id),
      effectiveElements: preparedClipStack.preparedEffectiveElements,
      effectiveClipDraws: preparedClipStack.preparedClipDrawElements,
      analyticClip: preparedClipStack.analyticClip,
      atlasClip: preparedClipStack.atlasClip,
      shader: preparedClipStack.shader,
    }
    : preparedClipStack.analyticClip || preparedClipStack.atlasClip || preparedClipStack.shader
    ? {
      bounds: preparedClipStack.bounds,
      deferredClipDraws: preparedClipStack.deferredClipDraws,
      effectiveElementIds: preparedClipStack.effectiveElements.map((element) => element.id),
      effectiveElements: preparedClipStack.preparedEffectiveElements,
      effectiveClipDraws: preparedClipStack.preparedClipDrawElements,
      analyticClip: preparedClipStack.analyticClip,
      atlasClip: preparedClipStack.atlasClip,
      shader: preparedClipStack.shader,
    }
    : undefined;

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

const resolveLevelFromWangsFormulaP4 = (p4: number): number =>
  Math.min(
    maxPatchResolveLevel,
    Math.max(0, Math.ceil(Math.log2(Math.sqrt(Math.sqrt(Math.max(p4, 1)))))),
  );

const resolveLevelFromWangsFormulaP2 = (p2: number): number =>
  Math.min(
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
      const n2 = conicWangsFormulaP2(
        patch.points[0],
        patch.points[1],
        patch.points[2],
        patch.weight,
      );
      return n2 * n2;
    }
    case 'cubic':
      return cubicWangsFormulaP4(
        patch.points[0],
        patch.points[1],
        patch.points[2],
        patch.points[3],
      );
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

const maxParametricSegments = 1 << maxPatchResolveLevel;
const maxParametricSegmentsP4 = maxParametricSegments ** 4;
const maxSegmentsPerCurve = 1024;
const maxSegmentsPerCurveP4 = maxSegmentsPerCurve ** 4;

const accountForStrokeCurve = (wangsFormulaP4: number): number => {
  if (wangsFormulaP4 <= maxParametricSegmentsP4) {
    return 0;
  }
  return Math.ceil(
    Math.sqrt(Math.sqrt(Math.min(wangsFormulaP4, maxSegmentsPerCurveP4) / maxParametricSegmentsP4)),
  );
};

const accountForStrokeConic = (wangsFormulaP4: number): number => {
  if (wangsFormulaP4 <= maxParametricSegmentsP4) {
    return 0;
  }
  return Math.ceil(
    Math.sqrt(Math.sqrt(Math.min(wangsFormulaP4, maxSegmentsPerCurveP4) / maxParametricSegmentsP4)),
  );
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
  const currentP3 = p3;

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

const resolveSquareCapOffset = (
  anchor: Point2D,
  tangentControlPoint: Point2D,
  halfWidth: number,
  transform: readonly [number, number, number, number, number, number],
  isHairline: boolean,
): Point2D => {
  const tangent = normalize(subtract(anchor, tangentControlPoint)) ?? [1, 0];
  if (!isHairline) {
    return scale(tangent, halfWidth);
  }
  const mapped = [
    (transform[0] * tangent[0]) + (transform[2] * tangent[1]),
    (transform[1] * tangent[0]) + (transform[3] * tangent[1]),
  ] as Point2D;
  const mappedLength = Math.hypot(mapped[0], mapped[1]);
  if (mappedLength <= epsilon) {
    return [1, 0];
  }
  return scale(tangent, 0.5 / mappedLength);
};

const resolveDegenerateSquareCapOffset = (
  halfWidth: number,
  transform: readonly [number, number, number, number, number, number],
  isHairline: boolean,
): Point2D => {
  if (!isHairline) {
    return [halfWidth, 0];
  }
  const determinant = (transform[0] * transform[3]) - (transform[2] * transform[1]);
  if (determinant > epsilon) {
    return [
      transform[3] * (0.5 / determinant),
      -transform[1] * (0.5 / determinant),
    ];
  }
  return [1, 0];
};

const createSquareCapStartPatch = (
  anchor: Point2D,
  tangentControlPoint: Point2D,
  halfWidth: number,
  transform: readonly [number, number, number, number, number, number],
  isHairline: boolean,
): DrawingPreparedPatch => {
  const offset = resolveSquareCapOffset(
    anchor,
    tangentControlPoint,
    halfWidth,
    transform,
    isHairline,
  );
  return finalizePatch({
    kind: 'line',
    points: [add(anchor, offset), anchor],
  });
};

const createSquareCapEndPatch = (
  anchor: Point2D,
  tangentControlPoint: Point2D,
  halfWidth: number,
  transform: readonly [number, number, number, number, number, number],
  isHairline: boolean,
): DrawingPreparedPatch => {
  const offset = resolveSquareCapOffset(
    anchor,
    tangentControlPoint,
    halfWidth,
    transform,
    isHairline,
  );
  return finalizePatch({
    kind: 'line',
    points: [anchor, add(anchor, offset)],
  });
};

const createDegenerateSquareStrokePatch = (
  center: Point2D,
  halfWidth: number,
  transform: readonly [number, number, number, number, number, number],
  isHairline: boolean,
): DrawingPreparedPatch => {
  const offset = resolveDegenerateSquareCapOffset(halfWidth, transform, isHairline);
  return finalizePatch({
    kind: 'line',
    points: [
      subtract(center, offset),
      add(center, offset),
    ],
  });
};

const createSyntheticRoundStrokePatch = (
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
  contourStart: false,
  contourEnd: false,
  startCap: 'none',
  endCap: 'none',
});

const createDegenerateRoundStrokePatch = (
  center: Point2D,
): DrawingPreparedStrokePatch => ({
  ...createSyntheticRoundStrokePatch(center),
  contourStart: true,
  contourEnd: true,
  startCap: 'round',
  endCap: 'round',
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

const createPathFromFlattenedStrokeSubpaths = (
  subpaths: readonly FlattenedSubpath[],
  fillRule: PathFillRule2D,
): DrawingPath2D => {
  const verbs: DrawingPath2D['verbs'][number][] = [];
  for (const subpath of subpaths) {
    if (subpath.points.length === 0) {
      continue;
    }
    verbs.push({ kind: 'moveTo', to: subpath.points[0]! });
    if (subpath.points.length === 1) {
      verbs.push({ kind: 'lineTo', to: subpath.points[0]! });
    } else {
      for (let index = 1; index < subpath.points.length; index += 1) {
        verbs.push({ kind: 'lineTo', to: subpath.points[index]! });
      }
    }
    if (subpath.closed) {
      verbs.push({ kind: 'close' });
    }
  }
  return {
    fillRule,
    verbs: Object.freeze(verbs),
  };
};

const createPreparedStrokePatchesFromPath = (
  path: DrawingPath2D,
  strokeStyle: DrawingStrokeStyle,
  transform: readonly [number, number, number, number, number, number],
): readonly DrawingPreparedStrokePatch[] => {
  const prepared: DrawingPreparedStrokePatch[] = [];
  let currentPoint: Point2D | null = null;
  let contourStart: Point2D | null = null;
  let pendingContourStart: Point2D | null = null;
  let lastDegeneratePoint: Point2D | null = null;
  let contourUnits: DrawingStrokeContourSequenceItem[] = [];
  const cap = strokeStyle.cap;
  const isHairline = strokeStyle.halfWidth < 0.5;

  const resetContour = (nextMoveTo: Point2D | null = null): void => {
    currentPoint = nextMoveTo;
    contourStart = nextMoveTo;
    lastDegeneratePoint = null;
    contourUnits = [];
  };

  const ensureImplicitContour = (): boolean => {
    if (currentPoint) {
      return true;
    }
    if (!pendingContourStart) {
      return false;
    }
    resetContour(pendingContourStart);
    pendingContourStart = null;
    return true;
  };

  const appendPreparedSequencePatch = (patch: DrawingPreparedStrokePatch): void => {
    contourUnits.push({
      kind: 'preparedPatch',
      prepared: patch,
    });
  };

  const emitPatchDefinition = (patch: DrawingPatchDefinition): void => {
    const finalized = finalizePatch(patch);
    for (const subdivided of subdivideStrokePreparedPatch(finalized)) {
      contourUnits.push({
        kind: 'basePatch',
        patch: subdivided,
      });
    }
  };

  const resolveSequenceItemJoinControlPoint = (
    previous: DrawingStrokeContourSequenceItem | null,
    patch: DrawingPreparedPatch,
  ): Point2D => {
    if (!previous) {
      return getPatchStartPoint(patch);
    }
    switch (previous.kind) {
      case 'moveWithinContour':
        return previous.anchor;
      case 'basePatch':
        return getPatchOutgoingJoinControlPoint(previous.patch);
      case 'preparedPatch':
        return previous.prepared.joinControlPoint;
      case 'contourFinished':
        return getPatchStartPoint(patch);
    }
  };

  const emitContourSequence = (
    sequence: readonly DrawingStrokeContourSequenceItem[],
  ): void => {
    if (sequence.length === 0) {
      return;
    }
    let previous: DrawingStrokeContourSequenceItem | null = sequence[0]!;
    for (const item of sequence.slice(1)) {
      if (item.kind === 'basePatch') {
        const joinControlPoint = resolveSequenceItemJoinControlPoint(previous, item.patch);
        prepared.push({
          patch: item.patch,
          prevPoint: joinControlPoint,
          joinControlPoint,
          contourStart: item.contourStart ?? false,
          contourEnd: item.contourEnd ?? false,
          startCap: item.startCap ?? 'none',
          endCap: item.endCap ?? 'none',
        });
      } else if (item.kind === 'preparedPatch') {
        prepared.push(item.prepared);
      }
      previous = item;
    }
  };

  const isContourPatchItem = (
    item: DrawingStrokeContourSequenceItem,
  ): item is DrawingStrokeContourPatchItem =>
    item.kind === 'basePatch' || item.kind === 'preparedPatch';

  const findFirstContourPatchItem = (): DrawingStrokeContourPatchItem | undefined =>
    contourUnits.find(isContourPatchItem);

  const findLastContourPatchItem = (): DrawingStrokeContourPatchItem | undefined =>
    [...contourUnits].reverse().find(isContourPatchItem);

  const emitDegenerateContour = (): void => {
    if (!lastDegeneratePoint) {
      return;
    }
    if (cap === 'round') {
      prepared.push(createDegenerateRoundStrokePatch(lastDegeneratePoint));
    } else if (cap === 'square') {
      const squarePatch = createDegenerateSquareStrokePatch(
        lastDegeneratePoint,
        strokeStyle.halfWidth,
        transform,
        isHairline,
      );
      emitContourSequence([
        {
          kind: 'basePatch',
          patch: squarePatch,
        },
        {
          kind: 'moveWithinContour',
          anchor: getPatchStartPoint(squarePatch),
        },
        {
          kind: 'basePatch',
          patch: squarePatch,
          contourStart: true,
          contourEnd: true,
          startCap: 'square',
          endCap: 'square',
        },
        {
          kind: 'contourFinished',
        },
      ]);
    }
  };

  const flushOpenContour = (): void => {
    const firstPatchItem = findFirstContourPatchItem();
    const lastPatchItem = findLastContourPatchItem();
    if (!firstPatchItem || !lastPatchItem) {
      emitDegenerateContour();
      resetContour();
      return;
    }

    const sequence = [...contourUnits];
    const firstPoint = firstPatchItem.kind === 'basePatch'
      ? getPatchStartPoint(firstPatchItem.patch)
      : getPatchStartPoint(firstPatchItem.prepared.patch);
    const lastPoint = lastPatchItem.kind === 'basePatch'
      ? getPatchEndPoint(lastPatchItem.patch)
      : getPatchEndPoint(lastPatchItem.prepared.patch);

    if (cap === 'round') {
      sequence.push({
        kind: 'preparedPatch',
        prepared: createSyntheticRoundStrokePatch(lastPoint),
      });
      sequence.push({
        kind: 'preparedPatch',
        prepared: createSyntheticRoundStrokePatch(firstPoint),
      });
    } else if (cap === 'square') {
      const lastJoinControl = lastPatchItem.kind === 'basePatch'
        ? getPatchOutgoingJoinControlPoint(lastPatchItem.patch)
        : lastPatchItem.prepared.joinControlPoint;
      const firstJoinControl = firstPatchItem.kind === 'basePatch'
        ? getPatchFirstControlPoint(firstPatchItem.patch)
        : firstPatchItem.prepared.joinControlPoint;
      sequence.push({
        kind: 'basePatch',
        patch: createSquareCapEndPatch(
          lastPoint,
          lastJoinControl,
          strokeStyle.halfWidth,
          transform,
          isHairline,
        ),
      });
      sequence.push({
        kind: 'moveWithinContour',
        anchor: add(
          firstPoint,
          resolveSquareCapOffset(
            firstPoint,
            firstJoinControl,
            strokeStyle.halfWidth,
            transform,
            isHairline,
          ),
        ),
      });
      sequence.push({
        kind: 'basePatch',
        patch: createSquareCapStartPatch(
          firstPoint,
          firstJoinControl,
          strokeStyle.halfWidth,
          transform,
          isHairline,
        ),
      });
    } else {
      sequence.push({
        kind: 'moveWithinContour',
        anchor: firstPoint,
      });
    }

    if (firstPatchItem.kind === 'basePatch') {
      sequence.push({
        kind: 'basePatch',
        patch: firstPatchItem.patch,
        contourStart: true,
        contourEnd: true,
        startCap: cap,
        endCap: cap,
      });
    } else {
      sequence.push({
        kind: 'preparedPatch',
        prepared: {
          ...firstPatchItem.prepared,
          contourStart: true,
          contourEnd: true,
          startCap: cap,
          endCap: cap,
        },
      });
    }
    sequence.push({
      kind: 'contourFinished',
    });
    emitContourSequence(sequence);
    resetContour();
  };

  const flushClosedContour = (): void => {
    const firstPatchItem = findFirstContourPatchItem();
    if (!firstPatchItem) {
      emitDegenerateContour();
      resetContour();
      return;
    }

    const sequence = [...contourUnits];
    if (firstPatchItem.kind === 'basePatch') {
      sequence.push({
        kind: 'basePatch',
        patch: firstPatchItem.patch,
        contourStart: true,
        contourEnd: true,
        startCap: 'none',
        endCap: 'none',
      });
    } else {
      sequence.push({
        kind: 'preparedPatch',
        prepared: {
          ...firstPatchItem.prepared,
          contourStart: true,
          contourEnd: true,
          startCap: 'none',
          endCap: 'none',
        },
      });
    }
    sequence.push({
      kind: 'contourFinished',
    });
    emitContourSequence(sequence);
    resetContour();
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo': {
        flushOpenContour();
        const to = transformPoint2D(verb.to, identityMatrix2D);
        resetContour(to);
        break;
      }
      case 'lineTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const to = transformPoint2D(verb.to, identityMatrix2D);
        if (pointsEqual(from, to)) {
          lastDegeneratePoint = to;
          currentPoint = to;
          break;
        }
        emitPatchDefinition({ kind: 'line', points: [from, to] });
        currentPoint = to;
        lastDegeneratePoint = null;
        break;
      }
      case 'quadTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const control = transformPoint2D(verb.control, identityMatrix2D);
        const to = transformPoint2D(verb.to, identityMatrix2D);
        if (pointsEqual(from, control) && pointsEqual(control, to)) {
          lastDegeneratePoint = to;
          currentPoint = to;
          break;
        }
        const cuspT = findQuadraticCuspT(from, control, to);
        if (cuspT !== null) {
          const [left] = splitQuadraticAt(from, control, to, cuspT);
          const cuspPoint = left[2];
          appendPreparedSequencePatch(createSyntheticRoundStrokePatch(cuspPoint));
          emitPatchDefinition({ kind: 'line', points: [from, cuspPoint] });
          emitPatchDefinition({ kind: 'line', points: [cuspPoint, to] });
        } else {
          emitPatchDefinition({ kind: 'quadratic', points: [from, control, to] });
        }
        currentPoint = to;
        lastDegeneratePoint = null;
        break;
      }
      case 'conicTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const control = transformPoint2D(verb.control, identityMatrix2D);
        const to = transformPoint2D(verb.to, identityMatrix2D);
        if (pointsEqual(from, control) && pointsEqual(control, to)) {
          lastDegeneratePoint = to;
          currentPoint = to;
          break;
        }
        const cuspT = findConicCuspT(from, control, to, verb.weight);
        if (cuspT !== null) {
          const cusp = evaluateConic(from, control, to, verb.weight, cuspT);
          appendPreparedSequencePatch(createSyntheticRoundStrokePatch(cusp));
          emitPatchDefinition({ kind: 'line', points: [from, cusp] });
          emitPatchDefinition({ kind: 'line', points: [cusp, to] });
        } else {
          emitPatchDefinition({
            kind: 'conic',
            points: [from, control, to],
            weight: verb.weight,
          });
        }
        currentPoint = to;
        lastDegeneratePoint = null;
        break;
      }
      case 'cubicTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const control1 = transformPoint2D(verb.control1, identityMatrix2D);
        const control2 = transformPoint2D(verb.control2, identityMatrix2D);
        const to = transformPoint2D(verb.to, identityMatrix2D);
        if (
          pointsEqual(from, control1) &&
          pointsEqual(control1, control2) &&
          pointsEqual(control2, to)
        ) {
          lastDegeneratePoint = to;
          currentPoint = to;
          break;
        }
        const chops = findCubicConvex180Chops(from, control1, control2, to);
        if (chops.ts.length > 0) {
          const chopped = splitCubicAtMany(from, control1, control2, to, chops.ts);
          if (chops.areCusps && chopped.length === 2) {
            const cuspPoint = chopped[0]![3];
            appendPreparedSequencePatch(createSyntheticRoundStrokePatch(cuspPoint));
            emitPatchDefinition({
              kind: 'cubic',
              points: [chopped[0]![0], chopped[0]![1], cuspPoint, cuspPoint],
            });
            emitPatchDefinition({
              kind: 'cubic',
              points: [cuspPoint, cuspPoint, chopped[1]![2], chopped[1]![3]],
            });
          } else if (chops.areCusps && chopped.length === 3) {
            const cusp0 = chopped[0]![3];
            const cusp1 = chopped[1]![3];
            appendPreparedSequencePatch(createSyntheticRoundStrokePatch(cusp0));
            appendPreparedSequencePatch(createSyntheticRoundStrokePatch(cusp1));
            emitPatchDefinition({ kind: 'line', points: [chopped[0]![0], cusp0] });
            emitPatchDefinition({ kind: 'line', points: [cusp0, cusp1] });
            emitPatchDefinition({ kind: 'line', points: [cusp1, chopped[2]![3]] });
          } else {
            for (const cubicPatch of chopped) {
              emitPatchDefinition({ kind: 'cubic', points: cubicPatch });
            }
          }
        } else {
          emitPatchDefinition({ kind: 'cubic', points: [from, control1, control2, to] });
        }
        currentPoint = to;
        lastDegeneratePoint = null;
        break;
      }
      case 'arcTo': {
        if (!ensureImplicitContour()) break;
        const arcPatches = createArcConicPatches(
          verb.center,
          verb.radius,
          verb.startAngle,
          verb.endAngle,
          verb.counterClockwise ?? false,
          identityMatrix2D,
        );
        for (const arcPatch of arcPatches) {
          emitPatchDefinition(arcPatch);
        }
        currentPoint = arcPatches.at(-1)?.points[2] ?? currentPoint;
        lastDegeneratePoint = null;
        break;
      }
      case 'close': {
        if (!currentPoint || !contourStart) break;
        if (contourUnits.length === 0 && lastDegeneratePoint === null) {
          // Match Skia StrokeIterator: an explicit close on an otherwise empty contour
          // is treated as a zero-length stroked subpath, so round/square caps still materialize.
          lastDegeneratePoint = contourStart;
        }
        if (!pointsEqual(currentPoint, contourStart)) {
          emitPatchDefinition({ kind: 'line', points: [currentPoint, contourStart] });
        }
        currentPoint = contourStart;
        pendingContourStart = contourStart;
        flushClosedContour();
        break;
      }
    }
  }

  flushOpenContour();
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
  const tan0 = subtract(control, from);
  const tan1 = subtract(to, control);
  const crossValue = Math.abs((tan0[0] * tan1[1]) - (tan0[1] * tan1[0]));
  if (crossValue > epsilon || dot(tan0, tan1) >= 0) {
    return null;
  }
  const normalizedTan0 = normalize(tan0);
  const normalizedNegTan1 = normalize(scale(tan1, -1));
  if (!normalizedTan0 || !normalizedNegTan1) {
    return 0.5;
  }
  let bisector = add(normalizedTan0, normalizedNegTan1);
  if (Math.hypot(bisector[0], bisector[1]) <= epsilon) {
    bisector = perpendicular(normalizedTan0);
  }
  const denominator = dot(subtract(tan0, tan1), bisector);
  const t = Math.abs(denominator) <= epsilon ? 0.5 : dot(tan0, bisector) / denominator;
  return t > epsilon && t < 1 - epsilon ? t : 0.5;
};

const solveQuadraticMidTangent = (a: number, b: number, c: number): number => {
  const discriminant = Math.max((b * b) - (4 * a * c), 0);
  const q = -0.5 * (b + (Math.sign(b || 1) * Math.sqrt(discriminant)));
  const halfQa = -0.5 * q * a;
  const t = Math.abs((q * q) + halfQa) < Math.abs((a * c) + halfQa)
    ? (Math.abs(a) <= epsilon ? Number.NaN : q / a)
    : (Math.abs(q) <= epsilon ? Number.NaN : c / q);
  return t > epsilon && t < 1 - epsilon ? t : 0.5;
};

const findConicCuspT = (
  from: Point2D,
  control: Point2D,
  to: Point2D,
  weight: number,
): number | null => {
  const tan0 = subtract(control, from);
  const tan1 = subtract(to, control);
  const crossValue = Math.abs((tan0[0] * tan1[1]) - (tan0[1] * tan1[0]));
  if (crossValue > epsilon || dot(tan0, tan1) >= 0) {
    return null;
  }
  const normalizedTan0 = normalize(tan0);
  const normalizedNegTan1 = normalize(scale(tan1, -1));
  if (!normalizedTan0 || !normalizedNegTan1) {
    return 0.5;
  }
  let bisector = add(normalizedTan0, normalizedNegTan1);
  if (Math.hypot(bisector[0], bisector[1]) <= epsilon) {
    bisector = perpendicular(normalizedTan0);
  }
  const delta = subtract(to, from);
  const coeffA = scale(delta, weight - 1);
  const coeffB = subtract(delta, scale(tan0, 2 * weight));
  const coeffC = scale(tan0, weight);
  return solveQuadraticMidTangent(
    dot(bisector, coeffA),
    dot(bisector, coeffB),
    dot(bisector, coeffC),
  );
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

  const areCusps = discrOver4 <= cuspThreshold;
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
  depth = 0,
): void => {
  const cuspT = depth === 0
    ? findCuspTBySampling((t) => derivativeConic(from, control, to, weight, t))
    : null;
  if (cuspT !== null) {
    const cuspPoint = evaluateConic(from, control, to, weight, cuspT);
    flattenConic(from, lerp(from, control, cuspT), cuspPoint, weight, out, depth + 1);
    flattenConic(cuspPoint, lerp(control, to, cuspT), to, weight, out, depth + 1);
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
  const turn = Math.PI * 2;
  let span = endAngle - startAngle;
  if (counterClockwise) {
    while (span <= 0) {
      span += turn;
    }
  } else {
    while (span >= 0) {
      span -= turn;
    }
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
  let pendingContourStart: Point2D | null = null;
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

  const ensureImplicitContour = (): boolean => {
    if (currentPoint) {
      return true;
    }
    if (!pendingContourStart) {
      return false;
    }
    points.push(pendingContourStart);
    currentPoint = pendingContourStart;
    pendingContourStart = null;
    return true;
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
        flush();
        pendingContourStart = null;
        points.push(transformPoint2D(verb.to, transform));
        currentPoint = transformPoint2D(verb.to, transform);
        break;
      case 'lineTo':
        if (!ensureImplicitContour()) return null;
        points.push(transformPoint2D(verb.to, transform));
        currentPoint = transformPoint2D(verb.to, transform);
        break;
      case 'quadTo':
        if (!ensureImplicitContour()) return null;
        {
          const from = currentPoint!;
          const control = transformPoint2D(verb.control, transform);
          const to = transformPoint2D(verb.to, transform);
          const targetDepth = Math.ceil(
            Math.log2(approximateQuadraticSegments(from, control, to)),
          );
          flattenQuadraticRecursive(
            from,
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
        if (!ensureImplicitContour()) return null;
        {
          const from = currentPoint!;
          const control1 = transformPoint2D(verb.control1, transform);
          const control2 = transformPoint2D(verb.control2, transform);
          const to = transformPoint2D(verb.to, transform);
          const targetDepth = Math.ceil(Math.log2(approximateCubicSegments(
            from,
            control1,
            control2,
            to,
          )));
          flattenCubicRecursive(
            from,
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
        if (!ensureImplicitContour()) return null;
        {
          const from = currentPoint!;
          const control = transformPoint2D(verb.control, transform);
          const to = transformPoint2D(verb.to, transform);
          flattenConic(from, control, to, verb.weight, points);
          currentPoint = to;
        }
        break;
      case 'arcTo':
        if (!currentPoint && !pendingContourStart) {
          const startPoint = transformPoint2D([
            verb.center[0] + (Math.cos(verb.startAngle) * verb.radius),
            verb.center[1] + (Math.sin(verb.startAngle) * verb.radius),
          ], transform);
          points.push(startPoint);
          currentPoint = startPoint;
        } else if (!ensureImplicitContour()) {
          return null;
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
        pendingContourStart = points[0] ?? currentPoint;
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
  let pendingContourStart: Point2D | null = null;
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

  const ensureImplicitContour = (): boolean => {
    if (currentPoint) {
      return true;
    }
    if (!pendingContourStart) {
      return false;
    }
    currentPoint = pendingContourStart;
    contourStart = pendingContourStart;
    contourPoints = [pendingContourStart];
    pendingContourStart = null;
    return true;
  };

  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo': {
        flushWedges();
        pendingContourStart = null;
        const to = transformPoint2D(verb.to, transform);
        currentPoint = to;
        contourStart = to;
        contourPoints = [to];
        break;
      }
      case 'lineTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const to = transformPoint2D(verb.to, transform);
        pushPatch({ kind: 'line', points: [from, to] });
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'quadTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const control = transformPoint2D(verb.control, transform);
        const to = transformPoint2D(verb.to, transform);
        const cuspT = findQuadraticCuspT(from, control, to);
        if (cuspT !== null) {
          const [left, right] = splitQuadraticAt(from, control, to, cuspT);
          pushPatch({ kind: 'quadratic', points: left });
          pushPatch({ kind: 'quadratic', points: right });
        } else {
          pushPatch({ kind: 'quadratic', points: [from, control, to] });
        }
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'conicTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const control = transformPoint2D(verb.control, transform);
        const to = transformPoint2D(verb.to, transform);
        const cuspT = findConicCuspT(from, control, to, verb.weight);
        if (cuspT !== null) {
          const cusp = evaluateConic(from, control, to, verb.weight, cuspT);
          pushPatch({ kind: 'line', points: [from, cusp] });
          pushPatch({ kind: 'line', points: [cusp, to] });
        } else {
          pushPatch({
            kind: 'conic',
            points: [from, control, to],
            weight: verb.weight,
          });
        }
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'cubicTo': {
        if (!ensureImplicitContour()) break;
        const from = currentPoint!;
        const control1 = transformPoint2D(verb.control1, transform);
        const control2 = transformPoint2D(verb.control2, transform);
        const to = transformPoint2D(verb.to, transform);
        const chops = findCubicConvex180Chops(from, control1, control2, to);
        if (chops.ts.length > 0) {
          const chopped = splitCubicAtMany(from, control1, control2, to, chops.ts);
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
          pushPatch({ kind: 'cubic', points: [from, control1, control2, to] });
        }
        contourPoints.push(to);
        currentPoint = to;
        break;
      }
      case 'arcTo': {
        if (!ensureImplicitContour()) break;
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
        pendingContourStart = contourStart;
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

const outsetRect = (rect: Rect, amount: number): Rect => ({
  origin: [rect.origin[0] - amount, rect.origin[1] - amount],
  size: {
    width: rect.size.width + (2 * amount),
    height: rect.size.height + (2 * amount),
  },
});

const computeStrokeInflationRadius = (
  subpaths: readonly FlattenedSubpath[],
  strokeStyle: DrawingStrokeStyle,
): number => {
  let multiplier = 1;
  const canProduceMiters = strokeStyle.joinLimit > 0 &&
    subpaths.some((subpath) => subpath.points.length > 2);
  if (canProduceMiters) {
    multiplier = Math.max(multiplier, strokeStyle.joinLimit);
  }
  if (strokeStyle.cap === 'square') {
    multiplier = Math.max(multiplier, Math.SQRT2);
  }
  return strokeStyle.halfWidth * multiplier;
};

const computeGraphiteStyleStrokeOrderBounds = (
  subpaths: readonly FlattenedSubpath[],
  strokeStyle: DrawingStrokeStyle,
  transform: readonly [number, number, number, number, number, number],
): Rect => {
  const points = subpaths.flatMap((subpath) => subpath.points);
  if (points.length === 0) {
    return { origin: [0, 0], size: { width: 0, height: 0 } };
  }
  const localBounds = computeBounds(points);
  const inflatedLocalBounds = outsetRect(
    localBounds,
    computeStrokeInflationRadius(subpaths, strokeStyle),
  );
  const transformedBounds = computeBounds(transformPoints(rectCorners(inflatedLocalBounds), transform));
  return outsetRect(transformedBounds, aaFringeWidth);
};

const rectCorners = (rect: Rect): readonly Point2D[] => Object.freeze([
  rect.origin,
  [rect.origin[0] + rect.size.width, rect.origin[1]],
  [rect.origin[0] + rect.size.width, rect.origin[1] + rect.size.height],
  [rect.origin[0], rect.origin[1] + rect.size.height],
]);

const computePreparedVertexBounds = (
  vertices: readonly DrawingPreparedVertex[] | undefined,
): Rect | undefined =>
  vertices && vertices.length > 0 ? computeBounds(vertices.map((vertex) => vertex.point)) : undefined;

const mergeBounds = (
  bounds: readonly (Rect | undefined)[],
): Rect => {
  const valid = bounds.filter((bound): bound is Rect => bound !== undefined);
  return valid.length > 0 ? unionBounds(valid) : { origin: [0, 0], size: { width: 0, height: 0 } };
};

const canUseTessellatedStrokePatches = (
  patches: readonly DrawingPreparedStrokePatch[],
  subpaths: readonly FlattenedSubpath[],
  _paint: DrawingPaint,
): boolean => {
  return patches.length > 0 &&
    subpaths.length > 0 &&
    subpaths.every((subpath) => subpath.points.length >= 1);
};

const shouldPrepareStrokePatches = (_paint: DrawingPaint): boolean => {
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

const preparePathFill = (
  recording: Pick<DrawingRecording, 'caps' | 'targetFormat'>,
  rendererProvider: DrawingRendererProvider,
  command: DrawPathCommand | DrawShapeCommand,
): DrawingDrawPreparation => {
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
  const blendMode = resolveBlendMode(command.paint);
  const blender = command.paint.blender;
  const preparedClip = createPreparedDrawClip(preparedClipStack);
  if (style === 'fill') {
    const patches = preparePatches(command.path, identityMatrix2D, true);
    const hasWedges = patches.some((patch) => patch.fanPoint !== undefined);
    const isSingleConvexContour = subpaths.length === 1 &&
      subpaths[0]!.closed &&
      isConvexPolygon(subpaths[0]!.points);
    const fillBounds = unionBounds(subpaths.map((subpath) => computeBounds(subpath.points)));
    const renderer = rendererProvider.getPathFillRenderer({
      fillRule: command.path.fillRule,
      patchCount: patches.length,
      hasWedges,
      isSingleConvexContour,
      verbCount: command.path.verbs.length,
      drawBoundsArea: fillBounds.size.width * fillBounds.size.height,
    });

    let baseTriangles: readonly Point2D[] = [];
    switch (renderer.kind) {
      case 'convex-tessellated-wedges':
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
    const coverage = resolveCoverage(command.paint, Boolean(fringeVertices?.length));
    if (!baseTriangles) {
      return { supported: false, reason: 'path fill triangulation failed' };
    }
    const fillColor = resolveFillColor(command.paint);
    const dstUsage = computeDstUsage(
      recording,
      fillColor,
      preparedClip,
      coverage,
      blendMode,
      blender,
    );
    const transformedFillBounds = computeBounds(transformPoints(baseTriangles, command.transform));
    const transformedFringeBounds = computePreparedVertexBounds(fringeVertices);
    const fillDrawBounds = mergeBounds([
      transformedFillBounds,
      transformedFringeBounds,
    ]);
    return {
      supported: true,
      draw: {
        kind: 'pathFill',
        renderer,
        triangles: baseTriangles,
        fringeVertices,
        patches,
        innerFillBounds: (dstUsage & drawingDstUsage.dstOnlyUsedByRenderer) !== 0
          ? insetRect(transformedFillBounds, aaFringeWidth)
          : undefined,
        fillRule: command.path.fillRule,
        color: fillColor,
        blendMode,
        coverage,
        blender,
        dstUsage,
        transform: command.transform,
        bounds: fillDrawBounds,
        clipRect: preparedClipStack.bounds,
        clip: preparedClip,
        usesStencil: Boolean(preparedClipStack.stencilClip?.elements?.length),
      },
    };
  }

  const strokeStyle = resolveStrokeStyle(command.paint);
  const strokeColor = resolveStrokeColor(command.paint);
  const dashedStrokeSubpaths = applyDashPattern(subpaths, command.paint);
  const strokeContours = createStrokeContourRecords(dashedStrokeSubpaths);
  const lineOnlyStrokeContours = strokeContours.every((contour) =>
    contour.points.length <= 2 || contour.points.every((_, index) => index < 2)
  );
  const patches = shouldPrepareStrokePatches(command.paint)
    ? createPreparedStrokePatchesFromPath(
      (command.paint.dashArray?.length ?? 0) > 0 || lineOnlyStrokeContours
        ? createPathFromFlattenedStrokeSubpaths(dashedStrokeSubpaths, command.path.fillRule)
        : command.path,
      strokeStyle,
      command.transform,
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
  const coverage = resolveCoverage(command.paint, Boolean(preparedStroke.fringeVertices?.length));
  const dstUsage = computeDstUsage(
    recording,
    strokeColor,
    preparedClip,
    coverage,
    blendMode,
    blender,
  );
  const transformedStrokeTriangleBounds = strokeTriangles.length > 0
    ? computeBounds(transformPoints(strokeTriangles, command.transform))
    : undefined;
  const transformedStrokeRectBounds = computeBounds(transformPoints(
    rectCorners(strokedBounds),
    command.transform,
  ));
  const transformedStrokeFringeBounds = computePreparedVertexBounds(preparedStroke.fringeVertices);
  const strokeOrderBounds = usesTessellatedStrokePatches
    ? computeGraphiteStyleStrokeOrderBounds(dashedStrokeSubpaths, strokeStyle, command.transform)
    : mergeBounds([
      transformedStrokeTriangleBounds,
      transformedStrokeRectBounds,
      transformedStrokeFringeBounds,
    ]);
  return {
    supported: true,
    draw: {
      kind: 'pathStroke',
      renderer: rendererProvider.getPathStrokeRenderer(patches.map((patch) => patch.patch)),
      triangles: strokeTriangles,
      fringeVertices: preparedStroke.fringeVertices,
      patches,
      usesTessellatedStrokePatches,
      color: strokeColor,
      blendMode,
      coverage,
      blender,
      dstUsage,
      strokeStyle,
      transform: command.transform,
      bounds: strokeOrderBounds,
      clipRect: preparedClipStack.bounds,
      clip: preparedClip,
      usesStencil: Boolean(preparedClipStack.stencilClip?.elements?.length),
    },
  };
};

export const prepareDrawingPathCommand = (
  recording: Pick<DrawingRecording, 'caps' | 'targetFormat'>,
  rendererProvider: DrawingRendererProvider,
  command: DrawPathCommand | DrawShapeCommand,
): DrawingDrawPreparation => preparePathFill(recording, rendererProvider, command);
