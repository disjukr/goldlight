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
  DrawingClip,
  DrawingClipOp,
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
  clips: readonly DrawingClip[];
}>;

type MutableDrawingRecorder = {
  commands: DrawingCommand[];
  state: DrawingRecorderState;
  stateStack: DrawingRecorderState[];
};

const cloneState = (state: DrawingRecorderState): DrawingRecorderState => ({
  transform: [...state.transform] as typeof state.transform,
  clips: state.clips.map((clip) =>
    clip.kind === 'rect'
      ? {
        kind: 'rect',
        op: clip.op,
        rect: {
          origin: [...clip.rect.origin] as typeof clip.rect.origin,
        size: { ...clip.rect.size },
        },
        transform: [...clip.transform] as typeof clip.transform,
      }
      : {
        kind: 'path',
        op: clip.op,
        path: {
          verbs: clip.path.verbs.map((verb) => ({ ...verb })),
          fillRule: clip.path.fillRule,
        },
        transform: [...clip.transform] as typeof clip.transform,
      }
  ),
});

export const createDrawingRecorder = (
  sharedContext: DawnSharedContext,
): DrawingRecorder => ({
  recorderId: registerDawnRecorder(sharedContext),
  sharedContext,
  commands: [],
  state: {
    transform: identityMatrix2D,
    clips: [],
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
    clips: recorder.state.clips,
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
    clips: recorder.state.clips,
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
  mutable.state = restored ?? { transform: identityMatrix2D, clips: [] };
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
  op: DrawingClipOp = 'intersect',
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clips: [
      ...recorder.state.clips,
      {
        kind: 'rect',
        op,
        rect: clipRect,
        transform: recorder.state.transform,
      },
    ],
  };
};

export const clipDrawingRecorderPath = (
  recorder: DrawingRecorder,
  clipPath: Path2D,
  op: DrawingClipOp = 'intersect',
): void => {
  (recorder as MutableDrawingRecorder).state = {
    ...recorder.state,
    clips: [
      ...recorder.state.clips,
      {
        kind: 'path',
        op,
        path: clipPath as DrawingPath2D,
        transform: recorder.state.transform,
      },
    ],
  };
};

export const resetDrawingRecorder = (
  recorder: DrawingRecorder,
): void => {
  const mutable = recorder as MutableDrawingRecorder;
  mutable.commands.length = 0;
  mutable.state = {
    transform: identityMatrix2D,
    clips: [],
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
