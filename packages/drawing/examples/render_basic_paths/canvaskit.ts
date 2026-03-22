import CanvasKitModule from 'npm:canvaskit-wasm';
import { createPath2D, createRect, createRectPath2D, withPath2DFillRule } from '@rieul3d/geometry';

const outputSize = 512;
type CanvasKitFactory = (options?: unknown) => Promise<any>;
type CanvasKit = Awaited<ReturnType<CanvasKitFactory>>;

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
  if (path.fillRule === 'evenodd') {
    skPath.setFillType(CanvasKit.FillType.EvenOdd);
  } else {
    skPath.setFillType(CanvasKit.FillType.Winding);
  }
  return skPath;
};

export const renderBasicPathsCanvasKitSnapshot = async (): Promise<
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

  canvas.clear(toColor(CanvasKit, [0.96, 0.95, 0.91, 1]));

  paint.setStyle(CanvasKit.PaintStyle.Fill);
  paint.setColor(toColor(CanvasKit, [0.14, 0.15, 0.18, 1]));
  canvas.drawPath(
    createCanvasKitPath(CanvasKit, createRectPath2D(createRect(48, 48, 416, 416))),
    paint,
  );

  canvas.save();
  canvas.translate(12, 0);
  paint.setColor(toColor(CanvasKit, [0.88, 0.36, 0.22, 1]));
  canvas.drawPath(
    createCanvasKitPath(
      CanvasKit,
      createPath2D(
        { kind: 'moveTo', to: [84, 384] },
        { kind: 'lineTo', to: [244, 96] },
        { kind: 'lineTo', to: [404, 384] },
        { kind: 'close' },
      ),
    ),
    paint,
  );
  canvas.restore();

  paint.setColor(toColor(CanvasKit, [0.98, 0.81, 0.33, 1]));
  canvas.drawPath(
    createCanvasKitPath(
      CanvasKit,
      createPath2D(
        { kind: 'moveTo', to: [148, 332] },
        { kind: 'cubicTo', control1: [192, 168], control2: [320, 168], to: [364, 332] },
        { kind: 'lineTo', to: [148, 332] },
        { kind: 'close' },
      ),
    ),
    paint,
  );

  paint.setColor(toColor(CanvasKit, [0.18, 0.55, 0.46, 1]));
  canvas.drawPath(
    createCanvasKitPath(
      CanvasKit,
      withPath2DFillRule(
        createPath2D(
          { kind: 'moveTo', to: [72, 72] },
          { kind: 'lineTo', to: [200, 72] },
          { kind: 'lineTo', to: [200, 200] },
          { kind: 'lineTo', to: [72, 200] },
          { kind: 'close' },
          { kind: 'moveTo', to: [104, 104] },
          { kind: 'lineTo', to: [168, 104] },
          { kind: 'lineTo', to: [168, 168] },
          { kind: 'lineTo', to: [104, 168] },
          { kind: 'close' },
        ),
        'evenodd',
      ),
    ),
    paint,
  );

  canvas.save();
  canvas.clipRect(CanvasKit.XYWHRect(280, 280, 140, 140), CanvasKit.ClipOp.Intersect, true);
  canvas.clipPath(
    createCanvasKitPath(
      CanvasKit,
      createPath2D(
        { kind: 'moveTo', to: [292, 292] },
        { kind: 'lineTo', to: [408, 292] },
        { kind: 'lineTo', to: [350, 408] },
        { kind: 'close' },
      ),
    ),
    CanvasKit.ClipOp.Intersect,
    true,
  );
  paint.setStyle(CanvasKit.PaintStyle.Stroke);
  paint.setStrokeWidth(10);
  paint.setStrokeJoin(CanvasKit.StrokeJoin.Round);
  paint.setStrokeCap(CanvasKit.StrokeCap.Square);
  paint.setColor(toColor(CanvasKit, [0.12, 0.38, 0.82, 1]));
  canvas.drawPath(
    createCanvasKitPath(
      CanvasKit,
      createPath2D(
        { kind: 'moveTo', to: [280, 360] },
        { kind: 'cubicTo', control1: [320, 240], control2: [380, 240], to: [420, 360] },
        { kind: 'lineTo', to: [420, 420] },
      ),
    ),
    paint,
  );
  canvas.restore();

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
