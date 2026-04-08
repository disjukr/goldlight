import { type Point2d, type Rect, transformPoint2d } from '@disjukr/goldlight/geometry';
import type {
  DrawingClip,
  DrawingClipRect,
  DrawingClipShader,
  DrawingClipStackElement,
  DrawingClipStackInsertion,
  DrawingClipStackRawElement,
  DrawingClipStackRawElementPendingDraw,
  DrawingClipStackSaveRecord,
  DrawingClipStackSnapshot,
  DrawingClipStackState,
  DrawingMatrix2d,
  DrawingPath2d,
} from './types.ts';

export type DrawingPreparedClipElement = Readonly<{
  op: DrawingClip['op'];
  triangles: readonly Point2d[];
}>;

export type DrawingPreparedClipUsageElement = Readonly<{
  id: number;
  bounds?: Rect;
  rawElement: DrawingClipStackRawElement;
}>;

export type DrawingPreparedClipDrawElement = Readonly<{
  id: number;
  op: DrawingClip['op'];
  triangles: readonly Point2d[];
  bounds?: Rect;
  rawElement: DrawingClipStackRawElement;
}>;

export type DrawingPreparedAnalyticClip =
  | Readonly<{
    kind: 'rect';
    rect: DrawingClipRect;
  }>
  | Readonly<{
    kind: 'rrect';
    rect: DrawingClipRect;
    xRadii: readonly [number, number, number, number];
    yRadii: readonly [number, number, number, number];
  }>;

export type DrawingPreparedAtlasClip = Readonly<{
  bounds: Rect;
  elements: readonly DrawingPreparedClipElement[];
}>;

export type DrawingPreparedClip = Readonly<{
  bounds?: Rect;
  elements?: readonly DrawingPreparedClipElement[];
  deferredClipDraws?: readonly DrawingPreparedClipElement[];
  effectiveElementIds?: readonly number[];
  effectiveElements?: readonly DrawingPreparedClipUsageElement[];
  effectiveClipDraws?: readonly DrawingPreparedClipDrawElement[];
  analyticClip?: DrawingPreparedAnalyticClip;
  atlasClip?: DrawingPreparedAtlasClip;
  shader?: DrawingClipShader;
}>;

export type DrawingVisitedClipStack = Readonly<{
  saveRecord: DrawingClipStackSaveRecord;
  bounds?: Rect;
  stencilClip?: DrawingPreparedClip;
  deferredClipDraws: readonly DrawingPreparedClipElement[];
  analyticClip?: DrawingPreparedAnalyticClip;
  atlasClip?: DrawingPreparedAtlasClip;
  shader?: DrawingClipShader;
  effectiveElements: readonly DrawingClipStackElement[];
  preparedEffectiveElements: readonly DrawingPreparedClipUsageElement[];
  preparedClipDrawElements: readonly DrawingPreparedClipDrawElement[];
}>;

const cloneClip = (clip: DrawingClip): DrawingClip =>
  clip.kind === 'rect'
    ? {
      kind: 'rect',
      op: clip.op,
      rect: {
        origin: [...clip.rect.origin] as typeof clip.rect.origin,
        size: { ...clip.rect.size },
      },
      transform: [...clip.transform] as typeof clip.transform,
    }
    : {
      kind: 'path',
      op: clip.op,
      path: {
        verbs: clip.path.verbs.map((verb) => ({ ...verb })),
        fillRule: clip.path.fillRule,
      },
      transform: [...clip.transform] as typeof clip.transform,
    };

const cloneElement = (element: DrawingClipStackElement): DrawingClipStackElement => ({
  id: element.id,
  clip: element.rawElement?.clip ?? cloneClip(element.clip),
  saveRecordIndex: element.saveRecordIndex,
  invalidatedByIndex: element.invalidatedByIndex,
  rawElement: element.rawElement ?? {
    id: element.id,
    clip: cloneClip(element.clip),
  },
});

const cloneBounds = (bounds: DrawingClipRect | Rect | undefined): DrawingClipRect | undefined =>
  bounds
    ? {
      origin: [...bounds.origin] as typeof bounds.origin,
      size: { ...bounds.size },
    }
    : undefined;

const cloneClipShader = (shader: DrawingClipShader | undefined): DrawingClipShader | undefined =>
  shader ? { kind: shader.kind, color: [...shader.color] as typeof shader.color } : undefined;

const ensureRawElementRuntimeState = (
  rawElement: DrawingClipStackRawElement,
): {
  -readonly [K in keyof NonNullable<DrawingClipStackRawElement['runtimeState']>]: NonNullable<
    DrawingClipStackRawElement['runtimeState']
  >[K];
} => {
  const mutableRawElement = rawElement as {
    runtimeState?: {
      -readonly [K in keyof NonNullable<DrawingClipStackRawElement['runtimeState']>]: NonNullable<
        DrawingClipStackRawElement['runtimeState']
      >[K];
    };
  };
  mutableRawElement.runtimeState ??= {};
  return mutableRawElement.runtimeState;
};

const unionRect = (left: Rect, right: Rect): Rect => {
  const minX = Math.min(left.origin[0], right.origin[0]);
  const minY = Math.min(left.origin[1], right.origin[1]);
  const maxX = Math.max(left.origin[0] + left.size.width, right.origin[0] + right.size.width);
  const maxY = Math.max(left.origin[1] + left.size.height, right.origin[1] + right.size.height);
  return {
    origin: [minX, minY],
    size: {
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    },
  };
};

export const prepareDrawingRawClipElementGeometry = (
  rawElement: DrawingClipStackRawElement,
  bounds: Rect | undefined,
  triangles: readonly Point2d[] | undefined,
): void => {
  const runtimeState = ensureRawElementRuntimeState(rawElement);
  runtimeState.preparedBounds = bounds;
  runtimeState.preparedTriangles = triangles;
};

export const getDrawingRawClipElementPreparedGeometry = (
  rawElement: DrawingClipStackRawElement,
): Readonly<{
  bounds?: Rect;
  triangles?: readonly Point2d[];
}> => {
  const runtimeState = ensureRawElementRuntimeState(rawElement);
  return {
    bounds: runtimeState.preparedBounds,
    triangles: runtimeState.preparedTriangles,
  };
};

export const getDrawingRawClipElementLatestLayerOrder = (
  rawElement: DrawingClipStackRawElement,
): number | undefined => ensureRawElementRuntimeState(rawElement).latestInsertion?.layerOrder;

export const getDrawingRawClipElementLatestInsertion = (
  rawElement: DrawingClipStackRawElement,
): DrawingClipStackInsertion | undefined =>
  ensureRawElementRuntimeState(rawElement).latestInsertion;

export const getDrawingRawClipElementUsageBounds = (
  rawElement: DrawingClipStackRawElement,
): Rect | undefined => ensureRawElementRuntimeState(rawElement).usageBounds;

export const updateDrawingRawClipElementForDraw = (
  rawElement: DrawingClipStackRawElement,
  usageBounds: Rect,
  latestInsertion: DrawingClipStackInsertion,
): Rect => {
  const runtimeState = ensureRawElementRuntimeState(rawElement);
  runtimeState.usageBounds = runtimeState.usageBounds
    ? unionRect(runtimeState.usageBounds, usageBounds)
    : usageBounds;
  runtimeState.latestInsertion = latestInsertion;
  return runtimeState.usageBounds;
};

export const getDrawingRawClipElementPendingDraw = (
  rawElement: DrawingClipStackRawElement,
): DrawingClipStackRawElementPendingDraw | undefined =>
  ensureRawElementRuntimeState(rawElement).pendingDraw;

export const drawDrawingRawClipElementImmediate = (
  rawElement: DrawingClipStackRawElement,
  pendingDraw: DrawingClipStackRawElementPendingDraw,
): DrawingClipStackRawElementPendingDraw => {
  const runtimeState = ensureRawElementRuntimeState(rawElement);
  runtimeState.pendingDraw = pendingDraw;
  return pendingDraw;
};

export const captureDrawingRawClipElementDeferredDraw = (
  rawElement: DrawingClipStackRawElement,
  update: Readonly<{
    usageBounds: Rect;
    scissorBounds: Rect;
    maxDepthIndex: number;
    maxDepth: number;
    paintOrder: number;
    sourceRenderStep: DrawingClipStackRawElementPendingDraw['sourceRenderStep'];
  }>,
): DrawingClipStackRawElementPendingDraw | undefined => {
  const runtimeState = ensureRawElementRuntimeState(rawElement);
  if (!runtimeState.pendingDraw) {
    return undefined;
  }
  const pendingDraw = runtimeState.pendingDraw as {
    -readonly [K in keyof DrawingClipStackRawElementPendingDraw]:
      DrawingClipStackRawElementPendingDraw[K];
  };
  pendingDraw.usageBounds = update.usageBounds;
  pendingDraw.scissorBounds = update.scissorBounds;
  pendingDraw.maxDepthIndex = update.maxDepthIndex;
  pendingDraw.maxDepth = update.maxDepth;
  pendingDraw.paintOrder = update.paintOrder;
  pendingDraw.latestInsertion = runtimeState.latestInsertion ?? pendingDraw.latestInsertion;
  pendingDraw.sourceRenderStep = update.sourceRenderStep;
  return pendingDraw;
};

export const resetDrawingRawClipElementRuntimeState = (
  rawElement: DrawingClipStackRawElement,
): void => {
  const runtimeState = ensureRawElementRuntimeState(rawElement);
  runtimeState.latestInsertion = undefined;
  runtimeState.usageBounds = undefined;
  runtimeState.pendingDraw = undefined;
};

const isEmptyRect = (rect: Rect | undefined): boolean =>
  rect !== undefined && (rect.size.width <= 0 || rect.size.height <= 0);

const createPolygonTriangles = (polygon: readonly Point2d[]): readonly Point2d[] => {
  if (polygon.length < 3) {
    return Object.freeze([]) as readonly Point2d[];
  }

  const triangles: Point2d[] = [];
  for (let index = 1; index < polygon.length - 1; index += 1) {
    triangles.push(polygon[0]!, polygon[index]!, polygon[index + 1]!);
  }
  return Object.freeze(triangles);
};

const createRectClipPolygon = (
  clipRect: DrawingClipRect,
  transform: DrawingMatrix2d,
): readonly Point2d[] => {
  const x0 = clipRect.origin[0];
  const y0 = clipRect.origin[1];
  const x1 = x0 + clipRect.size.width;
  const y1 = y0 + clipRect.size.height;
  return Object.freeze([
    transformPoint2d([x0, y0], transform),
    transformPoint2d([x1, y0], transform),
    transformPoint2d([x1, y1], transform),
    transformPoint2d([x0, y1], transform),
  ]);
};

const clipEpsilon = 1e-4;
const clipRadiusMin = 0.5;

const clipPointsEqual = (left: Point2d, right: Point2d): boolean =>
  Math.abs(left[0] - right[0]) <= clipEpsilon && Math.abs(left[1] - right[1]) <= clipEpsilon;

const isAxisAlignedMatrix = (transform: DrawingMatrix2d): boolean =>
  Math.abs(transform[1]) <= clipEpsilon && Math.abs(transform[2]) <= clipEpsilon;

const normalizeRect = (
  originX: number,
  originY: number,
  width: number,
  height: number,
): DrawingClipRect => {
  const x1 = originX + width;
  const y1 = originY + height;
  const left = Math.min(originX, x1);
  const top = Math.min(originY, y1);
  const right = Math.max(originX, x1);
  const bottom = Math.max(originY, y1);
  return {
    origin: [left, top],
    size: {
      width: right - left,
      height: bottom - top,
    },
  };
};

const createAxisAlignedDeviceRect = (
  rect: DrawingClipRect,
  transform: DrawingMatrix2d,
): DrawingClipRect =>
  normalizeRect(
    (transform[0] * rect.origin[0]) + transform[4],
    (transform[3] * rect.origin[1]) + transform[5],
    transform[0] * rect.size.width,
    transform[3] * rect.size.height,
  );

const matchesRectPath = (
  path: DrawingPath2d,
): DrawingClipRect | null => {
  const verbs = path.verbs;
  if (verbs.length !== 5) {
    return null;
  }
  const [moveTo, line1, line2, line3, close] = verbs;
  if (
    moveTo.kind !== 'moveTo' ||
    line1.kind !== 'lineTo' ||
    line2.kind !== 'lineTo' ||
    line3.kind !== 'lineTo' ||
    close.kind !== 'close'
  ) {
    return null;
  }
  const x0 = moveTo.to[0];
  const y0 = moveTo.to[1];
  const x1 = line2.to[0];
  const y1 = line2.to[1];
  if (
    !clipPointsEqual(line1.to, [x1, y0]) ||
    !clipPointsEqual(line3.to, [x0, y1])
  ) {
    return null;
  }
  return normalizeRect(x0, y0, x1 - x0, y1 - y0);
};

const matchesRRectPath = (
  path: DrawingPath2d,
):
  | Readonly<{
    rect: DrawingClipRect;
    xRadii: readonly [number, number, number, number];
    yRadii: readonly [number, number, number, number];
  }>
  | null => {
  const verbs = path.verbs;
  if (verbs.length !== 10) {
    return null;
  }
  const [moveTo, line1, quad1, line2, quad2, line3, quad3, line4, quad4, close] = verbs;
  if (
    moveTo.kind !== 'moveTo' ||
    line1.kind !== 'lineTo' ||
    quad1.kind !== 'quadTo' ||
    line2.kind !== 'lineTo' ||
    quad2.kind !== 'quadTo' ||
    line3.kind !== 'lineTo' ||
    quad3.kind !== 'quadTo' ||
    line4.kind !== 'lineTo' ||
    quad4.kind !== 'quadTo' ||
    close.kind !== 'close'
  ) {
    return null;
  }
  const x = quad4.control[0];
  const y = quad4.control[1];
  const width = quad1.control[0] - x;
  const height = quad2.control[1] - y;
  if (width <= clipEpsilon || height <= clipEpsilon) {
    return null;
  }
  const topLeft = [moveTo.to[0] - x, line4.to[1] - y] as const;
  const topRight = [x + width - line1.to[0], quad1.to[1] - y] as const;
  const bottomRight = [x + width - quad2.to[0], y + height - line2.to[1]] as const;
  const bottomLeft = [line3.to[0] - x, y + height - quad3.to[1]] as const;
  if (
    Math.abs(moveTo.to[1] - y) > clipEpsilon ||
    !clipPointsEqual(line1.to, [x + width - topRight[0], y]) ||
    !clipPointsEqual(quad1.control, [x + width, y]) ||
    !clipPointsEqual(quad1.to, [x + width, y + topRight[1]]) ||
    !clipPointsEqual(line2.to, [x + width, y + height - bottomRight[1]]) ||
    !clipPointsEqual(quad2.control, [x + width, y + height]) ||
    !clipPointsEqual(quad2.to, [x + width - bottomRight[0], y + height]) ||
    !clipPointsEqual(line3.to, [x + bottomLeft[0], y + height]) ||
    !clipPointsEqual(quad3.control, [x, y + height]) ||
    !clipPointsEqual(quad3.to, [x, y + height - bottomLeft[1]]) ||
    !clipPointsEqual(line4.to, [x, y + topLeft[1]]) ||
    !clipPointsEqual(quad4.control, [x, y]) ||
    !clipPointsEqual(quad4.to, [x + topLeft[0], y]) ||
    !clipPointsEqual(quad4.to, moveTo.to)
  ) {
    return null;
  }
  return {
    rect: {
      origin: [x, y],
      size: { width, height },
    },
    xRadii: [topLeft[0], topRight[0], bottomRight[0], bottomLeft[0]],
    yRadii: [topLeft[1], topRight[1], bottomRight[1], bottomLeft[1]],
  };
};

const intersectRect = (left: DrawingClipRect, right: DrawingClipRect): DrawingClipRect => {
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

const rrectCornerCenters = (
  clip: Readonly<{
    rect: DrawingClipRect;
    xRadii: readonly [number, number, number, number];
    yRadii: readonly [number, number, number, number];
  }>,
): readonly [Point2d, Point2d, Point2d, Point2d] => {
  const x0 = clip.rect.origin[0];
  const y0 = clip.rect.origin[1];
  const x1 = x0 + clip.rect.size.width;
  const y1 = y0 + clip.rect.size.height;
  return [
    [x0 + clip.xRadii[0], y0 + clip.yRadii[0]],
    [x1 - clip.xRadii[1], y0 + clip.yRadii[1]],
    [x1 - clip.xRadii[2], y1 - clip.yRadii[2]],
    [x0 + clip.xRadii[3], y1 - clip.yRadii[3]],
  ] as const;
};

const isRelativelyCircular = (xRadius: number, yRadius: number): boolean =>
  Math.abs(xRadius - yRadius) <= Math.max(clipEpsilon, Math.max(xRadius, yRadius) * 0.01);

const isSupportedAnalyticRRect = (
  xRadii: readonly [number, number, number, number],
  yRadii: readonly [number, number, number, number],
): boolean => {
  const circularFlags = [false, false, false, false];
  let circularRadius = 0;
  let circularCount = 0;
  for (let index = 0; index < 4; index += 1) {
    const xRadius = xRadii[index]!;
    const yRadius = yRadii[index]!;
    if (!isRelativelyCircular(xRadius, yRadius)) {
      return false;
    }
    if (xRadius < clipRadiusMin || yRadius < clipRadiusMin) {
      continue;
    }
    if (circularCount === 0) {
      circularRadius = xRadius;
    } else if (!isRelativelyCircular(xRadius, circularRadius)) {
      return false;
    }
    circularFlags[index] = true;
    circularCount += 1;
  }

  if (circularCount <= 1 || circularCount === 4) {
    return true;
  }
  if (circularCount === 2) {
    for (let index = 0; index < 4; index += 1) {
      if (circularFlags[index] && circularFlags[(index + 1) % 4]) {
        return true;
      }
    }
    return false;
  }
  return false;
};

const pointInAnalyticRRect = (
  clip: Readonly<{
    rect: DrawingClipRect;
    xRadii: readonly [number, number, number, number];
    yRadii: readonly [number, number, number, number];
  }>,
  point: Point2d,
): boolean => {
  const x0 = clip.rect.origin[0];
  const y0 = clip.rect.origin[1];
  const x1 = x0 + clip.rect.size.width;
  const y1 = y0 + clip.rect.size.height;
  const [px, py] = point;
  if (
    px < x0 - clipEpsilon || px > x1 + clipEpsilon || py < y0 - clipEpsilon || py > y1 + clipEpsilon
  ) {
    return false;
  }

  const centers = rrectCornerCenters(clip);
  const cornerIndex = py <= centers[0]![1]
    ? (px <= centers[0]![0] ? 0 : px >= centers[1]![0] ? 1 : -1)
    : py >= centers[3]![1]
    ? (px >= centers[2]![0] ? 2 : px <= centers[3]![0] ? 3 : -1)
    : -1;

  if (cornerIndex < 0) {
    return true;
  }

  const rx = cornerIndex === 0
    ? clip.xRadii[0]
    : cornerIndex === 1
    ? clip.xRadii[1]
    : cornerIndex === 2
    ? clip.xRadii[2]
    : clip.xRadii[3];
  const ry = cornerIndex === 0
    ? clip.yRadii[0]
    : cornerIndex === 1
    ? clip.yRadii[1]
    : cornerIndex === 2
    ? clip.yRadii[2]
    : clip.yRadii[3];
  if (rx < clipEpsilon || ry < clipEpsilon) {
    return true;
  }
  const center = cornerIndex === 0
    ? centers[0]
    : cornerIndex === 1
    ? centers[1]
    : cornerIndex === 2
    ? centers[2]
    : centers[3];
  const dx = (px - center[0]) / rx;
  const dy = (py - center[1]) / ry;
  return (dx * dx) + (dy * dy) <= 1 + clipEpsilon;
};

const analyticClipContainsClip = (
  outer: DrawingPreparedAnalyticClip,
  inner: DrawingPreparedAnalyticClip,
): boolean => {
  if (outer.kind === 'rect') {
    return rectContains(outer.rect, inner.rect);
  }
  const x0 = inner.rect.origin[0];
  const y0 = inner.rect.origin[1];
  const x1 = x0 + inner.rect.size.width;
  const y1 = y0 + inner.rect.size.height;
  return pointInAnalyticRRect(outer, [x0, y0]) &&
    pointInAnalyticRRect(outer, [x1, y0]) &&
    pointInAnalyticRRect(outer, [x1, y1]) &&
    pointInAnalyticRRect(outer, [x0, y1]);
};

const combineAnalyticClips = (
  left: DrawingPreparedAnalyticClip,
  right: DrawingPreparedAnalyticClip,
): DrawingPreparedAnalyticClip | undefined => {
  if (left.kind === 'rect' && right.kind === 'rect') {
    return {
      kind: 'rect',
      rect: intersectRect(left.rect, right.rect),
    };
  }
  if (analyticClipContainsClip(left, right)) {
    return right;
  }
  if (analyticClipContainsClip(right, left)) {
    return left;
  }
  return undefined;
};

const analyticClipsEqual = (
  left: DrawingPreparedAnalyticClip,
  right: DrawingPreparedAnalyticClip,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  if (
    left.rect.origin[0] !== right.rect.origin[0] ||
    left.rect.origin[1] !== right.rect.origin[1] ||
    left.rect.size.width !== right.rect.size.width ||
    left.rect.size.height !== right.rect.size.height
  ) {
    return false;
  }
  if (left.kind === 'rect') {
    return true;
  }
  if (right.kind !== 'rrect') {
    return false;
  }
  return left.xRadii.every((value, index) => value === right.xRadii[index]) &&
    left.yRadii.every((value, index) => value === right.yRadii[index]);
};

const createAnalyticClipForClip = (clip: DrawingClip): DrawingPreparedAnalyticClip | undefined => {
  if (clip.op !== 'intersect') {
    return undefined;
  }
  if (clip.kind === 'rect') {
    if (!isAxisAlignedMatrix(clip.transform)) {
      return undefined;
    }
    return {
      kind: 'rect',
      rect: createAxisAlignedDeviceRect(clip.rect, clip.transform),
    };
  }

  const rect = matchesRectPath(clip.path);
  if (rect) {
    if (!isAxisAlignedMatrix(clip.transform)) {
      return undefined;
    }
    return {
      kind: 'rect',
      rect: createAxisAlignedDeviceRect(rect, clip.transform),
    };
  }

  const rrect = matchesRRectPath(clip.path);
  if (rrect && isAxisAlignedMatrix(clip.transform)) {
    const scaledXRadii = [
      Math.abs(clip.transform[0]) * rrect.xRadii[0],
      Math.abs(clip.transform[0]) * rrect.xRadii[1],
      Math.abs(clip.transform[0]) * rrect.xRadii[2],
      Math.abs(clip.transform[0]) * rrect.xRadii[3],
    ] as const;
    const scaledYRadii = [
      Math.abs(clip.transform[3]) * rrect.yRadii[0],
      Math.abs(clip.transform[3]) * rrect.yRadii[1],
      Math.abs(clip.transform[3]) * rrect.yRadii[2],
      Math.abs(clip.transform[3]) * rrect.yRadii[3],
    ] as const;
    if (!isSupportedAnalyticRRect(scaledXRadii, scaledYRadii)) {
      return undefined;
    }
    return {
      kind: 'rrect',
      rect: createAxisAlignedDeviceRect(rrect.rect, clip.transform),
      xRadii: scaledXRadii,
      yRadii: scaledYRadii,
    };
  }
  return undefined;
};

const createAnalyticClipForActiveElements = (
  activeElements: readonly DrawingClipStackElement[],
): DrawingPreparedAnalyticClip | undefined => {
  if (activeElements.length === 0) {
    return undefined;
  }
  const analyticClips = activeElements.map((element) => createAnalyticClipForClip(element.clip));
  if (analyticClips.some((clip) => clip === undefined)) {
    return undefined;
  }
  const resolved = analyticClips as readonly DrawingPreparedAnalyticClip[];
  let combined = resolved[0]!;
  for (let index = 1; index < resolved.length; index += 1) {
    const next = combineAnalyticClips(combined, resolved[index]!);
    if (!next) {
      return undefined;
    }
    combined = next;
  }
  return combined;
};

const rectContains = (outer: DrawingClipRect, inner: DrawingClipRect): boolean => {
  const outerRight = outer.origin[0] + outer.size.width;
  const outerBottom = outer.origin[1] + outer.size.height;
  const innerRight = inner.origin[0] + inner.size.width;
  const innerBottom = inner.origin[1] + inner.size.height;
  return outer.origin[0] <= inner.origin[0] &&
    outer.origin[1] <= inner.origin[1] &&
    outerRight >= innerRight &&
    outerBottom >= innerBottom;
};

const matricesEqual = (left: DrawingMatrix2d, right: DrawingMatrix2d): boolean =>
  left.every((value, index) => value === right[index]);

const clipsEquivalent = (left: DrawingClip, right: DrawingClip): boolean => {
  if (
    left.kind !== right.kind || left.op !== right.op ||
    !matricesEqual(left.transform, right.transform)
  ) {
    return false;
  }
  if (left.kind === 'rect' && right.kind === 'rect') {
    return left.rect.origin[0] === right.rect.origin[0] &&
      left.rect.origin[1] === right.rect.origin[1] &&
      left.rect.size.width === right.rect.size.width &&
      left.rect.size.height === right.rect.size.height;
  }
  if (left.kind === 'path' && right.kind === 'path') {
    return JSON.stringify(left.path) === JSON.stringify(right.path);
  }
  return false;
};

const classifyDrawingClipStateFromElements = (
  elements: readonly DrawingClipStackElement[],
  bounds?: Rect,
): DrawingClipStackState => {
  if (isEmptyRect(bounds)) {
    return 'empty';
  }
  if (elements.length === 0) {
    return 'wideOpen';
  }
  if (
    elements.length === 1 &&
    elements[0]?.clip.kind === 'rect' &&
    elements[0].clip.op === 'intersect'
  ) {
    return 'deviceRect';
  }
  return 'complex';
};

export const classifyDrawingClipState = (
  elements: readonly DrawingClipStackElement[],
  bounds?: Rect,
): DrawingClipStackState => classifyDrawingClipStateFromElements(elements, bounds);

const getCurrentSaveRecordIndex = (clipStack: DrawingClipStackSnapshot): number =>
  Math.max(0, clipStack.saveRecords.length - 1);

export const createDrawingClipStackSnapshot = (
  elements: readonly DrawingClipStackElement[] = [],
  saveRecords: readonly DrawingClipStackSaveRecord[] = [{
    startingElementIndex: 0,
    oldestValidIndex: 0,
    elementCount: elements.length,
    deferredSaveCount: 0,
    state: classifyDrawingClipStateFromElements(elements),
  }],
): DrawingClipStackSnapshot => ({
  elements: Object.freeze(elements.map((element) => cloneElement(element))),
  saveRecords: Object.freeze(saveRecords.map((record) => ({
    startingElementIndex: record.startingElementIndex,
    oldestValidIndex: record.oldestValidIndex,
    elementCount: record.elementCount,
    deferredSaveCount: record.deferredSaveCount,
    state: record.state,
    bounds: cloneBounds(record.bounds),
    clipShader: cloneClipShader(record.clipShader),
  }))),
});

export const cloneDrawingClipStackSnapshot = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSnapshot =>
  createDrawingClipStackSnapshot(clipStack.elements, clipStack.saveRecords);

export const getCurrentDrawingClipSaveRecord = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSaveRecord =>
  clipStack.saveRecords[clipStack.saveRecords.length - 1] ?? {
    startingElementIndex: 0,
    oldestValidIndex: 0,
    elementCount: 0,
    deferredSaveCount: 0,
    state: 'wideOpen',
    clipShader: undefined,
  };

export const createDrawingClipSaveRecord = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSaveRecord => ({
  ...getCurrentDrawingClipSaveRecord(clipStack),
  startingElementIndex: clipStack.elements.length,
  deferredSaveCount: 0,
});

export const pushDrawingClipStackSave = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSnapshot => {
  const saveRecords = [...clipStack.saveRecords];
  const current = getCurrentDrawingClipSaveRecord(clipStack);
  saveRecords[saveRecords.length - 1] = {
    ...current,
    deferredSaveCount: current.deferredSaveCount + 1,
  };
  return createDrawingClipStackSnapshot(clipStack.elements, saveRecords);
};

const materializeDeferredSaveRecord = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSnapshot => {
  const current = getCurrentDrawingClipSaveRecord(clipStack);
  if (current.deferredSaveCount <= 0) {
    return clipStack;
  }

  const saveRecords = [...clipStack.saveRecords];
  saveRecords[saveRecords.length - 1] = {
    ...current,
    deferredSaveCount: current.deferredSaveCount - 1,
  };
  saveRecords.push(createDrawingClipSaveRecord(clipStack));
  return createDrawingClipStackSnapshot(clipStack.elements, saveRecords);
};

export const popDrawingClipStackSave = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSnapshot => {
  const current = getCurrentDrawingClipSaveRecord(clipStack);
  if (current.deferredSaveCount > 0) {
    const saveRecords = [...clipStack.saveRecords];
    saveRecords[saveRecords.length - 1] = {
      ...current,
      deferredSaveCount: current.deferredSaveCount - 1,
    };
    return createDrawingClipStackSnapshot(clipStack.elements, saveRecords);
  }

  if (clipStack.saveRecords.length <= 1) {
    return createDrawingClipStackSnapshot();
  }

  const restoredSaveRecords = clipStack.saveRecords.slice(0, -1);
  const restoredSaveRecord = restoredSaveRecords[restoredSaveRecords.length - 1]!;
  const restoredElements = clipStack.elements
    .slice(0, restoredSaveRecord.elementCount)
    .map((element) =>
      element.invalidatedByIndex !== undefined &&
        element.invalidatedByIndex >= restoredSaveRecord.elementCount
        ? { ...element, invalidatedByIndex: undefined }
        : element
    );

  return createDrawingClipStackSnapshot(restoredElements, restoredSaveRecords);
};

const _getActiveElements = (
  clipStack: DrawingClipStackSnapshot,
): readonly DrawingClipStackElement[] => {
  const saveRecord = getCurrentDrawingClipSaveRecord(clipStack);
  return clipStack.elements
    .slice(saveRecord.oldestValidIndex, saveRecord.elementCount)
    .filter((element) => element.invalidatedByIndex === undefined);
};

function createPolygonBounds(polygon: readonly Point2d[]): Rect {
  if (polygon.length === 0) {
    return { origin: [0, 0], size: { width: 0, height: 0 } };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }

  return {
    origin: [minX, minY],
    size: {
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    },
  };
}

const computeRectDeviceBounds = (clipRect: DrawingClipRect, transform: DrawingMatrix2d): Rect =>
  createPolygonBounds(createRectClipPolygon(clipRect, transform));

const intersectRects = (left: Rect | undefined, right: Rect): Rect =>
  left
    ? {
      origin: [
        Math.max(left.origin[0], right.origin[0]),
        Math.max(left.origin[1], right.origin[1]),
      ],
      size: {
        width: Math.max(
          0,
          Math.min(left.origin[0] + left.size.width, right.origin[0] + right.size.width) -
            Math.max(left.origin[0], right.origin[0]),
        ),
        height: Math.max(
          0,
          Math.min(left.origin[1] + left.size.height, right.origin[1] + right.size.height) -
            Math.max(left.origin[1], right.origin[1]),
        ),
      },
    }
    : right;

const computeConservativeBounds = (
  activeElements: readonly DrawingClipStackElement[],
): Rect | undefined => {
  let bounds: Rect | undefined;
  for (const element of activeElements) {
    if (element.clip.kind !== 'rect' || element.clip.op !== 'intersect') {
      continue;
    }
    bounds = intersectRects(
      bounds,
      computeRectDeviceBounds(element.clip.rect, element.clip.transform),
    );
  }
  return bounds;
};

const simplifyClipStackElements = (
  activeElements: readonly Readonly<{ index: number; element: DrawingClipStackElement }>[],
  clip: DrawingClip,
): Readonly<{
  append: boolean;
  invalidatedIndices: readonly number[];
}> => {
  const invalidatedIndices: number[] = [];

  for (let index = activeElements.length - 1; index >= 0; index -= 1) {
    const activeElement = activeElements[index]!;
    const element = activeElement.element;
    if (clipsEquivalent(element.clip, clip)) {
      return {
        append: false,
        invalidatedIndices: Object.freeze(invalidatedIndices),
      };
    }

    if (clip.op === 'intersect' && element.clip.op === 'intersect') {
      const currentAnalytic = createAnalyticClipForClip(element.clip);
      const nextAnalytic = createAnalyticClipForClip(clip);
      if (currentAnalytic && nextAnalytic) {
        if (analyticClipsEqual(currentAnalytic, nextAnalytic)) {
          return {
            append: false,
            invalidatedIndices: Object.freeze(invalidatedIndices),
          };
        }
        if (analyticClipContainsClip(nextAnalytic, currentAnalytic)) {
          return {
            append: false,
            invalidatedIndices: Object.freeze(invalidatedIndices),
          };
        }
        if (analyticClipContainsClip(currentAnalytic, nextAnalytic)) {
          invalidatedIndices.push(activeElement.index);
          continue;
        }
      }
    }

    if (
      clip.kind === 'rect' &&
      element.clip.kind === 'rect' &&
      clip.op === 'intersect' &&
      element.clip.op === 'intersect' &&
      matricesEqual(clip.transform, element.clip.transform)
    ) {
      if (rectContains(clip.rect, element.clip.rect)) {
        return {
          append: false,
          invalidatedIndices: Object.freeze(invalidatedIndices),
        };
      }
      if (rectContains(element.clip.rect, clip.rect)) {
        invalidatedIndices.push(activeElement.index);
        continue;
      }
    }
  }

  return {
    append: true,
    invalidatedIndices: Object.freeze(invalidatedIndices),
  };
};

export const appendDrawingClipStackElement = (
  clipStack: DrawingClipStackSnapshot,
  clip: DrawingClip,
): DrawingClipStackSnapshot => {
  const writableClipStack = materializeDeferredSaveRecord(clipStack);
  const current = getCurrentDrawingClipSaveRecord(writableClipStack);
  const activeElements = writableClipStack.elements
    .slice(current.oldestValidIndex, current.elementCount)
    .map((element, offset) => ({ index: current.oldestValidIndex + offset, element }))
    .filter((entry) => entry.element.invalidatedByIndex === undefined);
  const simplification = simplifyClipStackElements(activeElements, clip);
  if (!simplification.append) {
    return writableClipStack;
  }

  const invalidatedSet = new Set(simplification.invalidatedIndices);
  const updatedElements = writableClipStack.elements.map((element, index) =>
    invalidatedSet.has(index)
      ? { ...element, invalidatedByIndex: current.startingElementIndex }
      : element
  );
  const appendedElements = [
    ...updatedElements,
    (() => {
      const elementId = writableClipStack.elements.length;
      const rawClip = cloneClip(clip);
      const rawElement: DrawingClipStackRawElement = {
        id: elementId,
        clip: rawClip,
      };
      return {
        id: elementId,
        clip: rawClip,
        saveRecordIndex: getCurrentSaveRecordIndex(writableClipStack),
        invalidatedByIndex: undefined,
        rawElement,
      };
    })(),
  ];

  const activeAfterAppend = appendedElements.filter((element) =>
    element.invalidatedByIndex === undefined
  );
  const bounds = computeConservativeBounds(activeAfterAppend);
  const nextSaveRecord: DrawingClipStackSaveRecord = {
    ...current,
    oldestValidIndex: activeAfterAppend.length > 0
      ? appendedElements.findIndex((element) => element.invalidatedByIndex === undefined)
      : appendedElements.length,
    elementCount: appendedElements.length,
    deferredSaveCount: 0,
    state: classifyDrawingClipStateFromElements(activeAfterAppend, bounds),
    bounds: cloneBounds(bounds),
  };
  const saveRecords = [...writableClipStack.saveRecords];
  saveRecords[saveRecords.length - 1] = nextSaveRecord;
  return createDrawingClipStackSnapshot(appendedElements, saveRecords);
};

export const setDrawingClipStackShader = (
  clipStack: DrawingClipStackSnapshot,
  shader: DrawingClipShader,
): DrawingClipStackSnapshot => {
  const writableClipStack = materializeDeferredSaveRecord(clipStack);
  const current = getCurrentDrawingClipSaveRecord(writableClipStack);
  const saveRecords = [...writableClipStack.saveRecords];
  saveRecords[saveRecords.length - 1] = {
    ...current,
    clipShader: cloneClipShader(shader),
  };
  return createDrawingClipStackSnapshot(writableClipStack.elements, saveRecords);
};

export const visitDrawingClipStackForDraw = (
  clipStack: DrawingClipStackSnapshot,
  preparePathClip: (
    path: DrawingPath2d,
    transform: DrawingMatrix2d,
  ) =>
    | Readonly<{
      bounds?: Rect;
      triangles?: readonly Point2d[];
    }>
    | null,
  intersectBounds: (bounds: Rect | undefined, candidate: Rect | undefined) => Rect | undefined,
  computeBounds: (points: readonly Point2d[]) => Rect,
): DrawingVisitedClipStack => {
  const saveRecord = getCurrentDrawingClipSaveRecord(clipStack);
  const activeElements = clipStack.elements
    .slice(saveRecord.oldestValidIndex, saveRecord.elementCount)
    .filter((element) => element.invalidatedByIndex === undefined);
  let bounds = saveRecord.bounds;
  const stencilElements: DrawingPreparedClipElement[] = [];
  const preparedEffectiveElements: DrawingPreparedClipUsageElement[] = [];
  const preparedClipDrawElements: DrawingPreparedClipDrawElement[] = [];

  for (const element of activeElements) {
    const clip = element.clip;
    if (clip.kind === 'rect') {
      const polygon = createRectClipPolygon(clip.rect, clip.transform);
      const elementBounds = computeBounds(polygon);
      if (clip.op === 'intersect') {
        bounds = intersectBounds(bounds, elementBounds);
      }
      stencilElements.push({
        op: clip.op,
        triangles: createPolygonTriangles(polygon),
      });
      preparedClipDrawElements.push({
        id: element.id,
        op: clip.op,
        triangles: createPolygonTriangles(polygon),
        bounds: elementBounds,
        rawElement: element.rawElement,
      });
      prepareDrawingRawClipElementGeometry(
        element.rawElement,
        elementBounds,
        createPolygonTriangles(polygon),
      );
      preparedEffectiveElements.push({
        id: element.id,
        bounds: elementBounds,
        rawElement: element.rawElement,
      });
      continue;
    }

    const prepared = preparePathClip(clip.path, clip.transform);
    if (!prepared) {
      preparedEffectiveElements.push({
        id: element.id,
        rawElement: element.rawElement,
      });
      continue;
    }
    if (clip.op === 'intersect') {
      bounds = intersectBounds(bounds, prepared.bounds);
    }
    if (prepared.triangles && prepared.triangles.length > 0) {
      stencilElements.push({
        op: clip.op,
        triangles: Object.freeze([...prepared.triangles]),
      });
      preparedClipDrawElements.push({
        id: element.id,
        op: clip.op,
        triangles: Object.freeze([...prepared.triangles]),
        bounds: prepared.bounds,
        rawElement: element.rawElement,
      });
      prepareDrawingRawClipElementGeometry(
        element.rawElement,
        prepared.bounds,
        Object.freeze([...prepared.triangles]),
      );
    }
    preparedEffectiveElements.push({
      id: element.id,
      bounds: prepared.bounds,
      rawElement: element.rawElement,
    });
  }

  const analyticClip = createAnalyticClipForActiveElements(activeElements);
  const atlasClip = !analyticClip &&
      stencilElements.length > 1 &&
      activeElements.some((element) => element.clip.kind === 'path')
    ? {
      bounds: bounds ?? computeBounds(stencilElements.flatMap((element) => element.triangles)),
      elements: Object.freeze(stencilElements.map((element) => ({
        op: element.op,
        triangles: Object.freeze([...element.triangles]),
      }))),
    }
    : undefined;
  const stencilClip = atlasClip ? undefined : stencilElements.length > 0
    ? {
      bounds,
      elements: Object.freeze(stencilElements),
      deferredClipDraws: Object.freeze(stencilElements.map((element) => ({
        op: element.op,
        triangles: Object.freeze([...element.triangles]),
      }))),
      effectiveElementIds: Object.freeze(activeElements.map((element) => element.id)),
      effectiveElements: Object.freeze([...preparedEffectiveElements]),
      effectiveClipDraws: Object.freeze([...preparedClipDrawElements]),
      analyticClip,
      shader: cloneClipShader(saveRecord.clipShader),
    }
    : analyticClip || saveRecord.clipShader
    ? {
      bounds,
      deferredClipDraws: Object.freeze(stencilElements.map((element) => ({
        op: element.op,
        triangles: Object.freeze([...element.triangles]),
      }))),
      effectiveElementIds: Object.freeze(activeElements.map((element) => element.id)),
      effectiveElements: Object.freeze([...preparedEffectiveElements]),
      effectiveClipDraws: Object.freeze([...preparedClipDrawElements]),
      analyticClip,
      shader: cloneClipShader(saveRecord.clipShader),
    }
    : undefined;

  return {
    saveRecord,
    bounds,
    stencilClip,
    deferredClipDraws: Object.freeze(stencilElements.map((element) => ({
      op: element.op,
      triangles: Object.freeze([...element.triangles]),
    }))),
    analyticClip,
    atlasClip,
    shader: cloneClipShader(saveRecord.clipShader),
    effectiveElements: Object.freeze([...activeElements]),
    preparedEffectiveElements: Object.freeze([...preparedEffectiveElements]),
    preparedClipDrawElements: Object.freeze([...preparedClipDrawElements]),
  };
};
