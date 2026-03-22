import CanvasKitModule from 'npm:canvaskit-wasm';
import { createPath2D } from '@rieul3d/geometry';

const outputSize = 840;
type CanvasKitFactory = (options?: unknown) => Promise<any>;
type CanvasKit = Awaited<ReturnType<CanvasKitFactory>>;

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
  skPath: any,
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
  skPath: any,
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
  canvas: any,
  paint: any,
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

  let effect: any | undefined;
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
  const surface = CanvasKit.MakeSurface(outputSize, outputSize);
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
      { kind: 'moveTo', to: [90, 360] },
      { kind: 'lineTo', to: [210, 360] },
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
      { kind: 'moveTo', to: [260, 360] },
      { kind: 'lineTo', to: [380, 360] },
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
      { kind: 'moveTo', to: [430, 360] },
      { kind: 'lineTo', to: [550, 360] },
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
      { kind: 'moveTo', to: [88, 470] },
      { kind: 'lineTo', to: [552, 470] },
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
      { kind: 'moveTo', to: [80, 580] },
      {
        kind: 'cubicTo',
        control1: [180, 440],
        control2: [280, 720],
        to: [380, 580],
      },
      {
        kind: 'cubicTo',
        control1: [450, 490],
        control2: [540, 490],
        to: [600, 580],
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
      { kind: 'moveTo', to: [80, 730] },
      { kind: 'quadTo', control: [185, 620], to: [300, 730] },
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
      { kind: 'moveTo', to: [410, 730] },
      {
        kind: 'arcTo',
        center: [500, 730],
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
