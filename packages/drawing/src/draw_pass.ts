import type { Point2D, Rect } from '@rieul3d/geometry';
import type { DrawingRecording } from './recording.ts';
import {
  captureDrawingRawClipElementDeferredDraw,
  getDrawingRawClipElementLatestInsertion,
  getDrawingRawClipElementLatestLayerOrder,
  getDrawingRawClipElementPendingDraw,
  getDrawingRawClipElementPreparedGeometry,
  getDrawingRawClipElementUsageBounds,
  resetDrawingRawClipElementRuntimeState,
  updateDrawingRawClipElementForDraw,
  drawDrawingRawClipElementImmediate,
} from './clip_stack.ts';
import {
  drawingDstUsage,
  type DrawingPreparedDraw,
  prepareDrawingPathCommand,
} from './path_renderer.ts';
import { isDrawingStencilFillRenderer } from './renderer_provider.ts';
import type { DrawingBlendMode, DrawingClipRect, DrawingCommand, DrawPathCommand, DrawShapeCommand } from './types.ts';

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
  clipDrawIds: readonly number[];
  usesStencil: boolean;
  usesFillStencil: boolean;
  usesDepth: boolean;
}>;

export type DrawingPreparedClipDraw = Readonly<{
  id: number;
  elementId: number;
  op: 'intersect' | 'difference';
  triangles: readonly Point2D[];
  bounds?: Rect;
  usageBounds: Rect;
  scissorBounds: Rect;
  maxDepthIndex: number;
  maxDepth: number;
  firstUseOrder: number;
  paintOrder: number;
  pipelineDesc: DrawingGraphicsPipelineDesc;
}>;

export type DrawingDrawPass = Readonly<{
  kind: 'drawPass';
  recorderId: number;
  loadOp: 'load' | 'clear';
  clearColor: readonly [number, number, number, number];
  clipDraws: readonly DrawingPreparedClipDraw[];
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
const firstLayerOrder = 1;

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

type MutablePreparedClipDraw = {
  id: number;
  elementId: number;
  op: 'intersect' | 'difference';
  triangles: readonly Point2D[];
  bounds?: Rect;
  usageBounds: Rect;
  scissorBounds: Rect;
  maxDepthIndex: number;
  maxDepth: number;
  firstUseOrder: number;
  paintOrder: number;
  pipelineDesc: DrawingGraphicsPipelineDesc;
};

type MutablePreparedStep = Omit<DrawingPreparedStep, 'clipDrawIds'> & {
  clipDrawIds: number[];
};

type DrawingBinding = {
  key: string;
  steps: MutablePreparedStep[];
  prev: DrawingBinding | null;
  next: DrawingBinding | null;
};

type DrawingLayer = {
  order: number;
  head: DrawingBinding | null;
  tail: DrawingBinding | null;
};

const iterateBindings = function* (
  layer: DrawingLayer,
): Generator<DrawingBinding, void, undefined> {
  for (let current = layer.head; current; current = current.next) {
    yield current;
  }
};

const findBindingByKey = (
  layer: DrawingLayer,
  key: string,
): DrawingBinding | null => {
  for (const binding of iterateBindings(layer)) {
    if (binding.key === key) {
      return binding;
    }
  }
  return null;
};

const insertBindingAfter = (
  layer: DrawingLayer,
  binding: DrawingBinding,
  previous: DrawingBinding | null,
): void => {
  if (!previous) {
    binding.prev = null;
    binding.next = layer.head;
    if (layer.head) {
      layer.head.prev = binding;
    } else {
      layer.tail = binding;
    }
    layer.head = binding;
    return;
  }

  binding.prev = previous;
  binding.next = previous.next;
  previous.next = binding;
  if (binding.next) {
    binding.next.prev = binding;
  } else {
    layer.tail = binding;
  }
};

const stepsOverlap = (left: DrawingPreparedStep, right: DrawingPreparedStep): boolean =>
  rectsIntersect(left.drawBounds, right.drawBounds);

const stepsHaveCompatibleBinding = (left: DrawingPreparedStep, right: DrawingPreparedStep): boolean =>
  getPipelineSortKey(left) === getPipelineSortKey(right) &&
  left.usesStencil === right.usesStencil &&
  left.usesFillStencil === right.usesFillStencil &&
  left.usesDepth === right.usesDepth;

const canInsertIntoLayer = (
  layer: DrawingLayer,
  step: DrawingPreparedStep,
): Readonly<{
  acceptable: boolean;
  compatible: boolean;
  incompatibleOverlap: boolean;
  bindingNode: DrawingBinding | null;
}> => {
  let compatible = false;
  let bindingNode: DrawingBinding | null = null;
  for (const binding of iterateBindings(layer)) {
    for (const existing of binding.steps) {
      if (!stepsOverlap(existing, step)) {
        continue;
      }
      if (!stepsHaveCompatibleBinding(existing, step)) {
        return {
          acceptable: false,
          compatible: false,
          incompatibleOverlap: true,
          bindingNode: null,
        };
      }
      compatible = true;
      bindingNode = binding;
    }
  }
  return {
    acceptable: true,
    compatible,
    incompatibleOverlap: false,
    bindingNode,
  };
};

const insertStepIntoLayer = (
  layer: DrawingLayer,
  step: MutablePreparedStep,
  boundaryNode: DrawingBinding | null = null,
): DrawingBinding => {
  const stepKey = getPipelineSortKey(step);
  const existingBinding = findBindingByKey(layer, stepKey);
  if (existingBinding) {
    existingBinding.steps.push(step);
    return existingBinding;
  }

  let previous: DrawingBinding | null = null;
  for (const existing of iterateBindings(layer)) {
    if (boundaryNode && existing === boundaryNode) {
      previous = existing;
      continue;
    }
    if (existing.key > stepKey) {
      break;
    }
    previous = existing;
  }
  const binding: DrawingBinding = {
    key: stepKey,
    steps: [step],
    prev: null,
    next: null,
  };
  insertBindingAfter(layer, binding, previous);
  return binding;
};

const resetRawElementRuntimeState = (
  rawElements: Iterable<NonNullable<NonNullable<DrawingPreparedDraw['clip']>['effectiveElements']>[number]['rawElement']>,
): void => {
  for (const rawElement of rawElements) {
    resetDrawingRawClipElementRuntimeState(rawElement);
  }
};

const createClipPipelineDescForElement = (
  element: Readonly<{
    op: 'intersect' | 'difference';
  }>,
  index: number,
): DrawingGraphicsPipelineDesc =>
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
  );

const assignLayeredOrder = (
  pass: DrawingDrawPass,
  allocateClipDrawId: () => number,
): DrawingDrawPass => {
  const layers: DrawingLayer[] = [];
  let nextLayerOrder = firstLayerOrder;
  const preparedSteps = pass.steps.map((step, originalOrder) => ({
    ...step,
    depthIndex: originalOrder + 1,
    depth: depthAsFloat(originalOrder + 1),
    originalOrder,
    paintOrder: noIntersectionPaintOrder,
    stencilIndex: step.usesStencil || step.usesFillStencil ? originalOrder : unassignedStencilIndex,
    dependsOnDst: stepDependsOnDst(step),
    clipDrawIds: [] as number[],
  }));

  for (const step of preparedSteps) {
    const dependsOnDst = step.dependsOnDst;
    const clipElements = step.draw.clip?.effectiveElements ?? [];
    let clipAnchorLayer: DrawingLayer | null = null;
    let clipAnchorBindingNode: DrawingBinding | null = null;
    for (const element of clipElements) {
      const latestInsertion = getDrawingRawClipElementLatestInsertion(element.rawElement);
      const latestLayerOrder = latestInsertion?.layerOrder;
      const usageBounds = getDrawingRawClipElementUsageBounds(element.rawElement);
      if (latestLayerOrder === undefined || !usageBounds) {
        continue;
      }
      if (element.bounds && !rectsIntersect(usageBounds, step.drawBounds)) {
        continue;
      }
      const candidateLayer = layers.find((layer) => layer.order === latestLayerOrder) ?? null;
      if (candidateLayer && (!clipAnchorLayer || candidateLayer.order > clipAnchorLayer.order)) {
        clipAnchorLayer = candidateLayer;
        clipAnchorBindingNode = (latestInsertion?.bindingNode as DrawingBinding | null | undefined) ??
          null;
      }
    }
    let targetLayer: DrawingLayer | null = null;
    let targetBindingNode: DrawingBinding | null = null;

    if (dependsOnDst) {
      const stopIndex = clipAnchorLayer ? layers.indexOf(clipAnchorLayer) : -1;
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = layers[index]!;
        const verdict = canInsertIntoLayer(layer, step);
        if (verdict.acceptable) {
          targetLayer = layer;
          targetBindingNode = verdict.bindingNode;
          if (verdict.compatible) {
            break;
          }
          continue;
        }
        if (verdict.incompatibleOverlap) {
          break;
        }
        if (index === stopIndex) {
          break;
        }
      }
    } else {
      const startIndex = clipAnchorLayer ? Math.max(0, layers.indexOf(clipAnchorLayer)) : 0;
      for (let index = startIndex; index < layers.length; index += 1) {
        const layer = layers[index]!;
        const verdict = canInsertIntoLayer(layer, step);
        if (verdict.acceptable) {
          targetLayer = layer;
          targetBindingNode = verdict.bindingNode;
          if (verdict.compatible) {
            break;
          }
        }
      }
    }

    if (!targetLayer) {
      targetLayer = {
        order: nextLayerOrder++,
        head: null,
        tail: null,
      };
      if (clipAnchorLayer && !dependsOnDst) {
        const anchorIndex = layers.indexOf(clipAnchorLayer);
        layers.splice(anchorIndex + 1, 0, targetLayer);
      } else {
        layers.push(targetLayer);
      }
    }

    step.paintOrder = targetLayer.order - firstLayerOrder;
    const insertedBindingNode = insertStepIntoLayer(
      targetLayer,
      step,
      targetLayer === clipAnchorLayer ? clipAnchorBindingNode : targetBindingNode,
    );
    for (let index = 0; index < clipElements.length; index += 1) {
      const clipElement = clipElements[index]!;
      const rawElement = clipElement.rawElement;
      const geometry = getDrawingRawClipElementPreparedGeometry(rawElement);
      const rawBounds = geometry.bounds ?? clipElement.bounds;
      const rawTriangles = geometry.triangles;
      const usageBounds = rawBounds
        ? intersectRect(step.drawBounds, rawBounds)
        : step.drawBounds;
      const accumulatedUsageBounds = updateDrawingRawClipElementForDraw(
        rawElement,
        usageBounds,
        {
          layerOrder: targetLayer.order,
          bindingNode: insertedBindingNode,
        },
      );

      if (!rawTriangles || rawTriangles.length === 0) {
        continue;
      }

      const scissorBounds = rawBounds
        ? intersectRect(accumulatedUsageBounds, rawBounds)
        : accumulatedUsageBounds;
      const pendingDraw = getDrawingRawClipElementPendingDraw(rawElement);
      if (pendingDraw) {
        const updatedPendingDraw = captureDrawingRawClipElementDeferredDraw(rawElement, {
          usageBounds: accumulatedUsageBounds,
          scissorBounds,
          maxDepthIndex: Math.max(pendingDraw.maxDepthIndex, step.depthIndex),
          maxDepth: depthAsFloat(
            Math.min(lastDepthIndex, Math.max(pendingDraw.maxDepthIndex, step.depthIndex) + 1),
          ),
          paintOrder: targetLayer.order - firstLayerOrder,
        });
        if (updatedPendingDraw) {
          step.clipDrawIds.push(updatedPendingDraw.drawId);
        }
        continue;
      }

      const createdPendingDraw = drawDrawingRawClipElementImmediate(rawElement, {
        drawId: allocateClipDrawId(),
        usageBounds: accumulatedUsageBounds,
        scissorBounds,
        maxDepthIndex: step.depthIndex,
        maxDepth: depthAsFloat(Math.min(lastDepthIndex, step.depthIndex + 1)),
        firstUseOrder: step.originalOrder,
        paintOrder: targetLayer.order - firstLayerOrder,
        stencilIndex: index,
      });
      if (createdPendingDraw) {
        step.clipDrawIds.push(createdPendingDraw.drawId);
      }
    }
  }

  const orderedSteps = layers.flatMap((layer) =>
    [...iterateBindings(layer)].flatMap((binding) => binding.steps)
  )
    .map((step) => Object.freeze({
      ...step,
      clipDrawIds: Object.freeze([...step.clipDrawIds]),
    }) as DrawingPreparedStep);
  const orderedClipDraws = [...new Set(
    preparedSteps.flatMap((step) => (step.draw.clip?.effectiveElements ?? []).map((element) => element.rawElement)),
  )]
    .flatMap((rawElement) => {
      const pendingDraw = getDrawingRawClipElementPendingDraw(rawElement);
      const geometry = getDrawingRawClipElementPreparedGeometry(rawElement);
      const triangles = geometry.triangles;
      if (!pendingDraw || !triangles || triangles.length === 0) {
        return [];
      }
      return [{
        id: pendingDraw.drawId,
        elementId: rawElement.id,
        op: rawElement.clip.op,
        triangles,
        bounds: geometry.bounds,
        usageBounds: pendingDraw.usageBounds,
        scissorBounds: pendingDraw.scissorBounds,
        maxDepthIndex: pendingDraw.maxDepthIndex,
        maxDepth: pendingDraw.maxDepth,
        firstUseOrder: pendingDraw.firstUseOrder,
        paintOrder: pendingDraw.paintOrder,
        pipelineDesc: createClipPipelineDescForElement({ op: rawElement.clip.op }, pendingDraw.stencilIndex),
      } satisfies MutablePreparedClipDraw];
    })
    .sort((left, right) => left.firstUseOrder - right.firstUseOrder || left.id - right.id)
    .map((clipDraw) => Object.freeze(clipDraw) as DrawingPreparedClipDraw);

  return {
    ...pass,
    clipDraws: Object.freeze(orderedClipDraws),
    steps: Object.freeze(orderedSteps),
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
  let nextClipDrawId = 1;

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

    const pass = assignLayeredOrder({
      kind: 'drawPass',
      recorderId: recording.recorderId,
      loadOp: currentLoadOp,
      clearColor: currentClearColor,
      clipDraws: Object.freeze([]),
      steps: Object.freeze([...currentSteps]),
      unsupportedDraws: Object.freeze([...currentUnsupportedDraws]),
    }, () => nextClipDrawId++);
    passes.push(pass);
    resetRawElementRuntimeState(
      currentSteps.flatMap((step) => (step.draw.clip?.effectiveElements ?? []).map((element) => element.rawElement)),
    );

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
          clipDrawIds: Object.freeze([]),
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

  return {
    backend: recording.backend,
    recorderId: recording.recorderId,
    passCount: passes.length,
    passes: Object.freeze(passes),
    unsupportedCommands: Object.freeze(unsupportedCommands),
  };
};
