import {
  createScaleMatrix2D,
  createTranslationMatrix2D,
  identityMatrix2D,
  multiplyMatrix2D,
  type Path2D,
  type Rect,
} from '@rieul3d/geometry';
import { createDrawingPath2DFromShape } from './geometry.ts';
import { createDrawingRecording, type DrawingRecording } from './recording.ts';
import { type DawnSharedContext, registerDawnRecorder } from './shared_context.ts';
import type {
  ClearCommand,
  DrawingCommand,
  DrawingPaint,
  DrawingPath2D,
  DrawingShapeDescriptor,
  DrawingSubmission,
  DrawPathCommand,
  DrawShapeCommand,
} from './types.ts';

export type DrawingRecorder = Readonly<{
  recorderId: number;
  sharedContext: DawnSharedContext;
  commands: DrawingCommand[];
  state: DrawingRecorderState;
  stateStack: DrawingRecorderState[];
}>;

export type DrawingRecorderState = Readonly<{
  transform: readonly [number, number, number, number, number, number];
  clipRect?: Rect;
  clipPath?: DrawingPath2D;
}>;

type MutableDrawingRecorder = {
  commands: DrawingCommand[];
  state: DrawingRecorderState;
  stateStack: DrawingRecorderState[];
};

const cloneState = (state: DrawingRecorderState): DrawingRecorderState => ({
  transform: [...state.transform] as typeof state.transform,
  clipRect: state.clipRect
    ? {
      origin: [...state.clipRect.origin] as typeof state.clipRect.origin,
      size: { ...state.clipRect.size },
    }
    : undefined,
  clipPath: state.clipPath
    ? {
      verbs: state.clipPath.verbs.map((verb) => ({ ...verb })),
      fillRule: state.clipPath.fillRule,
    }
    : undefined,
});

const intersectClipRect = (
  left: Rect | undefined,
  right: Rect,
): Rect | undefined => {
  if (!left) {
    return right;
  }

  const leftX0 = left.origin[0];
  const leftY0 = left.origin[1];
  const leftX1 = left.origin[0] + left.size.width;
  const leftY1 = left.origin[1] + left.size.height;
  const rightX0 = right.origin[0];
  const rightY0 = right.origin[1];
  const rightX1 = right.origin[0] + right.size.width;
  const rightY1 = right.origin[1] + right.size.height;
  const x0 = Math.max(leftX0, rightX0);
  const y0 = Math.max(leftY0, rightY0);
  const x1 = Math.min(leftX1, rightX1);
  const y1 = Math.min(leftY1, rightY1);

  if (x1 <= x0 || y1 <= y0) {
    return {
      origin: [x0, y0],
      size: { width: 0, height: 0 },
    };
  }

  return {
    origin: [x0, y0],
    size: { width: x1 - x0, height: y1 - y0 },
  };
};

export const createDrawingRecorder = (
  sharedContext: DawnSharedContext,
): DrawingRecorder => ({
  recorderId: registerDawnRecorder(sharedContext),
  sharedContext,
  commands: [],
  state: {
    transform: identityMatrix2D,
  },
  stateStack: [],
});

export const recordClear = (
  recorder: DrawingRecorder,
  color: readonly [number, number, number, number],
): ClearCommand => {
  const command: ClearCommand = {
    kind: 'clear',
    color,
  };
  recorder.commands.push(command);
  return command;
};

export const recordDrawPath = (
  recorder: DrawingRecorder,
  path: Path2D,
  paint: DrawingPaint = {},
): DrawPathCommand => {
  const command: DrawPathCommand = {
    kind: 'drawPath',
    path: path as DrawingPath2D,
    paint,
    transform: recorder.state.transform,
    clipRect: recorder.state.clipRect,
    clipPath: recorder.state.clipPath,
  };
  recorder.commands.push(command);
  return command;
};

export const recordDrawShape = (
  recorder: DrawingRecorder,
  shape: DrawingShapeDescriptor,
  paint: DrawingPaint = {},
): DrawShapeCommand => {
  const command: DrawShapeCommand = {
    kind: 'drawShape',
    shape,
    path: createDrawingPath2DFromShape(shape),
    paint,
    transform: recorder.state.transform,
    clipRect: recorder.state.clipRect,
    clipPath: recorder.state.clipPath,
  };
  recorder.commands.push(command);
  return command;
};

export const saveDrawingRecorder = (recorder: DrawingRecorder): void => {
  (recorder as MutableDrawingRecorder).stateStack.push(cloneState(recorder.state));
};

export const restoreDrawingRecorder = (recorder: DrawingRecorder): void => {
  const mutable = recorder as MutableDrawingRecorder;
  const restored = mutable.stateStack.pop();
  mutable.state = restored ?? { transform: identityMatrix2D };
};

export const concatDrawingRecorderTransform = (
  recorder: DrawingRecorder,
  transform: readonly [number, number, number, number, number, number],
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    transform: multiplyMatrix2D(recorder.state.transform, transform),
  };
};

export const translateDrawingRecorder = (
  recorder: DrawingRecorder,
  tx: number,
  ty: number,
): void => {
  concatDrawingRecorderTransform(recorder, createTranslationMatrix2D(tx, ty));
};

export const scaleDrawingRecorder = (
  recorder: DrawingRecorder,
  sx: number,
  sy = sx,
): void => {
  concatDrawingRecorderTransform(recorder, createScaleMatrix2D(sx, sy));
};

export const clipDrawingRecorderRect = (
  recorder: DrawingRecorder,
  clipRect: Rect,
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clipRect: intersectClipRect(recorder.state.clipRect, clipRect),
  };
};

export const clipDrawingRecorderPath = (
  recorder: DrawingRecorder,
  clipPath: Path2D,
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clipPath: clipPath as DrawingPath2D,
  };
};

export const resetDrawingRecorder = (
  recorder: DrawingRecorder,
): void => {
  const mutable = recorder as MutableDrawingRecorder;
  mutable.commands.length = 0;
  mutable.state = {
    transform: identityMatrix2D,
  };
  mutable.stateStack.length = 0;
};

export const finishDrawingRecorder = (
  recorder: DrawingRecorder,
): DrawingRecording => {
  const recording = createDrawingRecording(
    recorder.sharedContext,
    recorder.recorderId,
    recorder.commands,
  );
  resetDrawingRecorder(recorder);
  return recording;
};

export const submitDrawingRecorder = (
  recorder: DrawingRecorder,
): DrawingSubmission => {
  const recording = finishDrawingRecorder(recorder);
  return {
    backend: recording.backend,
    commands: recording.commands,
  };
};
