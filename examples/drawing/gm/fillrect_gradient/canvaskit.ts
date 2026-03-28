import CanvasKitModule from 'npm:canvaskit-wasm@^0.40.0';

const cellSize = 50;
const numColumns = 2;
const numRows = 9;
const padSize = 10;
const outputWidth = numColumns * (cellSize + padSize);
const outputHeight = numRows * (cellSize + padSize);

type GradientStop = Readonly<{
  offset: number;
  color: readonly [number, number, number, number];
}>;

type CanvasKitShader = {
  delete: () => void;
};

type CanvasKitPaint = {
  setAntiAlias: (enabled: boolean) => void;
  setStyle: (style: unknown) => void;
  setShader: (shader: CanvasKitShader | null) => void;
  delete: () => void;
};

type CanvasKitCanvas = {
  clear: (color: unknown) => void;
  drawRect: (rect: Float32Array | number[], paint: CanvasKitPaint) => void;
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
  Paint: new () => CanvasKitPaint;
  MakeSurface: (width: number, height: number) => CanvasKitSurface | null;
  PaintStyle: { Fill: unknown };
  TileMode: { Clamp: unknown };
  XYWHRect: (x: number, y: number, width: number, height: number) => Float32Array | number[];
  Shader: {
    MakeLinearGradient: (
      start: readonly [number, number],
      end: readonly [number, number],
      colors: Float32Array,
      positions: number[] | null,
      tileMode: unknown,
    ) => CanvasKitShader;
    MakeRadialGradient: (
      center: readonly [number, number],
      radius: number,
      colors: Float32Array,
      positions: number[] | null,
      tileMode: unknown,
    ) => CanvasKitShader;
  };
};

type CanvasKitFactory = (options?: unknown) => Promise<CanvasKit>;

const CanvasKitInit = CanvasKitModule as unknown as CanvasKitFactory;

const green: readonly [number, number, number, number] = [0, 1, 0, 1];
const white: readonly [number, number, number, number] = [1, 1, 1, 1];
const red: readonly [number, number, number, number] = [1, 0, 0, 1];
const blue: readonly [number, number, number, number] = [0, 0, 1, 1];
const yellow: readonly [number, number, number, number] = [1, 1, 0, 1];
const gray: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 1];
const cyan: readonly [number, number, number, number] = [0, 1, 1, 1];

const gradientCases: readonly (readonly GradientStop[])[] = [
  Object.freeze([
    { offset: 0, color: green },
    { offset: 1, color: white },
  ]),
  Object.freeze([
    { offset: 0, color: green },
    { offset: 0.5, color: white },
    { offset: 1, color: red },
  ]),
  Object.freeze([
    { offset: 0.4, color: green },
    { offset: 0.5, color: white },
    { offset: 0.6, color: red },
  ]),
  Object.freeze([{ offset: 0, color: red }]),
  Object.freeze([{ offset: 1, color: red }]),
  Object.freeze([{ offset: 0.5, color: red }]),
  Object.freeze([
    { offset: 0, color: blue },
    { offset: 0.5, color: white },
    { offset: 0.5, color: red },
    { offset: 1, color: yellow },
  ]),
  Object.freeze([
    { offset: 0, color: blue },
    { offset: 0.5, color: white },
    { offset: 0.5, color: gray },
    { offset: 0.5, color: cyan },
    { offset: 0.5, color: red },
    { offset: 1, color: yellow },
  ]),
  Object.freeze([
    { offset: 0.5, color: white },
    { offset: 0.5, color: gray },
    { offset: 1, color: yellow },
    { offset: 0.5, color: cyan },
    { offset: 0.5, color: red },
    { offset: 0, color: blue },
  ]),
];

const toColor = (
  CanvasKit: CanvasKit,
  color: readonly [number, number, number, number],
) => CanvasKit.Color4f(color[0], color[1], color[2], color[3]);

const toColorArray = (
  colors: readonly (readonly [number, number, number, number])[],
) => new Float32Array(colors.flatMap((color) => color));

export const renderFillrectGradientCanvasKitSnapshot = async (): Promise<
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
  canvas.clear(toColor(CanvasKit, [1, 1, 1, 1]));

  for (let row = 0; row < gradientCases.length; row += 1) {
    const y = row * (cellSize + padSize);
    const stops = gradientCases[row]!;
    const colors = toColorArray(stops.map((stop) => stop.color));
    const positions = stops.map((stop) => stop.offset);

    let shader = CanvasKit.Shader.MakeLinearGradient(
      [cellSize, y],
      [cellSize, y + cellSize],
      colors,
      positions,
      CanvasKit.TileMode.Clamp,
    );
    paint.setShader(shader);
    canvas.drawRect(CanvasKit.XYWHRect(0, y, cellSize, cellSize), paint);
    shader.delete();

    shader = CanvasKit.Shader.MakeRadialGradient(
      [cellSize + padSize + (cellSize / 2), y + (cellSize / 2)],
      cellSize / 2,
      colors,
      positions,
      CanvasKit.TileMode.Clamp,
    );
    paint.setShader(shader);
    canvas.drawRect(
      CanvasKit.XYWHRect(cellSize + padSize, y, cellSize, cellSize),
      paint,
    );
    shader.delete();
  }

  paint.setShader(null);
  surface.flush();
  const png = surface.makeImageSnapshot().encodeToBytes();
  if (!png) {
    throw new Error('CanvasKit snapshot encoding failed');
  }

  paint.delete();
  return { png };
};
