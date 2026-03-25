import {
  appendDrawingClipStackElement,
  cloneDrawingClipStackSnapshot,
  createDrawingClipStackSnapshot,
  pushDrawingClipStackSave,
  setDrawingClipStackShader,
} from './clip_stack.ts';
import {
  createScaleMatrix2D,
  createTranslationMatrix2D,
  identityMatrix2D,
  multiplyMatrix2D,
  type Path2D,
  type Rect,
} from '@goldlight/geometry';
import { createDrawingPath2DFromShape } from './geometry.ts';
import { createDrawingRecording, type DrawingRecording } from './recording.ts';
import { type DawnSharedContext, registerDawnRecorder } from './shared_context.ts';
import type {
  ClearCommand,
  DrawingClipOp,
  DrawingClipShader,
  DrawingClipStackSnapshot,
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
  clipStack: DrawingClipStackSnapshot;
}>;

type MutableDrawingRecorder = {
  commands: DrawingCommand[];
  state: DrawingRecorderState;
  stateStack: DrawingRecorderState[];
};

const cloneState = (state: DrawingRecorderState): DrawingRecorderState => ({
  transform: [...state.transform] as typeof state.transform,
  clipStack: cloneDrawingClipStackSnapshot(state.clipStack),
});

export const createDrawingRecorder = (
  sharedContext: DawnSharedContext,
): DrawingRecorder => ({
  recorderId: registerDawnRecorder(sharedContext),
  sharedContext,
  commands: [],
  state: {
    transform: identityMatrix2D,
    clipStack: createDrawingClipStackSnapshot(),
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
    clipStack: recorder.state.clipStack,
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
    clipStack: recorder.state.clipStack,
  };
  recorder.commands.push(command);
  return command;
};

export const saveDrawingRecorder = (recorder: DrawingRecorder): void => {
  const mutable = recorder as MutableDrawingRecorder;
  mutable.stateStack.push(cloneState(recorder.state));
  mutable.state = {
    ...mutable.state,
    clipStack: pushDrawingClipStackSave(mutable.state.clipStack),
  };
};

export const restoreDrawingRecorder = (recorder: DrawingRecorder): void => {
  const mutable = recorder as MutableDrawingRecorder;
  const restored = mutable.stateStack.pop();
  mutable.state = restored ??
    { transform: identityMatrix2D, clipStack: createDrawingClipStackSnapshot() };
};

export const concatDrawingRecorderTransform = (
  recorder: DrawingRecorder,
  transform: readonly [number, number, number, number, number, number],
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    transform: multiplyMatrix2D(transform, recorder.state.transform),
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
  op: DrawingClipOp = 'intersect',
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clipStack: appendDrawingClipStackElement(recorder.state.clipStack, {
      kind: 'rect',
      op,
      rect: clipRect,
      transform: recorder.state.transform,
    }),
  };
};

export const clipDrawingRecorderPath = (
  recorder: DrawingRecorder,
  clipPath: Path2D,
  op: DrawingClipOp = 'intersect',
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clipStack: appendDrawingClipStackElement(recorder.state.clipStack, {
      kind: 'path',
      op,
      path: clipPath as DrawingPath2D,
      transform: recorder.state.transform,
    }),
  };
};

export const clipDrawingRecorderShader = (
  recorder: DrawingRecorder,
  shader: DrawingClipShader,
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clipStack: setDrawingClipStackShader(recorder.state.clipStack, shader),
  };
};

export const resetDrawingRecorder = (
  recorder: DrawingRecorder,
): void => {
  const mutable = recorder as MutableDrawingRecorder;
  mutable.commands.length = 0;
  mutable.state = {
    transform: identityMatrix2D,
    clipStack: createDrawingClipStackSnapshot(),
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
