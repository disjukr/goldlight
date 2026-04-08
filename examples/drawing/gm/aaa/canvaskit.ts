import CanvasKitModule from 'canvaskit-wasm';

const gmWidth = 800;
const gmHeight = 800;
const outputWidth = gmWidth;
const outputHeight = gmHeight * 3;

type CanvasKitPath = {
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  cubicTo: (
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ) => void;
  close: () => void;
  addRect: (rect: unknown) => void;
  setFillType: (fillType: unknown) => void;
};

type CanvasKitPaint = {
  setAntiAlias: (enabled: boolean) => void;
  setStyle: (style: unknown) => void;
  setColor: (color: unknown) => void;
  setStrokeWidth: (width: number) => void;
};

type CanvasKitCanvas = {
  clear: (color: unknown) => void;
  drawPath: (path: CanvasKitPath, paint: CanvasKitPaint) => void;
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  rotate: (degrees: number, px?: number, py?: number) => void;
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
  PaintStyle: { Fill: unknown; Stroke: unknown };
  FillType: { EvenOdd: unknown; Winding: unknown };
  XYWHRect: (x: number, y: number, width: number, height: number) => unknown;
};

type CanvasKitFactory = (options?: unknown) => Promise<CanvasKit>;

const CanvasKitInit = CanvasKitModule as unknown as CanvasKitFactory;
type Point = readonly [number, number];
type Matrix2d = readonly [number, number, number, number, number, number];

const createRotationMatrix2d = (degrees: number): Matrix2d => {
  const radians = degrees * (Math.PI / 180);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, s, -s, c, 0, 0];
};

const transformPoint = (matrix: Matrix2d, point: Point): Point => [
  (matrix[0] * point[0]) + (matrix[2] * point[1]) + matrix[4],
  (matrix[1] * point[0]) + (matrix[3] * point[1]) + matrix[5],
];

const addPolygon = (path: CanvasKitPath, points: readonly Point[]): void => {
  path.moveTo(points[0]![0], points[0]![1]);
  for (const point of points.slice(1)) {
    path.lineTo(point[0], point[1]);
  }
  path.close();
};

const addCirclePolygon = (
  path: CanvasKitPath,
  center: Point,
  radius: number,
  segments = 256,
): void => {
  const points: Point[] = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    points.push([
      center[0] + (Math.cos(theta) * radius),
      center[1] + (Math.sin(theta) * radius),
    ]);
  }
  addPolygon(path, points);
};

const toColor = (
  CanvasKit: CanvasKit,
  color: readonly [number, number, number, number],
) => CanvasKit.Color4f(color[0], color[1], color[2], color[3]);

export const renderAaaCanvasKitSnapshot = async (): Promise<Readonly<{ png: Uint8Array }>> => {
  const CanvasKit = await CanvasKitInit();
  const surface = CanvasKit.MakeSurface(outputWidth, outputHeight);
  if (!surface) {
    throw new Error('CanvasKit surface creation failed');
  }

  const canvas = surface.getCanvas();
  const fillPaint = new CanvasKit.Paint();
  fillPaint.setAntiAlias(true);
  fillPaint.setStyle(CanvasKit.PaintStyle.Fill);
  fillPaint.setColor(toColor(CanvasKit, [1, 0, 0, 1]));

  const strokePaint = new CanvasKit.Paint();
  strokePaint.setAntiAlias(true);
  strokePaint.setStyle(CanvasKit.PaintStyle.Stroke);
  strokePaint.setStrokeWidth(5);
  strokePaint.setColor(toColor(CanvasKit, [1, 0, 0, 1]));

  canvas.clear(toColor(CanvasKit, [1, 1, 1, 1]));
  const rotation = createRotationMatrix2d(1);

  let path = new CanvasKit.Path();
  addPolygon(path, [
    transformPoint(rotation, [20, 20]),
    transformPoint(rotation, [200, 20]),
    transformPoint(rotation, [200, 200]),
    transformPoint(rotation, [20, 200]),
  ]);
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  addPolygon(path, [
    transformPoint(rotation, [20, 220]),
    transformPoint(rotation, [20.2, 220]),
    transformPoint(rotation, [20.2, 400]),
    transformPoint(rotation, [20, 400]),
  ]);
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  addPolygon(path, [
    transformPoint(rotation, [20, 400]),
    transformPoint(rotation, [200, 400]),
    transformPoint(rotation, [200, 400.1]),
    transformPoint(rotation, [20, 400.1]),
  ]);
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  addCirclePolygon(path, transformPoint(rotation, [100, 300]), 30);
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  path.moveTo(77.8073, 231.626);
  path.cubicTo(77.8075, 231.626, 77.8074, 231.625, 77.8073, 231.625);
  path.lineTo(77.8073, 231.626);
  path.close();
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  addPolygon(path, [
    [1.98009784, 409.0162744],
    [47.843992, 410.1922744],
    [47.804008, 411.7597256],
    [1.93990216, 410.5837256],
  ]);
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  path.addRect(CanvasKit.XYWHRect(700, 266, 10, 268));
  canvas.drawPath(path, fillPaint);

  const points: Point[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = 2.6927937 * index;
    points.push([
      128 + (115.2 * Math.cos(angle)),
      128 + (115.2 * Math.sin(angle)),
    ]);
  }
  path = new CanvasKit.Path();
  addPolygon(path, points.map((point) => [point[0], point[1] + gmHeight]));
  canvas.save();
  canvas.rotate(1, 0, 0);
  canvas.drawPath(path, fillPaint);
  canvas.restore();

  path = new CanvasKit.Path();
  addPolygon(path, points.map((point) => [point[0], point[1] + gmHeight]));
  canvas.save();
  canvas.translate(200, 0);
  canvas.rotate(1, 0, 0);
  canvas.drawPath(path, strokePaint);
  canvas.restore();

  path = new CanvasKit.Path();
  path.addRect(CanvasKit.XYWHRect(20, gmHeight + 320, 80.4999, 80));
  path.addRect(CanvasKit.XYWHRect(100.5001, gmHeight + 320, 99.4999, 80));
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  path.addRect(CanvasKit.XYWHRect(320, gmHeight + 320, 80.1, 80));
  path.addRect(CanvasKit.XYWHRect(400.9, gmHeight + 320, 99.1, 80));
  canvas.drawPath(path, fillPaint);

  path = new CanvasKit.Path();
  path.setFillType(CanvasKit.FillType.EvenOdd);
  path.addRect(CanvasKit.XYWHRect(0, gmHeight * 2, gmWidth, gmHeight));
  addCirclePolygon(path, [100, (gmHeight * 2) + 100], 30);
  canvas.drawPath(path, fillPaint);

  surface.flush();
  const png = surface.makeImageSnapshot().encodeToBytes();
  if (!png) {
    throw new Error('CanvasKit snapshot encoding failed');
  }
  return { png };
};

