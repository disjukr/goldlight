import { dirname, fromFileUrl, join } from '@std/path';
import { createRect } from '@rieul3d/geometry';
import { createDrawingPath2DFromShape } from '@rieul3d/drawing';
import { exportPngRgba } from '@rieul3d/exporters';

const exampleDir = dirname(fromFileUrl(import.meta.url));
const inputPath = join(exampleDir, 'tiger.svg');
const outputPath = join(exampleDir, 'tiger.png');

const width = 512;
const height = 512;
const bytes = new Uint8Array(width * height * 4);

const setPixel = (
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void => {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }

  const index = (y * width + x) * 4;
  bytes[index] = r;
  bytes[index + 1] = g;
  bytes[index + 2] = b;
  bytes[index + 3] = a;
};

const fillRect = (
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  r: number,
  g: number,
  b: number,
): void => {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      setPixel(column, row, r, g, b);
    }
  }
};

const drawLine = (
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  r: number,
  g: number,
  b: number,
): void => {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  if (steps === 0) {
    setPixel(fromX, fromY, r, g, b);
    return;
  }

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    setPixel(
      Math.round(fromX + (deltaX * t)),
      Math.round(fromY + (deltaY * t)),
      r,
      g,
      b,
    );
  }
};

const strokeRectPath = (
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  r: number,
  g: number,
  b: number,
): void => {
  const path = createDrawingPath2DFromShape({
    kind: 'rect',
    rect: createRect(x, y, rectWidth, rectHeight),
  });

  let firstPoint: readonly [number, number] | null = null;
  let currentPoint: readonly [number, number] | null = null;

  for (const verb of path.verbs) {
    if (verb.kind === 'moveTo') {
      firstPoint = verb.to;
      currentPoint = verb.to;
      continue;
    }

    if (verb.kind === 'lineTo' && currentPoint !== null) {
      drawLine(currentPoint[0], currentPoint[1], verb.to[0], verb.to[1], r, g, b);
      currentPoint = verb.to;
      continue;
    }

    if (verb.kind === 'close' && currentPoint !== null && firstPoint !== null) {
      drawLine(currentPoint[0], currentPoint[1], firstPoint[0], firstPoint[1], r, g, b);
    }
  }
};

const drawFrame = (): void => {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(x, y, 250, 246, 238);
    }
  }

  fillRect(32, 32, width - 64, height - 64, 255, 255, 255);
  fillRect(48, 48, width - 96, 16, 229, 146, 63);
  fillRect(48, 80, width - 96, 8, 37, 30, 24);
  fillRect(48, 424, width - 96, 40, 37, 30, 24);
  strokeRectPath(32, 32, width - 64, height - 64, 37, 30, 24);
  strokeRectPath(48, 48, width - 96, 416, 126, 114, 103);

  for (let x = 72; x < width - 72; x += 1) {
    const diagonalY = 120 + Math.floor((x - 72) * 0.7);
    setPixel(x, diagonalY, 229, 146, 63);
    setPixel(x, height - diagonalY, 229, 146, 63);
  }

  for (let y = 112; y < 400; y += 1) {
    setPixel(96, y, 37, 30, 24);
    setPixel(width - 97, y, 37, 30, 24);
  }
};

drawFrame();

const svg = await Deno.readTextFile(inputPath);
const pathCount = (svg.match(/<path\b/g) ?? []).length;
const groupCount = (svg.match(/<g\b/g) ?? []).length;
const transformCount = (svg.match(/\stransform=/g) ?? []).length;

const pngBytes = exportPngRgba({
  width,
  height,
  bytes,
});

await Deno.writeFile(outputPath, pngBytes);

console.log(`Wrote ${outputPath}`);
console.log(
  [
    'This example uses local drawing geometry plus @rieul3d/exporters only.',
    `Tiger SVG inventory: ${pathCount} paths, ${groupCount} groups, ${transformCount} transforms.`,
    'Actual tiger rasterization is not implemented yet because drawing still lacks SVG parsing and path rendering.',
  ].join('\n'),
);
