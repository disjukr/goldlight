import type { DrawingPreparedClipElement } from './clip_stack.ts';
import { identityMatrix2D, type Point2D } from '@rieul3d/geometry';
import {
  type DrawingPreparedClipDraw,
  type DrawingPreparedRecording,
  type DrawingPreparedRenderStep,
  prepareDrawingRecording,
} from './draw_pass.ts';
import type { DrawingRecording } from './recording.ts';
import type {
  DrawingPreparedPatch,
  DrawingPreparedShader,
  DrawingPreparedStrokePatch,
  DrawingPreparedVertex,
} from './path_renderer.ts';
import { drawingDstUsage, toDrawingBlendModeCode } from './path_renderer.ts';
import type { DrawingGraphicsPipelineHandle } from './resource_provider.ts';
import { isDrawingPatchFillRenderer } from './renderer_provider.ts';
import type { DawnSharedContext } from './shared_context.ts';
import { createDrawingTaskList, type DrawingTaskList } from './task.ts';
import type { DrawingStrokeStyle } from './types.ts';

export type DrawingPreparedStepResources = Readonly<{
  pipelineHandle: DrawingGraphicsPipelineHandle;
  pipeline: GPURenderPipeline;
  stepPayloadBuffer: GPUBuffer;
  stepBindGroup: GPUBindGroup;
  clipTextureView: GPUTextureView | null;
  clipDrawKey: string | null;
  vertexBuffer: GPUBuffer | null;
  instanceBuffer: GPUBuffer | null;
  vertexCount: number;
  instanceCount: number;
}>;

export type DrawingPreparedClipDrawResources = Readonly<{
  id: number;
  pipelineHandle: DrawingGraphicsPipelineHandle;
  pipeline: GPURenderPipeline;
  clipVertexBuffer: GPUBuffer;
  clipVertexCount: number;
  clipElement: DrawingPreparedClipElement;
  scissorBounds: DrawingPreparedClipDraw['scissorBounds'];
  maxDepth: number;
}>;

export type DrawingPreparedPassResources = Readonly<{
  pipelineHandles: readonly DrawingGraphicsPipelineHandle[];
  resolvedPipelines: readonly GPURenderPipeline[];
  clipDraws: readonly DrawingPreparedClipDrawResources[];
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
  gradientBuffer: GPUBuffer;
  gradientBindGroup: GPUBindGroup;
  identityStepPayloadBuffer: GPUBuffer;
  identityStepBindGroup: GPUBindGroup;
  defaultClipTextureBindGroup: GPUBindGroup;
  fullscreenClipVertexBuffer: GPUBuffer;
  fullscreenClipVertexCount: number;
  ownedBuffers: readonly GPUBuffer[];
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
const storageBufferUsage = 0x0080;
const floatsPerVertex = 6;
const stepPayloadFloats = 64;
const wedgePatchFloats = 14;
const curvePatchFloats = 12;
const strokePatchFloats = 14;
const maxPatchResolveLevel = 5;
const maxStrokeEdges = (1 << 14) - 1;

const numCurveTrianglesAtResolveLevel = (resolveLevel: number): number =>
  resolveLevel <= 0 ? 0 : (1 << resolveLevel) - 1;

const fixedCurveVertexCountForResolveLevel = (resolveLevel: number): number =>
  numCurveTrianglesAtResolveLevel(resolveLevel) * 3;

const fixedWedgeVertexCountForResolveLevel = (resolveLevel: number): number =>
  (numCurveTrianglesAtResolveLevel(resolveLevel) + 1) * 3;

const createFixedCountCurveVertices = (): readonly (readonly [number, number])[] => {
  const vertices: [number, number][] = [[0, 0], [0, 1]];
  for (let resolveLevel = 1; resolveLevel <= maxPatchResolveLevel; resolveLevel += 1) {
    const numSegments = 1 << resolveLevel;
    for (let index = 1; index < numSegments; index += 2) {
      vertices.push([resolveLevel, index]);
    }
  }
  return Object.freeze(vertices);
};

const appendIndexedTriangleVertices = (
  source: readonly (readonly [number, number])[],
  indices: readonly number[],
): Float32Array => {
  const data = new Float32Array(indices.length * 2);
  let offset = 0;
  for (const index of indices) {
    const vertex = source[index]!;
    data[offset++] = vertex[0];
    data[offset++] = vertex[1];
  }
  return data;
};

const createFixedCountCurveIndices = (baseIndex: number): number[] => {
  const indices: number[] = [baseIndex, baseIndex + 2, baseIndex + 1];
  let triangleCursor = 0;
  let nextIndex = baseIndex + 3;
  for (let resolveLevel = 2; resolveLevel <= maxPatchResolveLevel; resolveLevel += 1) {
    const numPairs = 1 << (resolveLevel - 2);
    for (let pairIndex = 0; pairIndex < numPairs; pairIndex += 1) {
      const neighbor = triangleCursor + pairIndex;
      const a = indices[(neighbor * 3) + 0]!;
      const b = indices[(neighbor * 3) + 1]!;
      const c = indices[(neighbor * 3) + 2]!;
      indices.push(a, nextIndex++, b);
      indices.push(b, nextIndex++, c);
    }
    triangleCursor += numPairs;
  }
  return indices;
};

const fixedCurveTemplateVertices = (() => {
  const vertices = createFixedCountCurveVertices();
  const indices = createFixedCountCurveIndices(0);
  return appendIndexedTriangleVertices(vertices, indices);
})();

const fixedWedgeTemplateVertices = (() => {
  const vertices: (readonly [number, number])[] = [[-1, -1], ...createFixedCountCurveVertices()];
  const indices = [0, 1, 2, ...createFixedCountCurveIndices(1)];
  return appendIndexedTriangleVertices(vertices, indices);
})();

const getPatchFillVertexCount = (
  patches: readonly DrawingPreparedPatch[],
  patchMode: 'wedge' | 'curve',
): number => {
  const maxResolveLevel = patches.reduce(
    (currentMax, patch) => Math.max(currentMax, patch.resolveLevel),
    0,
  );
  return patchMode === 'wedge'
    ? fixedWedgeVertexCountForResolveLevel(maxResolveLevel)
    : fixedCurveVertexCountForResolveLevel(maxResolveLevel);
};

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
    vertices[offset++] = 1;
    vertices[offset++] = 1;
    vertices[offset++] = 1;
    vertices[offset++] = coverage;
  }

  return vertices;
};

const createDeviceSpaceVertexData = (
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

const createPatchTemplateBuffer = (
  sharedContext: DawnSharedContext,
  vertices: Float32Array,
): GPUBuffer => {
  const buffer = sharedContext.resourceProvider.createBuffer({
    label: 'drawing-patch-template-vertices',
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

const createGradientStorageBuffer = (
  sharedContext: DawnSharedContext,
  floats: readonly number[],
): GPUBuffer => {
  const payload = floats.length > 0 ? floats : [0];
  const buffer = sharedContext.resourceProvider.createBuffer({
    label: 'drawing-gradient-storage',
    size: Float32Array.BYTES_PER_ELEMENT * payload.length,
    usage: storageBufferUsage,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(payload);
  buffer.unmap();
  return buffer;
};

const createStepPayloadBuffer = (
  sharedContext: DawnSharedContext,
  transform: readonly [number, number, number, number, number, number],
  depth: number,
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
  dst: Readonly<{
    blendModeCode: number;
    requiresDstRead: boolean;
    invSize: Point2D;
    blenderCoefficients: readonly [number, number, number, number];
  }>,
  shader: Readonly<{
    kindCode: number;
    numStops: number;
    bufferOffset: number;
    tileModeCode: number;
    params0: readonly [number, number, number, number];
    params1: readonly [number, number, number, number];
    localMatrix0: readonly [number, number, number, number];
    localMatrix1: readonly [number, number, number, number];
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
    maxScaleFactor(transform),
    depth,
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
    dst.blendModeCode,
    dst.requiresDstRead ? 1 : 0,
    dst.invSize[0],
    dst.invSize[1],
    dst.blenderCoefficients[0],
    dst.blenderCoefficients[1],
    dst.blenderCoefficients[2],
    dst.blenderCoefficients[3],
    shader.kindCode,
    shader.numStops,
    shader.bufferOffset,
    shader.tileModeCode,
    shader.params0[0],
    shader.params0[1],
    shader.params0[2],
    shader.params0[3],
    shader.params1[0],
    shader.params1[1],
    shader.params1[2],
    shader.params1[3],
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    shader.localMatrix0[0],
    shader.localMatrix0[1],
    shader.localMatrix0[2],
    shader.localMatrix0[3],
    shader.localMatrix1[0],
    shader.localMatrix1[1],
    shader.localMatrix1[2],
    shader.localMatrix1[3],
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
  createDeviceSpaceVertexData(
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

const invertAffineMatrix = (
  matrix: readonly [number, number, number, number, number, number],
): readonly [number, number, number, number, number, number] => {
  const det = (matrix[0] * matrix[3]) - (matrix[1] * matrix[2]);
  if (Math.abs(det) <= 1e-8) {
    return identityMatrix2D;
  }
  const invDet = 1 / det;
  const a = matrix[3] * invDet;
  const b = -matrix[1] * invDet;
  const c = -matrix[2] * invDet;
  const d = matrix[0] * invDet;
  const tx = -((a * matrix[4]) + (c * matrix[5]));
  const ty = -((b * matrix[4]) + (d * matrix[5]));
  return [a, b, c, d, tx, ty];
};

type DrawingGradientPayload = Readonly<{
  kindCode: number;
  numStops: number;
  bufferOffset: number;
  tileModeCode: number;
  params0: readonly [number, number, number, number];
  params1: readonly [number, number, number, number];
  localMatrix0: readonly [number, number, number, number];
  localMatrix1: readonly [number, number, number, number];
}>;

type DrawingGradientBufferBuilder = Readonly<{
  data: number[];
  cache: Map<string, Readonly<{ bufferOffset: number; numStops: number }>>;
}>;

const createGradientBufferBuilder = (): DrawingGradientBufferBuilder => ({
  data: [],
  cache: new Map(),
});

const toGradientTileModeCode = (
  tileMode: DrawingPreparedShader['tileMode'] | undefined,
): number => tileMode === 'repeat' ? 1 : tileMode === 'mirror' ? 2 : tileMode === 'decal' ? 3 : 0;

const toGradientColorSpaceCode = (
  shader: DrawingPreparedShader,
): number =>
  shader.interpolation?.colorSpace === 'srgb'
    ? 1
    : shader.interpolation?.colorSpace === 'srgb-linear'
    ? 2
    : 0;

const normalizeGradientStops = (
  shader: DrawingPreparedShader,
): readonly { offset: number; color: readonly [number, number, number, number] }[] => {
  const sourceStops = shader.stops.length > 0
    ? shader.stops
    : [{ offset: 0, color: [0, 0, 0, 1] as const }];
  const sorted = [...sourceStops]
    .map((stop) => ({
      offset: Math.min(1, Math.max(0, stop.offset)),
      color: stop.color,
    }))
    .sort((left, right) => left.offset - right.offset);
  if (sorted.length === 1) {
    return Object.freeze([
      sorted[0]!,
      { offset: 1, color: sorted[0]!.color },
    ]);
  }
  const normalized = [...sorted];
  if (normalized[0]!.offset > 0) {
    normalized.unshift({ offset: 0, color: normalized[0]!.color });
  }
  if (normalized[normalized.length - 1]!.offset < 1) {
    normalized.push({ offset: 1, color: normalized[normalized.length - 1]!.color });
  }
  return Object.freeze(normalized);
};

const getGradientStopBufferEntry = (
  builder: DrawingGradientBufferBuilder,
  shader: DrawingPreparedShader,
): Readonly<{ bufferOffset: number; numStops: number }> => {
  const stops = normalizeGradientStops(shader);
  const cacheKey = JSON.stringify(
    stops.map((stop) => [stop.offset, ...stop.color]),
  );
  const existing = builder.cache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const bufferOffset = builder.data.length;
  for (const stop of stops) {
    builder.data.push(stop.offset);
  }
  for (const stop of stops) {
    builder.data.push(stop.color[0], stop.color[1], stop.color[2], stop.color[3]);
  }
  const entry = { bufferOffset, numStops: stops.length };
  builder.cache.set(cacheKey, entry);
  return entry;
};

const createGradientPayload = (
  shader: DrawingPreparedShader | undefined,
  transform: readonly [number, number, number, number, number, number],
  builder: DrawingGradientBufferBuilder,
): DrawingGradientPayload => {
  const inverse = invertAffineMatrix(transform);
  const localMatrix0: readonly [number, number, number, number] = [
    inverse[0],
    inverse[1],
    inverse[2],
    inverse[3],
  ];
  const localMatrix1: readonly [number, number, number, number] = [
    inverse[4],
    inverse[5],
    0,
    0,
  ];
  if (!shader) {
    return {
      kindCode: 0,
      numStops: 0,
      bufferOffset: 0,
      tileModeCode: 0,
      params0: [0, 0, 0, 0],
      params1: [0, 0, 0, 0],
      localMatrix0,
      localMatrix1,
    };
  }
  const stops = getGradientStopBufferEntry(builder, shader);
  const common = {
    numStops: stops.numStops,
    bufferOffset: stops.bufferOffset,
    tileModeCode: toGradientTileModeCode(shader.tileMode),
    localMatrix0,
    localMatrix1,
  } as const;
  if (shader.kind === 'linear-gradient') {
    return {
      kindCode: 1,
      ...common,
      params0: [shader.start[0], shader.start[1], shader.end[0], shader.end[1]],
      params1: [toGradientColorSpaceCode(shader), shader.interpolation?.inPremul ? 1 : 0, 0, 0],
    };
  }
  if (shader.kind === 'radial-gradient') {
    return {
      kindCode: 2,
      ...common,
      params0: [shader.center[0], shader.center[1], shader.radius, 0],
      params1: [toGradientColorSpaceCode(shader), shader.interpolation?.inPremul ? 1 : 0, 0, 0],
    };
  }
  if (shader.kind === 'two-point-conical-gradient') {
    return {
      kindCode: 3,
      ...common,
      params0: [
        shader.startCenter[0],
        shader.startCenter[1],
        shader.endCenter[0],
        shader.endCenter[1],
      ],
      params1: [
        shader.startRadius,
        shader.endRadius,
        toGradientColorSpaceCode(shader),
        shader.interpolation?.inPremul ? 1 : 0,
      ],
    };
  }
  const startAngle = shader.startAngle;
  const endAngle = shader.endAngle ?? (shader.startAngle + (Math.PI * 2));
  const t0 = startAngle / (Math.PI * 2);
  const t1 = endAngle / (Math.PI * 2);
  return {
    kindCode: 4,
    ...common,
    params0: [
      shader.center[0],
      shader.center[1],
      -t0,
      1 / Math.max(t1 - t0, 1e-5),
    ],
    params1: [toGradientColorSpaceCode(shader), shader.interpolation?.inPremul ? 1 : 0, 0, 0],
  };
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
  }
  return data;
};

const getStencilClipCount = (
  step: DrawingPreparedRenderStep,
): number => step.clipDrawIds.length;

const getClipDrawKey = (
  step: DrawingPreparedRenderStep,
): string | null => {
  const ids = step.draw.clip?.effectiveElementIds;
  return ids && ids.length > 0 && getStencilClipCount(step) > 0 ? ids.join(',') : null;
};

const usesDeviceSpaceVertices = (step: DrawingPreparedRenderStep): boolean =>
  step.kind === 'fill-inner' ||
  step.kind === 'fill-cover';

const prepareClipDrawResources = (
  sharedContext: DawnSharedContext,
  clipDraw: DrawingPreparedClipDraw,
): DrawingPreparedClipDrawResources | null => {
  const clipVertices = createVertexModulationData(clipDraw.triangles, [0, 0, 0, 0]);
  const clipVertexBuffer = createVertexBuffer(sharedContext, clipVertices);
  const pipelineHandle = sharedContext.resourceProvider.createGraphicsPipelineHandle(
    clipDraw.pipelineDesc,
  );
  const pipeline = sharedContext.resourceProvider.resolveGraphicsPipelineHandle(pipelineHandle);
  return {
    id: clipDraw.id,
    pipelineHandle,
    pipeline,
    clipVertexBuffer,
    clipVertexCount: clipVertices.length / floatsPerVertex,
    clipElement: {
      op: clipDraw.op,
      triangles: clipDraw.triangles,
    },
    scissorBounds: clipDraw.scissorBounds,
    maxDepth: clipDraw.maxDepth,
  };
};

const prepareStepResources = (
  sharedContext: DawnSharedContext,
  step: DrawingPreparedRenderStep,
  patchTemplates: Readonly<{
    wedgeVertexBuffer: GPUBuffer;
    curveVertexBuffer: GPUBuffer;
  }>,
  gradientBuilder: DrawingGradientBufferBuilder,
): DrawingPreparedStepResources => {
  const pipelineHandle = sharedContext.resourceProvider.createGraphicsPipelineHandle(
    step.pipelineDesc,
  );
  const pipeline = sharedContext.resourceProvider.resolveGraphicsPipelineHandle(pipelineHandle);
  const clipAtlasView = sharedContext.atlasProvider.getClipAtlasManager().findOrCreateEntry(
    step.draw.clip?.atlasClip,
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
    usesDeviceSpaceVertices(step) ? identityMatrix2D : step.draw.transform,
    step.depth,
    step.draw.color,
    step.draw.kind === 'pathStroke' ? step.draw.strokeStyle : null,
    clipPayload,
    {
      blendModeCode: toDrawingBlendModeCode(step.draw.blendMode, step.draw.blender),
      requiresDstRead: (step.draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0,
      invSize: [
        1 / Math.max(sharedContext.backend.target.width, 1),
        1 / Math.max(sharedContext.backend.target.height, 1),
      ],
      blenderCoefficients: step.draw.blender?.kind === 'arithmetic'
        ? step.draw.blender.coefficients
        : [0, 0, 0, 0],
    },
    createGradientPayload(step.draw.shader, step.draw.transform, gradientBuilder),
  );
  const stepBindGroup = sharedContext.resourceProvider.createStepBindGroup(stepPayloadBuffer);

  if (step.draw.kind === 'pathFill') {
    const usesPatchFill = isDrawingPatchFillRenderer(step.draw.renderer);
    const fillVertices = usesPatchFill
      ? null
      : createVertexModulationData(step.draw.triangles, [1, 1, 1, 1]);
    const patchVertices = step.draw.renderer.patchMode === 'wedge'
      ? createWedgePatchInstanceData(step.draw.patches)
      : step.draw.renderer.patchMode === 'curve'
      ? createCurvePatchInstanceData(step.draw.patches)
      : null;
    const fringeVertices = step.draw.fringeVertices
      ? createColoredDeviceSpaceVertexData(step.draw.fringeVertices)
      : null;
    const boundsCoverVertices = step.usesFillStencil
      ? createBoundsCoverVertexData(step.draw.bounds, [1, 1, 1, 1])
      : null;
    const activeVertices = step.kind === 'fill-inner'
      ? step.draw.innerFillBounds
        ? createBoundsCoverVertexData(step.draw.innerFillBounds, [1, 1, 1, 1])
        : null
      : step.kind === 'fill-stencil-fan'
      ? fillVertices
      : step.kind === 'fill-fringe'
      ? fringeVertices
      : step.kind === 'fill-cover'
      ? boundsCoverVertices
      : usesPatchFill
      ? patchVertices
      : fillVertices;
    const usesPatchInstances = usesPatchFill &&
      (step.kind === 'fill-main' || step.kind === 'fill-stencil');
    const instanceBuffer = usesPatchInstances && activeVertices && activeVertices.length > 0
      ? createVertexBuffer(sharedContext, activeVertices)
      : null;
    const vertexBuffer = !activeVertices || activeVertices.length === 0
      ? null
      : usesPatchInstances
      ? step.draw.renderer.patchMode === 'wedge'
        ? patchTemplates.wedgeVertexBuffer
        : patchTemplates.curveVertexBuffer
      : createVertexBuffer(sharedContext, activeVertices);
    const vertexCount = !activeVertices ? 0 : usesPatchInstances
      ? getPatchFillVertexCount(
        step.draw.patches,
        step.draw.renderer.patchMode === 'wedge' ? 'wedge' : 'curve',
      )
      : activeVertices.length / floatsPerVertex;
    const instanceCount = !activeVertices ? 0 : usesPatchInstances
      ? patchVertices!.length /
        (step.draw.renderer.patchMode === 'wedge' ? wedgePatchFloats : curvePatchFloats)
      : 1;

    return {
      pipelineHandle,
      pipeline,
      stepPayloadBuffer,
      stepBindGroup,
      clipTextureView: clipAtlasView,
      clipDrawKey: getClipDrawKey(step),
      vertexBuffer,
      instanceBuffer,
      vertexCount,
      instanceCount,
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
  const activeVertices = step.kind === 'stroke-fringe'
    ? fringeVertices
    : patchVertices.length > 0
    ? patchVertices
    : strokeVertices;
  const vertexBuffer = activeVertices && activeVertices.length > 0
    ? createVertexBuffer(sharedContext, activeVertices)
    : null;
  const vertexCount = !activeVertices
    ? 0
    : step.kind === 'stroke-main' && patchVertices.length > 0
    ? patchVertexCount
    : activeVertices.length / floatsPerVertex;
  const instanceCount = !activeVertices
    ? 0
    : step.kind === 'stroke-main' && patchVertices.length > 0
    ? patchVertices.length / strokePatchFloats
    : 1;

  return {
    pipelineHandle,
    pipeline,
    stepPayloadBuffer,
    stepBindGroup,
    clipTextureView: clipAtlasView,
    clipDrawKey: getClipDrawKey(step),
    vertexBuffer,
    instanceBuffer: null,
    vertexCount,
    instanceCount,
  };
};

const preparePassResources = (
  sharedContext: DawnSharedContext,
  passInfo: DrawingPreparedRecording['passes'][number],
  patchTemplates: Readonly<{
    wedgeVertexBuffer: GPUBuffer;
    curveVertexBuffer: GPUBuffer;
  }>,
  gradientBuilder: DrawingGradientBufferBuilder,
): DrawingPreparedPassResources => {
  const steps = passInfo.renderSteps.map((step) =>
    prepareStepResources(sharedContext, step, patchTemplates, gradientBuilder)
  );
  const pipelineHandles = steps.map((step) => step.pipelineHandle);
  const clipDraws = passInfo.clipDraws
    .map((clipDraw) => prepareClipDrawResources(sharedContext, clipDraw))
    .filter((clipDraw): clipDraw is DrawingPreparedClipDrawResources => clipDraw !== null);
  return {
    pipelineHandles: Object.freeze(pipelineHandles),
    resolvedPipelines: Object.freeze(steps.map((step) => step.pipeline)),
    clipDraws: Object.freeze(clipDraws),
    sampledTextures: Object.freeze([]),
    steps: Object.freeze(steps),
  };
};

const collectOwnedBuffers = (
  tasks: readonly DrawingPreparedRenderPassTaskResources[],
  globals: Readonly<{
    viewportTransformBuffer: GPUBuffer;
    gradientBuffer: GPUBuffer;
    identityStepPayloadBuffer: GPUBuffer;
    fullscreenClipVertexBuffer: GPUBuffer;
    wedgePatchVertexBuffer: GPUBuffer;
    curvePatchVertexBuffer: GPUBuffer;
  }>,
): readonly GPUBuffer[] => {
  const buffers: GPUBuffer[] = [
    globals.viewportTransformBuffer,
    globals.gradientBuffer,
    globals.identityStepPayloadBuffer,
    globals.fullscreenClipVertexBuffer,
    globals.wedgePatchVertexBuffer,
    globals.curvePatchVertexBuffer,
  ];

  for (const task of tasks) {
    for (const pass of task.passes) {
      for (const step of pass.steps) {
        buffers.push(step.stepPayloadBuffer);
        if (step.vertexBuffer) {
          buffers.push(step.vertexBuffer);
        }
        if (step.instanceBuffer) {
          buffers.push(step.instanceBuffer);
        }
      }
      for (const clipDraw of pass.clipDraws) {
        buffers.push(clipDraw.clipVertexBuffer);
      }
    }
  }

  return Object.freeze(buffers);
};

export const prepareDawnResources = (
  sharedContext: DawnSharedContext,
  tasks: DrawingTaskList,
): DrawingPreparedCommandResources => {
  const gradientBuilder = createGradientBufferBuilder();
  const viewportTransformBuffer = createViewportTransformBuffer(sharedContext);
  const viewportBindGroup = sharedContext.resourceProvider.createViewportBindGroup(
    viewportTransformBuffer,
  );
  const identityStepPayloadBuffer = createStepPayloadBuffer(
    sharedContext,
    [1, 0, 0, 1, 0, 0],
    0,
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
    {
      blendModeCode: 3,
      requiresDstRead: false,
      invSize: [0, 0],
      blenderCoefficients: [0, 0, 0, 0],
    },
    createGradientPayload(undefined, identityMatrix2D, gradientBuilder),
  );
  const identityStepBindGroup = sharedContext.resourceProvider.createStepBindGroup(
    identityStepPayloadBuffer,
  );
  const defaultClipTextureBindGroup = sharedContext.resourceProvider.createClipTextureBindGroup();
  const fullscreenClipVertices = createFullscreenClipVertexData(sharedContext.backend.target);
  const fullscreenClipVertexBuffer = createVertexBuffer(sharedContext, fullscreenClipVertices);
  const wedgePatchVertexBuffer = createPatchTemplateBuffer(
    sharedContext,
    fixedWedgeTemplateVertices,
  );
  const curvePatchVertexBuffer = createPatchTemplateBuffer(
    sharedContext,
    fixedCurveTemplateVertices,
  );
  const taskResources = Object.freeze(
    tasks.tasks.map((task): DrawingPreparedRenderPassTaskResources => ({
      kind: 'renderPass',
      passes: Object.freeze(
        task.drawPasses.map((passInfo) =>
          preparePassResources(sharedContext, passInfo, {
            wedgeVertexBuffer: wedgePatchVertexBuffer,
            curveVertexBuffer: curvePatchVertexBuffer,
          }, gradientBuilder)
        ),
      ),
    })),
  );
  const finalizedGradientBuffer = createGradientStorageBuffer(sharedContext, gradientBuilder.data);
  const finalizedGradientBindGroup = sharedContext.resourceProvider.createGradientBindGroup(
    finalizedGradientBuffer,
  );

  return {
    viewportTransformBuffer,
    viewportBindGroup,
    gradientBuffer: finalizedGradientBuffer,
    gradientBindGroup: finalizedGradientBindGroup,
    identityStepPayloadBuffer,
    identityStepBindGroup,
    defaultClipTextureBindGroup,
    fullscreenClipVertexBuffer,
    fullscreenClipVertexCount: fullscreenClipVertices.length / floatsPerVertex,
    ownedBuffers: collectOwnedBuffers(taskResources, {
      viewportTransformBuffer,
      gradientBuffer: finalizedGradientBuffer,
      identityStepPayloadBuffer,
      fullscreenClipVertexBuffer,
      wedgePatchVertexBuffer,
      curvePatchVertexBuffer,
    }),
    tasks: taskResources,
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
