import type { DrawingPreparedClipElement } from './clip_stack.ts';
import { identityMatrix2d, type Point2d } from '@goldlight/geometry';
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
  sampledTextureView: GPUTextureView | null;
  clipDrawKey: string | null;
  vertexBuffer: GPUBuffer | null;
  instanceBuffer: GPUBuffer | null;
  sampledTexture?: GPUTexture;
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
  ownedTextures: readonly GPUTexture[];
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
const stepPayloadFloats = 100;
const wedgePatchFloats = 14;
const curvePatchFloats = 12;
const strokePatchFloats = 14;
const maxPatchResolveLevel = 5;
const maxStrokeEdges = (1 << 14) - 1;
const patchPrecision = 4;

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

const textVertexFloats = 4;

const createTextVertexData = (
  quads: readonly Readonly<{
    bounds: Readonly<{ origin: Point2d; size: Readonly<{ width: number; height: number }> }>;
    uvBounds: Readonly<{ origin: Point2d; size: Readonly<{ width: number; height: number }> }>;
  }>[],
): Float32Array => {
  const vertices = new Float32Array(quads.length * 6 * textVertexFloats);
  let offset = 0;
  for (const quad of quads) {
    const x0 = quad.bounds.origin[0];
    const y0 = quad.bounds.origin[1];
    const x1 = x0 + quad.bounds.size.width;
    const y1 = y0 + quad.bounds.size.height;
    const u0 = quad.uvBounds.origin[0];
    const v0 = quad.uvBounds.origin[1];
    const u1 = u0 + quad.uvBounds.size.width;
    const v1 = v0 + quad.uvBounds.size.height;
    const data = [
      x0,
      y0,
      u0,
      v0,
      x1,
      y0,
      u1,
      v0,
      x0,
      y1,
      u0,
      v1,
      x0,
      y1,
      u0,
      v1,
      x1,
      y0,
      u1,
      v0,
      x1,
      y1,
      u1,
      v1,
    ];
    vertices.set(data, offset);
    offset += data.length;
  }
  return vertices;
};

const createTextAtlas = (
  glyphs: readonly Readonly<{
    quadBounds: Readonly<{ origin: Point2d; size: Readonly<{ width: number; height: number }> }>;
    mask: Readonly<{
      width: number;
      height: number;
      stride: number;
      pixels: Uint8Array;
    }>;
  }>[],
): Readonly<{
  width: number;
  height: number;
  pixels: Uint8Array;
  quads: readonly Readonly<{
    bounds: Readonly<{ origin: Point2d; size: Readonly<{ width: number; height: number }> }>;
    uvBounds: Readonly<{ origin: Point2d; size: Readonly<{ width: number; height: number }> }>;
  }>[];
}> => {
  const padding = 1;
  let atlasWidth = 0;
  let atlasHeight = padding;
  let rowWidth = padding;
  let rowHeight = 0;
  const maxRowWidth = 1024;
  const placements: { x: number; y: number }[] = [];

  for (const glyph of glyphs) {
    if (rowWidth + glyph.mask.width + padding > maxRowWidth) {
      atlasWidth = Math.max(atlasWidth, rowWidth);
      atlasHeight += rowHeight + padding;
      rowWidth = padding;
      rowHeight = 0;
    }
    placements.push({ x: rowWidth, y: atlasHeight });
    rowWidth += glyph.mask.width + padding;
    rowHeight = Math.max(rowHeight, glyph.mask.height);
  }
  atlasWidth = Math.max(1, atlasWidth, rowWidth);
  atlasHeight = Math.max(1, atlasHeight + rowHeight + padding);
  const pixels = new Uint8Array(atlasWidth * atlasHeight * 4);
  const quads = glyphs.map((glyph, index) => {
    const placement = placements[index]!;
    for (let row = 0; row < glyph.mask.height; row += 1) {
      for (let column = 0; column < glyph.mask.width; column += 1) {
        const alpha = glyph.mask.pixels[(row * glyph.mask.stride) + column] ?? 0;
        const pixelIndex = (((placement.y + row) * atlasWidth) + placement.x + column) * 4;
        pixels[pixelIndex + 0] = 255;
        pixels[pixelIndex + 1] = 255;
        pixels[pixelIndex + 2] = 255;
        pixels[pixelIndex + 3] = alpha;
      }
    }
    return {
      bounds: glyph.quadBounds,
      uvBounds: {
        origin: [placement.x / atlasWidth, placement.y / atlasHeight] as Point2d,
        size: {
          width: glyph.mask.width / atlasWidth,
          height: glyph.mask.height / atlasHeight,
        },
      },
    };
  });
  return {
    width: atlasWidth,
    height: atlasHeight,
    pixels,
    quads: Object.freeze(quads),
  };
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
    atlasOrigin: Point2d;
    atlasInvSize: Point2d;
    hasAnalyticRect: boolean;
    analyticOrigin: Point2d;
    analyticSize: Point2d;
    hasShader: boolean;
    shaderColor: readonly [number, number, number, number];
  }>,
  dst: Readonly<{
    blendModeCode: number;
    requiresDstRead: boolean;
    invSize: Point2d;
    blenderCoefficients: readonly [number, number, number, number];
  }>,
  shader: Readonly<{
    kindCode: number;
    layoutCode: number;
    numStops: number;
    bufferOffset: number;
    tileModeCode: number;
    colorSpaceCode: number;
    doUnpremulCode: number;
    params0: readonly [number, number, number, number];
    params1: readonly [number, number, number, number];
    inlineOffsets: readonly [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    inlineColors: readonly [
      readonly [number, number, number, number],
      readonly [number, number, number, number],
      readonly [number, number, number, number],
      readonly [number, number, number, number],
      readonly [number, number, number, number],
      readonly [number, number, number, number],
      readonly [number, number, number, number],
      readonly [number, number, number, number],
    ];
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
  const payload = [
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
    shader.layoutCode,
    shader.numStops,
    shader.bufferOffset,
    shader.tileModeCode,
    shader.colorSpaceCode,
    shader.doUnpremulCode,
    0,
    shader.params0[0],
    shader.params0[1],
    shader.params0[2],
    shader.params0[3],
    shader.params1[0],
    shader.params1[1],
    shader.params1[2],
    shader.params1[3],
    shader.inlineOffsets[0],
    shader.inlineOffsets[1],
    shader.inlineOffsets[2],
    shader.inlineOffsets[3],
    shader.inlineOffsets[4],
    shader.inlineOffsets[5],
    shader.inlineOffsets[6],
    shader.inlineOffsets[7],
    shader.inlineColors[0][0],
    shader.inlineColors[0][1],
    shader.inlineColors[0][2],
    shader.inlineColors[0][3],
    shader.inlineColors[1][0],
    shader.inlineColors[1][1],
    shader.inlineColors[1][2],
    shader.inlineColors[1][3],
    shader.inlineColors[2][0],
    shader.inlineColors[2][1],
    shader.inlineColors[2][2],
    shader.inlineColors[2][3],
    shader.inlineColors[3][0],
    shader.inlineColors[3][1],
    shader.inlineColors[3][2],
    shader.inlineColors[3][3],
    shader.inlineColors[4][0],
    shader.inlineColors[4][1],
    shader.inlineColors[4][2],
    shader.inlineColors[4][3],
    shader.inlineColors[5][0],
    shader.inlineColors[5][1],
    shader.inlineColors[5][2],
    shader.inlineColors[5][3],
    shader.inlineColors[6][0],
    shader.inlineColors[6][1],
    shader.inlineColors[6][2],
    shader.inlineColors[6][3],
    shader.inlineColors[7][0],
    shader.inlineColors[7][1],
    shader.inlineColors[7][2],
    shader.inlineColors[7][3],
    shader.localMatrix0[0],
    shader.localMatrix0[1],
    shader.localMatrix0[2],
    shader.localMatrix0[3],
    shader.localMatrix1[0],
    shader.localMatrix1[1],
    shader.localMatrix1[2],
    shader.localMatrix1[3],
  ];
  new Float32Array(buffer.getMappedRange()).set(payload);
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
    case 'triangle':
      return 2;
    case 'quadratic':
      return 1;
    case 'conic':
      return 2;
    case 'cubic':
      return 3;
  }
};

const quadraticToCubicPoints = (
  p0: Point2d,
  p1: Point2d,
  p2: Point2d,
): readonly [Point2d, Point2d, Point2d, Point2d] => {
  const c1: Point2d = [
    p0[0] + ((p1[0] - p0[0]) * (2 / 3)),
    p0[1] + ((p1[1] - p0[1]) * (2 / 3)),
  ];
  const c2: Point2d = [
    p2[0] + ((p1[0] - p2[0]) * (2 / 3)),
    p2[1] + ((p1[1] - p2[1]) * (2 / 3)),
  ];
  return [p0, c1, c2, p2];
};

const lineToCubicPatchPoints = (
  p0: Point2d,
  p1: Point2d,
): readonly [Point2d, Point2d, Point2d, Point2d] => {
  const c1: Point2d = [
    p0[0] + ((p1[0] - p0[0]) / 3),
    p0[1] + ((p1[1] - p0[1]) / 3),
  ];
  const c2: Point2d = [
    p1[0] + ((p0[0] - p1[0]) / 3),
    p1[1] + ((p0[1] - p1[1]) / 3),
  ];
  return [p0, c1, c2, p1];
};

const conicPatchPoints = (
  p0: Point2d,
  p1: Point2d,
  p2: Point2d,
  weight: number,
): readonly [Point2d, Point2d, Point2d, Point2d] => [
  p0,
  p1,
  p2,
  [weight, Number.POSITIVE_INFINITY],
];

const getFillPatchPoints = (
  patch: DrawingPreparedPatch,
): readonly [Point2d, Point2d, Point2d, Point2d] =>
  patch.kind === 'line'
    ? lineToCubicPatchPoints(patch.points[0], patch.points[1])
    : patch.kind === 'triangle'
    ? [patch.points[0], patch.points[1], patch.points[2], [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]]
    : patch.kind === 'quadratic'
    ? quadraticToCubicPoints(patch.points[0], patch.points[1], patch.points[2])
    : patch.kind === 'conic'
    ? conicPatchPoints(patch.points[0], patch.points[1], patch.points[2], patch.weight)
    : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];

const toFillCurveType = (patch: DrawingPreparedPatch): number =>
  patch.kind === 'triangle' ? 2 : patch.kind === 'conic' ? 1 : 0;

const transformPoint = (
  point: Point2d,
  matrix: readonly [number, number, number, number, number, number],
): Point2d => [
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
    return identityMatrix2d;
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

type DrawingGradientColor = readonly [number, number, number, number];

type DrawingGradientNormalizedStop = Readonly<{
  offset: number;
  color: DrawingGradientColor;
}>;

type DrawingGradientInlineColors = readonly [
  DrawingGradientColor,
  DrawingGradientColor,
  DrawingGradientColor,
  DrawingGradientColor,
  DrawingGradientColor,
  DrawingGradientColor,
  DrawingGradientColor,
  DrawingGradientColor,
];

type DrawingGradientInlineOffsets = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

type DrawingGradientPayload = Readonly<{
  kindCode: number;
  layoutCode: number;
  numStops: number;
  bufferOffset: number;
  tileModeCode: number;
  colorSpaceCode: number;
  doUnpremulCode: number;
  params0: readonly [number, number, number, number];
  params1: readonly [number, number, number, number];
  inlineOffsets: DrawingGradientInlineOffsets;
  inlineColors: DrawingGradientInlineColors;
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

const gradientEpsilon = 1e-5;

const identityGradientColor: DrawingGradientColor = [0, 0, 0, 0];
const identityGradientInlineColors: DrawingGradientInlineColors = [
  identityGradientColor,
  identityGradientColor,
  identityGradientColor,
  identityGradientColor,
  identityGradientColor,
  identityGradientColor,
  identityGradientColor,
  identityGradientColor,
];
const identityGradientInlineOffsets: DrawingGradientInlineOffsets = [0, 0, 0, 0, 0, 0, 0, 0];

const toGradientTileModeCode = (
  tileMode: DrawingPreparedShader['tileMode'] | undefined,
): number => tileMode === 'repeat' ? 1 : tileMode === 'mirror' ? 2 : tileMode === 'decal' ? 3 : 0;

const toGradientColorSpaceCode = (
  shader: DrawingPreparedShader,
): number => {
  switch (shader.interpolation?.colorSpace) {
    case 'srgb-linear':
      return 1;
    case 'lab':
      return 2;
    case 'oklab':
      return 3;
    case 'oklab-gamut-map':
      return 4;
    case 'lch':
      return 5;
    case 'oklch':
      return 6;
    case 'oklch-gamut-map':
      return 7;
    case 'srgb':
      return 8;
    case 'hsl':
      return 9;
    case 'hwb':
      return 10;
    default:
      return 0;
  }
};

const toGradientHueMethodCode = (
  shader: DrawingPreparedShader,
): number => {
  switch (shader.interpolation?.hueMethod) {
    case 'longer':
      return 1;
    case 'increasing':
      return 2;
    case 'decreasing':
      return 3;
    default:
      return 0;
  }
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const srgbToLinearComponent = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const srgbToLinear = (
  color: DrawingGradientColor,
): DrawingGradientColor => [
  srgbToLinearComponent(color[0]),
  srgbToLinearComponent(color[1]),
  srgbToLinearComponent(color[2]),
  color[3],
];

const linearSrgbToXyzD50 = (
  color: DrawingGradientColor,
): DrawingGradientColor => {
  const r = color[0];
  const g = color[1];
  const b = color[2];
  return [
    (0.4360747 * r) + (0.3850649 * g) + (0.1430804 * b),
    (0.2225045 * r) + (0.7168786 * g) + (0.0606169 * b),
    (0.0139322 * r) + (0.0971045 * g) + (0.7141733 * b),
    color[3],
  ];
};

const xyzD50ToLab = (
  color: DrawingGradientColor,
): DrawingGradientColor => {
  const d50 = [0.9642956764295677, 1, 0.8251046025104602] as const;
  const e = 216 / 24389;
  const k = 24389 / 27;
  const mapped = [0, 1, 2].map((index) => {
    const value = color[index]! / d50[index]!;
    return value > e ? Math.cbrt(value) : ((k * value) + 16) / 116;
  });
  return [
    (116 * mapped[1]!) - 16,
    500 * (mapped[0]! - mapped[1]!),
    200 * (mapped[1]! - mapped[2]!),
    color[3],
  ];
};

const labToHcl = (
  color: DrawingGradientColor,
): DrawingGradientColor => {
  const hue = Math.atan2(color[2], color[1]) * (180 / Math.PI);
  const chroma = Math.hypot(color[1], color[2]);
  return [hue >= 0 ? hue : hue + 360, chroma, color[0], color[3]];
};

const linearSrgbToOklab = (
  color: DrawingGradientColor,
): DrawingGradientColor => {
  let l = (0.4122214708 * color[0]) + (0.5363325363 * color[1]) + (0.0514459929 * color[2]);
  let m = (0.2119034982 * color[0]) + (0.6806995451 * color[1]) + (0.1073969566 * color[2]);
  let s = (0.0883024619 * color[0]) + (0.2817188376 * color[1]) + (0.6299787005 * color[2]);
  l = Math.cbrt(l);
  m = Math.cbrt(m);
  s = Math.cbrt(s);
  return [
    (0.2104542553 * l) + (0.793617785 * m) - (0.0040720468 * s),
    (1.9779984951 * l) - (2.428592205 * m) + (0.4505937099 * s),
    (0.0259040371 * l) + (0.7827717662 * m) - (0.808675766 * s),
    color[3],
  ];
};

const oklabToOkhcl = (
  color: DrawingGradientColor,
): DrawingGradientColor => {
  const hue = Math.atan2(color[2], color[1]) * (180 / Math.PI);
  const chroma = Math.hypot(color[1], color[2]);
  return [hue >= 0 ? hue : hue + 360, chroma, color[0], color[3]];
};

const srgbToHsl = (
  color: DrawingGradientColor,
): DrawingGradientColor => {
  const mx = Math.max(color[0], color[1], color[2]);
  const mn = Math.min(color[0], color[1], color[2]);
  let hue = 0;
  let sat = 0;
  const light = (mn + mx) / 2;
  const delta = mx - mn;
  if (delta !== 0) {
    sat = light === 0 || light === 1 ? 0 : (mx - light) / Math.min(light, 1 - light);
    if (mx === color[0]) {
      hue = ((color[1] - color[2]) / delta) + (color[1] < color[2] ? 6 : 0);
    } else if (mx === color[1]) {
      hue = ((color[2] - color[0]) / delta) + 2;
    } else {
      hue = ((color[0] - color[1]) / delta) + 4;
    }
    hue *= 60;
  }
  return [hue, sat * 100, light * 100, color[3]];
};

const srgbToHwb = (
  color: DrawingGradientColor,
): DrawingGradientColor => {
  const hsl = srgbToHsl(color);
  const white = Math.min(color[0], color[1], color[2]);
  const black = 1 - Math.max(color[0], color[1], color[2]);
  return [hsl[0], white * 100, black * 100, color[3]];
};

const isPolarColorSpaceCode = (colorSpaceCode: number): boolean =>
  colorSpaceCode === 5 || colorSpaceCode === 6 || colorSpaceCode === 7 ||
  colorSpaceCode === 9 || colorSpaceCode === 10;

const transformGradientColorToInterpolationSpace = (
  color: DrawingGradientColor,
  colorSpaceCode: number,
): DrawingGradientColor => {
  switch (colorSpaceCode) {
    case 1:
      return srgbToLinear(color);
    case 2:
      return xyzD50ToLab(linearSrgbToXyzD50(srgbToLinear(color)));
    case 3:
    case 4:
      return linearSrgbToOklab(srgbToLinear(color));
    case 5:
      return labToHcl(xyzD50ToLab(linearSrgbToXyzD50(srgbToLinear(color))));
    case 6:
    case 7:
      return oklabToOkhcl(linearSrgbToOklab(srgbToLinear(color)));
    case 9:
      return srgbToHsl(color);
    case 10:
      return srgbToHwb(color);
    default:
      return color;
  }
};

const premulInterpolationColor = (
  color: DrawingGradientColor,
  colorSpaceCode: number,
): DrawingGradientColor =>
  isPolarColorSpaceCode(colorSpaceCode)
    ? [color[0], color[1] * color[3], color[2] * color[3], color[3]]
    : [color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3]];

const applyHueMethodToStops = (
  stops: readonly DrawingGradientNormalizedStop[],
  hueMethodCode: number,
  colorSpaceCode: number,
): readonly DrawingGradientNormalizedStop[] => {
  if (!isPolarColorSpaceCode(colorSpaceCode) || stops.length < 2) {
    return stops;
  }
  const nextStops = stops.map((stop) => ({
    offset: stop.offset,
    color: [...stop.color] as DrawingGradientColor,
  }));
  let delta = 0;
  for (let index = 0; index < nextStops.length - 1; index += 1) {
    const currentHue = nextStops[index]!.color[0];
    const nextColor = [...nextStops[index + 1]!.color] as [number, number, number, number];
    nextColor[0] += delta;
    if (hueMethodCode === 0) {
      if (nextColor[0] - currentHue > 180) {
        nextColor[0] -= 360;
        delta -= 360;
      } else if (nextColor[0] - currentHue < -180) {
        nextColor[0] += 360;
        delta += 360;
      }
    } else if (hueMethodCode === 1) {
      if (0 < nextColor[0] - currentHue && nextColor[0] - currentHue < 180) {
        nextColor[0] -= 360;
        delta -= 360;
      } else if (-180 < nextColor[0] - currentHue && nextColor[0] - currentHue <= 0) {
        nextColor[0] += 360;
        delta += 360;
      }
    } else if (hueMethodCode === 2) {
      if (nextColor[0] < currentHue) {
        nextColor[0] += 360;
        delta += 360;
      }
    } else if (hueMethodCode === 3 && currentHue < nextColor[0]) {
      nextColor[0] -= 360;
      delta -= 360;
    }
    nextStops[index + 1] = { offset: nextStops[index + 1]!.offset, color: nextColor };
  }
  return Object.freeze(nextStops);
};

const normalizeGradientStops = (
  shader: DrawingPreparedShader,
): readonly DrawingGradientNormalizedStop[] => {
  const tileMode = shader.tileMode ?? 'clamp';
  const sourceStops = shader.stops.length > 0
    ? shader.stops
    : [{ offset: 0, color: [0, 0, 0, 1] as const }];
  const clamped = sourceStops.map((stop) => ({
    offset: clamp01(stop.offset),
    color: stop.color,
  }));

  const stops: DrawingGradientNormalizedStop[] = [];
  let previousOffset = 0;

  if (clamped[0]!.offset > 0) {
    stops.push({ offset: 0, color: clamped[0]!.color });
  }

  for (const stop of clamped) {
    const offset = Math.max(previousOffset, stop.offset);
    stops.push({
      offset,
      color: stop.color,
    });
    previousOffset = offset;
  }

  if (stops.length === 1) {
    stops.push({ offset: 1, color: stops[0]!.color });
  } else if (stops[stops.length - 1]!.offset < 1) {
    stops.push({ offset: 1, color: stops[stops.length - 1]!.color });
  }

  const deduped: DrawingGradientNormalizedStop[] = [];
  for (let index = 0; index < stops.length;) {
    let runEnd = index + 1;
    while (
      runEnd < stops.length &&
      Math.abs(stops[runEnd]!.offset - stops[index]!.offset) <= gradientEpsilon
    ) {
      runEnd += 1;
    }
    const runLength = runEnd - index;
    const offset = stops[index]!.offset;
    const duplicate = runLength > 1;
    const ignoreLeftmost = duplicate && tileMode !== 'clamp' && offset === 0;
    const ignoreRightmost = tileMode !== 'clamp' && offset === 1;
    if (!ignoreLeftmost) {
      deduped.push(stops[index]!);
    }
    if (duplicate && !ignoreRightmost) {
      deduped.push(stops[runEnd - 1]!);
    }
    index = runEnd;
  }

  return Object.freeze(
    deduped.length === 1 ? [deduped[0]!, { offset: 1, color: deduped[0]!.color }] : deduped,
  );
};

const transformGradientStops = (
  shader: DrawingPreparedShader,
): readonly DrawingGradientNormalizedStop[] => {
  const colorSpaceCode = toGradientColorSpaceCode(shader);
  const hueMethodCode = toGradientHueMethodCode(shader);
  let stops = normalizeGradientStops(shader).map((stop) => ({
    offset: stop.offset,
    color: transformGradientColorToInterpolationSpace(stop.color, colorSpaceCode),
  })) as DrawingGradientNormalizedStop[];
  stops = [...applyHueMethodToStops(stops, hueMethodCode, colorSpaceCode)];
  if (shader.interpolation?.inPremul) {
    stops = stops.map((stop) => ({
      offset: stop.offset,
      color: premulInterpolationColor(stop.color, colorSpaceCode),
    }));
  }
  return Object.freeze(stops);
};

const getGradientStopBufferEntry = (
  builder: DrawingGradientBufferBuilder,
  shader: DrawingPreparedShader,
): Readonly<
  { bufferOffset: number; numStops: number; stops: readonly DrawingGradientNormalizedStop[] }
> => {
  const stops = transformGradientStops(shader);
  const cacheKey = JSON.stringify(
    stops.map((stop) => [stop.offset, ...stop.color]),
  );
  const existing = builder.cache.get(cacheKey);
  if (existing) {
    return { ...existing, stops };
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
  return { ...entry, stops };
};

const toInlineGradientData = (
  stops: readonly DrawingGradientNormalizedStop[],
): Readonly<
  {
    layoutCode: number;
    inlineOffsets: DrawingGradientInlineOffsets;
    inlineColors: DrawingGradientInlineColors;
  }
> => {
  const targetLength = stops.length <= 4 ? 4 : 8;
  const paddedStops = Array.from(
    { length: targetLength },
    (_, index) => stops[Math.min(index, stops.length - 1)]!,
  );
  return {
    layoutCode: targetLength === 4 ? 1 : 2,
    inlineOffsets: Object.freeze([
      paddedStops[0]!.offset,
      paddedStops[1]!.offset,
      paddedStops[2]!.offset,
      paddedStops[3]!.offset,
      targetLength === 8 ? paddedStops[4]!.offset : paddedStops[3]!.offset,
      targetLength === 8 ? paddedStops[5]!.offset : paddedStops[3]!.offset,
      targetLength === 8 ? paddedStops[6]!.offset : paddedStops[3]!.offset,
      targetLength === 8 ? paddedStops[7]!.offset : paddedStops[3]!.offset,
    ]) as DrawingGradientInlineOffsets,
    inlineColors: Object.freeze([
      paddedStops[0]!.color,
      paddedStops[1]!.color,
      paddedStops[2]!.color,
      paddedStops[3]!.color,
      targetLength === 8 ? paddedStops[4]!.color : paddedStops[3]!.color,
      targetLength === 8 ? paddedStops[5]!.color : paddedStops[3]!.color,
      targetLength === 8 ? paddedStops[6]!.color : paddedStops[3]!.color,
      targetLength === 8 ? paddedStops[7]!.color : paddedStops[3]!.color,
    ]) as DrawingGradientInlineColors,
  };
};

const multiplyAffineMatrices = (
  left: readonly [number, number, number, number, number, number],
  right: readonly [number, number, number, number, number, number],
): readonly [number, number, number, number, number, number] => [
  (left[0] * right[0]) + (left[2] * right[1]),
  (left[1] * right[0]) + (left[3] * right[1]),
  (left[0] * right[2]) + (left[2] * right[3]),
  (left[1] * right[2]) + (left[3] * right[3]),
  (left[0] * right[4]) + (left[2] * right[5]) + left[4],
  (left[1] * right[4]) + (left[3] * right[5]) + left[5],
];

const createLinearGradientMatrix = (
  start: Point2d,
  end: Point2d,
): readonly [number, number, number, number, number, number] => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const denom = Math.max((dx * dx) + (dy * dy), gradientEpsilon);
  const a = dx / denom;
  const b = -dy / denom;
  const c = dy / denom;
  const d = dx / denom;
  return [a, b, c, d, -((a * start[0]) + (c * start[1])), -((b * start[0]) + (d * start[1]))];
};

const createRadialGradientMatrix = (
  center: Point2d,
  radius: number,
): readonly [number, number, number, number, number, number] => {
  const scale = 1 / Math.max(radius, gradientEpsilon);
  return [scale, 0, 0, scale, -center[0] * scale, -center[1] * scale];
};

const createSweepGradientMatrix = (
  center: Point2d,
): readonly [number, number, number, number, number, number] => [
  1,
  0,
  0,
  1,
  -center[0],
  -center[1],
];

const createConicalGradientMatrix = (
  startCenter: Point2d,
  endCenter: Point2d,
  startRadius: number,
  endRadius: number,
): readonly [number, number, number, number, number, number] => {
  const dx = endCenter[0] - startCenter[0];
  const dy = endCenter[1] - startCenter[1];
  const len = Math.hypot(dx, dy);
  if (len <= gradientEpsilon) {
    const diffRadius = endRadius - startRadius;
    const scale = 1 / Math.max(Math.abs(diffRadius), gradientEpsilon);
    return [scale, 0, 0, scale, -startCenter[0] * scale, -startCenter[1] * scale];
  }
  const invLenSq = 1 / (len * len);
  const a = dx * invLenSq;
  const b = -dy * invLenSq;
  const c = dy * invLenSq;
  const d = dx * invLenSq;
  return [
    a,
    b,
    c,
    d,
    -((a * startCenter[0]) + (c * startCenter[1])),
    -((b * startCenter[0]) + (d * startCenter[1])),
  ];
};

const createGradientPayload = (
  shader: DrawingPreparedShader | undefined,
  transform: readonly [number, number, number, number, number, number],
  builder: DrawingGradientBufferBuilder,
): DrawingGradientPayload => {
  const inverseDrawTransform = invertAffineMatrix(transform);
  const identityPayload = {
    kindCode: 0,
    layoutCode: 0,
    numStops: 0,
    bufferOffset: 0,
    tileModeCode: 0,
    colorSpaceCode: 0,
    doUnpremulCode: 0,
    params0: [0, 0, 0, 0] as const,
    params1: [0, 0, 0, 0] as const,
    inlineOffsets: identityGradientInlineOffsets,
    inlineColors: identityGradientInlineColors,
  };

  if (!shader) {
    return {
      ...identityPayload,
      localMatrix0: [
        inverseDrawTransform[0],
        inverseDrawTransform[1],
        inverseDrawTransform[2],
        inverseDrawTransform[3],
      ],
      localMatrix1: [inverseDrawTransform[4], inverseDrawTransform[5], 0, 0],
    };
  }

  const colorSpaceCode = toGradientColorSpaceCode(shader);
  const gradientStops = getGradientStopBufferEntry(builder, shader);
  const specialization = gradientStops.numStops <= 8 ? toInlineGradientData(gradientStops.stops) : {
    layoutCode: 3,
    inlineOffsets: identityGradientInlineOffsets,
    inlineColors: identityGradientInlineColors,
  };
  const common = {
    layoutCode: specialization.layoutCode,
    numStops: gradientStops.numStops,
    bufferOffset: specialization.layoutCode === 3 ? gradientStops.bufferOffset : 0,
    tileModeCode: toGradientTileModeCode(shader.tileMode),
    colorSpaceCode,
    doUnpremulCode: shader.interpolation?.inPremul ? 1 : 0,
    inlineOffsets: specialization.inlineOffsets,
    inlineColors: specialization.inlineColors,
  } as const;

  let gradientMatrix: readonly [number, number, number, number, number, number] = identityMatrix2d;
  let kindCode = 0;
  let params0: readonly [number, number, number, number] = [0, 0, 0, 0];
  const params1: readonly [number, number, number, number] = [0, 0, 0, 0];

  if (shader.kind === 'linear-gradient') {
    kindCode = 1;
    gradientMatrix = createLinearGradientMatrix(shader.start, shader.end);
  } else if (shader.kind === 'radial-gradient') {
    kindCode = 2;
    gradientMatrix = createRadialGradientMatrix(shader.center, shader.radius);
  } else if (shader.kind === 'sweep-gradient') {
    kindCode = 3;
    gradientMatrix = createSweepGradientMatrix(shader.center);
    const startAngle = shader.startAngle;
    const endAngle = shader.endAngle ?? (shader.startAngle + (Math.PI * 2));
    params0 = [
      -startAngle / (Math.PI * 2),
      1 / Math.max((endAngle - startAngle) / (Math.PI * 2), gradientEpsilon),
      0,
      0,
    ];
  } else {
    kindCode = 4;
    gradientMatrix = createConicalGradientMatrix(
      shader.startCenter,
      shader.endCenter,
      shader.startRadius,
      shader.endRadius,
    );
    let radius0 = shader.startRadius;
    let radius1 = shader.endRadius;
    let dRadius = radius1 - radius0;
    const centerDistance = Math.hypot(
      shader.endCenter[0] - shader.startCenter[0],
      shader.endCenter[1] - shader.startCenter[1],
    );
    const isRadial = centerDistance <= gradientEpsilon;
    if (isRadial) {
      const diffRadius = radius1 - radius0;
      const scale = Math.abs(diffRadius) <= gradientEpsilon ? 0 : 1 / diffRadius;
      radius0 *= scale;
      radius1 *= scale;
      dRadius = radius0 > 0 ? 1 : -1;
      params0 = [radius0, dRadius, 0, 1];
    } else {
      radius0 /= centerDistance;
      radius1 /= centerDistance;
      dRadius = radius1 - radius0;
      let a = 1 - (dRadius * dRadius);
      let invA = 1;
      if (Math.abs(a) > gradientEpsilon) {
        invA = 1 / (2 * a);
      } else {
        a = 0;
        invA = 0;
      }
      params0 = [radius0, dRadius, a, invA];
    }
  }

  const localMatrix = multiplyAffineMatrices(gradientMatrix, inverseDrawTransform);
  return {
    kindCode,
    ...common,
    params0,
    params1,
    localMatrix0: [localMatrix[0], localMatrix[1], localMatrix[2], localMatrix[3]],
    localMatrix1: [localMatrix[4], localMatrix[5], 0, 0],
  };
};

const calcNumRadialSegmentsPerRadian = (approxStrokeRadius: number): number => {
  const radius = Math.max(approxStrokeRadius, 0.5);
  const cosTheta = 1 - ((1 / patchPrecision) / radius);
  return 0.5 / Math.acos(Math.max(cosTheta, -1));
};

const cubicWangsFormulaP4 = (
  p0: Point2d,
  p1: Point2d,
  p2: Point2d,
  p3: Point2d,
): number => {
  const v1x = p0[0] - (2 * p1[0]) + p2[0];
  const v1y = p0[1] - (2 * p1[1]) + p2[1];
  const v2x = p1[0] - (2 * p2[0]) + p3[0];
  const v2y = p1[1] - (2 * p2[1]) + p3[1];
  return Math.max((v1x * v1x) + (v1y * v1y), (v2x * v2x) + (v2y * v2y)) *
    (((3 * 3) * (2 * 2) / 64) * (patchPrecision * patchPrecision));
};

const conicWangsFormulaP4 = (
  p0: Point2d,
  p1: Point2d,
  p2: Point2d,
  weight: number,
): number => {
  const center: Point2d = [
    (Math.min(p0[0], p1[0], p2[0]) + Math.max(p0[0], p1[0], p2[0])) * 0.5,
    (Math.min(p0[1], p1[1], p2[1]) + Math.max(p0[1], p1[1], p2[1])) * 0.5,
  ];
  const c0: Point2d = [p0[0] - center[0], p0[1] - center[1]];
  const c1: Point2d = [p1[0] - center[0], p1[1] - center[1]];
  const c2: Point2d = [p2[0] - center[0], p2[1] - center[1]];
  const maxLen = Math.max(
    Math.hypot(c0[0], c0[1]),
    Math.hypot(c1[0], c1[1]),
    Math.hypot(c2[0], c2[1]),
  );
  const dp: Point2d = [
    c0[0] + c2[0] - (2 * weight * c1[0]),
    c0[1] + c2[1] - (2 * weight * c1[1]),
  ];
  const dw = Math.abs(2 - (2 * weight));
  const rpMinus1 = Math.max(0, (maxLen * patchPrecision) - 1);
  const numer = (Math.hypot(dp[0], dp[1]) * patchPrecision) + (rpMinus1 * dw);
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
  const points: readonly [Point2d, Point2d, Point2d, Point2d] = [
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
): readonly [Point2d, Point2d, Point2d, Point2d] =>
  patch.kind === 'line'
    ? [patch.points[0], patch.points[0], patch.points[1], patch.points[1]]
    : patch.kind === 'triangle'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : patch.kind === 'quadratic'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : patch.kind === 'conic'
    ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
    : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];

const getStrokePatchPoints = (
  patch: DrawingPreparedPatch,
): readonly [Point2d, Point2d, Point2d, Point2d] =>
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
    const points = getFillPatchPoints(patch);
    data[offset++] = points[0][0];
    data[offset++] = points[0][1];
    data[offset++] = points[1][0];
    data[offset++] = points[1][1];
    data[offset++] = points[2][0];
    data[offset++] = points[2][1];
    data[offset++] = points[3][0];
    data[offset++] = points[3][1];
    data[offset++] = toFillCurveType(patch);
    data[offset++] = 0;
    data[offset++] = Math.min(maxPatchResolveLevel, Math.max(0, patch.resolveLevel));
    data[offset++] = 0;
    data[offset++] = patch.fanPoint![0];
    data[offset++] = patch.fanPoint![1];
  }
  return data;
};

const getCurveFillPatches = (
  patches: readonly DrawingPreparedPatch[],
): readonly DrawingPreparedPatch[] => patches.filter((patch) => patch.kind !== 'line');

const createCurvePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
): Float32Array => {
  const curvePatches = getCurveFillPatches(patches);
  const data = new Float32Array(curvePatches.length * curvePatchFloats);
  let offset = 0;
  for (const patch of curvePatches) {
    const points = getFillPatchPoints(patch);
    data[offset++] = points[0]![0];
    data[offset++] = points[0]![1];
    data[offset++] = points[1]![0];
    data[offset++] = points[1]![1];
    data[offset++] = points[2]![0];
    data[offset++] = points[2]![1];
    data[offset++] = points[3]![0];
    data[offset++] = points[3]![1];
    data[offset++] = toFillCurveType(patch);
    data[offset++] = 0;
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
    usesDeviceSpaceVertices(step) ? identityMatrix2d : step.draw.transform,
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
  let sampledTexture: GPUTexture | null = null;
  let sampledTextureView: GPUTextureView | null = null;

  if (step.draw.kind === 'directMaskText' || step.draw.kind === 'sdfText') {
    const atlas = createTextAtlas(step.draw.glyphs);
    sampledTexture = sharedContext.resourceProvider.createTexture({
      label: step.draw.kind === 'directMaskText'
        ? 'drawing-text-bitmap-atlas'
        : 'drawing-text-sdf-atlas',
      size: {
        width: atlas.width,
        height: atlas.height,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: 0x04 | 0x02,
    });
    if (
      'writeTexture' in sharedContext.backend.queue &&
      typeof sharedContext.backend.queue.writeTexture === 'function'
    ) {
      sharedContext.backend.queue.writeTexture(
        { texture: sampledTexture },
        new Uint8Array(atlas.pixels),
        { bytesPerRow: atlas.width * 4, rowsPerImage: atlas.height },
        { width: atlas.width, height: atlas.height, depthOrArrayLayers: 1 },
      );
    }
    sampledTextureView = sampledTexture.createView();
    const vertexBuffer = createVertexBuffer(sharedContext, createTextVertexData(atlas.quads));
    const textShaderPayload = createGradientPayload(
      step.draw.shader,
      identityMatrix2d,
      gradientBuilder,
    );
    const textStepPayloadBuffer = createStepPayloadBuffer(
      sharedContext,
      identityMatrix2d,
      step.depth,
      step.draw.color,
      null,
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
      step.draw.kind === 'sdfText'
        ? {
          ...textShaderPayload,
          params0: [
            Math.max(0, 0.5 - (0.5 / Math.max(step.draw.sdfRadius, 1))),
            Math.min(1, 0.5 + (0.5 / Math.max(step.draw.sdfRadius, 1))),
            0,
            0,
          ] as const,
        }
        : textShaderPayload,
    );
    return {
      pipelineHandle,
      pipeline,
      stepPayloadBuffer: textStepPayloadBuffer,
      stepBindGroup: sharedContext.resourceProvider.createStepBindGroup(textStepPayloadBuffer),
      clipTextureView: clipAtlasView,
      sampledTextureView,
      clipDrawKey: getClipDrawKey(step),
      vertexBuffer,
      instanceBuffer: null,
      vertexCount: atlas.quads.length * 6,
      instanceCount: 1,
      ...(sampledTexture ? { sampledTexture } : {}),
    } as DrawingPreparedStepResources & { sampledTexture?: GPUTexture };
  }

  if (step.draw.kind === 'pathFill') {
    const usesPatchFill = isDrawingPatchFillRenderer(step.draw.renderer);
    const fillVertices = createVertexModulationData(step.draw.triangles, [1, 1, 1, 1]);
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
        step.draw.renderer.patchMode === 'curve'
          ? getCurveFillPatches(step.draw.patches)
          : step.draw.patches,
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
      sampledTextureView,
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
    sampledTextureView,
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

const collectOwnedTextures = (
  tasks: readonly DrawingPreparedRenderPassTaskResources[],
): readonly GPUTexture[] => {
  const textures: GPUTexture[] = [];
  for (const task of tasks) {
    for (const pass of task.passes) {
      for (const step of pass.steps) {
        if (step.sampledTexture) {
          textures.push(step.sampledTexture);
        }
      }
    }
  }
  return Object.freeze(textures);
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
    createGradientPayload(undefined, identityMatrix2d, gradientBuilder),
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
    ownedTextures: collectOwnedTextures(taskResources),
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
