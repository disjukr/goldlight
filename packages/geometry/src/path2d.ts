export type Point2D = readonly [number, number];

export type Size2D = Readonly<{
  width: number;
  height: number;
}>;

export type Rect = Readonly<{
  origin: Point2D;
  size: Size2D;
}>;

export type CornerRadii = Readonly<{
  x: number;
  y: number;
}>;

export type RRect = Readonly<{
  rect: Rect;
  topLeft?: CornerRadii;
  topRight?: CornerRadii;
  bottomRight?: CornerRadii;
  bottomLeft?: CornerRadii;
}>;

export type Circle = Readonly<{
  center: Point2D;
  radius: number;
}>;

export type Polygon = Readonly<{
  points: readonly Point2D[];
  closed?: boolean;
}>;

export type PathVerb2D =
  | Readonly<{ kind: 'moveTo'; to: Point2D }>
  | Readonly<{ kind: 'lineTo'; to: Point2D }>
  | Readonly<{ kind: 'quadTo'; control: Point2D; to: Point2D }>
  | Readonly<{ kind: 'close' }>;

export type Path2D = Readonly<{
  verbs: readonly PathVerb2D[];
}>;

export type Shape2D =
  | Readonly<{
    kind: 'rect';
    rect: Rect;
  }>
  | Readonly<{
    kind: 'rrect';
    rrect: RRect;
  }>
  | Readonly<{
    kind: 'circle';
    circle: Circle;
    segments?: number;
  }>
  | Readonly<{
    kind: 'polygon';
    polygon: Polygon;
  }>;

const defaultCircleSegments = 32;

const clampRadii = (radius: CornerRadii | undefined, halfWidth: number, halfHeight: number) => ({
  x: Math.max(0, Math.min(radius?.x ?? 0, halfWidth)),
  y: Math.max(0, Math.min(radius?.y ?? 0, halfHeight)),
});

export const createRect = (
  x: number,
  y: number,
  width: number,
  height: number,
): Rect => ({
  origin: [x, y],
  size: { width, height },
});

export const createCircle = (
  cx: number,
  cy: number,
  radius: number,
): Circle => ({
  center: [cx, cy],
  radius,
});

export const createPath2D = (...verbs: PathVerb2D[]): Path2D => ({ verbs });

export const createRectPath2D = (rect: Rect): Path2D => {
  const [x, y] = rect.origin;
  const { width, height } = rect.size;

  return createPath2D(
    { kind: 'moveTo', to: [x, y] },
    { kind: 'lineTo', to: [x + width, y] },
    { kind: 'lineTo', to: [x + width, y + height] },
    { kind: 'lineTo', to: [x, y + height] },
    { kind: 'close' },
  );
};

export const createPolygonPath2D = (polygon: Polygon): Path2D => {
  if (polygon.points.length === 0) {
    return createPath2D();
  }

  const [first, ...rest] = polygon.points;
  const verbs: PathVerb2D[] = [{ kind: 'moveTo', to: first }];
  for (const point of rest) {
    verbs.push({ kind: 'lineTo', to: point });
  }
  if (polygon.closed ?? true) {
    verbs.push({ kind: 'close' });
  }

  return createPath2D(...verbs);
};

export const createCirclePath2D = (
  circle: Circle,
  segments = defaultCircleSegments,
): Path2D => {
  if (segments < 3) {
    throw new Error('"segments" must be at least 3');
  }

  const verbs: PathVerb2D[] = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const point: Point2D = [
      circle.center[0] + (Math.cos(theta) * circle.radius),
      circle.center[1] + (Math.sin(theta) * circle.radius),
    ];
    verbs.push(index === 0 ? { kind: 'moveTo', to: point } : { kind: 'lineTo', to: point });
  }
  verbs.push({ kind: 'close' });

  return createPath2D(...verbs);
};

export const createRRectPath2D = (rrect: RRect): Path2D => {
  const [x, y] = rrect.rect.origin;
  const { width, height } = rrect.rect.size;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const topLeft = clampRadii(rrect.topLeft, halfWidth, halfHeight);
  const topRight = clampRadii(rrect.topRight, halfWidth, halfHeight);
  const bottomRight = clampRadii(rrect.bottomRight, halfWidth, halfHeight);
  const bottomLeft = clampRadii(rrect.bottomLeft, halfWidth, halfHeight);

  return createPath2D(
    { kind: 'moveTo', to: [x + topLeft.x, y] },
    { kind: 'lineTo', to: [x + width - topRight.x, y] },
    { kind: 'quadTo', control: [x + width, y], to: [x + width, y + topRight.y] },
    { kind: 'lineTo', to: [x + width, y + height - bottomRight.y] },
    {
      kind: 'quadTo',
      control: [x + width, y + height],
      to: [x + width - bottomRight.x, y + height],
    },
    { kind: 'lineTo', to: [x + bottomLeft.x, y + height] },
    { kind: 'quadTo', control: [x, y + height], to: [x, y + height - bottomLeft.y] },
    { kind: 'lineTo', to: [x, y + topLeft.y] },
    { kind: 'quadTo', control: [x, y], to: [x + topLeft.x, y] },
    { kind: 'close' },
  );
};

export const createPath2DFromShape = (shape: Shape2D): Path2D => {
  switch (shape.kind) {
    case 'rect':
      return createRectPath2D(shape.rect);
    case 'rrect':
      return createRRectPath2D(shape.rrect);
    case 'circle':
      return createCirclePath2D(shape.circle, shape.segments);
    case 'polygon':
      return createPolygonPath2D(shape.polygon);
  }
};
