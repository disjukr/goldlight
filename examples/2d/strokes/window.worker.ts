import { Path2d, Scene2d, setWindowScene } from "goldlight";

type StrokeJoin = "miter" | "bevel" | "round";
type StrokeCap = "butt" | "square" | "round";
type Color = { r: number; g: number; b: number; a: number };
type PathVerbs = NonNullable<ConstructorParameters<typeof Path2d>[0]>["verbs"];

function addStroke(
  scene: Scene2d,
  verbs: PathVerbs,
  options: {
    strokeWidth: number;
    strokeJoin?: StrokeJoin;
    strokeCap?: StrokeCap;
    color: Color;
    dashArray?: number[];
    dashOffset?: number;
  },
) {
  scene.add(new Path2d({
    style: "stroke",
    verbs,
    strokeWidth: options.strokeWidth,
    strokeJoin: options.strokeJoin ?? "round",
    strokeCap: options.strokeCap ?? "butt",
    color: options.color,
    dashArray: options.dashArray,
    dashOffset: options.dashOffset,
  }));
}

function mount() {
  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.97, g: 0.95, b: 0.9, a: 1 },
  }));

  addStroke(scene, [
    { kind: "moveTo", to: [90, 180] },
    { kind: "lineTo", to: [160, 80] },
    { kind: "lineTo", to: [230, 180] },
  ], {
    strokeWidth: 28,
    strokeJoin: "miter",
    strokeCap: "butt",
    color: { r: 0.88, g: 0.32, b: 0.2, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [275, 180] },
    { kind: "lineTo", to: [345, 80] },
    { kind: "lineTo", to: [415, 180] },
  ], {
    strokeWidth: 28,
    strokeJoin: "bevel",
    strokeCap: "butt",
    color: { r: 0.23, g: 0.59, b: 0.47, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [460, 180] },
    { kind: "lineTo", to: [530, 80] },
    { kind: "lineTo", to: [600, 180] },
  ], {
    strokeWidth: 28,
    strokeJoin: "round",
    strokeCap: "butt",
    color: { r: 0.16, g: 0.41, b: 0.82, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [90, 315] },
    { kind: "lineTo", to: [210, 315] },
  ], {
    strokeWidth: 32,
    strokeJoin: "round",
    strokeCap: "butt",
    color: { r: 0.52, g: 0.21, b: 0.72, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [260, 315] },
    { kind: "lineTo", to: [380, 315] },
  ], {
    strokeWidth: 32,
    strokeJoin: "round",
    strokeCap: "square",
    color: { r: 0.87, g: 0.54, b: 0.15, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [430, 315] },
    { kind: "lineTo", to: [550, 315] },
  ], {
    strokeWidth: 32,
    strokeJoin: "round",
    strokeCap: "round",
    color: { r: 0.15, g: 0.58, b: 0.76, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [88, 430] },
    { kind: "lineTo", to: [552, 430] },
  ], {
    strokeWidth: 14,
    strokeCap: "round",
    dashArray: [28, 18],
    dashOffset: 6,
    color: { r: 0.62, g: 0.21, b: 0.22, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [80, 535] },
    {
      kind: "cubicTo",
      control1: [180, 395],
      control2: [280, 675],
      to: [380, 535],
    },
    {
      kind: "cubicTo",
      control1: [450, 445],
      control2: [540, 445],
      to: [600, 535],
    },
  ], {
    strokeWidth: 22,
    strokeJoin: "round",
    strokeCap: "round",
    color: { r: 0.11, g: 0.13, b: 0.18, a: 1 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [80, 675] },
    { kind: "quadTo", control: [185, 565], to: [300, 675] },
  ], {
    strokeWidth: 18,
    strokeJoin: "round",
    strokeCap: "round",
    color: { r: 0.76, g: 0.18, b: 0.42, a: 0.55 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [410, 675] },
    {
      kind: "arcTo",
      center: [500, 675],
      radius: 90,
      startAngle: Math.PI,
      endAngle: 0,
    },
  ], {
    strokeWidth: 18,
    strokeJoin: "round",
    strokeCap: "round",
    color: { r: 0.13, g: 0.45, b: 0.36, a: 0.85 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [500, 748] },
    { kind: "lineTo", to: [542, 878] },
    { kind: "lineTo", to: [430, 796] },
    { kind: "lineTo", to: [570, 796] },
    { kind: "lineTo", to: [458, 878] },
    { kind: "close" },
  ], {
    strokeWidth: 18,
    strokeJoin: "miter",
    strokeCap: "butt",
    color: { r: 0.66, g: 0.22, b: 0.72, a: 0.5 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [110, 850] },
    { kind: "lineTo", to: [300, 760] },
  ], {
    strokeWidth: 26,
    strokeJoin: "round",
    strokeCap: "round",
    color: { r: 0.18, g: 0.43, b: 0.82, a: 0.45 },
  });

  addStroke(scene, [
    { kind: "moveTo", to: [110, 760] },
    { kind: "lineTo", to: [300, 850] },
  ], {
    strokeWidth: 26,
    strokeJoin: "round",
    strokeCap: "round",
    color: { r: 0.9, g: 0.36, b: 0.18, a: 0.45 },
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
