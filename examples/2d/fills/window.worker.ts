import { Path2d, Scene2d, setWindowScene } from "goldlight";

type Point2d = [number, number];
type PathInit = NonNullable<ConstructorParameters<typeof Path2d>[0]>;
type PathVerb = NonNullable<PathInit["verbs"]>[number];
type PathVerbs = PathVerb[];

function add(scene: Scene2d, init: PathInit) {
  scene.add(new Path2d(init));
}

function addTranslated(
  scene: Scene2d,
  dx: number,
  dy: number,
  init: PathInit,
) {
  const verbs: PathVerbs = (init.verbs ?? []).map((verb) => {
    switch (verb.kind) {
      case "moveTo":
      case "lineTo":
        return { kind: verb.kind, to: [verb.to[0] + dx, verb.to[1] + dy] as Point2d };
      case "quadTo":
        return {
          kind: "quadTo",
          control: [verb.control[0] + dx, verb.control[1] + dy] as Point2d,
          to: [verb.to[0] + dx, verb.to[1] + dy] as Point2d,
        };
      case "conicTo":
        return {
          kind: "conicTo",
          control: [verb.control[0] + dx, verb.control[1] + dy] as Point2d,
          to: [verb.to[0] + dx, verb.to[1] + dy] as Point2d,
          weight: verb.weight,
        };
      case "cubicTo":
        return {
          kind: "cubicTo",
          control1: [verb.control1[0] + dx, verb.control1[1] + dy] as Point2d,
          control2: [verb.control2[0] + dx, verb.control2[1] + dy] as Point2d,
          to: [verb.to[0] + dx, verb.to[1] + dy] as Point2d,
        };
      case "arcTo":
        return {
          kind: "arcTo",
          center: [verb.center[0] + dx, verb.center[1] + dy] as Point2d,
          radius: verb.radius,
          startAngle: verb.startAngle,
          endAngle: verb.endAngle,
          counterClockwise: verb.counterClockwise,
        };
      case "close":
        return { kind: "close" };
    }
  });

  add(scene, { ...init, verbs });
}

function createTrianglePath(a: Point2d, b: Point2d, c: Point2d): PathVerbs {
  return [
    { kind: "moveTo", to: a },
    { kind: "lineTo", to: b },
    { kind: "lineTo", to: c },
    { kind: "close" },
  ];
}

function createRoundedDiamondPath(center: Point2d, radiusX: number, radiusY: number): PathVerbs {
  return [
    { kind: "moveTo", to: [center[0], center[1] - radiusY] as Point2d },
    {
      kind: "quadTo",
      control: [center[0] + radiusX, center[1] - radiusY * 0.2] as Point2d,
      to: [center[0] + radiusX, center[1]] as Point2d,
    },
    {
      kind: "quadTo",
      control: [center[0] + radiusX * 0.2, center[1] + radiusY] as Point2d,
      to: [center[0], center[1] + radiusY] as Point2d,
    },
    {
      kind: "quadTo",
      control: [center[0] - radiusX, center[1] + radiusY * 0.2] as Point2d,
      to: [center[0] - radiusX, center[1]] as Point2d,
    },
    {
      kind: "quadTo",
      control: [center[0] - radiusX * 0.2, center[1] - radiusY] as Point2d,
      to: [center[0], center[1] - radiusY] as Point2d,
    },
    { kind: "close" },
  ];
}

function createWobblyDiamondPath(center: Point2d, width: number, height: number): PathVerbs {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return [
    { kind: "moveTo", to: [center[0], top] as Point2d },
    {
      kind: "cubicTo",
      control1: [center[0] + width * 0.22, top + height * 0.08] as Point2d,
      control2: [right + width * 0.06, center[1] - height * 0.12] as Point2d,
      to: [right, center[1] - height * 0.02] as Point2d,
    },
    {
      kind: "cubicTo",
      control1: [right - width * 0.06, center[1] + height * 0.2] as Point2d,
      control2: [center[0] + width * 0.3, bottom + height * 0.04] as Point2d,
      to: [center[0] + width * 0.08, bottom] as Point2d,
    },
    {
      kind: "cubicTo",
      control1: [center[0] - width * 0.12, bottom - height * 0.02] as Point2d,
      control2: [left + width * 0.22, center[1] + height * 0.32] as Point2d,
      to: [left, center[1] + height * 0.1] as Point2d,
    },
    {
      kind: "cubicTo",
      control1: [left + width * 0.18, center[1] - height * 0.18] as Point2d,
      control2: [center[0] - width * 0.16, top + height * 0.14] as Point2d,
      to: [center[0], top] as Point2d,
    },
    { kind: "close" },
  ];
}

function createConcaveKitePath(center: Point2d, width: number, height: number): PathVerbs {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return [
    { kind: "moveTo", to: [center[0], top] as Point2d },
    {
      kind: "quadTo",
      control: [right + width * 0.04, center[1] - height * 0.22] as Point2d,
      to: [right, center[1] - height * 0.06] as Point2d,
    },
    {
      kind: "cubicTo",
      control1: [right - width * 0.26, center[1] + height * 0.08] as Point2d,
      control2: [center[0] + width * 0.08, center[1] + height * 0.02] as Point2d,
      to: [center[0] + width * 0.12, center[1] + height * 0.16] as Point2d,
    },
    {
      kind: "quadTo",
      control: [center[0] - width * 0.04, bottom + height * 0.04] as Point2d,
      to: [center[0] - width * 0.18, bottom] as Point2d,
    },
    {
      kind: "quadTo",
      control: [left - width * 0.08, center[1] + height * 0.04] as Point2d,
      to: [left, center[1] - height * 0.02] as Point2d,
    },
    {
      kind: "quadTo",
      control: [center[0] - width * 0.08, center[1] - height * 0.24] as Point2d,
      to: [center[0], top] as Point2d,
    },
    { kind: "close" },
  ];
}

function createSelfIntersectingStarPath(center: Point2d, radius: number): PathVerbs {
  const points: Point2d[] = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = (-Math.PI / 2) + ((index * Math.PI * 2) / 5);
    points.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ]);
  }
  return [
    { kind: "moveTo", to: points[0]! },
    { kind: "lineTo", to: points[2]! },
    { kind: "lineTo", to: points[4]! },
    { kind: "lineTo", to: points[1]! },
    { kind: "lineTo", to: points[3]! },
    { kind: "close" },
  ];
}

function createSoftStarPath(center: Point2d, outerRadius: number, innerRadius: number): PathVerbs {
  const points: Point2d[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (-Math.PI / 2) + (index * Math.PI / 5);
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    points.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ]);
  }

  const verbs: PathVerbs = [
    { kind: "moveTo", to: points[0]! },
  ];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    verbs.push({
      kind: "quadTo",
      control: [
        ((current[0] + next[0]) / 2) + ((center[0] - (current[0] + next[0]) / 2) * 0.08),
        ((current[1] + next[1]) / 2) + ((center[1] - (current[1] + next[1]) / 2) * 0.08),
      ],
      to: next,
    });
  }
  verbs.push({ kind: "close" });
  return verbs;
}

function createDiamondCutoutRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  holeRadiusX: number,
  holeRadiusY: number,
): PathVerbs {
  const center: Point2d = [x + width / 2, y + height / 2];
  return [
    { kind: "moveTo", to: [x, y] as Point2d },
    { kind: "lineTo", to: [x + width, y] as Point2d },
    { kind: "lineTo", to: [x + width, y + height] as Point2d },
    { kind: "lineTo", to: [x, y + height] as Point2d },
    { kind: "close" },
    { kind: "moveTo", to: [center[0], center[1] - holeRadiusY] as Point2d },
    { kind: "lineTo", to: [center[0] - holeRadiusX, center[1]] as Point2d },
    { kind: "lineTo", to: [center[0], center[1] + holeRadiusY] as Point2d },
    { kind: "lineTo", to: [center[0] + holeRadiusX, center[1]] as Point2d },
    { kind: "close" },
  ];
}

function createNestedDiamondPath(
  center: Point2d,
  width: number,
  height: number,
  innerScale = 0.52,
): PathVerbs {
  return [
    ...createRoundedDiamondPath(center, width / 2, height / 2),
    ...createRoundedDiamondPath(center, (width * innerScale) / 2, (height * innerScale) / 2),
  ];
}

function mount() {
  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.97, g: 0.95, b: 0.9, a: 1 },
  }));

  add(scene, {
    color: { r: 0.14, g: 0.15, b: 0.18, a: 1 },
    verbs: [
      { kind: "moveTo", to: [44, 44] },
      { kind: "lineTo", to: [676, 44] },
      { kind: "lineTo", to: [676, 936] },
      { kind: "lineTo", to: [44, 936] },
      { kind: "close" },
    ],
  });

  add(scene, {
    color: { r: 0.91, g: 0.37, b: 0.23, a: 1 },
    verbs: createTrianglePath([92, 226], [182, 88], [274, 226]),
  });

  add(scene, {
    color: { r: 0.98, g: 0.8, b: 0.33, a: 1 },
    verbs: createWobblyDiamondPath([370, 156], 186, 134),
  });

  add(scene, {
    color: { r: 0.22, g: 0.58, b: 0.47, a: 1 },
    verbs: createRoundedDiamondPath([558, 160], 88, 72),
  });

  add(scene, {
    color: { r: 0.19, g: 0.54, b: 0.79, a: 0.94 },
    fillRule: "evenodd",
    verbs: createDiamondCutoutRectPath(84, 304, 170, 152, 34, 42),
  });

  add(scene, {
    color: { r: 0.64, g: 0.38, b: 0.84, a: 0.92 },
    fillRule: "evenodd",
    verbs: createSelfIntersectingStarPath([336, 350], 72),
  });

  addTranslated(scene, 58, 326, {
    color: { r: 0.78, g: 0.46, b: 0.82, a: 0.72 },
    verbs: createTrianglePath([0, 0], [146, 0], [0, 118]),
  });

  add(scene, {
    color: { r: 0.9, g: 0.59, b: 0.18, a: 1 },
    verbs: createConcaveKitePath([528, 382], 120, 142),
  });

  add(scene, {
    color: { r: 0.95, g: 0.46, b: 0.28, a: 0.54 },
    verbs: createTrianglePath([94, 714], [152, 614], [212, 714]),
  });

  add(scene, {
    color: { r: 0.2, g: 0.47, b: 0.9, a: 0.42 },
    verbs: createSoftStarPath([236, 688], 92, 46),
  });

  add(scene, {
    color: { r: 0.13, g: 0.65, b: 0.52, a: 0.4 },
    verbs: createRoundedDiamondPath([252, 690], 104, 114),
  });

  add(scene, {
    color: { r: 0.96, g: 0.73, b: 0.36, a: 0.88 },
    verbs: createNestedDiamondPath([482, 834], 124, 92),
  });

  add(scene, {
    color: { r: 0.48, g: 0.77, b: 0.86, a: 0.88 },
    fillRule: "evenodd",
    verbs: createNestedDiamondPath([608, 834], 124, 92),
  });

  addTranslated(scene, 370, 556, {
    color: { r: 0.16, g: 0.18, b: 0.24, a: 0.96 },
    verbs: [
      { kind: "moveTo", to: [0, 0] },
      { kind: "lineTo", to: [210, 0] },
      { kind: "lineTo", to: [210, 220] },
      { kind: "lineTo", to: [0, 220] },
      { kind: "close" },
    ],
  });

  addTranslated(scene, 388, 576, {
    color: { r: 0.96, g: 0.82, b: 0.35, a: 0.95 },
    verbs: createRoundedDiamondPath([80, 92], 68, 88),
  });

  addTranslated(scene, 388, 576, {
    color: { r: 0.28, g: 0.63, b: 0.55, a: 0.72 },
    verbs: createTrianglePath([48, 170], [124, 34], [166, 170]),
  });

  add(scene, {
    color: { r: 0.86, g: 0.34, b: 0.43, a: 1 },
    verbs: [
      { kind: "moveTo", to: [88, 850] },
      { kind: "lineTo", to: [282, 850] },
      { kind: "lineTo", to: [282, 890] },
      {
        kind: "cubicTo",
        control1: [248, 926],
        control2: [122, 926],
        to: [88, 890],
      },
      { kind: "close" },
    ],
  });

  return {
    dispose() {},
  };
}

const app = mount();

if (import.meta.hot) {
  import.meta.hot.accept(() => {});
  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
