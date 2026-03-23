import CanvasKitModule from 'npm:canvaskit-wasm@^0.40.0';
import { createPath2D, createRect, createRectPath2D, type Point2D } from '@rieul3d/geometry';

const outputWidth = 720;
const outputHeight = 980;

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

type CanvasKitPaint = {
  setAntiAlias: (enabled: boolean) => void;
  setStyle: (style: unknown) => void;
  setColor: (color: unknown) => void;
};

type CanvasKitCanvas = {
  clear: (color: unknown) => void;
  drawPath: (path: CanvasKitPath, paint: CanvasKitPaint) => void;
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  clipRect: (rect: unknown, clipOp: unknown, aa: boolean) => void;
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
  ClipOp: { Intersect: unknown };
  XYWHRect: (x: number, y: number, width: number, height: number) => unknown;
};

type CanvasKitFactory = (options?: unknown) => Promise<CanvasKit>;

const CanvasKitInit = CanvasKitModule as unknown as CanvasKitFactory;

const toColor = (
  CanvasKit: CanvasKit,
  color: readonly [number, number, number, number],
) => CanvasKit.Color4f(color[0], color[1], color[2], color[3]);

const createCanvasKitPath = (
  CanvasKit: CanvasKit,
  path: ReturnType<typeof createPath2D>,
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
  skPath.setFillType(path.fillRule === 'evenodd' ? CanvasKit.FillType.EvenOdd : CanvasKit.FillType.Winding);
  return skPath;
};

const createRoundedDiamondPath = (
  center: Point2D,
  radiusX: number,
  radiusY: number,
) => createPath2D(
  { kind: 'moveTo', to: [center[0], center[1] - radiusY] },
  {
    kind: 'quadTo',
    control: [center[0] + radiusX, center[1] - radiusY * 0.2],
    to: [center[0] + radiusX, center[1]],
  },
  {
    kind: 'quadTo',
    control: [center[0] + radiusX * 0.2, center[1] + radiusY],
    to: [center[0], center[1] + radiusY],
  },
  {
    kind: 'quadTo',
    control: [center[0] - radiusX, center[1] + radiusY * 0.2],
    to: [center[0] - radiusX, center[1]],
  },
  {
    kind: 'quadTo',
    control: [center[0] - radiusX * 0.2, center[1] - radiusY],
    to: [center[0], center[1] - radiusY],
  },
  { kind: 'close' },
);

const createKitePath = (
  center: Point2D,
  width: number,
  height: number,
) => {
  const left = center[0] - width / 2;
  const right = center[0] + width / 2;
  const top = center[1] - height / 2;
  const bottom = center[1] + height / 2;
  return createPath2D(
    { kind: 'moveTo', to: [center[0], top] },
    { kind: 'lineTo', to: [right, center[1] - height * 0.12] },
    { kind: 'lineTo', to: [center[0] + width * 0.18, bottom] },
    { kind: 'lineTo', to: [left, center[1] + height * 0.08] },
    { kind: 'close' },
  );
};

const createTrianglePath = (
  a: Point2D,
  b: Point2D,
  c: Point2D,
) => createPath2D(
  { kind: 'moveTo', to: a },
  { kind: 'lineTo', to: b },
  { kind: 'lineTo', to: c },
  { kind: 'close' },
);

export const renderFillsCanvasKitSnapshot = async (): Promise<
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

  canvas.clear(toColor(CanvasKit, [0.97, 0.95, 0.9, 1]));

  const drawFill = (
    path: ReturnType<typeof createPath2D>,
    color: readonly [number, number, number, number],
  ) => {
    paint.setColor(toColor(CanvasKit, color));
    const skPath = createCanvasKitPath(CanvasKit, path);
    canvas.drawPath(skPath, paint);
    skPath.delete();
  };

  drawFill(createRectPath2D(createRect(44, 44, 632, 892)), [0.14, 0.15, 0.18, 1]);
  drawFill(createTrianglePath([92, 226], [182, 88], [274, 226]), [0.91, 0.37, 0.23, 1]);
  drawFill(createKitePath([370, 156], 186, 134), [0.98, 0.8, 0.33, 1]);
  drawFill(createRoundedDiamondPath([558, 160], 88, 72), [0.22, 0.58, 0.47, 1]);

  drawFill(createRectPath2D(createRect(84, 304, 170, 152)), [0.19, 0.54, 0.79, 0.94]);
  canvas.save();
  canvas.translate(58, 326);
  drawFill(createTrianglePath([0, 0], [88, 0], [0, 118]), [0.78, 0.46, 0.82, 0.72]);
  canvas.restore();
  drawFill(createKitePath([528, 382], 120, 142), [0.9, 0.59, 0.18, 1]);

  drawFill(createTrianglePath([94, 714], [152, 614], [212, 714]), [0.95, 0.46, 0.28, 0.54]);
  drawFill(createTrianglePath([152, 736], [278, 606], [322, 742]), [0.2, 0.47, 0.9, 0.42]);
  drawFill(createRoundedDiamondPath([252, 690], 104, 114), [0.13, 0.65, 0.52, 0.4]);

  canvas.save();
  canvas.translate(370, 556);
  drawFill(createRectPath2D(createRect(0, 0, 210, 220)), [0.16, 0.18, 0.24, 0.96]);
  canvas.restore();

  canvas.save();
  canvas.translate(388, 576);
  drawFill(createRoundedDiamondPath([80, 92], 68, 88), [0.96, 0.82, 0.35, 0.95]);
  drawFill(createTrianglePath([48, 170], [124, 34], [166, 170]), [0.28, 0.63, 0.55, 0.72]);
  canvas.restore();

  drawFill(createPath2D(
    { kind: 'moveTo', to: [88, 850] },
    { kind: 'lineTo', to: [282, 850] },
    { kind: 'lineTo', to: [282, 890] },
    {
      kind: 'cubicTo',
      control1: [248, 926],
      control2: [122, 926],
      to: [88, 890],
    },
    { kind: 'close' },
  ), [0.86, 0.34, 0.43, 1]);

  surface.flush();
  const png = surface.makeImageSnapshot().encodeToBytes();
  if (!png) {
    throw new Error('CanvasKit snapshot encoding failed');
  }
  return { png };
};
