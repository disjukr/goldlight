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

export type DrawingShaderKey =
  | 'path'
  | 'wedge-patch'
  | 'curve-patch'
  | 'stroke-patch';

export type DrawingVertexLayoutKey =
  | 'device-vertex'
  | 'wedge-patch-instance'
  | 'curve-patch-instance'
  | 'stroke-patch-instance';

export type DrawingDepthStencilKey =
  | 'none'
  | 'clip-stencil-write'
  | 'clip-stencil-intersect'
  | 'clip-stencil-difference'
  | 'clip-cover'
  | 'fill-stencil-evenodd'
  | 'fill-stencil-nonzero'
  | 'fill-stencil-cover';

export type DrawingPrimitiveTopology = 'triangle-list' | 'triangle-strip';

export type DrawingGraphicsPipelineDesc = Readonly<{
  label: string;
  shader: DrawingShaderKey;
  vertexLayout: DrawingVertexLayoutKey;
  colorWriteDisabled: boolean;
  depthStencil: DrawingDepthStencilKey;
  topology: DrawingPrimitiveTopology;
}>;

export type DrawingPreparedStep = Readonly<{
  draw: DrawingPreparedDraw;
  pipelineDescs: readonly DrawingGraphicsPipelineDesc[];
  clipPipelineDescs: readonly DrawingGraphicsPipelineDesc[];
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

const createPipelineDesc = (
  label: string,
  shader: DrawingShaderKey,
  vertexLayout: DrawingVertexLayoutKey,
  depthStencil: DrawingDepthStencilKey = 'none',
  colorWriteDisabled = false,
  topology: DrawingPrimitiveTopology = 'triangle-list',
): DrawingGraphicsPipelineDesc => ({
  label,
  shader,
  vertexLayout,
  depthStencil,
  colorWriteDisabled,
  topology,
});

const getPipelineDescsForDraw = (
  draw: DrawingPreparedDraw,
): readonly DrawingGraphicsPipelineDesc[] => {
  const usesStencilClip = Boolean(draw.clip?.elements?.length);
  switch (draw.kind) {
    case 'pathFill': {
      const fillStencilDesc = draw.fillRule === 'evenodd'
        ? draw.renderer === 'stencil-tessellated-curves'
          ? createPipelineDesc(
            'drawing-path-fill-curve-patch-stencil-evenodd',
            'curve-patch',
            'curve-patch-instance',
            'fill-stencil-evenodd',
            true,
          )
          : draw.renderer === 'stencil-tessellated-wedges'
          ? createPipelineDesc(
            'drawing-path-fill-patch-stencil-evenodd',
            'wedge-patch',
            'wedge-patch-instance',
            'fill-stencil-evenodd',
            true,
          )
          : createPipelineDesc(
            'drawing-path-fill-stencil-evenodd',
            'path',
            'device-vertex',
            'fill-stencil-evenodd',
            true,
          )
        : draw.renderer === 'stencil-tessellated-curves'
        ? createPipelineDesc(
          'drawing-path-fill-curve-patch-stencil-nonzero',
          'curve-patch',
          'curve-patch-instance',
          'fill-stencil-nonzero',
          true,
        )
        : draw.renderer === 'stencil-tessellated-wedges'
        ? createPipelineDesc(
          'drawing-path-fill-patch-stencil-nonzero',
          'wedge-patch',
          'wedge-patch-instance',
          'fill-stencil-nonzero',
          true,
        )
        : createPipelineDesc(
          'drawing-path-fill-stencil-nonzero',
          'path',
          'device-vertex',
          'fill-stencil-nonzero',
          true,
        );

      if (!usesStencilClip && draw.renderer !== 'middle-out-fan') {
        return [
          fillStencilDesc,
          createPipelineDesc(
            'drawing-path-fill-stencil-cover',
            'path',
            'device-vertex',
            'fill-stencil-cover',
          ),
        ];
      }
      if (draw.renderer === 'middle-out-fan') {
        return usesStencilClip
          ? [createPipelineDesc(
            'drawing-path-fill-clip-cover',
            'path',
            'device-vertex',
            'clip-cover',
          )]
          : [createPipelineDesc('drawing-path-fill-cover', 'path', 'device-vertex')];
      }
      if (draw.renderer === 'stencil-tessellated-curves') {
        return usesStencilClip
          ? [createPipelineDesc(
            'drawing-path-fill-curve-patch-clip-cover',
            'curve-patch',
            'curve-patch-instance',
            'clip-cover',
          )]
          : [
            createPipelineDesc(
              'drawing-path-fill-curve-patch-cover',
              'curve-patch',
              'curve-patch-instance',
            ),
          ];
      }
      if (usesStencilClip) {
        return [
          createPipelineDesc(
            'drawing-path-fill-patch-clip-cover',
            'wedge-patch',
            'wedge-patch-instance',
            'clip-cover',
          ),
        ];
      }
      return [
        createPipelineDesc('drawing-path-fill-patch-cover', 'wedge-patch', 'wedge-patch-instance'),
      ];
    }
    case 'pathStroke':
      if (!draw.usesTessellatedStrokePatches || draw.patches.length === 0) {
        return usesStencilClip
          ? [createPipelineDesc(
            'drawing-path-stroke-clip-cover',
            'path',
            'device-vertex',
            'clip-cover',
          )]
          : [createPipelineDesc('drawing-path-stroke-cover', 'path', 'device-vertex')];
      }
      return usesStencilClip
        ? [createPipelineDesc(
          'drawing-path-stroke-patch-clip-cover',
          'stroke-patch',
          'stroke-patch-instance',
          'clip-cover',
          false,
          'triangle-strip',
        )]
        : [createPipelineDesc(
          'drawing-path-stroke-patch-cover',
          'stroke-patch',
          'stroke-patch-instance',
          'none',
          false,
          'triangle-strip',
        )];
  }
};

const getClipPipelineDescsForDraw = (
  draw: DrawingPreparedDraw,
): readonly DrawingGraphicsPipelineDesc[] => {
  if (!draw.clip?.elements?.length) {
    return Object.freeze([]);
  }

  const clipPipelines: DrawingGraphicsPipelineDesc[] = [];
  if (draw.clip.elements[0]!.op === 'difference') {
    clipPipelines.push(
      createPipelineDesc(
        'drawing-clip-stencil-write',
        'path',
        'device-vertex',
        'clip-stencil-write',
        true,
      ),
    );
  }

  for (let index = 0; index < draw.clip.elements.length; index += 1) {
    const element = draw.clip.elements[index]!;
    clipPipelines.push(
      createPipelineDesc(
        index === 0 && element.op === 'intersect'
          ? 'drawing-clip-stencil-write'
          : element.op === 'difference'
          ? 'drawing-clip-stencil-difference'
          : 'drawing-clip-stencil-intersect',
        'path',
        'device-vertex',
        index === 0 && element.op === 'intersect'
          ? 'clip-stencil-write'
          : element.op === 'difference'
          ? 'clip-stencil-difference'
          : 'clip-stencil-intersect',
        true,
      ),
    );
  }

  return Object.freeze(clipPipelines);
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
          pipelineDescs: getPipelineDescsForDraw(prepared.draw),
          clipPipelineDescs: getClipPipelineDescsForDraw(prepared.draw),
          clipRect: prepared.draw.clipRect,
          drawBounds: prepared.draw.bounds,
          clipBounds: prepared.draw.clip?.bounds,
          usesStencil: prepared.draw.usesStencil,
          usesFillStencil: prepared.draw.kind === 'pathFill' &&
            prepared.draw.renderer !== 'middle-out-fan' &&
            !prepared.draw.clip?.elements?.length,
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
