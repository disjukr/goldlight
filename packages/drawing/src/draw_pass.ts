import type { Rect } from '@rieul3d/geometry';
import type { DrawingRecording } from './recording.ts';
import {
  drawingDstUsage,
  type DrawingPreparedDraw,
  prepareDrawingPathCommand,
} from './path_renderer.ts';
import { isDrawingStencilFillRenderer } from './renderer_provider.ts';
import type {
  DrawingBlendMode,
  DrawingClipRect,
  DrawingCommand,
  DrawPathCommand,
  DrawShapeCommand,
} from './types.ts';

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
  | 'direct-depth-less'
  | 'clip-stencil-write'
  | 'clip-stencil-intersect'
  | 'clip-stencil-difference'
  | 'clip-cover'
  | 'clip-cover-depth-less'
  | 'fill-stencil-evenodd'
  | 'fill-stencil-nonzero'
  | 'fill-stencil-cover';

export type DrawingPrimitiveTopology = 'triangle-list' | 'triangle-strip';

export type DrawingGraphicsPipelineDesc = Readonly<{
  label: string;
  shader: DrawingShaderKey;
  vertexLayout: DrawingVertexLayoutKey;
  blendMode: DrawingBlendMode;
  colorWriteDisabled: boolean;
  depthStencil: DrawingDepthStencilKey;
  topology: DrawingPrimitiveTopology;
}>;

export type DrawingPreparedStep = Readonly<{
  draw: DrawingPreparedDraw;
  depth: number;
  depthIndex: number;
  originalOrder: number;
  paintOrder: number;
  stencilIndex: number;
  dependsOnDst: boolean;
  pipelineDescs: readonly DrawingGraphicsPipelineDesc[];
  clipPipelineDescs: readonly DrawingGraphicsPipelineDesc[];
  clipRect?: DrawingClipRect;
  drawBounds: DrawingPreparedDraw['bounds'];
  clipBounds?: Rect;
  usesStencil: boolean;
  usesFillStencil: boolean;
  usesDepth: boolean;
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
const noIntersectionPaintOrder = 0;
const unassignedStencilIndex = 0xffff;
const lastDepthIndex = 0xffff;

const isDrawCommand = (command: DrawingCommand): command is DrawingDrawCommand =>
  command.kind === 'drawPath' || command.kind === 'drawShape';

const rectsIntersect = (left: Rect, right: Rect): boolean => {
  const leftRight = left.origin[0] + left.size.width;
  const leftBottom = left.origin[1] + left.size.height;
  const rightRight = right.origin[0] + right.size.width;
  const rightBottom = right.origin[1] + right.size.height;
  return Math.max(left.origin[0], right.origin[0]) < Math.min(leftRight, rightRight) &&
    Math.max(left.origin[1], right.origin[1]) < Math.min(leftBottom, rightBottom);
};

const intersectRect = (left: Rect, right: Rect): Rect => {
  const x0 = Math.max(left.origin[0], right.origin[0]);
  const y0 = Math.max(left.origin[1], right.origin[1]);
  const x1 = Math.min(left.origin[0] + left.size.width, right.origin[0] + right.size.width);
  const y1 = Math.min(left.origin[1] + left.size.height, right.origin[1] + right.size.height);
  return {
    origin: [x0, y0],
    size: {
      width: Math.max(0, x1 - x0),
      height: Math.max(0, y1 - y0),
    },
  };
};

const getEffectiveDrawBounds = (
  drawBounds: Rect,
  clipRect: DrawingClipRect | undefined,
  clipBounds: Rect | undefined,
): Rect => {
  let effectiveBounds = drawBounds;
  if (clipRect) {
    effectiveBounds = intersectRect(effectiveBounds, clipRect);
  }
  if (clipBounds) {
    effectiveBounds = intersectRect(effectiveBounds, clipBounds);
  }
  return effectiveBounds;
};

const stepDependsOnDst = (step: DrawingPreparedStep): boolean =>
  (step.draw.dstUsage & drawingDstUsage.dependsOnDst) !== 0;

const depthAsFloat = (depthIndex: number): number =>
  1 - (Math.min(depthIndex, lastDepthIndex) / lastDepthIndex);

const getPipelineSortKey = (step: DrawingPreparedStep): string =>
  step.clipPipelineDescs.map((descriptor) => descriptor.label).join('|') + '//' +
  step.pipelineDescs.map((descriptor) => descriptor.label).join('|');

const assignPaintOrder = (
  pass: DrawingDrawPass,
): DrawingDrawPass => {
  const recordedDraws: Array<{
    bounds: Rect;
    paintOrder: number;
  }> = [];
  const steps = pass.steps.map((step, originalOrder) => {
    const dependsOnDst = stepDependsOnDst(step);
    let paintOrder = noIntersectionPaintOrder;
    if (dependsOnDst) {
      for (const recorded of recordedDraws) {
        if (rectsIntersect(recorded.bounds, step.drawBounds)) {
          paintOrder = Math.max(paintOrder, recorded.paintOrder + 1);
        }
      }
    }
    recordedDraws.push({
      bounds: step.drawBounds,
      paintOrder,
    });
    return {
      ...step,
      depthIndex: originalOrder + 1,
      depth: depthAsFloat(originalOrder + 1),
      originalOrder,
      paintOrder,
      stencilIndex: step.usesStencil || step.usesFillStencil ? originalOrder : unassignedStencilIndex,
      dependsOnDst,
    };
  });
  return {
    ...pass,
    steps: Object.freeze(steps),
  };
};

const createPipelineDesc = (
  label: string,
  shader: DrawingShaderKey,
  vertexLayout: DrawingVertexLayoutKey,
  blendMode: DrawingBlendMode,
  depthStencil: DrawingDepthStencilKey = 'none',
  colorWriteDisabled = false,
  topology: DrawingPrimitiveTopology = 'triangle-list',
): DrawingGraphicsPipelineDesc => ({
  label,
  shader,
  vertexLayout,
  blendMode,
  depthStencil,
  colorWriteDisabled,
  topology,
});

const getPipelineBlendMode = (
  draw: DrawingPreparedDraw,
): DrawingBlendMode =>
  (draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0 ? 'src' : draw.blendMode;

const getPipelineDescsForDraw = (
  draw: DrawingPreparedDraw,
): readonly DrawingGraphicsPipelineDesc[] => {
  const usesStencilClip = Boolean(draw.clip?.elements?.length);
  const pipelineBlendMode = getPipelineBlendMode(draw);
  switch (draw.kind) {
    case 'pathFill': {
      const rendererFillRule = draw.renderer.fillRule ?? draw.fillRule;
      const fillStencilDesc = rendererFillRule === 'evenodd'
        ? draw.renderer.kind === 'stencil-tessellated-curves'
          ? createPipelineDesc(
            'drawing-path-fill-curve-patch-stencil-evenodd',
            'curve-patch',
            'curve-patch-instance',
            pipelineBlendMode,
            'fill-stencil-evenodd',
            true,
          )
          : draw.renderer.kind === 'stencil-tessellated-wedges'
          ? createPipelineDesc(
            'drawing-path-fill-patch-stencil-evenodd',
            'wedge-patch',
            'wedge-patch-instance',
            pipelineBlendMode,
            'fill-stencil-evenodd',
            true,
          )
          : createPipelineDesc(
            'drawing-path-fill-stencil-evenodd',
            'path',
            'device-vertex',
            pipelineBlendMode,
            'fill-stencil-evenodd',
            true,
          )
        : draw.renderer.kind === 'stencil-tessellated-curves'
        ? createPipelineDesc(
          'drawing-path-fill-curve-patch-stencil-nonzero',
          'curve-patch',
          'curve-patch-instance',
          pipelineBlendMode,
          'fill-stencil-nonzero',
          true,
        )
        : draw.renderer.kind === 'stencil-tessellated-wedges'
        ? createPipelineDesc(
          'drawing-path-fill-patch-stencil-nonzero',
          'wedge-patch',
          'wedge-patch-instance',
          pipelineBlendMode,
          'fill-stencil-nonzero',
          true,
        )
        : createPipelineDesc(
          'drawing-path-fill-stencil-nonzero',
          'path',
          'device-vertex',
          pipelineBlendMode,
          'fill-stencil-nonzero',
          true,
        );

      if (!usesStencilClip && isDrawingStencilFillRenderer(draw.renderer)) {
        return [
          fillStencilDesc,
          createPipelineDesc(
            'drawing-path-fill-stencil-cover',
            'path',
            'device-vertex',
            pipelineBlendMode,
            'fill-stencil-cover',
          ),
        ];
      }
      if (draw.renderer.patchMode === 'curve') {
        return usesStencilClip
          ? [createPipelineDesc(
            'drawing-path-fill-curve-patch-clip-cover',
            'curve-patch',
            'curve-patch-instance',
            pipelineBlendMode,
            'clip-cover',
          )]
          : [
            createPipelineDesc(
              'drawing-path-fill-curve-patch-cover',
              'curve-patch',
              'curve-patch-instance',
              pipelineBlendMode,
            ),
          ];
      }
      if (draw.renderer.patchMode === 'wedge') {
        return usesStencilClip
          ? [createPipelineDesc(
            'drawing-path-fill-patch-clip-cover',
            'wedge-patch',
            'wedge-patch-instance',
            pipelineBlendMode,
            'clip-cover',
          )]
          : [
            createPipelineDesc(
              'drawing-path-fill-patch-cover',
              'wedge-patch',
              'wedge-patch-instance',
              pipelineBlendMode,
            ),
          ];
      }
      return usesStencilClip
        ? [createPipelineDesc(
          'drawing-path-fill-clip-cover',
          'path',
          'device-vertex',
          pipelineBlendMode,
          'clip-cover',
        )]
        : [createPipelineDesc('drawing-path-fill-cover', 'path', 'device-vertex', pipelineBlendMode)];
    }
    case 'pathStroke':
      if (!draw.usesTessellatedStrokePatches || draw.patches.length === 0) {
        return usesStencilClip
          ? [createPipelineDesc(
            'drawing-path-stroke-clip-cover',
            'path',
            'device-vertex',
            pipelineBlendMode,
            'clip-cover',
          )]
          : [createPipelineDesc('drawing-path-stroke-cover', 'path', 'device-vertex', pipelineBlendMode)];
      }
      return usesStencilClip
        ? [createPipelineDesc(
          'drawing-path-stroke-patch-clip-cover',
          'stroke-patch',
          'stroke-patch-instance',
          pipelineBlendMode,
          'clip-cover-depth-less',
          false,
          'triangle-strip',
        )]
        : [createPipelineDesc(
          'drawing-path-stroke-patch-cover',
          'stroke-patch',
          'stroke-patch-instance',
          pipelineBlendMode,
          'direct-depth-less',
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
        'src-over',
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
        'src-over',
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
      const prepared = prepareDrawingPathCommand(recording, recording.rendererProvider, command);
      if (prepared.supported) {
        currentSteps.push({
          draw: prepared.draw,
          depth: 0,
          depthIndex: 0,
          originalOrder: -1,
          paintOrder: -1,
          stencilIndex: unassignedStencilIndex,
          dependsOnDst: false,
          pipelineDescs: getPipelineDescsForDraw(prepared.draw),
          clipPipelineDescs: getClipPipelineDescsForDraw(prepared.draw),
          clipRect: prepared.draw.clipRect,
          drawBounds: getEffectiveDrawBounds(
            prepared.draw.bounds,
            prepared.draw.clipRect,
            prepared.draw.clip?.bounds,
          ),
          clipBounds: prepared.draw.clip?.bounds,
          usesStencil: prepared.draw.usesStencil,
          usesFillStencil: prepared.draw.kind === 'pathFill' &&
            isDrawingStencilFillRenderer(prepared.draw.renderer) &&
            !prepared.draw.clip?.elements?.length,
          usesDepth: prepared.draw.kind === 'pathStroke' &&
            prepared.draw.renderer.usesDepth &&
            prepared.draw.usesTessellatedStrokePatches &&
            prepared.draw.patches.length > 0,
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

  const passesWithPaintOrder = passes.map(assignPaintOrder);
  const passesWithDepth = passesWithPaintOrder.map((pass) => ({
    ...pass,
    steps: Object.freeze([...pass.steps]
      .sort((left, right) =>
        left.paintOrder - right.paintOrder ||
        left.stencilIndex - right.stencilIndex ||
        getPipelineSortKey(left).localeCompare(getPipelineSortKey(right)) ||
        left.originalOrder - right.originalOrder
      )),
  }));

  return {
    backend: recording.backend,
    recorderId: recording.recorderId,
    passCount: passesWithDepth.length,
    passes: Object.freeze(passesWithDepth),
    unsupportedCommands: Object.freeze(unsupportedCommands),
  };
};
