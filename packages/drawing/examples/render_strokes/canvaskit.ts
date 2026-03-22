import CanvasKitModule from 'npm:canvaskit-wasm@^0.40.0';
import { createPath2D } from '@rieul3d/geometry';

const outputWidth = 680;
const outputHeight = 940;
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
  arcToOval?: (
    oval: unknown,
    startDegrees: number,
    sweepDegrees: number,
    forceMoveTo: boolean,
  ) => void;
  addArc?: (oval: unknown, startDegrees: number, sweepDegrees: number) => void;
  arcTo?: (oval: unknown, startDegrees: number, sweepDegrees: number, forceMoveTo: boolean) => void;
  delete: () => void;
};

type CanvasKitPaint = {
  setAntiAlias: (enabled: boolean) => void;
  setStyle: (style: unknown) => void;
  setStrokeWidth: (width: number) => void;
  setStrokeJoin: (join: unknown) => void;
  setStrokeCap: (cap: unknown) => void;
  setColor: (color: unknown) => void;
  setPathEffect: (effect: unknown) => void;
};

type CanvasKitCanvas = {
  clear: (color: unknown) => void;
  drawPath: (path: CanvasKitPath, paint: CanvasKitPaint) => void;
};

type CanvasKitPathEffect = {
  delete: () => void;
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
  LTRBRect: (l: number, t: number, r: number, b: number) => unknown;
  Path: new () => CanvasKitPath;
  Paint: new () => CanvasKitPaint;
  MakeSurface: (width: number, height: number) => CanvasKitSurface | null;
  PaintStyle: { Stroke: unknown };
  StrokeJoin: { Bevel: unknown; Round: unknown; Miter: unknown };
  StrokeCap: { Square: unknown; Round: unknown; Butt: unknown };
  PathEffect: {
    MakeDash: (intervals: Float32Array, phase: number) => CanvasKitPathEffect;
  };
};

type CanvasKitFactory = (options?: unknown) => Promise<CanvasKit>;

const CanvasKitInit = CanvasKitModule as unknown as CanvasKitFactory;

const toColor = (
  CanvasKit: CanvasKit,
  color: readonly [number, number, number, number],
) => CanvasKit.Color4f(color[0], color[1], color[2], color[3]);

const radiansToDegrees = (radians: number): number => (radians * 180) / Math.PI;

const normalizeSweep = (
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean | undefined,
): number => {
  const turn = Math.PI * 2;
  let sweep = endAngle - startAngle;
  if (counterClockwise) {
    while (sweep <= 0) {
      sweep += turn;
    }
  } else {
    while (sweep >= 0) {
      sweep -= turn;
    }
  }
  return sweep;
};

const appendArcFallback = (
  skPath: CanvasKitPath,
  center: readonly [number, number],
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean | undefined,
): void => {
  const sweep = normalizeSweep(startAngle, endAngle, counterClockwise);
  const segments = Math.max(8, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 48));
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const theta = startAngle + (sweep * t);
    skPath.lineTo(
      center[0] + (Math.cos(theta) * radius),
      center[1] + (Math.sin(theta) * radius),
    );
  }
};

const appendArc = (
  CanvasKit: CanvasKit,
  skPath: CanvasKitPath,
  center: readonly [number, number],
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean | undefined,
): void => {
  const sweep = normalizeSweep(startAngle, endAngle, counterClockwise);
  const startDegrees = radiansToDegrees(startAngle);
  const sweepDegrees = radiansToDegrees(sweep);
  const oval = CanvasKit.LTRBRect(
    center[0] - radius,
    center[1] - radius,
    center[0] + radius,
    center[1] + radius,
  );

  if (typeof skPath.arcToOval === 'function') {
    skPath.arcToOval(oval, startDegrees, sweepDegrees, false);
    return;
  }
  if (typeof skPath.addArc === 'function') {
    skPath.addArc(oval, startDegrees, sweepDegrees);
    return;
  }
  if (typeof skPath.arcTo === 'function') {
    skPath.arcTo(oval, startDegrees, sweepDegrees, false);
    return;
  }
  appendArcFallback(skPath, center, radius, startAngle, endAngle, counterClockwise);
};

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
      case 'arcTo':
        appendArc(
          CanvasKit,
          skPath,
          verb.center,
          verb.radius,
          verb.startAngle,
          verb.endAngle,
          verb.counterClockwise,
        );
        break;
      case 'close':
        skPath.close();
        break;
      default:
        throw new Error(`Unsupported path verb: ${(verb as { kind: string }).kind}`);
    }
  }
  return skPath;
};

const drawStroke = (
  CanvasKit: CanvasKit,
  canvas: CanvasKitCanvas,
  paint: CanvasKitPaint,
  path: ReturnType<typeof createPath2D>,
  options: Readonly<{
    strokeWidth: number;
    strokeJoin?: 'miter' | 'bevel' | 'round';
    strokeCap?: 'butt' | 'square' | 'round';
    color: readonly [number, number, number, number];
    dashArray?: readonly number[];
    dashOffset?: number;
  }>,
) => {
  paint.setStyle(CanvasKit.PaintStyle.Stroke);
  paint.setStrokeWidth(options.strokeWidth);
  paint.setStrokeJoin(
    options.strokeJoin === 'bevel'
      ? CanvasKit.StrokeJoin.Bevel
      : options.strokeJoin === 'round'
      ? CanvasKit.StrokeJoin.Round
      : CanvasKit.StrokeJoin.Miter,
  );
  paint.setStrokeCap(
    options.strokeCap === 'square'
      ? CanvasKit.StrokeCap.Square
      : options.strokeCap === 'round'
      ? CanvasKit.StrokeCap.Round
      : CanvasKit.StrokeCap.Butt,
  );
  paint.setColor(toColor(CanvasKit, options.color));

  let effect: CanvasKitPathEffect | undefined;
  if (options.dashArray) {
    effect = CanvasKit.PathEffect.MakeDash(
      Float32Array.from(options.dashArray),
      options.dashOffset ?? 0,
    );
    paint.setPathEffect(effect);
  } else {
    paint.setPathEffect(null);
  }

  const skPath = createCanvasKitPath(CanvasKit, path);
  canvas.drawPath(skPath, paint);
  skPath.delete();
  if (effect) {
    effect.delete();
  }
};

export const renderStrokesCanvasKitSnapshot = async (): Promise<
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

  canvas.clear(toColor(CanvasKit, [0.97, 0.95, 0.9, 1]));

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [90, 180] },
      { kind: 'lineTo', to: [160, 80] },
      { kind: 'lineTo', to: [230, 180] },
    ),
    {
      strokeWidth: 28,
      strokeJoin: 'miter',
      strokeCap: 'butt',
      color: [0.88, 0.32, 0.2, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [275, 180] },
      { kind: 'lineTo', to: [345, 80] },
      { kind: 'lineTo', to: [415, 180] },
    ),
    {
      strokeWidth: 28,
      strokeJoin: 'bevel',
      strokeCap: 'butt',
      color: [0.23, 0.59, 0.47, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [460, 180] },
      { kind: 'lineTo', to: [530, 80] },
      { kind: 'lineTo', to: [600, 180] },
    ),
    {
      strokeWidth: 28,
      strokeJoin: 'round',
      strokeCap: 'butt',
      color: [0.16, 0.41, 0.82, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [90, 315] },
      { kind: 'lineTo', to: [210, 315] },
    ),
    {
      strokeWidth: 32,
      strokeJoin: 'round',
      strokeCap: 'butt',
      color: [0.52, 0.21, 0.72, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [260, 315] },
      { kind: 'lineTo', to: [380, 315] },
    ),
    {
      strokeWidth: 32,
      strokeJoin: 'round',
      strokeCap: 'square',
      color: [0.87, 0.54, 0.15, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [430, 315] },
      { kind: 'lineTo', to: [550, 315] },
    ),
    {
      strokeWidth: 32,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.15, 0.58, 0.76, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [88, 430] },
      { kind: 'lineTo', to: [552, 430] },
    ),
    {
      strokeWidth: 14,
      strokeCap: 'round',
      dashArray: [28, 18],
      dashOffset: 6,
      color: [0.62, 0.21, 0.22, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [80, 535] },
      {
        kind: 'cubicTo',
        control1: [180, 395],
        control2: [280, 675],
        to: [380, 535],
      },
      {
        kind: 'cubicTo',
        control1: [450, 445],
        control2: [540, 445],
        to: [600, 535],
      },
    ),
    {
      strokeWidth: 22,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.11, 0.13, 0.18, 1],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [80, 675] },
      { kind: 'quadTo', control: [185, 565], to: [300, 675] },
    ),
    {
      strokeWidth: 18,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.76, 0.18, 0.42, 0.55],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [410, 675] },
      {
        kind: 'arcTo',
        center: [500, 675],
        radius: 90,
        startAngle: Math.PI,
        endAngle: 0,
      },
    ),
    {
      strokeWidth: 18,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.13, 0.45, 0.36, 0.85],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [500, 748] },
      { kind: 'lineTo', to: [542, 878] },
      { kind: 'lineTo', to: [430, 796] },
      { kind: 'lineTo', to: [570, 796] },
      { kind: 'lineTo', to: [458, 878] },
      { kind: 'close' },
    ),
    {
      strokeWidth: 18,
      strokeJoin: 'miter',
      strokeCap: 'butt',
      color: [0.66, 0.22, 0.72, 0.5],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [110, 850] },
      { kind: 'lineTo', to: [300, 760] },
    ),
    {
      strokeWidth: 26,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.18, 0.43, 0.82, 0.45],
    },
  );

  drawStroke(
    CanvasKit,
    canvas,
    paint,
    createPath2D(
      { kind: 'moveTo', to: [110, 760] },
      { kind: 'lineTo', to: [300, 850] },
    ),
    {
      strokeWidth: 26,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.9, 0.36, 0.18, 0.45],
    },
  );

  surface.flush();
  const image = surface.makeImageSnapshot();
  const png = image.encodeToBytes();
  if (!png) {
    throw new Error('CanvasKit PNG encoding failed');
  }
  return {
    png,
  };
};
