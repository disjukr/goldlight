export type Point2d = readonly [number, number];

export type Matrix2d = readonly [number, number, number, number, number, number];

export type Size2d = Readonly<{
  width: number;
  height: number;
}>;

export type Rect = Readonly<{
  origin: Point2d;
  size: Size2d;
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
  center: Point2d;
  radius: number;
}>;

export type Polygon = Readonly<{
  points: readonly Point2d[];
  closed?: boolean;
}>;

export type PathVerb2d =
  | Readonly<{ kind: 'moveTo'; to: Point2d }>
  | Readonly<{ kind: 'lineTo'; to: Point2d }>
  | Readonly<{ kind: 'quadTo'; control: Point2d; to: Point2d }>
  | Readonly<{ kind: 'conicTo'; control: Point2d; to: Point2d; weight: number }>
  | Readonly<{ kind: 'cubicTo'; control1: Point2d; control2: Point2d; to: Point2d }>
  | Readonly<{
    kind: 'arcTo';
    center: Point2d;
    radius: number;
    startAngle: number;
    endAngle: number;
    counterClockwise?: boolean;
  }>
  | Readonly<{ kind: 'close' }>;

export type PathFillRule2d = 'nonzero' | 'evenodd';

export type Path2d = Readonly<{
  verbs: readonly PathVerb2d[];
  fillRule: PathFillRule2d;
}>;

export type Shape2d =
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

export const identityMatrix2d: Matrix2d = [1, 0, 0, 1, 0, 0];

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

export const createPath2d = (...verbs: PathVerb2d[]): Path2d => ({
  verbs,
  fillRule: 'nonzero',
});

export const multiplyMatrix2d = (
  left: Matrix2d,
  right: Matrix2d,
): Matrix2d => [
  (left[0] * right[0]) + (left[2] * right[1]),
  (left[1] * right[0]) + (left[3] * right[1]),
  (left[0] * right[2]) + (left[2] * right[3]),
  (left[1] * right[2]) + (left[3] * right[3]),
  (left[0] * right[4]) + (left[2] * right[5]) + left[4],
  (left[1] * right[4]) + (left[3] * right[5]) + left[5],
];

export const createTranslationMatrix2d = (tx: number, ty: number): Matrix2d => [1, 0, 0, 1, tx, ty];

export const createScaleMatrix2d = (sx: number, sy = sx): Matrix2d => [sx, 0, 0, sy, 0, 0];

export const transformPoint2d = (
  point: Point2d,
  matrix: Matrix2d,
): Point2d => [
  (matrix[0] * point[0]) + (matrix[2] * point[1]) + matrix[4],
  (matrix[1] * point[0]) + (matrix[3] * point[1]) + matrix[5],
];

const approximateUniformScale = (matrix: Matrix2d): number => {
  const sx = Math.hypot(matrix[0], matrix[1]);
  const sy = Math.hypot(matrix[2], matrix[3]);
  return (sx + sy) / 2;
};

export const withPath2dFillRule = (
  path: Path2d,
  fillRule: PathFillRule2d,
): Path2d => ({
  verbs: path.verbs,
  fillRule,
});

export const transformPath2d = (
  path: Path2d,
  matrix: Matrix2d,
): Path2d => ({
  verbs: path.verbs.map((verb) => {
    switch (verb.kind) {
      case 'moveTo':
      case 'lineTo':
        return {
          kind: verb.kind,
          to: transformPoint2d(verb.to, matrix),
        };
      case 'quadTo':
        return {
          kind: 'quadTo',
          control: transformPoint2d(verb.control, matrix),
          to: transformPoint2d(verb.to, matrix),
        };
      case 'conicTo':
        return {
          kind: 'conicTo',
          control: transformPoint2d(verb.control, matrix),
          to: transformPoint2d(verb.to, matrix),
          weight: verb.weight,
        };
      case 'cubicTo':
        return {
          kind: 'cubicTo',
          control1: transformPoint2d(verb.control1, matrix),
          control2: transformPoint2d(verb.control2, matrix),
          to: transformPoint2d(verb.to, matrix),
        };
      case 'arcTo':
        return {
          kind: 'arcTo',
          center: transformPoint2d(verb.center, matrix),
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

export const createRectPath2d = (rect: Rect): Path2d => {
  const [x, y] = rect.origin;
  const { width, height } = rect.size;

  return createPath2d(
    { kind: 'moveTo', to: [x, y] },
    { kind: 'lineTo', to: [x + width, y] },
    { kind: 'lineTo', to: [x + width, y + height] },
    { kind: 'lineTo', to: [x, y + height] },
    { kind: 'close' },
  );
};

export const createPolygonPath2d = (polygon: Polygon): Path2d => {
  if (polygon.points.length === 0) {
    return createPath2d();
  }

  const [first, ...rest] = polygon.points;
  const verbs: PathVerb2d[] = [{ kind: 'moveTo', to: first }];
  for (const point of rest) {
    verbs.push({ kind: 'lineTo', to: point });
  }
  if (polygon.closed ?? true) {
    verbs.push({ kind: 'close' });
  }

  return createPath2d(...verbs);
};

export const createCirclePath2d = (
  circle: Circle,
  segments = defaultCircleSegments,
): Path2d => {
  if (segments < 3) {
    throw new Error('"segments" must be at least 3');
  }

  const verbs: PathVerb2d[] = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const point: Point2d = [
      circle.center[0] + (Math.cos(theta) * circle.radius),
      circle.center[1] + (Math.sin(theta) * circle.radius),
    ];
    verbs.push(index === 0 ? { kind: 'moveTo', to: point } : { kind: 'lineTo', to: point });
  }
  verbs.push({ kind: 'close' });

  return createPath2d(...verbs);
};

export const createRRectPath2d = (rrect: RRect): Path2d => {
  const [x, y] = rrect.rect.origin;
  const { width, height } = rrect.rect.size;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const topLeft = clampRadii(rrect.topLeft, halfWidth, halfHeight);
  const topRight = clampRadii(rrect.topRight, halfWidth, halfHeight);
  const bottomRight = clampRadii(rrect.bottomRight, halfWidth, halfHeight);
  const bottomLeft = clampRadii(rrect.bottomLeft, halfWidth, halfHeight);

  return createPath2d(
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

export const createPath2dFromShape = (shape: Shape2d): Path2d => {
  switch (shape.kind) {
    case 'rect':
      return createRectPath2d(shape.rect);
    case 'rrect':
      return createRRectPath2d(shape.rrect);
    case 'circle':
      return createCirclePath2d(shape.circle, shape.segments);
    case 'polygon':
      return createPolygonPath2d(shape.polygon);
  }
};
