import type { Path2D } from '@rieul3d/geometry';
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
}>;

export const createDrawingRecorder = (
  sharedContext: DawnSharedContext,
): DrawingRecorder => ({
  recorderId: registerDawnRecorder(sharedContext),
  sharedContext,
  commands: [],
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
  };
  recorder.commands.push(command);
  return command;
};

export const resetDrawingRecorder = (
  recorder: DrawingRecorder,
): void => {
  recorder.commands.length = 0;
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
