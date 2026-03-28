import CanvasKitModule from 'npm:canvaskit-wasm@^0.40.0';
import {
  createPath2d,
  createRect,
  createRectPath2d,
  type Point2d,
} from '@disjukr/goldlight/geometry';

const outputWidth = 960;
const outputHeight = 720;

type CanvasKitPath = {
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  quadTo: (cx: number, cy: number, x: number, y: number) => void;
  cubicTo: (
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ) => void;
  close: () => void;
  setFillType: (fillType: unknown) => void;
  delete: () => void;
};

type CanvasKitShader = {
  delete: () => void;
};

type CanvasKitPaint = {
  setAntiAlias: (enabled: boolean) => void;
  setStyle: (style: unknown) => void;
  setColor: (color: unknown) => void;
  setShader: (shader: CanvasKitShader | null) => void;
  delete: () => void;
};

type CanvasKitCanvas = {
  clear: (color: unknown) => void;
  drawPath: (path: CanvasKitPath, paint: CanvasKitPaint) => void;
};

type CanvasKitSurface = {
  getCanvas: () => CanvasKitCanvas;
  flush: () => void;
  makeImageSnapshot: () => {
    encodeToBytes: () => Uint8Array | null;
  };
};

type CanvasKit = {
  Color4f: (r: number, g: number, b: number, a: number) => unknown;
  Path: new () => CanvasKitPath;
  Paint: new () => CanvasKitPaint;
  MakeSurface: (width: number, height: number) => CanvasKitSurface | null;
  PaintStyle: { Fill: unknown };
  FillType: { EvenOdd: unknown; Winding: unknown };
  TileMode: { Clamp: unknown };
  Shader: {
    MakeLinearGradient: (
      start: Point2d,
      end: Point2d,
      colors: Float32Array,
      positions: number[] | null,
      tileMode: unknown,
    ) => CanvasKitShader;
    MakeRadialGradient: (
      center: Point2d,
      radius: number,
      colors: Float32Array,
      positions: number[] | null,
      tileMode: unknown,
    ) => CanvasKitShader;
    MakeTwoPointConicalGradient: (
      startCenter: Point2d,
      startRadius: number,
      endCenter: Point2d,
      endRadius: number,
      colors: Float32Array,
      positions: number[] | null,
      tileMode: unknown,
    ) => CanvasKitShader;
    MakeSweepGradient: (
      cx: number,
      cy: number,
      colors: Float32Array,
      positions: number[] | null,
      tileMode: unknown,
      localMatrix?: unknown,
      flags?: number,
      startAngle?: number,
      endAngle?: number,
    ) => CanvasKitShader;
  };
};

type CanvasKitFactory = (options?: unknown) => Promise<CanvasKit>;

const CanvasKitInit = CanvasKitModule as unknown as CanvasKitFactory;

const toColor = (
  CanvasKit: CanvasKit,
  color: readonly [number, number, number, number],
) => CanvasKit.Color4f(color[0], color[1], color[2], color[3]);

const toColorArray = (
  colors: readonly (readonly [number, number, number, number])[],
) => new Float32Array(colors.flatMap((color) => color));

const createCanvasKitPath = (
  CanvasKit: CanvasKit,
  path: ReturnType<typeof createPath2d>,
) => {
  const skPath = new CanvasKit.Path();
  for (const verb of path.verbs) {
    switch (verb.kind) {
      case 'moveTo':
        skPath.moveTo(verb.to[0], verb.to[1]);
        break;
      case 'lineTo':
        skPath.lineTo(verb.to[0], verb.to[1]);
        break;
      case 'quadTo':
        skPath.quadTo(verb.control[0], verb.control[1], verb.to[0], verb.to[1]);
        break;
      case 'cubicTo':
        skPath.cubicTo(
          verb.control1[0],
          verb.control1[1],
          verb.control2[0],
          verb.control2[1],
          verb.to[0],
          verb.to[1],
        );
        break;
      case 'close':
        skPath.close();
        break;
      default:
        throw new Error(`Unsupported path verb: ${(verb as { kind: string }).kind}`);
    }
  }
  skPath.setFillType(
    path.fillRule === 'evenodd' ? CanvasKit.FillType.EvenOdd : CanvasKit.FillType.Winding,
  );
  return skPath;
};

const createBlobPath = (
  center: Point2d,
  radiusX: number,
  radiusY: number,
) =>
  createPath2d(
    { kind: 'moveTo', to: [center[0], center[1] - radiusY] },
    {
      kind: 'cubicTo',
      control1: [center[0] + radiusX * 0.7, center[1] - radiusY * 1.05],
      control2: [center[0] + radiusX * 1.1, center[1] - radiusY * 0.1],
      to: [center[0] + radiusX, center[1] + radiusY * 0.06],
    },
    {
      kind: 'cubicTo',
      control1: [center[0] + radiusX * 0.82, center[1] + radiusY * 0.94],
      control2: [center[0] - radiusX * 0.18, center[1] + radiusY * 1.14],
      to: [center[0] - radiusX * 0.16, center[1] + radiusY],
    },
    {
      kind: 'cubicTo',
      control1: [center[0] - radiusX * 0.92, center[1] + radiusY * 0.82],
      control2: [center[0] - radiusX * 1.08, center[1] - radiusY * 0.18],
      to: [center[0], center[1] - radiusY],
    },
    { kind: 'close' },
  );

const createStarPath = (
  center: Point2d,
  outerRadius: number,
  innerRadius: number,
) => {
  const points: Point2d[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (-Math.PI / 2) + (index * Math.PI / 5);
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    points.push([
      center[0] + (Math.cos(angle) * radius),
      center[1] + (Math.sin(angle) * radius),
    ]);
  }

  return createPath2d(
    { kind: 'moveTo', to: points[0]! },
    ...points.slice(1).map((point) => ({ kind: 'lineTo', to: point }) as const),
    { kind: 'close' },
  );
};

export const renderGradientsCanvasKitSnapshot = async (): Promise<
  Readonly<{
    png: Uint8Array;
  }>
> => {
  const CanvasKit = await CanvasKitInit();
  const surface = CanvasKit.MakeSurface(outputWidth, outputHeight);
  if (!surface) {
    throw new Error('CanvasKit surface creation failed');
  }

  const canvas = surface.getCanvas();
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(CanvasKit.PaintStyle.Fill);

  canvas.clear(toColor(CanvasKit, [0.05, 0.07, 0.1, 1]));

  const drawSolid = (
    path: ReturnType<typeof createPath2d>,
    color: readonly [number, number, number, number],
  ) => {
    paint.setShader(null);
    paint.setColor(toColor(CanvasKit, color));
    const skPath = createCanvasKitPath(CanvasKit, path);
    canvas.drawPath(skPath, paint);
    skPath.delete();
  };

  const drawShader = (
    path: ReturnType<typeof createPath2d>,
    shader: CanvasKitShader,
  ) => {
    paint.setColor(toColor(CanvasKit, [0, 0, 0, 1]));
    paint.setShader(shader);
    const skPath = createCanvasKitPath(CanvasKit, path);
    canvas.drawPath(skPath, paint);
    skPath.delete();
    paint.setShader(null);
    shader.delete();
  };

  drawSolid(createRectPath2d(createRect(36, 36, 888, 648)), [0.09, 0.11, 0.15, 1]);
  drawSolid(createRectPath2d(createRect(72, 78, 244, 564)), [0.13, 0.15, 0.2, 1]);
  drawSolid(createRectPath2d(createRect(358, 78, 244, 564)), [0.13, 0.15, 0.2, 1]);
  drawSolid(createRectPath2d(createRect(644, 78, 244, 564)), [0.13, 0.15, 0.2, 1]);

  drawShader(
    createBlobPath([194, 256], 88, 116),
    CanvasKit.Shader.MakeLinearGradient(
      [106, 124],
      [282, 386],
      toColorArray([
        [1, 0.53, 0.24, 1],
        [0.98, 0.13, 0.5, 1],
      ]),
      [0, 1],
      CanvasKit.TileMode.Clamp,
    ),
  );
  drawShader(
    createRectPath2d(createRect(112, 408, 164, 138)),
    CanvasKit.Shader.MakeLinearGradient(
      [112, 408],
      [276, 546],
      toColorArray([
        [0.18, 0.86, 0.76, 1],
        [0.15, 0.39, 1, 1],
      ]),
      [0, 1],
      CanvasKit.TileMode.Clamp,
    ),
  );

  drawShader(
    createBlobPath([480, 248], 94, 122),
    CanvasKit.Shader.MakeTwoPointConicalGradient(
      [452, 222],
      12,
      [492, 260],
      146,
      toColorArray([
        [1, 0.96, 0.7, 1],
        [0.23, 0.56, 1, 1],
      ]),
      [0, 1],
      CanvasKit.TileMode.Clamp,
    ),
  );
  drawShader(
    createStarPath([480, 468], 96, 46),
    CanvasKit.Shader.MakeRadialGradient(
      [480, 468],
      118,
      toColorArray([
        [0.96, 0.88, 0.34, 1],
        [0.92, 0.2, 0.38, 0.95],
      ]),
      [0, 1],
      CanvasKit.TileMode.Clamp,
    ),
  );

  drawShader(
    createStarPath([766, 236], 110, 48),
    CanvasKit.Shader.MakeSweepGradient(
      766,
      236,
      toColorArray([
        [0.2, 1, 0.82, 1],
        [0.42, 0.12, 0.98, 1],
      ]),
      [0, 1],
      CanvasKit.TileMode.Clamp,
      undefined,
      undefined,
      -90,
      270,
    ),
  );
  drawShader(
    createBlobPath([766, 470], 96, 88),
    CanvasKit.Shader.MakeSweepGradient(
      766,
      470,
      toColorArray([
        [1, 0.82, 0.23, 1],
        [0.94, 0.22, 0.46, 1],
      ]),
      [0, 1],
      CanvasKit.TileMode.Clamp,
      undefined,
      undefined,
      0,
      360,
    ),
  );

  surface.flush();
  const png = surface.makeImageSnapshot().encodeToBytes();
  if (!png) {
    throw new Error('CanvasKit snapshot encoding failed');
  }

  paint.delete();
  return { png };
};
