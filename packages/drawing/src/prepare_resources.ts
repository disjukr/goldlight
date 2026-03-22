import type { DrawingPreparedClipElement } from './clip_stack.ts';
import type { Point2D } from '@rieul3d/geometry';
import { type DrawingPreparedRecording, prepareDrawingRecording } from './draw_pass.ts';
import type { DrawingRecording } from './recording.ts';
import type { DrawingPreparedPatch, DrawingPreparedVertex } from './path_renderer.ts';
import type { DawnSharedContext } from './shared_context.ts';

export type DrawingPreparedStepResources = Readonly<{
  pipelines: readonly GPURenderPipeline[];
  clipPipelines: readonly GPURenderPipeline[];
  fringePipeline: GPURenderPipeline | null;
  stepPayloadBuffer: GPUBuffer;
  stepBindGroup: GPUBindGroup;
  fillVertexBuffer: GPUBuffer | null;
  fillVertexCount: number;
  patchVertexBuffer: GPUBuffer | null;
  patchInstanceCount: number;
  patchVertexCount: number;
  fringeVertexBuffer: GPUBuffer | null;
  fringeVertexCount: number;
  boundsCoverVertexBuffer: GPUBuffer | null;
  boundsCoverVertexCount: number;
  clipVertexBuffers: readonly GPUBuffer[];
  clipVertexCounts: readonly number[];
  clipElements: readonly DrawingPreparedClipElement[];
}>;

export type DrawingPreparedPassResources = Readonly<{
  steps: readonly DrawingPreparedStepResources[];
}>;

export type DrawingPreparedCommandResources = Readonly<{
  viewportTransformBuffer: GPUBuffer;
  viewportBindGroup: GPUBindGroup;
  identityStepPayloadBuffer: GPUBuffer;
  identityStepBindGroup: GPUBindGroup;
  fullscreenClipVertexBuffer: GPUBuffer;
  fullscreenClipVertexCount: number;
  passes: readonly DrawingPreparedPassResources[];
}>;

export type DawnPreparedWork = Readonly<{
  backend: 'graphite-dawn';
  recording: DrawingRecording;
  prepared: DrawingPreparedRecording;
  resources: DrawingPreparedCommandResources;
}>;

const vertexBufferUsage = 0x0020;
const uniformBufferUsage = 0x0040;
const floatsPerVertex = 6;
const stepPayloadFloats = 16;
const wedgePatchFloats = 14;
const curvePatchFloats = 12;
const strokePatchFloats = 12;
const maxPatchResolveLevel = 6;
const patchSegmentCount = 1 << maxPatchResolveLevel;
const wedgePatchVertexCount = patchSegmentCount * 3;
const curvePatchVertexCount = patchSegmentCount * 3;
const strokePatchVertexCount = patchSegmentCount * 6;

const createVertexModulationData = (
  triangles: readonly (readonly [number, number])[],
  modulation: readonly [number, number, number, number],
): Float32Array => {
  const vertices = new Float32Array(triangles.length * floatsPerVertex);
  let offset = 0;

  for (const point of triangles) {
    vertices[offset++] = point[0];
    vertices[offset++] = point[1];
    vertices[offset++] = modulation[0];
    vertices[offset++] = modulation[1];
    vertices[offset++] = modulation[2];
    vertices[offset++] = modulation[3];
  }

  return vertices;
};

const createColoredDeviceSpaceVertexData = (
  triangles: readonly DrawingPreparedVertex[],
): Float32Array => {
  const vertices = new Float32Array(triangles.length * floatsPerVertex);
  let offset = 0;

  for (const vertex of triangles) {
    const coverage = vertex.color[3];
    vertices[offset++] = vertex.point[0];
    vertices[offset++] = vertex.point[1];
    vertices[offset++] = coverage;
    vertices[offset++] = coverage;
    vertices[offset++] = coverage;
    vertices[offset++] = coverage;
  }

  return vertices;
};

const createVertexBuffer = (
  sharedContext: DawnSharedContext,
  vertices: Float32Array,
): GPUBuffer => {
  const buffer = sharedContext.resourceProvider.createBuffer({
    label: 'drawing-vertices',
    size: vertices.byteLength,
    usage: vertexBufferUsage,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(vertices);
  buffer.unmap();
  return buffer;
};

const createViewportTransformBuffer = (
  sharedContext: DawnSharedContext,
): GPUBuffer => {
  const buffer = sharedContext.resourceProvider.createBuffer({
    label: 'drawing-viewport-transform',
    size: Float32Array.BYTES_PER_ELEMENT * 4,
    usage: uniformBufferUsage,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set([
    2 / Math.max(sharedContext.backend.target.width, 1),
    -2 / Math.max(sharedContext.backend.target.height, 1),
    -1,
    1,
  ]);
  buffer.unmap();
  return buffer;
};

const createStepPayloadBuffer = (
  sharedContext: DawnSharedContext,
  transform: readonly [number, number, number, number, number, number],
  color: readonly [number, number, number, number],
  halfWidth: number,
): GPUBuffer => {
  const buffer = sharedContext.resourceProvider.createBuffer({
    label: 'drawing-step-payload',
    size: Float32Array.BYTES_PER_ELEMENT * stepPayloadFloats,
    usage: uniformBufferUsage,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set([
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[4],
    transform[5],
    0,
    0,
    color[0],
    color[1],
    color[2],
    color[3],
    halfWidth,
    0,
    0,
    0,
  ]);
  buffer.unmap();
  return buffer;
};

const createBoundsCoverVertexData = (
  bounds: Readonly<{
    origin: readonly [number, number];
    size: Readonly<{
      width: number;
      height: number;
    }>;
  }>,
  color: readonly [number, number, number, number],
): Float32Array =>
  createVertexModulationData(
    [
      bounds.origin,
      [bounds.origin[0] + bounds.size.width, bounds.origin[1]],
      [bounds.origin[0] + bounds.size.width, bounds.origin[1] + bounds.size.height],
      bounds.origin,
      [bounds.origin[0] + bounds.size.width, bounds.origin[1] + bounds.size.height],
      [bounds.origin[0], bounds.origin[1] + bounds.size.height],
    ],
    color,
  );

const createFullscreenClipVertexData = (
  target: Readonly<{ width: number; height: number }>,
): Float32Array =>
  createBoundsCoverVertexData({
    origin: [0, 0],
    size: {
      width: target.width,
      height: target.height,
    },
  }, [0, 0, 0, 0]);

const toCurveType = (patch: DrawingPreparedPatch): number => {
  switch (patch.kind) {
    case 'line':
      return 0;
    case 'quadratic':
      return 1;
    case 'conic':
      return 2;
    case 'cubic':
      return 3;
  }
};

const getPatchPoints = (
  patch: DrawingPreparedPatch,
): readonly [Point2D, Point2D, Point2D, Point2D] =>
  patch.kind === 'line'
    ? [patch.points[0], patch.points[1], patch.points[1], patch.points[1]]
    : patch.kind === 'quadratic'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : patch.kind === 'conic'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];

const createWedgePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
): Float32Array => {
  const wedgePatches = patches.filter((patch) => patch.fanPoint !== undefined);
  const data = new Float32Array(wedgePatches.length * wedgePatchFloats);
  let offset = 0;
  for (const patch of wedgePatches) {
    const points = getPatchPoints(patch);
    data[offset++] = points[0][0];
    data[offset++] = points[0][1];
    data[offset++] = points[1][0];
    data[offset++] = points[1][1];
    data[offset++] = points[2][0];
    data[offset++] = points[2][1];
    data[offset++] = points[3][0];
    data[offset++] = points[3][1];
    data[offset++] = toCurveType(patch);
    data[offset++] = patch.kind === 'conic' ? patch.weight : 1;
    data[offset++] = Math.min(maxPatchResolveLevel, Math.max(0, patch.resolveLevel));
    data[offset++] = 0;
    data[offset++] = patch.fanPoint![0];
    data[offset++] = patch.fanPoint![1];
  }
  return data;
};

const createCurvePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
): Float32Array => {
  const data = new Float32Array(patches.length * curvePatchFloats);
  let offset = 0;
  for (const patch of patches) {
    const points = getPatchPoints(patch);
    data[offset++] = points[0]![0];
    data[offset++] = points[0]![1];
    data[offset++] = points[1]![0];
    data[offset++] = points[1]![1];
    data[offset++] = points[2]![0];
    data[offset++] = points[2]![1];
    data[offset++] = points[3]![0];
    data[offset++] = points[3]![1];
    data[offset++] = toCurveType(patch);
    data[offset++] = patch.kind === 'conic' ? patch.weight : 1;
    data[offset++] = Math.min(maxPatchResolveLevel, Math.max(0, patch.resolveLevel));
    data[offset++] = 0;
  }
  return data;
};

const createStrokePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
): Float32Array => {
  const data = new Float32Array(patches.length * strokePatchFloats);
  let offset = 0;
  for (const patch of patches) {
    const points = getPatchPoints(patch);
    data[offset++] = points[0]![0];
    data[offset++] = points[0]![1];
    data[offset++] = points[1]![0];
    data[offset++] = points[1]![1];
    data[offset++] = points[2]![0];
    data[offset++] = points[2]![1];
    data[offset++] = points[3]![0];
    data[offset++] = points[3]![1];
    data[offset++] = toCurveType(patch);
    data[offset++] = patch.kind === 'conic' ? patch.weight : 1;
    data[offset++] = Math.min(maxPatchResolveLevel, Math.max(0, patch.resolveLevel));
    data[offset++] = 0;
  }
  return data;
};

const getStencilClipCount = (
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
): number => step.draw.clip?.elements?.length ?? 0;

const createClipStepResources = (
  sharedContext: DawnSharedContext,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
): Readonly<{
  buffers: readonly GPUBuffer[];
  counts: readonly number[];
  elements: readonly DrawingPreparedClipElement[];
}> => {
  const clipElements = step.draw.clip?.elements;
  if (!clipElements || clipElements.length === 0) {
    return {
      buffers: Object.freeze([]),
      counts: Object.freeze([]),
      elements: Object.freeze([]),
    };
  }

  const buffers: GPUBuffer[] = [];
  const counts: number[] = [];
  for (const element of clipElements) {
    const clipVertices = createVertexModulationData(element.triangles, [0, 0, 0, 0]);
    buffers.push(createVertexBuffer(sharedContext, clipVertices));
    counts.push(clipVertices.length / floatsPerVertex);
  }

  return {
    buffers: Object.freeze(buffers),
    counts: Object.freeze(counts),
    elements: Object.freeze([...clipElements]),
  };
};

const prepareStepResources = (
  sharedContext: DawnSharedContext,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
): DrawingPreparedStepResources => {
  const pipelines = step.pipelineDescs.map((descriptor) =>
    sharedContext.resourceProvider.findOrCreateGraphicsPipeline(descriptor)
  );
  const clipPipelines = step.clipPipelineDescs.map((descriptor) =>
    sharedContext.resourceProvider.findOrCreateGraphicsPipeline(descriptor)
  );
  const clipResources = createClipStepResources(sharedContext, step);
  const stepPayloadBuffer = createStepPayloadBuffer(
    sharedContext,
    step.draw.transform,
    step.draw.color,
    step.draw.kind === 'pathStroke' ? step.draw.halfWidth : 0,
  );
  const stepBindGroup = sharedContext.resourceProvider.createStepBindGroup(stepPayloadBuffer);

  if (step.draw.kind === 'pathFill') {
    const usesPatchFill = step.draw.renderer !== 'middle-out-fan';
    const fillVertices = usesPatchFill
      ? null
      : createVertexModulationData(step.draw.triangles, [1, 1, 1, 1]);
    const patchVertices = step.draw.renderer === 'stencil-tessellated-wedges'
      ? createWedgePatchInstanceData(step.draw.patches)
      : step.draw.renderer === 'stencil-tessellated-curves'
      ? createCurvePatchInstanceData(step.draw.patches)
      : null;
    const fringeVertices = step.draw.fringeVertices
      ? createColoredDeviceSpaceVertexData(step.draw.fringeVertices)
      : null;
    const boundsCoverVertices = step.usesFillStencil
      ? createBoundsCoverVertexData(step.draw.bounds, [1, 1, 1, 1])
      : null;

    const fringePipeline = step.draw.fringeVertices
      ? sharedContext.resourceProvider.findOrCreateGraphicsPipeline({
        label: getStencilClipCount(step) > 0
          ? 'drawing-path-fill-clip-cover'
          : 'drawing-path-fill-cover',
        shader: 'path',
        vertexLayout: 'device-vertex',
        depthStencil: getStencilClipCount(step) > 0 ? 'clip-cover' : 'none',
        colorWriteDisabled: false,
      })
      : null;

    return {
      pipelines: Object.freeze(pipelines),
      clipPipelines: Object.freeze(clipPipelines),
      fringePipeline,
      stepPayloadBuffer,
      stepBindGroup,
      fillVertexBuffer: fillVertices ? createVertexBuffer(sharedContext, fillVertices) : null,
      fillVertexCount: fillVertices ? fillVertices.length / floatsPerVertex : 0,
      patchVertexBuffer: patchVertices && patchVertices.length > 0
        ? createVertexBuffer(sharedContext, patchVertices)
        : null,
      patchInstanceCount: patchVertices
        ? patchVertices.length /
          (step.draw.renderer === 'stencil-tessellated-wedges' ? wedgePatchFloats : curvePatchFloats)
        : 0,
      patchVertexCount: step.draw.renderer === 'stencil-tessellated-wedges'
        ? wedgePatchVertexCount
        : curvePatchVertexCount,
      fringeVertexBuffer: fringeVertices ? createVertexBuffer(sharedContext, fringeVertices) : null,
      fringeVertexCount: fringeVertices ? fringeVertices.length / floatsPerVertex : 0,
      boundsCoverVertexBuffer: boundsCoverVertices
        ? createVertexBuffer(sharedContext, boundsCoverVertices)
        : null,
      boundsCoverVertexCount: boundsCoverVertices ? boundsCoverVertices.length / floatsPerVertex : 0,
      clipVertexBuffers: clipResources.buffers,
      clipVertexCounts: clipResources.counts,
      clipElements: clipResources.elements,
    };
  }

  const strokeVertices = createVertexModulationData(step.draw.triangles, [1, 1, 1, 1]);
  const patchVertices = createStrokePatchInstanceData(step.draw.patches);
  const fringeVertices = step.draw.fringeVertices
    ? createColoredDeviceSpaceVertexData(step.draw.fringeVertices)
    : null;

  return {
    pipelines: Object.freeze(pipelines),
    clipPipelines: Object.freeze(clipPipelines),
    fringePipeline: step.draw.fringeVertices
      ? sharedContext.resourceProvider.findOrCreateGraphicsPipeline({
        label: getStencilClipCount(step) > 0
          ? 'drawing-path-stroke-clip-cover'
          : 'drawing-path-stroke-cover',
        shader: 'path',
        vertexLayout: 'device-vertex',
        depthStencil: getStencilClipCount(step) > 0 ? 'clip-cover' : 'none',
        colorWriteDisabled: false,
      })
      : null,
    stepPayloadBuffer,
    stepBindGroup,
    fillVertexBuffer: createVertexBuffer(sharedContext, strokeVertices),
    fillVertexCount: strokeVertices.length / floatsPerVertex,
    patchVertexBuffer: patchVertices.length > 0 ? createVertexBuffer(sharedContext, patchVertices) : null,
    patchInstanceCount: patchVertices.length / strokePatchFloats,
    patchVertexCount: strokePatchVertexCount,
    fringeVertexBuffer: fringeVertices ? createVertexBuffer(sharedContext, fringeVertices) : null,
    fringeVertexCount: fringeVertices ? fringeVertices.length / floatsPerVertex : 0,
    boundsCoverVertexBuffer: null,
    boundsCoverVertexCount: 0,
    clipVertexBuffers: clipResources.buffers,
    clipVertexCounts: clipResources.counts,
    clipElements: clipResources.elements,
  };
};

export const prepareDawnResources = (
  sharedContext: DawnSharedContext,
  prepared: DrawingPreparedRecording,
): DrawingPreparedCommandResources => {
  const viewportTransformBuffer = createViewportTransformBuffer(sharedContext);
  const viewportBindGroup = sharedContext.resourceProvider.createViewportBindGroup(
    viewportTransformBuffer,
  );
  const identityStepPayloadBuffer = createStepPayloadBuffer(
    sharedContext,
    [1, 0, 0, 1, 0, 0],
    [0, 0, 0, 0],
    0,
  );
  const identityStepBindGroup = sharedContext.resourceProvider.createStepBindGroup(
    identityStepPayloadBuffer,
  );
  const fullscreenClipVertices = createFullscreenClipVertexData(sharedContext.backend.target);
  const fullscreenClipVertexBuffer = createVertexBuffer(sharedContext, fullscreenClipVertices);

  return {
    viewportTransformBuffer,
    viewportBindGroup,
    identityStepPayloadBuffer,
    identityStepBindGroup,
    fullscreenClipVertexBuffer,
    fullscreenClipVertexCount: fullscreenClipVertices.length / floatsPerVertex,
    passes: Object.freeze(prepared.passes.map((passInfo) => ({
      steps: Object.freeze(passInfo.steps.map((step) => prepareStepResources(sharedContext, step))),
    }))),
  };
};

export const prepareDawnRecording = (
  sharedContext: DawnSharedContext,
  recording: DrawingRecording,
): DawnPreparedWork => {
  const prepared = prepareDrawingRecording(recording);
  return {
    backend: 'graphite-dawn',
    recording,
    prepared,
    resources: prepareDawnResources(sharedContext, prepared),
  };
};
