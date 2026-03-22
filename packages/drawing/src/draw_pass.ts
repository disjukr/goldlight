import type { DrawingRecording } from './recording.ts';
import { type DrawingPreparedDraw, prepareDrawingPathCommand } from './path_renderer.ts';
import type {
  DrawingClipRect,
  DrawingCommand,
  DrawPathCommand,
  DrawShapeCommand,
} from './types.ts';
import type { Rect } from '@rieul3d/geometry';

export type DrawingDrawCommand = DrawPathCommand | DrawShapeCommand;

export type DrawingPipelineKey =
  | 'clip-stencil-write'
  | 'path-fill-stencil-evenodd'
  | 'path-fill-stencil-nonzero'
  | 'path-fill-patch-stencil-evenodd'
  | 'path-fill-patch-stencil-nonzero'
  | 'path-fill-curve-patch-stencil-evenodd'
  | 'path-fill-curve-patch-stencil-nonzero'
  | 'path-fill-cover'
  | 'path-fill-stencil-cover'
  | 'path-fill-patch-cover'
  | 'path-fill-curve-patch-cover'
  | 'path-fill-clip-cover'
  | 'path-fill-patch-clip-cover'
  | 'path-fill-curve-patch-clip-cover'
  | 'path-stroke-cover'
  | 'path-stroke-patch-cover'
  | 'path-stroke-clip-cover'
  | 'path-stroke-patch-clip-cover';

export type DrawingPreparedStep = Readonly<{
  draw: DrawingPreparedDraw;
  pipelineKeys: readonly DrawingPipelineKey[];
  clipRect?: DrawingClipRect;
  drawBounds: DrawingPreparedDraw['bounds'];
  clipBounds?: Rect;
  usesStencil: boolean;
  usesFillStencil: boolean;
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
  const usesStencilClip = Boolean(draw.clip?.triangleRuns?.length);
  switch (draw.kind) {
    case 'pathFill': {
      const fillStencilKey = draw.fillRule === 'evenodd'
        ? draw.renderer === 'stencil-tessellated-curves'
          ? 'path-fill-curve-patch-stencil-evenodd'
          : draw.renderer === 'stencil-tessellated-wedges'
          ? 'path-fill-patch-stencil-evenodd'
          : 'path-fill-stencil-evenodd'
        : draw.renderer === 'stencil-tessellated-curves'
        ? 'path-fill-curve-patch-stencil-nonzero'
        : draw.renderer === 'stencil-tessellated-wedges'
        ? 'path-fill-patch-stencil-nonzero'
        : 'path-fill-stencil-nonzero';

      if (!usesStencilClip && draw.renderer !== 'middle-out-fan') {
        return [fillStencilKey, 'path-fill-stencil-cover'];
      }
      if (draw.renderer === 'middle-out-fan') {
        return usesStencilClip
          ? ['clip-stencil-write', 'path-fill-clip-cover']
          : ['path-fill-cover'];
      }
      if (draw.renderer === 'stencil-tessellated-curves') {
        return usesStencilClip
          ? ['clip-stencil-write', 'path-fill-curve-patch-clip-cover']
          : ['path-fill-curve-patch-cover'];
      }
      if (usesStencilClip) {
        return ['clip-stencil-write', 'path-fill-patch-clip-cover'];
      }
      return ['path-fill-patch-cover'];
    }
    case 'pathStroke':
      if (draw.patches.length === 0) {
        return usesStencilClip
          ? ['clip-stencil-write', 'path-stroke-clip-cover']
          : ['path-stroke-cover'];
      }
      return usesStencilClip
        ? ['clip-stencil-write', 'path-stroke-patch-clip-cover']
        : ['path-stroke-patch-cover'];
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
          usesFillStencil: prepared.draw.kind === 'pathFill' &&
            prepared.draw.renderer !== 'middle-out-fan' &&
            !prepared.draw.clip?.triangleRuns?.length,
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
