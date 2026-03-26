import {
  appendDrawingClipStackElement,
  cloneDrawingClipStackSnapshot,
  createDrawingClipStackSnapshot,
  pushDrawingClipStackSave,
  setDrawingClipStackShader,
} from './clip_stack.ts';
import {
  createScaleMatrix2d,
  createTranslationMatrix2d,
  identityMatrix2d,
  multiplyMatrix2d,
  type Path2d,
  type Rect,
} from '@goldlight/geometry';
import { createDrawingPath2dFromShape } from './geometry.ts';
import { createDrawingRecording, type DrawingRecording } from './recording.ts';
import { type DawnSharedContext, registerDawnRecorder } from './shared_context.ts';
import type {
  ClearCommand,
  DrawDirectMaskTextCommand,
  DrawingClipOp,
  DrawingClipShader,
  DrawingClipStackSnapshot,
  DrawingCommand,
  DrawingPaint,
  DrawingPath2d,
  DrawingShapeDescriptor,
  DrawingSubmission,
  DrawPathCommand,
  DrawSdfTextCommand,
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
    transform: identityMatrix2d,
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
  path: Path2d,
  paint: DrawingPaint = {},
): DrawPathCommand => {
  const command: DrawPathCommand = {
    kind: 'drawPath',
    path: path as DrawingPath2d,
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
    path: createDrawingPath2dFromShape(shape),
    paint,
    transform: recorder.state.transform,
    clipStack: recorder.state.clipStack,
  };
  recorder.commands.push(command);
  return command;
};

export const recordDrawDirectMaskText = (
  recorder: DrawingRecorder,
  glyphs: DrawDirectMaskTextCommand['glyphs'],
  paint: DrawingPaint = {},
): DrawDirectMaskTextCommand => {
  const command: DrawDirectMaskTextCommand = {
    kind: 'drawDirectMaskText',
    glyphs,
    paint,
    transform: recorder.state.transform,
    clipStack: recorder.state.clipStack,
  };
  recorder.commands.push(command);
  return command;
};

export const recordDrawSdfText = (
  recorder: DrawingRecorder,
  glyphs: DrawSdfTextCommand['glyphs'],
  paint: DrawingPaint = {},
): DrawSdfTextCommand => {
  const command: DrawSdfTextCommand = {
    kind: 'drawSdfText',
    glyphs,
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
    { transform: identityMatrix2d, clipStack: createDrawingClipStackSnapshot() };
};

export const concatDrawingRecorderTransform = (
  recorder: DrawingRecorder,
  transform: readonly [number, number, number, number, number, number],
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    transform: multiplyMatrix2d(transform, recorder.state.transform),
  };
};

export const translateDrawingRecorder = (
  recorder: DrawingRecorder,
  tx: number,
  ty: number,
): void => {
  concatDrawingRecorderTransform(recorder, createTranslationMatrix2d(tx, ty));
};

export const scaleDrawingRecorder = (
  recorder: DrawingRecorder,
  sx: number,
  sy = sx,
): void => {
  concatDrawingRecorderTransform(recorder, createScaleMatrix2d(sx, sy));
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
  clipPath: Path2d,
  op: DrawingClipOp = 'intersect',
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clipStack: appendDrawingClipStackElement(recorder.state.clipStack, {
      kind: 'path',
      op,
      path: clipPath as DrawingPath2d,
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
    transform: identityMatrix2d,
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
