import type { DrawingRecording } from './recording.ts';
import { prepareDrawingPathCommand, type DrawingPreparedDraw } from './path_renderer.ts';
import type {
  DrawingClipRect,
  DrawingCommand,
  DrawPathCommand,
  DrawShapeCommand,
} from './types.ts';
import type { Rect } from '@rieul3d/geometry';

export type DrawingDrawCommand = DrawPathCommand | DrawShapeCommand;

export type DrawingPipelineKey =
  | 'path-fill-nonzero-stencil'
  | 'path-fill-evenodd-stencil'
  | 'path-fill-cover'
  | 'path-stroke-cover';

export type DrawingPreparedStep = Readonly<{
  draw: DrawingPreparedDraw;
  pipelineKeys: readonly DrawingPipelineKey[];
  clipRect?: DrawingClipRect;
  drawBounds: DrawingPreparedDraw['bounds'];
  clipBounds?: Rect;
  usesStencil: boolean;
}>;

export type DrawingDrawPass = Readonly<{
  kind: 'drawPass';
  recorderId: number;
  loadOp: 'load' | 'clear';
  clearColor: readonly [number, number, number, number];
  steps: readonly DrawingPreparedStep[];
  unsupportedDraws: readonly DrawingDrawCommand[];
}>;

export type DrawingPreparedRecording = Readonly<{
  backend: DrawingRecording['backend'];
  recorderId: number;
  passCount: number;
  passes: readonly DrawingDrawPass[];
  unsupportedCommands: readonly DrawingCommand[];
}>;

const defaultClearColor: readonly [number, number, number, number] = [0, 0, 0, 0];

const isDrawCommand = (command: DrawingCommand): command is DrawingDrawCommand =>
  command.kind === 'drawPath' || command.kind === 'drawShape';

const getPipelineKeysForDraw = (draw: DrawingPreparedDraw): readonly DrawingPipelineKey[] => {
  switch (draw.kind) {
    case 'pathFill':
      return draw.fillRule === 'evenodd'
        ? ['path-fill-evenodd-stencil', 'path-fill-cover']
        : ['path-fill-nonzero-stencil', 'path-fill-cover'];
    case 'pathStroke':
      return ['path-stroke-cover'];
  }
};

export const prepareDrawingRecording = (
  recording: DrawingRecording,
): DrawingPreparedRecording => {
  const passes: DrawingDrawPass[] = [];
  const unsupportedCommands: DrawingCommand[] = [];

  let currentLoadOp: 'load' | 'clear' = 'load';
  let currentClearColor = defaultClearColor;
  let currentSteps: DrawingPreparedStep[] = [];
  let currentUnsupportedDraws: DrawingDrawCommand[] = [];

  const flushPass = (): void => {
    if (
      currentLoadOp === 'load' &&
      currentSteps.length === 0 &&
      currentUnsupportedDraws.length === 0
    ) {
      return;
    }

    passes.push({
      kind: 'drawPass',
      recorderId: recording.recorderId,
      loadOp: currentLoadOp,
      clearColor: currentClearColor,
      steps: Object.freeze([...currentSteps]),
      unsupportedDraws: Object.freeze([...currentUnsupportedDraws]),
    });

    currentLoadOp = 'load';
    currentClearColor = defaultClearColor;
    currentSteps = [];
    currentUnsupportedDraws = [];
  };

  for (const command of recording.commands) {
    if (command.kind === 'clear') {
      flushPass();
      currentLoadOp = 'clear';
      currentClearColor = command.color;
      continue;
    }

    if (isDrawCommand(command)) {
      const prepared = prepareDrawingPathCommand(command);
      if (prepared.supported) {
        currentSteps.push({
          draw: prepared.draw,
          pipelineKeys: getPipelineKeysForDraw(prepared.draw),
          clipRect: prepared.draw.clipRect,
          drawBounds: prepared.draw.bounds,
          clipBounds: prepared.draw.clip?.bounds,
          usesStencil: prepared.draw.usesStencil,
        });
      } else {
        currentUnsupportedDraws.push(command);
        unsupportedCommands.push(command);
      }
      continue;
    }

    unsupportedCommands.push(command);
  }

  flushPass();

  return {
    backend: recording.backend,
    recorderId: recording.recorderId,
    passCount: passes.length,
    passes: Object.freeze(passes),
    unsupportedCommands: Object.freeze(unsupportedCommands),
  };
};
