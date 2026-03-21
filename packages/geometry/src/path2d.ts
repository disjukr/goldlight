export type Point2D = readonly [number, number];

export type Matrix2D = readonly [number, number, number, number, number, number];

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
  | Readonly<{ kind: 'conicTo'; control: Point2D; to: Point2D; weight: number }>
  | Readonly<{ kind: 'cubicTo'; control1: Point2D; control2: Point2D; to: Point2D }>
  | Readonly<{
    kind: 'arcTo';
    center: Point2D;
    radius: number;
    startAngle: number;
    endAngle: number;
    counterClockwise?: boolean;
  }>
  | Readonly<{ kind: 'close' }>;

export type PathFillRule2D = 'nonzero' | 'evenodd';

export type Path2D = Readonly<{
  verbs: readonly PathVerb2D[];
  fillRule: PathFillRule2D;
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

export const identityMatrix2D: Matrix2D = [1, 0, 0, 1, 0, 0];

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

export const createPath2D = (...verbs: PathVerb2D[]): Path2D => ({
  verbs,
  fillRule: 'nonzero',
});

export const multiplyMatrix2D = (
  left: Matrix2D,
  right: Matrix2D,
): Matrix2D => [
  (left[0] * right[0]) + (left[2] * right[1]),
  (left[1] * right[0]) + (left[3] * right[1]),
  (left[0] * right[2]) + (left[2] * right[3]),
  (left[1] * right[2]) + (left[3] * right[3]),
  (left[0] * right[4]) + (left[2] * right[5]) + left[4],
  (left[1] * right[4]) + (left[3] * right[5]) + left[5],
];

export const createTranslationMatrix2D = (tx: number, ty: number): Matrix2D => [1, 0, 0, 1, tx, ty];

export const createScaleMatrix2D = (sx: number, sy = sx): Matrix2D => [sx, 0, 0, sy, 0, 0];

export const transformPoint2D = (
  point: Point2D,
  matrix: Matrix2D,
): Point2D => [
  (matrix[0] * point[0]) + (matrix[2] * point[1]) + matrix[4],
  (matrix[1] * point[0]) + (matrix[3] * point[1]) + matrix[5],
];

const approximateUniformScale = (matrix: Matrix2D): number => {
  const sx = Math.hypot(matrix[0], matrix[1]);
  const sy = Math.hypot(matrix[2], matrix[3]);
  return (sx + sy) / 2;
};

export const withPath2DFillRule = (
  path: Path2D,
  fillRule: PathFillRule2D,
): Path2D => ({
  verbs: path.verbs,
  fillRule,
});

export const transformPath2D = (
  path: Path2D,
  matrix: Matrix2D,
): Path2D => ({
  verbs: path.verbs.map((verb) => {
    switch (verb.kind) {
      case 'moveTo':
      case 'lineTo':
        return {
          kind: verb.kind,
          to: transformPoint2D(verb.to, matrix),
        };
      case 'quadTo':
        return {
          kind: 'quadTo',
          control: transformPoint2D(verb.control, matrix),
          to: transformPoint2D(verb.to, matrix),
        };
      case 'conicTo':
        return {
          kind: 'conicTo',
          control: transformPoint2D(verb.control, matrix),
          to: transformPoint2D(verb.to, matrix),
          weight: verb.weight,
        };
      case 'cubicTo':
        return {
          kind: 'cubicTo',
          control1: transformPoint2D(verb.control1, matrix),
          control2: transformPoint2D(verb.control2, matrix),
          to: transformPoint2D(verb.to, matrix),
        };
      case 'arcTo':
        return {
          kind: 'arcTo',
          center: transformPoint2D(verb.center, matrix),
          radius: verb.radius * approximateUniformScale(matrix),
          startAngle: verb.startAngle,
          endAngle: verb.endAngle,
          counterClockwise: verb.counterClockwise,
        };
      case 'close':
        return verb;
    }
  }),
  fillRule: path.fillRule,
});

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
