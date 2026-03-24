import { dirname, fromFileUrl, join } from '@std/path';
import { exportPngRgba } from '@goldlight/exporters';
import {
  checkForFinishedDawnQueueWork,
  concatDrawingRecorderTransform,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  submitToDawnQueueManager,
} from '@goldlight/drawing';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import {
  createPath2D,
  identityMatrix2D,
  multiplyMatrix2D,
  withPath2DFillRule,
} from '@goldlight/geometry';
import type { Matrix2D, Path2D, PathVerb2D } from '@goldlight/geometry';

type SvgPaint = readonly [number, number, number, number] | null;

type SvgStyleState = Readonly<{
  fill: SvgPaint;
  stroke: SvgPaint;
  strokeWidth: number;
  fillRule: 'nonzero' | 'evenodd';
  transform: Matrix2D;
}>;

type SvgPathDraw = Readonly<{
  path: Path2D;
  fill: SvgPaint;
  stroke: SvgPaint;
  strokeWidth: number;
  transform: Matrix2D;
}>;

type SvgScene = Readonly<{
  viewBox: Readonly<{ minX: number; minY: number; width: number; height: number }>;
  draws: readonly SvgPathDraw[];
}>;

const exampleDir = dirname(fromFileUrl(import.meta.url));
const inputPath = join(exampleDir, 'tiger.svg');
const defaultBackground = [0, 0, 0, 0] as const;
const defaultFill = [0, 0, 0, 1] as const;
const defaultStyleState: SvgStyleState = {
  fill: defaultFill,
  stroke: null,
  strokeWidth: 1,
  fillRule: 'nonzero',
  transform: identityMatrix2D,
};

const parseNumberList = (value: string): number[] =>
  [...value.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map((match) =>
    Number(match[0])
  );

const parseColor = (value: string | undefined): SvgPaint | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized === '' || normalized === 'currentColor') {
    return undefined;
  }
  if (normalized === 'none') {
    return null;
  }
  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    if (hex.length === 3) {
      return [
        Number.parseInt(hex[0]! + hex[0]!, 16) / 255,
        Number.parseInt(hex[1]! + hex[1]!, 16) / 255,
        Number.parseInt(hex[2]! + hex[2]!, 16) / 255,
        1,
      ];
    }
    if (hex.length === 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255,
        1,
      ];
    }
  }
  throw new Error(`Unsupported SVG color: ${value}`);
};

const parseStyleAttribute = (value: string | undefined): Record<string, string> => {
  if (!value) {
    return {};
  }
  const entries: Record<string, string> = {};
  for (const declaration of value.split(';')) {
    const trimmed = declaration.trim();
    if (!trimmed) {
      continue;
    }
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    entries[trimmed.slice(0, colonIndex).trim()] = trimmed.slice(colonIndex + 1).trim();
  }
  return entries;
};

const parseAttributes = (raw: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
};

const parseTransform = (value: string | undefined): Matrix2D => {
  if (!value) {
    return identityMatrix2D;
  }
  const operations = [...value.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)];
  let transform = identityMatrix2D;
  for (const [, name, rawArgs] of operations) {
    const args = parseNumberList(rawArgs);
    let next = identityMatrix2D;
    if (name === 'matrix') {
      if (args.length !== 6) {
        throw new Error(`Invalid matrix transform: ${value}`);
      }
      next = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!];
    } else if (name === 'translate') {
      next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    } else if (name === 'scale') {
      next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    } else {
      throw new Error(`Unsupported transform operation: ${name}`);
    }
    transform = multiplyMatrix2D(transform, next);
  }
  return transform;
};

const applyAttributesToStyle = (
  parent: SvgStyleState,
  attributes: Record<string, string>,
): SvgStyleState => {
  const styleAttributes = parseStyleAttribute(attributes.style);
  const fillValue = styleAttributes.fill ?? attributes.fill;
  const strokeValue = styleAttributes.stroke ?? attributes.stroke;
  const strokeWidthValue = styleAttributes['stroke-width'] ?? attributes['stroke-width'];
  const fillRuleValue = styleAttributes['fill-rule'] ?? attributes['fill-rule'];
  const fill = parseColor(fillValue);
  const stroke = parseColor(strokeValue);
  const strokeWidth = strokeWidthValue !== undefined ? Number(strokeWidthValue) : undefined;
  const fillRule = fillRuleValue === 'evenodd'
    ? 'evenodd'
    : fillRuleValue === 'nonzero'
    ? 'nonzero'
    : undefined;
  return {
    fill: fill === undefined ? parent.fill : fill,
    stroke: stroke === undefined ? parent.stroke : stroke,
    strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth! : parent.strokeWidth,
    fillRule: fillRule ?? parent.fillRule,
    transform: multiplyMatrix2D(parent.transform, parseTransform(attributes.transform)),
  };
};

const tokenizePathData = (data: string): string[] =>
  data.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];

const isCommandToken = (token: string | undefined): token is string =>
  token !== undefined && /^[A-Za-z]$/.test(token);

const parsePathData = (data: string): Path2D => {
  const tokens = tokenizePathData(data);
  const verbs: PathVerb2D[] = [];
  let index = 0;
  let current: readonly [number, number] = [0, 0];
  let subpathStart: readonly [number, number] = [0, 0];
  let command = '';
  let previousCubicControl: readonly [number, number] | null = null;

  const requireNumber = (): number => {
    const token = tokens[index++];
    if (!token || isCommandToken(token)) {
      throw new Error(`Expected number in SVG path data: ${data}`);
    }
    return Number(token);
  };

  const readPoint = (relative: boolean): readonly [number, number] => {
    const x = requireNumber();
    const y = requireNumber();
    return relative ? [current[0] + x, current[1] + y] : [x, y];
  };

  while (index < tokens.length) {
    if (isCommandToken(tokens[index])) {
      command = tokens[index++]!;
    } else if (!command) {
      throw new Error(`SVG path data is missing an initial command: ${data}`);
    }

    const relative = command === command.toLowerCase();
    switch (command.toLowerCase()) {
      case 'm': {
        const firstPoint = readPoint(relative);
        verbs.push({ kind: 'moveTo', to: firstPoint });
        current = firstPoint;
        subpathStart = firstPoint;
        previousCubicControl = null;
        command = relative ? 'l' : 'L';
        while (index < tokens.length && !isCommandToken(tokens[index])) {
          const point = readPoint(relative);
          verbs.push({ kind: 'lineTo', to: point });
          current = point;
        }
        break;
      }
      case 'l': {
        while (index < tokens.length && !isCommandToken(tokens[index])) {
          const point = readPoint(relative);
          verbs.push({ kind: 'lineTo', to: point });
          current = point;
        }
        previousCubicControl = null;
        break;
      }
      case 'h': {
        while (index < tokens.length && !isCommandToken(tokens[index])) {
          const value = requireNumber();
          current = relative ? [current[0] + value, current[1]] : [value, current[1]];
          verbs.push({ kind: 'lineTo', to: current });
        }
        previousCubicControl = null;
        break;
      }
      case 'v': {
        while (index < tokens.length && !isCommandToken(tokens[index])) {
          const value = requireNumber();
          current = relative ? [current[0], current[1] + value] : [current[0], value];
          verbs.push({ kind: 'lineTo', to: current });
        }
        previousCubicControl = null;
        break;
      }
      case 'c': {
        while (index < tokens.length && !isCommandToken(tokens[index])) {
          const control1 = readPoint(relative);
          const control2 = readPoint(relative);
          const point = readPoint(relative);
          verbs.push({ kind: 'cubicTo', control1, control2, to: point });
          current = point;
          previousCubicControl = control2;
        }
        break;
      }
      case 's': {
        while (index < tokens.length && !isCommandToken(tokens[index])) {
          const control1: readonly [number, number] = previousCubicControl
            ? [current[0] * 2 - previousCubicControl[0], current[1] * 2 - previousCubicControl[1]]
            : current;
          const control2 = readPoint(relative);
          const point = readPoint(relative);
          verbs.push({ kind: 'cubicTo', control1, control2, to: point });
          current = point;
          previousCubicControl = control2;
        }
        break;
      }
      case 'z': {
        verbs.push({ kind: 'close' });
        current = subpathStart;
        previousCubicControl = null;
        break;
      }
      default:
        throw new Error(`Unsupported SVG path command: ${command}`);
    }
  }

  return createPath2D(...verbs);
};

const parseViewBox = (value: string | undefined) => {
  const numbers = parseNumberList(value ?? '');
  if (numbers.length !== 4) {
    return { minX: 0, minY: 0, width: 900, height: 900 };
  }
  return {
    minX: numbers[0]!,
    minY: numbers[1]!,
    width: numbers[2]!,
    height: numbers[3]!,
  };
};

const parseSvgScene = (svg: string): SvgScene => {
  const tagPattern = /<(\/?)(svg|g|path)\b([^>]*?)(\/?)>/gs;
  const styleStack: SvgStyleState[] = [defaultStyleState];
  const draws: SvgPathDraw[] = [];
  let viewBox = { minX: 0, minY: 0, width: 900, height: 900 };

  for (const match of svg.matchAll(tagPattern)) {
    const isClosing = match[1] === '/';
    const name = match[2]!;
    const attributes = parseAttributes(match[3] ?? '');
    const selfClosing = match[4] === '/';

    if (isClosing) {
      if ((name === 'svg' || name === 'g') && styleStack.length > 1) {
        styleStack.pop();
      }
      continue;
    }

    if (name === 'svg') {
      viewBox = parseViewBox(attributes.viewBox);
    }

    if (name === 'svg' || name === 'g') {
      const nextState = applyAttributesToStyle(styleStack[styleStack.length - 1]!, attributes);
      styleStack.push(nextState);
      if (selfClosing) {
        styleStack.pop();
      }
      continue;
    }

    if (name === 'path') {
      const state = applyAttributesToStyle(styleStack[styleStack.length - 1]!, attributes);
      const pathData = attributes.d;
      if (!pathData) {
        continue;
      }
      draws.push({
        path: withPath2DFillRule(parsePathData(pathData), state.fillRule),
        fill: state.fill,
        stroke: state.stroke,
        strokeWidth: state.strokeWidth,
        transform: state.transform,
      });
    }
  }

  return { viewBox, draws: Object.freeze(draws) };
};

const createViewBoxFitTransform = (
  viewBox: Readonly<{ minX: number; minY: number; width: number; height: number }>,
  outputWidth: number,
  outputHeight: number,
): Matrix2D => {
  const scale = Math.min(
    outputWidth / Math.max(viewBox.width, 1),
    outputHeight / Math.max(viewBox.height, 1),
  );
  const tx = -viewBox.minX * scale + ((outputWidth - (viewBox.width * scale)) * 0.5);
  const ty = -viewBox.minY * scale + ((outputHeight - (viewBox.height * scale)) * 0.5);
  return [scale, 0, 0, scale, tx, ty];
};

export const renderTigerSnapshot = async (): Promise<
  Readonly<{
    png: Uint8Array;
    passCount: number;
    unsupportedCommandCount: number;
    pathCount: number;
    drawCount: number;
  }>
> => {
  const svg = await Deno.readTextFile(inputPath);
  const scene = parseSvgScene(svg);
  const outputWidth = Math.round(scene.viewBox.width);
  const outputHeight = Math.round(scene.viewBox.height);
  const fitTransform = createViewBoxFitTransform(scene.viewBox, outputWidth, outputHeight);
  const drawingContext = await requestDrawingContext({
    target: {
      kind: 'offscreen',
      width: outputWidth,
      height: outputHeight,
      format: 'rgba8unorm',
      sampleCount: 4,
    },
  });

  const binding = createOffscreenBinding(drawingContext.backend);
  const recorder = drawingContext.createRecorder();

  recordClear(recorder, defaultBackground);

  for (const draw of scene.draws) {
    const drawTransform = multiplyMatrix2D(fitTransform, draw.transform);
    if (draw.fill) {
      saveDrawingRecorder(recorder);
      concatDrawingRecorderTransform(recorder, drawTransform);
      recordDrawPath(recorder, draw.path, {
        style: 'fill',
        color: draw.fill,
      });
      restoreDrawingRecorder(recorder);
    }
    if (draw.stroke && draw.strokeWidth > 0) {
      saveDrawingRecorder(recorder);
      concatDrawingRecorderTransform(recorder, drawTransform);
      recordDrawPath(recorder, draw.path, {
        style: 'stroke',
        color: draw.stroke,
        strokeWidth: draw.strokeWidth,
      });
      restoreDrawingRecorder(recorder);
    }
  }

  const recording = finishDrawingRecorder(recorder);
  const commandBuffer = encodeDawnCommandBuffer(drawingContext.sharedContext, recording, binding);
  submitToDawnQueueManager(drawingContext.sharedContext.queueManager, commandBuffer);
  await drawingContext.tick();
  await checkForFinishedDawnQueueWork(drawingContext.sharedContext.queueManager, 'yes');

  const snapshot = await readOffscreenSnapshot(
    { device: drawingContext.backend.device, queue: drawingContext.backend.queue },
    binding,
  );

  return {
    png: exportPngRgba({
      width: snapshot.width,
      height: snapshot.height,
      bytes: snapshot.bytes,
    }),
    passCount: commandBuffer.passCount,
    unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
    pathCount: scene.draws.length,
    drawCount: scene.draws.reduce(
      (count, draw) => count + (draw.fill ? 1 : 0) + (draw.stroke ? 1 : 0),
      0,
    ),
  };
};
