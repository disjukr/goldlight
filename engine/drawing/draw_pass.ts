import type { Point2d, Rect } from '@disjukr/goldlight/geometry';
import type { DrawingRecording } from './recording.ts';
import {
  captureDrawingRawClipElementDeferredDraw,
  drawDrawingRawClipElementImmediate,
  getDrawingRawClipElementLatestInsertion,
  getDrawingRawClipElementPendingDraw,
  getDrawingRawClipElementPreparedGeometry,
  getDrawingRawClipElementUsageBounds,
  resetDrawingRawClipElementRuntimeState,
  updateDrawingRawClipElementForDraw,
} from './clip_stack.ts';
import {
  drawingDstUsage,
  type DrawingPreparedDraw,
  prepareDrawingPathCommand,
  prepareDrawingTextCommand,
} from './path_renderer.ts';
import { isDrawingStencilFillRenderer } from './renderer_provider.ts';
import type {
  DrawDirectMaskTextCommand,
  DrawingBlendMode,
  DrawingClipRect,
  DrawingClipStackWrapperKind,
  DrawingCommand,
  DrawPathCommand,
  DrawSdfTextCommand,
  DrawShapeCommand,
  DrawTransformedMaskTextCommand,
} from './types.ts';

export type DrawingDrawCommand =
  | DrawPathCommand
  | DrawShapeCommand
  | DrawDirectMaskTextCommand
  | DrawTransformedMaskTextCommand
  | DrawSdfTextCommand;

export type DrawingShaderKey =
  | 'analytic-rrect'
  | 'per-edge-aa-quad'
  | 'path'
  | 'wedge-patch'
  | 'curve-patch'
  | 'stroke-patch'
  | 'bitmap-text'
  | 'sdf-text';

export type DrawingVertexLayoutKey =
  | 'analytic-rrect-instance'
  | 'per-edge-aa-quad-instance'
  | 'device-vertex'
  | 'wedge-patch-instance'
  | 'curve-patch-instance'
  | 'stroke-patch-instance'
  | 'text-instance';

export type DrawingDepthStencilKey =
  | 'none'
  | 'direct'
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
  sampleCount?: 1 | 4;
}>;

export type DrawingPreparedStep = Readonly<{
  draw: DrawingPreparedDraw;
  depth: number;
  depthIndex: number;
  originalOrder: number;
  paintOrder: number;
  stencilIndex: number;
  dependsOnDst: boolean;
  requiresBarrier: boolean;
  pipelineDescs: readonly DrawingGraphicsPipelineDesc[];
  clipPipelineDescs: readonly DrawingGraphicsPipelineDesc[];
  clipRect?: DrawingClipRect;
  drawBounds: DrawingPreparedDraw['bounds'];
  clipBounds?: Rect;
  clipDrawIds: readonly number[];
  usesStencil: boolean;
  usesFillStencil: boolean;
  usesDepth: boolean;
  requiresMSAA: boolean;
}>;

export type DrawingPreparedRenderStepKind =
  | 'per-edge-aa-quad-main'
  | 'analytic-main'
  | 'fill-inner'
  | 'fill-main'
  | 'fill-stencil-fan'
  | 'fill-stencil'
  | 'fill-cover'
  | 'fill-fringe'
  | 'stroke-main'
  | 'stroke-fringe'
  | 'text-main';

export type DrawingPreparedRenderStep = Readonly<{
  draw: DrawingPreparedDraw;
  stepIndex: number;
  renderStepIndex: number;
  renderStepCount: number;
  kind: DrawingPreparedRenderStepKind;
  pipelineDesc: DrawingGraphicsPipelineDesc;
  depth: number;
  depthIndex: number;
  originalOrder: number;
  paintOrder: number;
  stencilIndex: number;
  dependsOnDst: boolean;
  requiresBarrier: boolean;
  clipRect?: DrawingClipRect;
  drawBounds: DrawingPreparedDraw['bounds'];
  clipBounds?: Rect;
  clipDrawIds: readonly number[];
  usesStencil: boolean;
  usesFillStencil: boolean;
  usesDepth: boolean;
  requiresMSAA: boolean;
}>;

export type DrawingPreparedClipDraw = Readonly<{
  id: number;
  elementId: number;
  op: 'intersect' | 'difference';
  triangles: readonly Point2d[];
  bounds?: Rect;
  usageBounds: Rect;
  scissorBounds: Rect;
  maxDepthIndex: number;
  maxDepth: number;
  firstUseOrder: number;
  paintOrder: number;
  latestInsertion: Readonly<{
    layerOrder: number;
    renderStepIndex: number;
    renderStepKind: string;
    pipelineKey: string;
    bindingKey: string;
    wrapperKind: DrawingClipStackWrapperKind;
    bindingNode: unknown | null;
  }>;
  sourceRenderStep: Readonly<{
    renderStepIndex: number;
    renderStepKind: string;
    pipelineKey: string;
    requiresBarrier: boolean;
    usesFillStencil: boolean;
    usesDepth: boolean;
  }>;
  pipelineDesc: DrawingGraphicsPipelineDesc;
}>;

export type DrawingDrawPass = Readonly<{
  kind: 'drawPass';
  recorderId: number;
  loadOp: 'load' | 'clear';
  clearColor: readonly [number, number, number, number];
  clipDraws: readonly DrawingPreparedClipDraw[];
  steps: readonly DrawingPreparedStep[];
  renderSteps: readonly DrawingPreparedRenderStep[];
  unsupportedDraws: readonly DrawingDrawCommand[];
  requiresMSAA: boolean;
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
  command.kind === 'drawPath' || command.kind === 'drawShape' ||
  command.kind === 'drawDirectMaskText' || command.kind === 'drawTransformedMaskText' ||
  command.kind === 'drawSdfText';

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

const unionStepBounds = (left: Rect, right: Rect): Rect => {
  const minX = Math.min(left.origin[0], right.origin[0]);
  const minY = Math.min(left.origin[1], right.origin[1]);
  const maxX = Math.max(left.origin[0] + left.size.width, right.origin[0] + right.size.width);
  const maxY = Math.max(left.origin[1] + left.size.height, right.origin[1] + right.size.height);
  return {
    origin: [minX, minY],
    size: {
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
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

type MutablePreparedClipDraw = {
  id: number;
  elementId: number;
  op: 'intersect' | 'difference';
  triangles: readonly Point2d[];
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

type MutablePreparedRenderStep = Omit<DrawingPreparedRenderStep, 'clipDrawIds'> & {
  clipDrawIds: number[];
};

type DrawingBoundsTest = 'disjoint' | 'compatible-overlap' | 'incompatible-overlap';

type DrawingBindingListType = 'single' | 'stencil';

type DrawingLayerKey = Readonly<{
  pipelineKey: string;
  requiresBarrier: boolean;
}>;

type DrawingBindingWrapperBase = {
  listType: DrawingBindingListType;
  listOrder: number;
  bounds: Rect;
  prev: DrawingBindingWrapper | null;
  next: DrawingBindingWrapper | null;
};

type DrawingSingleDrawList = DrawingBindingWrapperBase & {
  listType: 'single';
  key: DrawingLayerKey;
  step: DrawingPreparedRenderStep;
  draws: MutablePreparedRenderStep[];
};

type DrawingStencilDraws = Readonly<{
  key: DrawingLayerKey;
  step: DrawingPreparedRenderStep;
  draws: MutablePreparedRenderStep[];
}>;

type DrawingStencilDrawList = DrawingBindingWrapperBase & {
  listType: 'stencil';
  groups: DrawingStencilDraws[];
};

type DrawingBindingWrapper = DrawingSingleDrawList | DrawingStencilDrawList;

type DrawingLayer = {
  order: number;
  paintOrder: number;
  stencilIndex: number;
  nextListOrder: number;
  head: DrawingBindingWrapper | null;
  tail: DrawingBindingWrapper | null;
};

type DrawingOrderingDevice = {
  layers: DrawingLayer[];
  nextLayerOrder: number;
  nextClipDrawId: number;
  trackedRawElements: Set<
    NonNullable<NonNullable<DrawingPreparedDraw['clip']>['effectiveElements']>[number]['rawElement']
  >;
};

const iterateBindings = function* (
  layer: DrawingLayer,
): Generator<DrawingBindingWrapper, void, undefined> {
  for (let current = layer.head; current; current = current.next) {
    yield current;
  }
};

const iterateBindingRenderSteps = function* (
  binding: DrawingBindingWrapper,
): Generator<MutablePreparedRenderStep, void, undefined> {
  if (binding.listType === 'single') {
    yield* binding.draws;
    return;
  }
  for (const group of binding.groups) {
    yield* group.draws;
  }
};

const createLayerKey = (
  step: Pick<DrawingPreparedRenderStep, 'pipelineDesc' | 'requiresBarrier'>,
): DrawingLayerKey => ({
  pipelineKey: step.pipelineDesc.label,
  requiresBarrier: step.requiresBarrier,
});

const layerKeysEqual = (left: DrawingLayerKey, right: DrawingLayerKey): boolean =>
  left.pipelineKey === right.pipelineKey && left.requiresBarrier === right.requiresBarrier;

const getBindingWrapperKey = (
  binding: DrawingBindingWrapper,
): string =>
  binding.listType === 'single'
    ? binding.key.pipelineKey
    : binding.groups[binding.groups.length - 1]?.key.pipelineKey ?? 'stencil';

const findBindingByKey = (
  layer: DrawingLayer,
  key: DrawingLayerKey,
  startBinding: DrawingBindingWrapper | null = null,
): DrawingBindingWrapper | null => {
  const endBinding = startBinding?.prev ?? null;
  for (let binding = layer.tail; binding && binding !== endBinding; binding = binding.prev) {
    if (binding.listType === 'single' && layerKeysEqual(binding.key, key)) {
      return binding;
    }
  }
  return null;
};

const insertBindingAfter = (
  layer: DrawingLayer,
  binding: DrawingBindingWrapper,
  previous: DrawingBindingWrapper | null,
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

const bindingIntersectsStep = (
  binding: DrawingBindingWrapper,
  step: DrawingPreparedRenderStep,
): boolean => rectsIntersect(binding.bounds, step.drawBounds);

const renderStepWrapperKind = (
  step: Pick<DrawingPreparedRenderStep, 'usesFillStencil'>,
): DrawingClipStackWrapperKind => step.usesFillStencil ? 'stencil' : 'single';

const bindingCanMatchRenderStep = (
  binding: DrawingBindingWrapper,
  step: DrawingPreparedRenderStep,
): boolean =>
  binding.listType === 'single'
    ? layerKeysEqual(binding.key, createLayerKey(step))
    : binding.groups.some((group) => layerKeysEqual(group.key, createLayerKey(step)));

const canRenderStepOverlapOwnBinding = (
  step: DrawingPreparedRenderStep,
): boolean =>
  renderStepWrapperKind(step) === 'single' &&
  !step.requiresBarrier &&
  !step.dependsOnDst;

const expandRenderSteps = (
  step: MutablePreparedStep,
  stepIndex: number,
): MutablePreparedRenderStep[] => {
  const renderSteps: MutablePreparedRenderStep[] = [];
  const pushRenderStep = (
    kind: DrawingPreparedRenderStepKind,
    pipelineDesc: DrawingGraphicsPipelineDesc,
    renderStepIndex: number,
    usesFillStencil = false,
    usesDepth = false,
  ): void => {
    renderSteps.push({
      draw: step.draw,
      stepIndex,
      renderStepIndex,
      renderStepCount: 0,
      kind,
      pipelineDesc,
      depth: step.depth,
      depthIndex: step.depthIndex,
      originalOrder: step.originalOrder,
      paintOrder: step.paintOrder,
      stencilIndex: step.stencilIndex,
      dependsOnDst: step.dependsOnDst,
      requiresBarrier: step.requiresBarrier,
      clipRect: step.clipRect,
      drawBounds: step.drawBounds,
      clipBounds: step.clipBounds,
      clipDrawIds: [],
      usesStencil: step.usesStencil,
      usesFillStencil,
      usesDepth,
      requiresMSAA: step.requiresMSAA,
    });
  };

  if (step.draw.kind === 'analyticRRect') {
    pushRenderStep(
      'analytic-main',
      step.pipelineDescs[0]!,
      0,
      false,
      step.usesDepth,
    );
  } else if (step.draw.kind === 'perEdgeAAQuad') {
    pushRenderStep(
      'per-edge-aa-quad-main',
      step.pipelineDescs[0]!,
      0,
      false,
      step.usesDepth,
    );
  } else if (step.draw.kind === 'pathFill') {
    if (step.draw.innerFillBounds) {
      pushRenderStep(
        'fill-inner',
        createPipelineDesc(
          'drawing-path-fill-inner',
          'path',
          'device-vertex',
          'src-over',
        ),
        0,
        false,
        false,
      );
    }
    if (step.usesFillStencil) {
      let renderStepOrder = step.draw.innerFillBounds ? 1 : 0;
      if (step.pipelineDescs.length === 3) {
        pushRenderStep('fill-stencil-fan', step.pipelineDescs[0]!, renderStepOrder++, true, false);
        pushRenderStep('fill-stencil', step.pipelineDescs[1]!, renderStepOrder++, true, false);
        pushRenderStep('fill-cover', step.pipelineDescs[2]!, renderStepOrder++, true, false);
      } else {
        pushRenderStep('fill-stencil', step.pipelineDescs[0]!, renderStepOrder++, true, false);
        pushRenderStep('fill-cover', step.pipelineDescs[1]!, renderStepOrder++, true, false);
      }
      if (step.draw.fringeVertices?.length) {
        pushRenderStep(
          'fill-fringe',
          createPipelineDesc(
            'drawing-path-fill-stencil-cover',
            'path',
            'device-vertex',
            (step.draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0
              ? 'src'
              : step.draw.blendMode,
            'fill-stencil-cover',
          ),
          renderStepOrder,
          true,
          false,
        );
      }
    } else {
      pushRenderStep(
        'fill-main',
        step.pipelineDescs[0]!,
        step.draw.innerFillBounds ? 1 : 0,
        false,
        step.usesDepth,
      );
      if (step.draw.fringeVertices?.length) {
        pushRenderStep(
          'fill-fringe',
          createPipelineDesc(
            step.clipDrawIds.length > 0
              ? 'drawing-path-fill-clip-cover'
              : 'drawing-path-fill-cover',
            'path',
            'device-vertex',
            (step.draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0
              ? 'src'
              : step.draw.blendMode,
            step.clipDrawIds.length > 0 ? 'clip-cover' : 'direct',
          ),
          step.draw.innerFillBounds ? 2 : 1,
          false,
          false,
        );
      }
    }
  } else if (step.draw.kind === 'pathStroke') {
    pushRenderStep('stroke-main', step.pipelineDescs[0]!, 0, false, step.usesDepth);
    if (step.draw.fringeVertices?.length) {
      pushRenderStep(
        'stroke-fringe',
        createPipelineDesc(
          step.clipDrawIds.length > 0
            ? 'drawing-path-stroke-clip-cover'
            : 'drawing-path-stroke-cover',
          'path',
          'device-vertex',
          (step.draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0
            ? 'src'
            : step.draw.blendMode,
          step.clipDrawIds.length > 0 ? 'clip-cover' : 'direct',
        ),
        1,
        false,
        false,
      );
    }
  } else {
    pushRenderStep('text-main', step.pipelineDescs[0]!, 0, false, false);
  }

  return renderSteps.map((renderStep) => ({
    ...renderStep,
    renderStepCount: renderSteps.length,
  }));
};

const canInsertIntoLayer = (
  layer: DrawingLayer,
  step: DrawingPreparedRenderStep,
  boundaryNode: DrawingBindingWrapper | null = null,
  direction: 'forward' | 'backward' = 'forward',
): Readonly<{
  boundsTest: DrawingBoundsTest;
  bindingNode: DrawingBindingWrapper | null;
}> => {
  let bindingNode: DrawingBindingWrapper | null = null;
  let binding = direction === 'forward' ? boundaryNode ?? layer.head : layer.tail;
  const endBinding = direction === 'forward' ? null : boundaryNode?.prev ?? null;

  for (
    ;
    binding && binding !== endBinding;
    binding = direction === 'forward' ? binding.next : binding.prev
  ) {
    if (bindingCanMatchRenderStep(binding, step)) {
      bindingNode = binding;
      if (canRenderStepOverlapOwnBinding(step)) {
        continue;
      }
    }
    if (bindingIntersectsStep(binding, step)) {
      return {
        boundsTest: 'incompatible-overlap',
        bindingNode: null,
      };
    }
  }

  return {
    boundsTest: bindingNode ? 'compatible-overlap' : 'disjoint',
    bindingNode,
  };
};

const insertStepIntoLayer = (
  layer: DrawingLayer,
  step: MutablePreparedRenderStep,
  matchingBinding: DrawingBindingWrapper | null,
  stencilGroupStartIndex: number | null,
  insertAtHead = false,
): Readonly<{
  binding: DrawingBindingWrapper;
  stencilGroupIndex: number | null;
}> => {
  if (step.usesFillStencil) {
    const key = createLayerKey(step);
    let binding: DrawingStencilDrawList;
    if (matchingBinding?.listType === 'stencil') {
      binding = matchingBinding;
      binding.bounds = unionStepBounds(binding.bounds, step.drawBounds);
    } else {
      binding = {
        listType: 'stencil',
        listOrder: layer.nextListOrder++,
        bounds: step.drawBounds,
        groups: [],
        prev: null,
        next: null,
      };
      insertBindingAfter(layer, binding, layer.tail);
    }

    const searchStart = stencilGroupStartIndex === null ? 0 : stencilGroupStartIndex + 1;
    let groupIndex = -1;
    for (let index = searchStart; index < binding.groups.length; index += 1) {
      if (layerKeysEqual(binding.groups[index]!.key, key)) {
        groupIndex = index;
        break;
      }
    }
    if (groupIndex < 0) {
      binding.groups.push({
        key,
        step,
        draws: [step],
      });
      groupIndex = binding.groups.length - 1;
    } else {
      binding.groups[groupIndex]!.draws.push(step);
    }
    return { binding, stencilGroupIndex: groupIndex };
  }

  if (matchingBinding?.listType === 'single') {
    matchingBinding.bounds = unionStepBounds(matchingBinding.bounds, step.drawBounds);
    if (insertAtHead) {
      matchingBinding.draws.unshift(step);
    } else {
      matchingBinding.draws.push(step);
    }
    return { binding: matchingBinding, stencilGroupIndex: null };
  }

  const binding: DrawingSingleDrawList = {
    listType: 'single',
    listOrder: layer.nextListOrder++,
    key: createLayerKey(step),
    step,
    bounds: step.drawBounds,
    draws: [step],
    prev: null,
    next: null,
  };
  insertBindingAfter(layer, binding, layer.tail);
  return { binding, stencilGroupIndex: null };
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

const createOrderingDevice = (): DrawingOrderingDevice => ({
  layers: [],
  nextLayerOrder: firstLayerOrder,
  nextClipDrawId: 1,
  trackedRawElements: new Set(),
});

const assignDisjointStencilIndices = (
  steps: readonly MutablePreparedStep[],
): readonly number[] => {
  const buckets = new Map<number, Rect[][]>();
  const stencilIndices: number[] = [];

  for (const step of steps) {
    if (!step.usesFillStencil) {
      stencilIndices.push(unassignedStencilIndex);
      (step as { stencilIndex: number }).stencilIndex = unassignedStencilIndex;
      continue;
    }

    const sets = buckets.get(step.paintOrder) ?? [];
    let assigned = -1;
    for (let index = 0; index < sets.length; index += 1) {
      const setBounds = sets[index]!;
      if (setBounds.every((bounds) => !rectsIntersect(bounds, step.drawBounds))) {
        setBounds.push(step.drawBounds);
        assigned = index;
        break;
      }
    }
    if (assigned < 0) {
      assigned = sets.length;
      sets.push([step.drawBounds]);
      buckets.set(step.paintOrder, sets);
    }

    stencilIndices.push(assigned);
    (step as { stencilIndex: number }).stencilIndex = assigned;
  }

  return Object.freeze(stencilIndices);
};

const computeCompressedPaintOrders = (
  steps: readonly MutablePreparedStep[],
): readonly number[] => {
  const paintOrders: number[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    let paintOrder = noIntersectionPaintOrder;
    if (step.dependsOnDst) {
      for (let prevIndex = 0; prevIndex < index; prevIndex += 1) {
        const prevStep = steps[prevIndex]!;
        if (!rectsIntersect(prevStep.drawBounds, step.drawBounds)) {
          continue;
        }
        paintOrder = Math.max(paintOrder, prevStep.paintOrder + 1);
      }
    }
    paintOrders.push(paintOrder);
    (step as { paintOrder: number }).paintOrder = paintOrder;
  }
  return Object.freeze(paintOrders);
};

const resetOrderingDevice = (
  device: DrawingOrderingDevice,
): void => {
  for (const rawElement of device.trackedRawElements) {
    resetDrawingRawClipElementRuntimeState(rawElement);
  }
  device.layers.length = 0;
  device.nextLayerOrder = firstLayerOrder;
  device.trackedRawElements.clear();
};

const finalizeDeferredClipDraws = (
  device: DrawingOrderingDevice,
): readonly DrawingPreparedClipDraw[] =>
  [...device.trackedRawElements]
    .flatMap((rawElement) => {
      const pendingDraw = getDrawingRawClipElementPendingDraw(rawElement);
      const geometry = getDrawingRawClipElementPreparedGeometry(rawElement);
      const triangles = geometry.triangles;
      if (!pendingDraw || !triangles || triangles.length === 0) {
        return [];
      }
      return [Object.freeze({
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
        latestInsertion: pendingDraw.latestInsertion,
        sourceRenderStep: pendingDraw.sourceRenderStep,
        pipelineDesc: createClipPipelineDescForElement(
          { op: rawElement.clip.op },
          pendingDraw.stencilIndex,
        ),
      }) as DrawingPreparedClipDraw];
    })
    .sort((left, right) => left.firstUseOrder - right.firstUseOrder || left.id - right.id);

const createClipLatestInsertion = (
  layer: DrawingLayer,
  bindingNode: DrawingBindingWrapper | null,
  renderStep: DrawingPreparedRenderStep,
): Readonly<{
  layerOrder: number;
  renderStepIndex: number;
  renderStepKind: string;
  pipelineKey: string;
  bindingKey: string;
  wrapperKind: DrawingClipStackWrapperKind;
  bindingNode: DrawingBindingWrapper | null;
}> => ({
  layerOrder: layer.order,
  renderStepIndex: renderStep.renderStepIndex,
  renderStepKind: renderStep.kind,
  pipelineKey: renderStep.pipelineDesc.label,
  bindingKey: bindingNode ? getBindingWrapperKey(bindingNode) : renderStep.pipelineDesc.label,
  wrapperKind: 'depth-only',
  bindingNode,
});

const createClipSourceRenderStep = (
  renderStep: DrawingPreparedRenderStep,
): Readonly<{
  renderStepIndex: number;
  renderStepKind: string;
  pipelineKey: string;
  requiresBarrier: boolean;
  usesFillStencil: boolean;
  usesDepth: boolean;
}> => ({
  renderStepIndex: renderStep.renderStepIndex,
  renderStepKind: renderStep.kind,
  pipelineKey: renderStep.pipelineDesc.label,
  requiresBarrier: renderStep.requiresBarrier,
  usesFillStencil: renderStep.usesFillStencil,
  usesDepth: renderStep.usesDepth,
});

const assignLayeredOrder = (
  device: DrawingOrderingDevice,
  pass: DrawingDrawPass,
): DrawingDrawPass => {
  const preparedSteps = pass.steps.map((step, originalOrder) => ({
    ...step,
    depthIndex: originalOrder + 1,
    depth: depthAsFloat(originalOrder + 1),
    originalOrder,
    paintOrder: noIntersectionPaintOrder,
    stencilIndex: unassignedStencilIndex,
    dependsOnDst: stepDependsOnDst(step),
    requiresBarrier: (step.draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0,
    clipDrawIds: [] as number[],
  }));
  computeCompressedPaintOrders(preparedSteps);
  assignDisjointStencilIndices(preparedSteps);
  const renderSteps = preparedSteps.flatMap((step, stepIndex) =>
    expandRenderSteps(step, stepIndex)
  );

  for (const [stepIndex, step] of preparedSteps.entries()) {
    const dependsOnDst = step.dependsOnDst;
    const clipElements = step.draw.clip?.effectiveElements ?? [];
    let clipAnchorLayer: DrawingLayer | null = null;
    let clipAnchorBindingNode: DrawingBindingWrapper | null = null;
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
      const candidateLayer = device.layers.find((layer) => layer.order === latestLayerOrder) ??
        null;
      if (candidateLayer && (!clipAnchorLayer || candidateLayer.order > clipAnchorLayer.order)) {
        clipAnchorLayer = candidateLayer;
        clipAnchorBindingNode =
          (latestInsertion?.bindingNode as DrawingBindingWrapper | null | undefined) ??
            null;
      }
    }
    const drawRenderSteps = renderSteps.filter((candidate) => candidate.stepIndex === stepIndex);
    let insertedBindingNode: DrawingBindingWrapper | null = null;
    let insertedLayer: DrawingLayer | null = null;
    let lastInsertedRenderStep: MutablePreparedRenderStep | null = null;
    let insertedStencilGroupIndex: number | null = null;
    let insertBeforeInTargetLayer = false;
    for (const renderStep of drawRenderSteps) {
      const orderedRenderStep: MutablePreparedRenderStep = {
        ...renderStep,
        paintOrder: step.paintOrder,
      };
      lastInsertedRenderStep = orderedRenderStep;
      const candidateLayers = device.layers.filter((layer) =>
        layer.paintOrder === step.paintOrder && layer.stencilIndex === step.stencilIndex
      );
      let targetLayer: DrawingLayer | null = null;
      let targetBindingNode: DrawingBindingWrapper | null = null;
      insertBeforeInTargetLayer = false;

      if (insertedLayer) {
        const startIndex = candidateLayers.indexOf(insertedLayer);
        for (let index = Math.max(startIndex, 0); index < candidateLayers.length; index += 1) {
          const layer = candidateLayers[index]!;
          const boundaryNode = layer === insertedLayer ? insertedBindingNode : null;
          const verdict = canInsertIntoLayer(layer, orderedRenderStep, boundaryNode, 'forward');
          if (verdict.boundsTest !== 'incompatible-overlap') {
            targetLayer = layer;
            targetBindingNode = verdict.bindingNode;
            insertBeforeInTargetLayer = false;
            if (verdict.boundsTest === 'compatible-overlap') {
              break;
            }
          }
        }
      } else if (dependsOnDst) {
        const stopIndex = clipAnchorLayer && clipAnchorLayer.paintOrder === step.paintOrder
          ? candidateLayers.indexOf(clipAnchorLayer)
          : -1;
        for (let index = candidateLayers.length - 1; index >= 0; index -= 1) {
          const layer = candidateLayers[index]!;
          const boundaryNode = layer === clipAnchorLayer ? clipAnchorBindingNode : null;
          const verdict = canInsertIntoLayer(layer, orderedRenderStep, boundaryNode, 'backward');
          if (verdict.boundsTest !== 'incompatible-overlap') {
            targetLayer = layer;
            targetBindingNode = verdict.bindingNode;
            if (verdict.boundsTest === 'compatible-overlap') {
              break;
            }
            continue;
          }
          if (verdict.boundsTest === 'incompatible-overlap' || index === stopIndex) {
            break;
          }
        }
      } else {
        const startLayer = clipAnchorLayer && clipAnchorLayer.paintOrder === step.paintOrder
          ? clipAnchorLayer
          : candidateLayers[0] ?? null;
        if (startLayer) {
          const startBinding = startLayer === clipAnchorLayer ? clipAnchorBindingNode : null;
          const searchMatch = !orderedRenderStep.usesFillStencil
            ? findBindingByKey(
              startLayer,
              createLayerKey(orderedRenderStep),
              startBinding,
            )
            : null;
          if (searchMatch) {
            targetLayer = startLayer;
            targetBindingNode = searchMatch;
          } else {
            const startIndex = candidateLayers.indexOf(startLayer);
            for (let index = Math.max(startIndex, 0); index < candidateLayers.length; index += 1) {
              const layer = candidateLayers[index]!;
              const boundaryNode = layer === startLayer ? startBinding : null;
              const verdict = canInsertIntoLayer(layer, orderedRenderStep, boundaryNode, 'forward');
              if (verdict.boundsTest !== 'incompatible-overlap') {
                targetLayer = layer;
                targetBindingNode = verdict.bindingNode;
                insertBeforeInTargetLayer = layer !== startLayer;
                if (verdict.boundsTest === 'compatible-overlap') {
                  break;
                }
              }
            }
          }
        }
      }

      if (!targetLayer) {
        targetLayer = {
          order: device.nextLayerOrder++,
          paintOrder: step.paintOrder,
          stencilIndex: step.stencilIndex,
          nextListOrder: 1,
          head: null,
          tail: null,
        };
        if (
          clipAnchorLayer &&
          !dependsOnDst &&
          clipAnchorLayer.paintOrder === step.paintOrder &&
          clipAnchorLayer.stencilIndex === step.stencilIndex
        ) {
          const anchorIndex = device.layers.indexOf(clipAnchorLayer);
          device.layers.splice(anchorIndex + 1, 0, targetLayer);
        } else {
          const insertIndex = device.layers.findIndex((layer) =>
            layer.paintOrder > step.paintOrder ||
            (layer.paintOrder === step.paintOrder && layer.stencilIndex > step.stencilIndex)
          );
          if (insertIndex < 0) {
            device.layers.push(targetLayer);
          } else {
            device.layers.splice(insertIndex, 0, targetLayer);
          }
        }
      }

      insertedLayer = targetLayer;
      const insertion = insertStepIntoLayer(
        targetLayer,
        orderedRenderStep,
        targetBindingNode,
        insertedStencilGroupIndex,
        !dependsOnDst && insertBeforeInTargetLayer,
      );
      insertedBindingNode = insertion.binding;
      insertedStencilGroupIndex = insertion.stencilGroupIndex;
    }
    for (let index = 0; index < clipElements.length; index += 1) {
      const clipElement = clipElements[index]!;
      const rawElement = clipElement.rawElement;
      device.trackedRawElements.add(rawElement);
      const geometry = getDrawingRawClipElementPreparedGeometry(rawElement);
      const rawBounds = geometry.bounds ?? clipElement.bounds;
      const rawTriangles = geometry.triangles;
      const usageBounds = rawBounds ? intersectRect(step.drawBounds, rawBounds) : step.drawBounds;
      const accumulatedUsageBounds = updateDrawingRawClipElementForDraw(
        rawElement,
        usageBounds,
        createClipLatestInsertion(
          insertedLayer!,
          insertedBindingNode,
          lastInsertedRenderStep ?? drawRenderSteps[drawRenderSteps.length - 1]!,
        ),
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
          paintOrder: step.paintOrder,
          sourceRenderStep: createClipSourceRenderStep(
            lastInsertedRenderStep ?? drawRenderSteps[drawRenderSteps.length - 1]!,
          ),
        });
        if (updatedPendingDraw) {
          step.clipDrawIds.push(updatedPendingDraw.drawId);
          for (const renderStep of drawRenderSteps) {
            renderStep.clipDrawIds.push(updatedPendingDraw.drawId);
          }
        }
        continue;
      }

      const createdPendingDraw = drawDrawingRawClipElementImmediate(rawElement, {
        drawId: device.nextClipDrawId++,
        usageBounds: accumulatedUsageBounds,
        scissorBounds,
        maxDepthIndex: step.depthIndex,
        maxDepth: depthAsFloat(Math.min(lastDepthIndex, step.depthIndex + 1)),
        firstUseOrder: step.originalOrder,
        paintOrder: step.paintOrder,
        stencilIndex: index,
        latestInsertion: createClipLatestInsertion(
          insertedLayer!,
          insertedBindingNode,
          lastInsertedRenderStep ?? drawRenderSteps[drawRenderSteps.length - 1]!,
        ),
        sourceRenderStep: createClipSourceRenderStep(
          lastInsertedRenderStep ?? drawRenderSteps[drawRenderSteps.length - 1]!,
        ),
      });
      if (createdPendingDraw) {
        step.clipDrawIds.push(createdPendingDraw.drawId);
        for (const renderStep of drawRenderSteps) {
          renderStep.clipDrawIds.push(createdPendingDraw.drawId);
        }
      }
    }
  }

  const orderedRenderSteps = device.layers.flatMap((layer) =>
    [...iterateBindings(layer)].flatMap((binding) => [...iterateBindingRenderSteps(binding)])
  ).map((step) =>
    Object.freeze({
      ...step,
      clipDrawIds: Object.freeze([...step.clipDrawIds]),
    }) as DrawingPreparedRenderStep
  );
  const orderedDrawSteps = preparedSteps.map((step) =>
    Object.freeze({
      ...step,
      clipDrawIds: Object.freeze([...step.clipDrawIds]),
    }) as DrawingPreparedStep
  );

  return {
    ...pass,
    clipDraws: Object.freeze(finalizeDeferredClipDraws(device)),
    steps: Object.freeze(orderedDrawSteps),
    renderSteps: Object.freeze(orderedRenderSteps),
  };
};

const createPipelineDesc = (
  label: string,
  shader: DrawingShaderKey,
  vertexLayout: DrawingVertexLayoutKey,
  blendMode: DrawingBlendMode,
  depthStencil: DrawingDepthStencilKey = 'direct',
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
    case 'analyticRRect':
      return usesStencilClip
        ? [createPipelineDesc(
          'drawing-analytic-rrect-clip-cover',
          'analytic-rrect',
          'analytic-rrect-instance',
          pipelineBlendMode,
          'clip-cover-depth-less',
          false,
          'triangle-strip',
        )]
        : [createPipelineDesc(
          'drawing-analytic-rrect-cover',
          'analytic-rrect',
          'analytic-rrect-instance',
          pipelineBlendMode,
          'direct-depth-less',
          false,
          'triangle-strip',
        )];
    case 'perEdgeAAQuad':
      return usesStencilClip
        ? [createPipelineDesc(
          'drawing-per-edge-aa-quad-clip-cover',
          'per-edge-aa-quad',
          'per-edge-aa-quad-instance',
          pipelineBlendMode,
          'clip-cover-depth-less',
          false,
          'triangle-strip',
        )]
        : [createPipelineDesc(
          'drawing-per-edge-aa-quad-cover',
          'per-edge-aa-quad',
          'per-edge-aa-quad-instance',
          pipelineBlendMode,
          'direct-depth-less',
          false,
          'triangle-strip',
        )];
    case 'pathFill': {
      const rendererFillRule = draw.renderer.fillRule ?? draw.fillRule;
      const fillStencilCurveDesc = rendererFillRule === 'evenodd'
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
      const fillStencilFanDesc = rendererFillRule === 'evenodd'
        ? createPipelineDesc(
          'drawing-path-fill-stencil-evenodd',
          'path',
          'device-vertex',
          pipelineBlendMode,
          'fill-stencil-evenodd',
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
        return draw.renderer.kind === 'stencil-tessellated-curves'
          ? [
            fillStencilFanDesc,
            fillStencilCurveDesc,
            createPipelineDesc(
              'drawing-path-fill-stencil-cover',
              'path',
              'device-vertex',
              pipelineBlendMode,
              'fill-stencil-cover',
            ),
          ]
          : [
            fillStencilCurveDesc,
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
        const depthStencil = draw.renderer.usesDepth
          ? usesStencilClip ? 'clip-cover-depth-less' : 'direct-depth-less'
          : usesStencilClip
          ? 'clip-cover'
          : 'direct';
        return usesStencilClip
          ? [createPipelineDesc(
            'drawing-path-fill-patch-clip-cover',
            'wedge-patch',
            'wedge-patch-instance',
            pipelineBlendMode,
            depthStencil,
          )]
          : [
            createPipelineDesc(
              'drawing-path-fill-patch-cover',
              'wedge-patch',
              'wedge-patch-instance',
              pipelineBlendMode,
              depthStencil,
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
        : [
          createPipelineDesc('drawing-path-fill-cover', 'path', 'device-vertex', pipelineBlendMode),
        ];
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
          : [
            createPipelineDesc(
              'drawing-path-stroke-cover',
              'path',
              'device-vertex',
              pipelineBlendMode,
            ),
          ];
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
    case 'directMaskText':
    case 'transformedMaskText':
      return [createPipelineDesc(
        usesStencilClip ? 'drawing-text-bitmap-clip-cover' : 'drawing-text-bitmap-cover',
        'bitmap-text',
        'text-instance',
        pipelineBlendMode,
        usesStencilClip ? 'clip-cover' : 'direct',
        false,
        'triangle-strip',
      )];
    case 'sdfText':
      return [createPipelineDesc(
        usesStencilClip ? 'drawing-text-sdf-clip-cover' : 'drawing-text-sdf-cover',
        'sdf-text',
        'text-instance',
        pipelineBlendMode,
        usesStencilClip ? 'clip-cover' : 'direct',
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
  const orderingDevice = createOrderingDevice();

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

    const pass = assignLayeredOrder(orderingDevice, {
      kind: 'drawPass',
      recorderId: recording.recorderId,
      loadOp: currentLoadOp,
      clearColor: currentClearColor,
      clipDraws: Object.freeze([]),
      steps: Object.freeze([...currentSteps]),
      renderSteps: Object.freeze([]),
      unsupportedDraws: Object.freeze([...currentUnsupportedDraws]),
      requiresMSAA: currentSteps.some((step) => step.requiresMSAA),
    });
    passes.push(pass);
    resetOrderingDevice(orderingDevice);

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
      const prepared = command.kind === 'drawPath' || command.kind === 'drawShape'
        ? prepareDrawingPathCommand(recording, recording.rendererProvider, command)
        : prepareDrawingTextCommand(recording, command);
      if (prepared.supported) {
        currentSteps.push({
          draw: prepared.draw,
          depth: 0,
          depthIndex: 0,
          originalOrder: -1,
          paintOrder: -1,
          stencilIndex: unassignedStencilIndex,
          dependsOnDst: false,
          requiresBarrier: false,
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
          usesDepth: (
            prepared.draw.kind === 'analyticRRect' ||
            prepared.draw.kind === 'perEdgeAAQuad' ||
            prepared.draw.kind === 'pathFill' ||
            prepared.draw.kind === 'pathStroke'
          ) &&
            prepared.draw.renderer.usesDepth &&
            (
              prepared.draw.kind === 'analyticRRect' ||
              prepared.draw.kind === 'perEdgeAAQuad' ||
              (prepared.draw.kind === 'pathStroke' &&
                prepared.draw.usesTessellatedStrokePatches &&
                prepared.draw.patches.length > 0) ||
              (prepared.draw.kind === 'pathFill' &&
                prepared.draw.patches.length > 0)
            ),
          requiresMSAA:
            (prepared.draw.kind === 'pathFill' || prepared.draw.kind === 'pathStroke') &&
            prepared.draw.renderer.requiresMSAA,
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
