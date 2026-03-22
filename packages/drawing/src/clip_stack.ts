import { type Point2D, type Rect, transformPoint2D } from '@rieul3d/geometry';
import type {
  DrawingClip,
  DrawingClipRect,
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

export type DrawingPreparedClip = Readonly<{
  bounds?: Rect;
  elements?: readonly DrawingPreparedClipElement[];
}>;

export type DrawingVisitedClipStack = Readonly<{
  saveRecord: DrawingClipStackSaveRecord;
  bounds?: Rect;
  stencilClip?: DrawingPreparedClip;
  effectiveElements: readonly DrawingClip[];
}>;

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

export const createDrawingClipStackSnapshot = (
  elements: readonly DrawingClip[] = [],
  saveRecords: readonly DrawingClipStackSaveRecord[] = [{
    elementCount: elements.length,
    state: elements.length === 0 ? 'wideOpen' : 'complex',
  }],
): DrawingClipStackSnapshot => ({
  elements: Object.freeze([...elements]),
  saveRecords: Object.freeze(saveRecords.map((record) => ({ ...record }))),
});

export const cloneDrawingClipStackSnapshot = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSnapshot =>
  createDrawingClipStackSnapshot(
    clipStack.elements.map((clip) =>
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
        }
    ),
    clipStack.saveRecords.map((record) => ({
      elementCount: record.elementCount,
      state: record.state,
      bounds: record.bounds
        ? {
          origin: [...record.bounds.origin] as typeof record.bounds.origin,
          size: { ...record.bounds.size },
        }
        : undefined,
    })),
  );

export const getCurrentDrawingClipSaveRecord = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSaveRecord =>
  clipStack.saveRecords[clipStack.saveRecords.length - 1] ?? {
    elementCount: 0,
    state: 'wideOpen',
  };

export const createDrawingClipSaveRecord = (
  clipStack: DrawingClipStackSnapshot,
): DrawingClipStackSaveRecord => ({
  ...getCurrentDrawingClipSaveRecord(clipStack),
});

export const classifyDrawingClipState = (
  elements: readonly DrawingClip[],
): DrawingClipStackState => {
  if (elements.length === 0) {
    return 'wideOpen';
  }
  if (
    elements.length === 1 &&
    elements[0]?.kind === 'rect' &&
    elements[0].op === 'intersect'
  ) {
    return 'deviceRect';
  }
  return 'complex';
};

export const visitDrawingClipStackForDraw = (
  clipStack: DrawingClipStackSnapshot,
  preparePathClip: (
    path: DrawingPath2D,
    transform: DrawingMatrix2D,
  ) => Readonly<{
    bounds?: Rect;
    triangles?: readonly Point2D[];
  }> | null,
  intersectBounds: (bounds: Rect | undefined, candidate: Rect | undefined) => Rect | undefined,
  computeBounds: (points: readonly Point2D[]) => Rect,
): DrawingVisitedClipStack => {
  const saveRecord = getCurrentDrawingClipSaveRecord(clipStack);
  const activeElements = clipStack.elements.slice(0, saveRecord.elementCount);
  let bounds = saveRecord.bounds;
  const stencilElements: DrawingPreparedClipElement[] = [];

  for (const clip of activeElements) {
    if (clip.kind === 'rect') {
      const polygon = createRectClipPolygon(clip.rect, clip.transform);
      if (clip.op === 'intersect') {
        bounds = intersectBounds(bounds, computeBounds(polygon));
      }
      stencilElements.push({
        op: clip.op,
        triangles: createPolygonTriangles(polygon),
      });
      continue;
    }

    const prepared = preparePathClip(clip.path, clip.transform);
    if (!prepared) {
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
    }
  }

  return {
    saveRecord,
    bounds,
    stencilClip: stencilElements.length > 0
      ? {
        bounds,
        elements: Object.freeze(stencilElements),
      }
      : undefined,
    effectiveElements: Object.freeze([...activeElements]),
  };
};
