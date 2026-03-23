import { type Point2D, type Rect, transformPoint2D } from '@rieul3d/geometry';
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
  DrawingMatrix2D,
  DrawingPath2D,
} from './types.ts';

export type DrawingPreparedClipElement = Readonly<{
  op: DrawingClip['op'];
  triangles: readonly Point2D[];
}>;

export type DrawingPreparedClipUsageElement = Readonly<{
  id: number;
  bounds?: Rect;
  rawElement: DrawingClipStackRawElement;
}>;

export type DrawingPreparedClipDrawElement = Readonly<{
  id: number;
  op: DrawingClip['op'];
  triangles: readonly Point2D[];
  bounds?: Rect;
  rawElement: DrawingClipStackRawElement;
}>;

export type DrawingPreparedAnalyticClip = Readonly<{
  kind: 'rect';
  rect: DrawingClipRect;
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
  -readonly [K in keyof NonNullable<DrawingClipStackRawElement['runtimeState']>]:
    NonNullable<DrawingClipStackRawElement['runtimeState']>[K];
} => {
  const mutableRawElement = rawElement as {
    runtimeState?: {
      -readonly [K in keyof NonNullable<DrawingClipStackRawElement['runtimeState']>]:
        NonNullable<DrawingClipStackRawElement['runtimeState']>[K];
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
  triangles: readonly Point2D[] | undefined,
): void => {
  const runtimeState = ensureRawElementRuntimeState(rawElement);
  runtimeState.preparedBounds = bounds;
  runtimeState.preparedTriangles = triangles;
};

export const getDrawingRawClipElementPreparedGeometry = (
  rawElement: DrawingClipStackRawElement,
): Readonly<{
  bounds?: Rect;
  triangles?: readonly Point2D[];
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
): DrawingClipStackInsertion | undefined => ensureRawElementRuntimeState(rawElement).latestInsertion;

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

const createPolygonTriangles = (polygon: readonly Point2D[]): readonly Point2D[] => {
  if (polygon.length < 3) {
    return Object.freeze([]) as readonly Point2D[];
  }

  const triangles: Point2D[] = [];
  for (let index = 1; index < polygon.length - 1; index += 1) {
    triangles.push(polygon[0]!, polygon[index]!, polygon[index + 1]!);
  }
  return Object.freeze(triangles);
};

const createRectClipPolygon = (
  clipRect: DrawingClipRect,
  transform: DrawingMatrix2D,
): readonly Point2D[] => {
  const x0 = clipRect.origin[0];
  const y0 = clipRect.origin[1];
  const x1 = x0 + clipRect.size.width;
  const y1 = y0 + clipRect.size.height;
  return Object.freeze([
    transformPoint2D([x0, y0], transform),
    transformPoint2D([x1, y0], transform),
    transformPoint2D([x1, y1], transform),
    transformPoint2D([x0, y1], transform),
  ]);
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

const matricesEqual = (left: DrawingMatrix2D, right: DrawingMatrix2D): boolean =>
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

function createPolygonBounds(polygon: readonly Point2D[]): Rect {
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

const computeRectDeviceBounds = (clipRect: DrawingClipRect, transform: DrawingMatrix2D): Rect =>
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
    path: DrawingPath2D,
    transform: DrawingMatrix2D,
  ) =>
    | Readonly<{
      bounds?: Rect;
      triangles?: readonly Point2D[];
    }>
    | null,
  intersectBounds: (bounds: Rect | undefined, candidate: Rect | undefined) => Rect | undefined,
  computeBounds: (points: readonly Point2D[]) => Rect,
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

  const analyticClip = activeElements.length === 1 &&
      activeElements[0]!.clip.kind === 'rect' &&
      activeElements[0]!.clip.op === 'intersect'
    ? {
      kind: 'rect' as const,
      rect: cloneBounds(activeElements[0]!.clip.rect)!,
    }
    : undefined;
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
