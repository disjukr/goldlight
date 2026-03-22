import type { DrawingPreparedClipElement } from './clip_stack.ts';
import type { Point2D } from '@rieul3d/geometry';
import { type DrawingPreparedRecording, prepareDrawingRecording } from './draw_pass.ts';
import type { DrawingRecording } from './recording.ts';
import type {
  DrawingPreparedPatch,
  DrawingPreparedStrokePatch,
  DrawingPreparedVertex,
} from './path_renderer.ts';
import type { DrawingGraphicsPipelineHandle } from './resource_provider.ts';
import type { DawnSharedContext } from './shared_context.ts';
import { createDrawingTaskList, type DrawingTaskList } from './task.ts';
import type { DrawingStrokeStyle } from './types.ts';

export type DrawingPreparedStepResources = Readonly<{
  pipelineHandles: readonly DrawingGraphicsPipelineHandle[];
  clipPipelineHandles: readonly DrawingGraphicsPipelineHandle[];
  pipelines: readonly GPURenderPipeline[];
  clipPipelines: readonly GPURenderPipeline[];
  fringePipeline: GPURenderPipeline | null;
  stepPayloadBuffer: GPUBuffer;
  stepBindGroup: GPUBindGroup;
  clipTextureView: GPUTextureView | null;
  clipTextureBindGroup: GPUBindGroup;
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
  pipelineHandles: readonly DrawingGraphicsPipelineHandle[];
  clipPipelineHandles: readonly DrawingGraphicsPipelineHandle[];
  resolvedPipelines: readonly GPURenderPipeline[];
  resolvedClipPipelines: readonly GPURenderPipeline[];
  sampledTextures: readonly GPUTextureView[];
  steps: readonly DrawingPreparedStepResources[];
}>;

export type DrawingPreparedRenderPassTaskResources = Readonly<{
  kind: 'renderPass';
  passes: readonly DrawingPreparedPassResources[];
}>;

export type DrawingPreparedCommandResources = Readonly<{
  viewportTransformBuffer: GPUBuffer;
  viewportBindGroup: GPUBindGroup;
  identityStepPayloadBuffer: GPUBuffer;
  identityStepBindGroup: GPUBindGroup;
  defaultClipTextureBindGroup: GPUBindGroup;
  fullscreenClipVertexBuffer: GPUBuffer;
  fullscreenClipVertexCount: number;
  tasks: readonly DrawingPreparedRenderPassTaskResources[];
}>;

export type DawnPreparedWork = Readonly<{
  backend: 'graphite-dawn';
  recording: DrawingRecording;
  prepared: DrawingPreparedRecording;
  tasks: DrawingTaskList;
  resources: DrawingPreparedCommandResources;
}>;

const vertexBufferUsage = 0x0020;
const uniformBufferUsage = 0x0040;
const floatsPerVertex = 6;
const stepPayloadFloats = 28;
const wedgePatchFloats = 14;
const curvePatchFloats = 12;
const strokePatchFloats = 16;
const maxPatchResolveLevel = 5;
const patchSegmentCount = 1 << maxPatchResolveLevel;
const wedgePatchVertexCount = patchSegmentCount * 3;
const curvePatchVertexCount = patchSegmentCount * 3;
const maxStrokeEdges = (1 << 14) - 1;

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
  strokeStyle: DrawingStrokeStyle | null,
  clip: Readonly<{
    hasAtlas: boolean;
    atlasOrigin: Point2D;
    atlasInvSize: Point2D;
    hasAnalyticRect: boolean;
    analyticOrigin: Point2D;
    analyticSize: Point2D;
    hasShader: boolean;
    shaderColor: readonly [number, number, number, number];
  }>,
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
    strokeStyle?.halfWidth ?? 0,
    clip.hasAtlas ? 1 : 0,
    clip.hasAnalyticRect ? 1 : 0,
    clip.hasShader ? 1 : 0,
    clip.atlasOrigin[0],
    clip.atlasOrigin[1],
    clip.atlasInvSize[0],
    clip.atlasInvSize[1],
    clip.analyticOrigin[0],
    clip.analyticOrigin[1],
    clip.analyticSize[0],
    clip.analyticSize[1],
    clip.shaderColor[0],
    clip.shaderColor[1],
    clip.shaderColor[2],
    clip.shaderColor[3],
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

const quadraticToCubicPoints = (
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
): readonly [Point2D, Point2D, Point2D, Point2D] => {
  const c1: Point2D = [
    p0[0] + ((p1[0] - p0[0]) * (2 / 3)),
    p0[1] + ((p1[1] - p0[1]) * (2 / 3)),
  ];
  const c2: Point2D = [
    p2[0] + ((p1[0] - p2[0]) * (2 / 3)),
    p2[1] + ((p1[1] - p2[1]) * (2 / 3)),
  ];
  return [p0, c1, c2, p2];
};

const transformPoint = (
  point: Point2D,
  matrix: readonly [number, number, number, number, number, number],
): Point2D => [
  (matrix[0] * point[0]) + (matrix[2] * point[1]) + matrix[4],
  (matrix[1] * point[0]) + (matrix[3] * point[1]) + matrix[5],
];

const maxScaleFactor = (
  matrix: readonly [number, number, number, number, number, number],
): number => {
  const a = matrix[0];
  const b = matrix[1];
  const c = matrix[2];
  const d = matrix[3];
  const sum = (a * a) + (b * b) + (c * c) + (d * d);
  const det = (a * d) - (b * c);
  const disc = Math.max((sum * sum) - (4 * det * det), 0);
  return Math.sqrt(Math.max((sum + Math.sqrt(disc)) * 0.5, 1));
};

const calcNumRadialSegmentsPerRadian = (approxStrokeRadius: number): number => {
  const radius = Math.max(approxStrokeRadius, 0.5);
  const cosTheta = 1 - ((1 / 4) / radius);
  return 0.5 / Math.acos(Math.max(cosTheta, -1));
};

const cubicWangsFormulaP4 = (
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
): number => {
  const v1x = p0[0] - (2 * p1[0]) + p2[0];
  const v1y = p0[1] - (2 * p1[1]) + p2[1];
  const v2x = p1[0] - (2 * p2[0]) + p3[0];
  const v2y = p1[1] - (2 * p2[1]) + p3[1];
  return Math.max((v1x * v1x) + (v1y * v1y), (v2x * v2x) + (v2y * v2y)) * (4 * (81 / 64));
};

const conicWangsFormulaP4 = (
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  weight: number,
): number => {
  const center: Point2D = [
    (Math.min(p0[0], p1[0], p2[0]) + Math.max(p0[0], p1[0], p2[0])) * 0.5,
    (Math.min(p0[1], p1[1], p2[1]) + Math.max(p0[1], p1[1], p2[1])) * 0.5,
  ];
  const c0: Point2D = [p0[0] - center[0], p0[1] - center[1]];
  const c1: Point2D = [p1[0] - center[0], p1[1] - center[1]];
  const c2: Point2D = [p2[0] - center[0], p2[1] - center[1]];
  const maxLen = Math.max(
    Math.hypot(c0[0], c0[1]),
    Math.hypot(c1[0], c1[1]),
    Math.hypot(c2[0], c2[1]),
  );
  const dp: Point2D = [
    c0[0] + c2[0] - (2 * weight * c1[0]),
    c0[1] + c2[1] - (2 * weight * c1[1]),
  ];
  const dw = Math.abs(2 - (2 * weight));
  const rpMinus1 = Math.max(0, (maxLen * 4) - 1);
  const numer = (Math.hypot(dp[0], dp[1]) * 4) + (rpMinus1 * dw);
  const denom = 4 * Math.min(weight, 1);
  const p2Val = denom <= 1e-5 ? Infinity : Math.max(0, numer / denom);
  return p2Val * p2Val;
};

const requiredStrokeEdgesForPatch = (
  patch: DrawingPreparedStrokePatch,
  transform: readonly [number, number, number, number, number, number],
  strokeStyle: DrawingStrokeStyle,
): number => {
  const sourcePoints = getStrokePatchPoints(patch.patch);
  const points: readonly [Point2D, Point2D, Point2D, Point2D] = [
    transformPoint(sourcePoints[0], transform),
    transformPoint(sourcePoints[1], transform),
    transformPoint(sourcePoints[2], transform),
    transformPoint(sourcePoints[3], transform),
  ];
  const maxScale = maxScaleFactor(transform);
  const numRadialSegmentsPerRadian = calcNumRadialSegmentsPerRadian(
    strokeStyle.halfWidth * maxScale,
  );
  const maxRadialSegmentsInStroke = Math.max(Math.ceil(numRadialSegmentsPerRadian * Math.PI), 1);
  let numParametricSegmentsP4 = 1;
  if (patch.patch.kind === 'conic') {
    numParametricSegmentsP4 = conicWangsFormulaP4(
      points[0],
      points[1],
      points[2],
      patch.patch.weight,
    );
  } else {
    numParametricSegmentsP4 = cubicWangsFormulaP4(points[0], points[1], points[2], points[3]);
  }
  const maxParametricSegmentsInStroke = Math.max(
    1,
    Math.ceil(Math.sqrt(Math.sqrt(Math.max(numParametricSegmentsP4, 1)))),
  );
  let edgesInJoins = strokeStyle.joinLimit > 0 ? 4 : 3;
  if (strokeStyle.joinLimit < 0 && numRadialSegmentsPerRadian > 0) {
    edgesInJoins += Math.ceil(numRadialSegmentsPerRadian * Math.PI) - 1;
  }
  return Math.min(
    maxStrokeEdges,
    edgesInJoins + maxRadialSegmentsInStroke + maxParametricSegmentsInStroke,
  );
};

const requiredStrokeVertexCount = (
  patches: readonly DrawingPreparedStrokePatch[],
  transform: readonly [number, number, number, number, number, number],
  strokeStyle: DrawingStrokeStyle,
): number => {
  if (patches.length === 0) {
    return 0;
  }
  let maxEdgesRequired = 1;
  for (const patch of patches) {
    maxEdgesRequired = Math.max(
      maxEdgesRequired,
      requiredStrokeEdgesForPatch(patch, transform, strokeStyle),
    );
  }
  return Math.min(maxStrokeEdges, maxEdgesRequired) * 2;
};

const getPatchPoints = (
  patch: DrawingPreparedPatch,
): readonly [Point2D, Point2D, Point2D, Point2D] =>
  patch.kind === 'line'
    ? [patch.points[0], patch.points[0], patch.points[1], patch.points[1]]
    : patch.kind === 'quadratic'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : patch.kind === 'conic'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];

const getStrokePatchPoints = (
  patch: DrawingPreparedPatch,
): readonly [Point2D, Point2D, Point2D, Point2D] =>
  patch.kind === 'quadratic'
    ? quadraticToCubicPoints(patch.points[0], patch.points[1], patch.points[2])
    : getPatchPoints(patch);

const toStrokeCurveType = (patch: DrawingPreparedPatch): number =>
  patch.kind === 'quadratic' ? 3 : toCurveType(patch);

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
  patches: readonly DrawingPreparedStrokePatch[],
  strokeStyle: DrawingStrokeStyle,
): Float32Array => {
  const data = new Float32Array(patches.length * strokePatchFloats);
  let offset = 0;
  for (const patch of patches) {
    const points = getStrokePatchPoints(patch.patch);
    data[offset++] = points[0]![0];
    data[offset++] = points[0]![1];
    data[offset++] = points[1]![0];
    data[offset++] = points[1]![1];
    data[offset++] = points[2]![0];
    data[offset++] = points[2]![1];
    data[offset++] = points[3]![0];
    data[offset++] = points[3]![1];
    data[offset++] = patch.joinControlPoint[0];
    data[offset++] = patch.joinControlPoint[1];
    data[offset++] = strokeStyle.halfWidth;
    data[offset++] = strokeStyle.joinLimit;
    data[offset++] = toStrokeCurveType(patch.patch);
    data[offset++] = patch.patch.kind === 'conic' ? patch.patch.weight : 1;
    data[offset++] = Math.min(maxPatchResolveLevel, Math.max(0, patch.patch.resolveLevel));
    data[offset++] = (patch.contourStart ? 1 : 0) +
      (patch.contourEnd ? 2 : 0) +
      (patch.startCap === 'square' ? 4 : 0) +
      (patch.endCap === 'square' ? 8 : 0) +
      (patch.startCap === 'round' ? 16 : 0) +
      (patch.endCap === 'round' ? 32 : 0);
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
  const clipElements = step.draw.clip?.deferredClipDraws ?? step.draw.clip?.elements;
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
  const pipelineHandles = step.pipelineDescs.map((descriptor) =>
    sharedContext.resourceProvider.createGraphicsPipelineHandle(descriptor)
  );
  const clipPipelineHandles = step.clipPipelineDescs.map((descriptor) =>
    sharedContext.resourceProvider.createGraphicsPipelineHandle(descriptor)
  );
  const pipelines = pipelineHandles.map((handle) =>
    sharedContext.resourceProvider.resolveGraphicsPipelineHandle(handle)
  );
  const clipPipelines = clipPipelineHandles.map((handle) =>
    sharedContext.resourceProvider.resolveGraphicsPipelineHandle(handle)
  );
  const clipResources = createClipStepResources(sharedContext, step);
  const clipAtlasView = sharedContext.atlasProvider.getClipAtlasManager().findOrCreateEntry(
    step.draw.clip?.atlasClip,
  );
  const clipTextureBindGroup = sharedContext.resourceProvider.createClipTextureBindGroup(
    clipAtlasView ?? undefined,
  );
  const clipPayload = {
    hasAtlas: Boolean(step.draw.clip?.atlasClip),
    atlasOrigin: step.draw.clip?.atlasClip?.bounds.origin ?? [0, 0],
    atlasInvSize: step.draw.clip?.atlasClip
      ? [
        1 / Math.max(step.draw.clip.atlasClip.bounds.size.width, 1),
        1 / Math.max(step.draw.clip.atlasClip.bounds.size.height, 1),
      ] as readonly [number, number]
      : [0, 0] as const,
    hasAnalyticRect: Boolean(step.draw.clip?.analyticClip),
    analyticOrigin: step.draw.clip?.analyticClip?.rect.origin ?? [0, 0],
    analyticSize: step.draw.clip?.analyticClip
      ? [
        step.draw.clip.analyticClip.rect.size.width,
        step.draw.clip.analyticClip.rect.size.height,
      ] as readonly [number, number]
      : [0, 0] as const,
    hasShader: Boolean(step.draw.clip?.shader),
    shaderColor: step.draw.clip?.shader?.color ?? [1, 1, 1, 1] as const,
  };
  const stepPayloadBuffer = createStepPayloadBuffer(
    sharedContext,
    step.draw.transform,
    step.draw.color,
    step.draw.kind === 'pathStroke' ? step.draw.strokeStyle : null,
    clipPayload,
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
        label: step.usesFillStencil
          ? 'drawing-path-fill-stencil-cover'
          : getStencilClipCount(step) > 0
          ? 'drawing-path-fill-clip-cover'
          : 'drawing-path-fill-cover',
        shader: 'path',
        vertexLayout: 'device-vertex',
        depthStencil: step.usesFillStencil
          ? 'fill-stencil-cover'
          : getStencilClipCount(step) > 0
          ? 'clip-cover'
          : 'none',
        colorWriteDisabled: false,
        topology: 'triangle-list',
      })
      : null;

    return {
      pipelineHandles: Object.freeze(pipelineHandles),
      clipPipelineHandles: Object.freeze(clipPipelineHandles),
      pipelines: Object.freeze(pipelines),
      clipPipelines: Object.freeze(clipPipelines),
      fringePipeline,
      stepPayloadBuffer,
      stepBindGroup,
      clipTextureView: clipAtlasView,
      clipTextureBindGroup,
      fillVertexBuffer: fillVertices ? createVertexBuffer(sharedContext, fillVertices) : null,
      fillVertexCount: fillVertices ? fillVertices.length / floatsPerVertex : 0,
      patchVertexBuffer: patchVertices && patchVertices.length > 0
        ? createVertexBuffer(sharedContext, patchVertices)
        : null,
      patchInstanceCount: patchVertices
        ? patchVertices.length /
          (step.draw.renderer === 'stencil-tessellated-wedges'
            ? wedgePatchFloats
            : curvePatchFloats)
        : 0,
      patchVertexCount: step.draw.renderer === 'stencil-tessellated-wedges'
        ? wedgePatchVertexCount
        : curvePatchVertexCount,
      fringeVertexBuffer: fringeVertices ? createVertexBuffer(sharedContext, fringeVertices) : null,
      fringeVertexCount: fringeVertices ? fringeVertices.length / floatsPerVertex : 0,
      boundsCoverVertexBuffer: boundsCoverVertices
        ? createVertexBuffer(sharedContext, boundsCoverVertices)
        : null,
      boundsCoverVertexCount: boundsCoverVertices
        ? boundsCoverVertices.length / floatsPerVertex
        : 0,
      clipVertexBuffers: clipResources.buffers,
      clipVertexCounts: clipResources.counts,
      clipElements: clipResources.elements,
    };
  }

  const strokeVertices = createVertexModulationData(step.draw.triangles, [1, 1, 1, 1]);
  const patchVertices = step.draw.usesTessellatedStrokePatches
    ? createStrokePatchInstanceData(step.draw.patches, step.draw.strokeStyle)
    : new Float32Array(0);
  const patchVertexCount = step.draw.usesTessellatedStrokePatches
    ? requiredStrokeVertexCount(step.draw.patches, step.draw.transform, step.draw.strokeStyle)
    : 0;
  const fringeVertices = step.draw.usesTessellatedStrokePatches
    ? null
    : step.draw.fringeVertices
    ? createColoredDeviceSpaceVertexData(step.draw.fringeVertices)
    : null;

  return {
    pipelineHandles: Object.freeze(pipelineHandles),
    clipPipelineHandles: Object.freeze(clipPipelineHandles),
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
        topology: 'triangle-list',
      })
      : null,
    stepPayloadBuffer,
    stepBindGroup,
    clipTextureView: clipAtlasView,
    clipTextureBindGroup,
    fillVertexBuffer: createVertexBuffer(sharedContext, strokeVertices),
    fillVertexCount: strokeVertices.length / floatsPerVertex,
    patchVertexBuffer: patchVertices.length > 0
      ? createVertexBuffer(sharedContext, patchVertices)
      : null,
    patchInstanceCount: patchVertices.length / strokePatchFloats,
    patchVertexCount,
    fringeVertexBuffer: fringeVertices ? createVertexBuffer(sharedContext, fringeVertices) : null,
    fringeVertexCount: fringeVertices ? fringeVertices.length / floatsPerVertex : 0,
    boundsCoverVertexBuffer: null,
    boundsCoverVertexCount: 0,
    clipVertexBuffers: clipResources.buffers,
    clipVertexCounts: clipResources.counts,
    clipElements: clipResources.elements,
  };
};

const preparePassResources = (
  sharedContext: DawnSharedContext,
  passInfo: DrawingPreparedRecording['passes'][number],
): DrawingPreparedPassResources => {
  const steps = passInfo.steps.map((step) => prepareStepResources(sharedContext, step));
  const pipelineHandles = steps.flatMap((step) => step.pipelineHandles);
  const clipPipelineHandles = steps.flatMap((step) => step.clipPipelineHandles);
  return {
    pipelineHandles: Object.freeze(pipelineHandles),
    clipPipelineHandles: Object.freeze(clipPipelineHandles),
    resolvedPipelines: Object.freeze(steps.flatMap((step) => step.pipelines)),
    resolvedClipPipelines: Object.freeze(steps.flatMap((step) => step.clipPipelines)),
    sampledTextures: Object.freeze([]),
    steps: Object.freeze(steps),
  };
};

export const prepareDawnResources = (
  sharedContext: DawnSharedContext,
  tasks: DrawingTaskList,
): DrawingPreparedCommandResources => {
  const viewportTransformBuffer = createViewportTransformBuffer(sharedContext);
  const viewportBindGroup = sharedContext.resourceProvider.createViewportBindGroup(
    viewportTransformBuffer,
  );
  const identityStepPayloadBuffer = createStepPayloadBuffer(
    sharedContext,
    [1, 0, 0, 1, 0, 0],
    [0, 0, 0, 0],
    null,
    {
      hasAtlas: false,
      atlasOrigin: [0, 0],
      atlasInvSize: [0, 0],
      hasAnalyticRect: false,
      analyticOrigin: [0, 0],
      analyticSize: [0, 0],
      hasShader: false,
      shaderColor: [1, 1, 1, 1],
    },
  );
  const identityStepBindGroup = sharedContext.resourceProvider.createStepBindGroup(
    identityStepPayloadBuffer,
  );
  const defaultClipTextureBindGroup = sharedContext.resourceProvider.createClipTextureBindGroup();
  const fullscreenClipVertices = createFullscreenClipVertexData(sharedContext.backend.target);
  const fullscreenClipVertexBuffer = createVertexBuffer(sharedContext, fullscreenClipVertices);

  return {
    viewportTransformBuffer,
    viewportBindGroup,
    identityStepPayloadBuffer,
    identityStepBindGroup,
    defaultClipTextureBindGroup,
    fullscreenClipVertexBuffer,
    fullscreenClipVertexCount: fullscreenClipVertices.length / floatsPerVertex,
    tasks: Object.freeze(tasks.tasks.map((task): DrawingPreparedRenderPassTaskResources => ({
      kind: 'renderPass',
      passes: Object.freeze(
        task.drawPasses.map((passInfo) => preparePassResources(sharedContext, passInfo)),
      ),
    }))),
  };
};

export const prepareDawnRecording = (
  sharedContext: DawnSharedContext,
  recording: DrawingRecording,
): DawnPreparedWork => {
  const prepared = prepareDrawingRecording(recording);
  const tasks = createDrawingTaskList(prepared);
  return {
    backend: 'graphite-dawn',
    recording,
    prepared,
    tasks,
    resources: prepareDawnResources(sharedContext, tasks),
  };
};
