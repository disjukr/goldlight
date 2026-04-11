import { Path2d, Scene2d, setWindowScene } from "goldlight";

type Point2d = [number, number];
type PathInit = NonNullable<ConstructorParameters<typeof Path2d>[0]>;
type PathShader = NonNullable<PathInit["shader"]>;
type PathVerb = NonNullable<PathInit["verbs"]>[number];

function add(scene: Scene2d, init: PathInit) {
  scene.add(new Path2d(init));
}

function createRectPath(x: number, y: number, width: number, height: number): PathVerb[] {
  return [
    { kind: "moveTo", to: [x, y] },
    { kind: "lineTo", to: [x + width, y] },
    { kind: "lineTo", to: [x + width, y + height] },
    { kind: "lineTo", to: [x, y + height] },
    { kind: "close" },
  ];
}

function createBlobPath(center: Point2d, radiusX: number, radiusY: number): PathVerb[] {
  return [
    { kind: "moveTo", to: [center[0], center[1] - radiusY] },
    {
      kind: "cubicTo",
      control1: [center[0] + radiusX * 0.7, center[1] - radiusY * 1.05],
      control2: [center[0] + radiusX * 1.1, center[1] - radiusY * 0.1],
      to: [center[0] + radiusX, center[1] + radiusY * 0.06],
    },
    {
      kind: "cubicTo",
      control1: [center[0] + radiusX * 0.82, center[1] + radiusY * 0.94],
      control2: [center[0] - radiusX * 0.18, center[1] + radiusY * 1.14],
      to: [center[0] - radiusX * 0.16, center[1] + radiusY],
    },
    {
      kind: "cubicTo",
      control1: [center[0] - radiusX * 0.92, center[1] + radiusY * 0.82],
      control2: [center[0] - radiusX * 1.08, center[1] - radiusY * 0.18],
      to: [center[0], center[1] - radiusY],
    },
    { kind: "close" },
  ];
}

function createStarPath(center: Point2d, outerRadius: number, innerRadius: number): PathVerb[] {
  const points: Point2d[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (-Math.PI / 2) + (index * Math.PI / 5);
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    points.push([
      center[0] + (Math.cos(angle) * radius),
      center[1] + (Math.sin(angle) * radius),
    ]);
  }

  return [
    { kind: "moveTo", to: points[0]! },
    ...points.slice(1).map((point) => ({ kind: "lineTo", to: point }) as const),
    { kind: "close" },
  ];
}

function gradientPath(verbs: PathVerb[], shader: PathShader): PathInit {
  return {
    style: "fill",
    verbs,
    shader,
  };
}

function mount() {
  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.05, g: 0.07, b: 0.1, a: 1 },
  }));

  add(scene, {
    style: "fill",
    color: { r: 0.09, g: 0.11, b: 0.15, a: 1 },
    verbs: createRectPath(36, 36, 888, 648),
  });

  for (const x of [72, 358, 644]) {
    add(scene, {
      style: "fill",
      color: { r: 0.13, g: 0.15, b: 0.2, a: 1 },
      verbs: createRectPath(x, 78, 244, 564),
    });
  }

  add(scene, gradientPath(
    createBlobPath([194, 256], 88, 116),
    {
      kind: "linear-gradient",
      start: [106, 124],
      end: [282, 386],
      stops: [
        { offset: 0, color: { r: 1, g: 0.53, b: 0.24, a: 1 } },
        { offset: 1, color: { r: 0.98, g: 0.13, b: 0.5, a: 1 } },
      ],
    },
  ));

  add(scene, gradientPath(
    createRectPath(112, 408, 164, 138),
    {
      kind: "linear-gradient",
      start: [112, 408],
      end: [276, 546],
      stops: [
        { offset: 0, color: { r: 0.18, g: 0.86, b: 0.76, a: 1 } },
        { offset: 1, color: { r: 0.15, g: 0.39, b: 1, a: 1 } },
      ],
    },
  ));

  add(scene, gradientPath(
    createBlobPath([480, 248], 94, 122),
    {
      kind: "two-point-conical-gradient",
      startCenter: [452, 222],
      startRadius: 12,
      endCenter: [492, 260],
      endRadius: 146,
      stops: [
        { offset: 0, color: { r: 1, g: 0.96, b: 0.7, a: 1 } },
        { offset: 1, color: { r: 0.23, g: 0.56, b: 1, a: 1 } },
      ],
    },
  ));

  add(scene, gradientPath(
    createStarPath([480, 468], 96, 46),
    {
      kind: "radial-gradient",
      center: [480, 468],
      radius: 118,
      stops: [
        { offset: 0, color: { r: 0.96, g: 0.88, b: 0.34, a: 1 } },
        { offset: 1, color: { r: 0.92, g: 0.2, b: 0.38, a: 0.95 } },
      ],
    },
  ));

  add(scene, gradientPath(
    createStarPath([766, 236], 110, 48),
    {
      kind: "sweep-gradient",
      center: [766, 236],
      startAngle: -Math.PI / 2,
      endAngle: Math.PI * 1.5,
      stops: [
        { offset: 0, color: { r: 0.2, g: 1, b: 0.82, a: 1 } },
        { offset: 1, color: { r: 0.42, g: 0.12, b: 0.98, a: 1 } },
      ],
    },
  ));

  add(scene, gradientPath(
    createBlobPath([766, 470], 96, 88),
    {
      kind: "sweep-gradient",
      center: [766, 470],
      startAngle: 0,
      endAngle: Math.PI * 2,
      stops: [
        { offset: 0, color: { r: 1, g: 0.82, b: 0.23, a: 1 } },
        { offset: 1, color: { r: 0.94, g: 0.22, b: 0.46, a: 1 } },
      ],
    },
  ));

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
