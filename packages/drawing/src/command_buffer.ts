import {
  acquireColorAttachmentView,
  acquireColorResolveView,
  type RenderContextBinding,
} from '@rieul3d/gpu';
import type { Point2D } from '@rieul3d/geometry';
import { type DrawingPreparedRecording, prepareDrawingRecording } from './draw_pass.ts';
import { submitToDawnQueueManager } from './queue_manager.ts';
import type { DrawingRecording } from './recording.ts';
import type { DrawingPreparedPatch, DrawingPreparedVertex } from './path_renderer.ts';
import type { DawnSharedContext } from './shared_context.ts';
import type { DrawingCommand } from './types.ts';

export type DawnCommandBuffer = Readonly<{
  backend: 'graphite-dawn';
  recording: DrawingRecording;
  prepared: DrawingPreparedRecording;
  commandBuffer: GPUCommandBuffer;
  passCount: number;
  unsupportedCommands: readonly DrawingCommand[];
}>;

type DrawingPreparedStepResources = Readonly<{
  pipelines: readonly GPURenderPipeline[];
  fringePipeline: GPURenderPipeline | null;
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
}>;

type DrawingPreparedPassResources = Readonly<{
  steps: readonly DrawingPreparedStepResources[];
}>;

type DrawingPreparedCommandResources = Readonly<{
  viewportTransformBuffer: GPUBuffer;
  viewportBindGroup: GPUBindGroup;
  passes: readonly DrawingPreparedPassResources[];
}>;

const vertexBufferUsage = 0x0020;
const uniformBufferUsage = 0x0040;
const floatsPerVertex = 6;
const wedgePatchFloats = 18;
const curvePatchFloats = 16;
const strokePatchFloats = 18;
const maxPatchResolveLevel = 6;
const patchSegmentCount = 1 << maxPatchResolveLevel;
const wedgePatchVertexCount = patchSegmentCount * 3;
const curvePatchVertexCount = patchSegmentCount * 3;
const strokePatchVertexCount = patchSegmentCount * 6;

const toGpuColor = (color: readonly [number, number, number, number]): GPUColor => ({
  r: color[0],
  g: color[1],
  b: color[2],
  a: color[3],
});

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

const createDeviceSpaceVertexData = (
  triangles: readonly (readonly [number, number])[],
  color: readonly [number, number, number, number],
): Float32Array => {
  const vertices = new Float32Array(triangles.length * floatsPerVertex);
  let offset = 0;

  for (const point of triangles) {
    vertices[offset++] = point[0];
    vertices[offset++] = point[1];
    vertices[offset++] = color[0];
    vertices[offset++] = color[1];
    vertices[offset++] = color[2];
    vertices[offset++] = color[3];
  }

  return vertices;
};

const createColoredDeviceSpaceVertexData = (
  triangles: readonly DrawingPreparedVertex[],
): Float32Array => {
  const vertices = new Float32Array(triangles.length * floatsPerVertex);
  let offset = 0;

  for (const vertex of triangles) {
    vertices[offset++] = vertex.point[0];
    vertices[offset++] = vertex.point[1];
    vertices[offset++] = vertex.color[0];
    vertices[offset++] = vertex.color[1];
    vertices[offset++] = vertex.color[2];
    vertices[offset++] = vertex.color[3];
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
  color: readonly [number, number, number, number],
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
    data[offset++] = color[0];
    data[offset++] = color[1];
    data[offset++] = color[2];
    data[offset++] = color[3];
  }
  return data;
};

const createCurvePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
  color: readonly [number, number, number, number],
): Float32Array => {
  const curvePatches = patches;
  const data = new Float32Array(curvePatches.length * curvePatchFloats);
  let offset = 0;
  for (const patch of curvePatches) {
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
    data[offset++] = color[0];
    data[offset++] = color[1];
    data[offset++] = color[2];
    data[offset++] = color[3];
  }
  return data;
};

const createStrokePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
  color: readonly [number, number, number, number],
  halfWidth: number,
): Float32Array => {
  const curvePatches = patches;
  const data = new Float32Array(curvePatches.length * strokePatchFloats);
  let offset = 0;
  for (const patch of curvePatches) {
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
    data[offset++] = halfWidth;
    data[offset++] = 0;
    data[offset++] = color[0];
    data[offset++] = color[1];
    data[offset++] = color[2];
    data[offset++] = color[3];
  }
  return data;
};

const applyClipRect = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  target: Readonly<{ width: number; height: number }>,
): void => {
  const clipRect = step.clipRect;
  const clipBounds = step.clipBounds;
  const clipX = clipRect?.origin[0] ?? clipBounds?.origin[0] ?? 0;
  const clipY = clipRect?.origin[1] ?? clipBounds?.origin[1] ?? 0;
  const clipRight = clipRect
    ? clipRect.origin[0] + clipRect.size.width
    : clipBounds
    ? clipBounds.origin[0] + clipBounds.size.width
    : target.width;
  const clipBottom = clipRect
    ? clipRect.origin[1] + clipRect.size.height
    : clipBounds
    ? clipBounds.origin[1] + clipBounds.size.height
    : target.height;
  const clip2X = clipBounds?.origin[0] ?? clipX;
  const clip2Y = clipBounds?.origin[1] ?? clipY;
  const clip2Right = clipBounds ? clipBounds.origin[0] + clipBounds.size.width : clipRight;
  const clip2Bottom = clipBounds ? clipBounds.origin[1] + clipBounds.size.height : clipBottom;
  const x = Math.max(0, Math.floor(Math.max(clipX, clip2X)));
  const y = Math.max(0, Math.floor(Math.max(clipY, clip2Y)));
  const right = Math.min(target.width, Math.ceil(Math.min(clipRight, clip2Right)));
  const bottom = Math.min(target.height, Math.ceil(Math.min(clipBottom, clip2Bottom)));
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  pass.setScissorRect(x, y, width, height);
};

const applyFullClip = (
  pass: GPURenderPassEncoder,
  target: Readonly<{ width: number; height: number }>,
): void => {
  pass.setScissorRect(0, 0, target.width, target.height);
};

const applyStepClip = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  target: Readonly<{ width: number; height: number }>,
): void => {
  if (!step.clipRect && !step.clipBounds) {
    applyFullClip(pass, target);
    return;
  }

  applyClipRect(pass, step, target);
};

const getStencilClipCount = (
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
): number => step.draw.clip?.triangleRuns?.length ?? 0;

const createClipStepResources = (
  sharedContext: DawnSharedContext,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
): Readonly<{
  buffers: readonly GPUBuffer[];
  counts: readonly number[];
}> => {
  const triangleRuns = step.draw.clip?.triangleRuns;
  if (!triangleRuns || triangleRuns.length === 0) {
    return {
      buffers: Object.freeze([]),
      counts: Object.freeze([]),
    };
  }

  const buffers: GPUBuffer[] = [];
  const counts: number[] = [];
  for (const triangles of triangleRuns) {
    const clipVertices = createDeviceSpaceVertexData(triangles, [0, 0, 0, 0]);
    buffers.push(createVertexBuffer(sharedContext, clipVertices));
    counts.push(clipVertices.length / floatsPerVertex);
  }
  return {
    buffers: Object.freeze(buffers),
    counts: Object.freeze(counts),
  };
};

const prepareStepResources = (
  sharedContext: DawnSharedContext,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
): DrawingPreparedStepResources => {
  const pipelines = step.pipelineDescs.map((descriptor) =>
    sharedContext.resourceProvider.findOrCreateGraphicsPipeline(descriptor)
  );
  const clipResources = createClipStepResources(sharedContext, step);

  if (step.draw.kind === 'pathFill') {
    const usesPatchFill = step.draw.renderer !== 'middle-out-fan';
    const fillVertices = usesPatchFill
      ? null
      : createDeviceSpaceVertexData(step.draw.triangles, step.draw.color);
    const patchVertices = step.draw.renderer === 'stencil-tessellated-wedges'
      ? createWedgePatchInstanceData(step.draw.patches, step.draw.color)
      : step.draw.renderer === 'stencil-tessellated-curves'
      ? createCurvePatchInstanceData(step.draw.patches, step.draw.color)
      : null;
    const fringeVertices = step.draw.fringeVertices
      ? createColoredDeviceSpaceVertexData(step.draw.fringeVertices)
      : null;
    const boundsCoverVertices = step.usesFillStencil
      ? createBoundsCoverVertexData(step.draw.bounds, step.draw.color)
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
      fringePipeline,
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
    };
  }

  const strokeVertices = createDeviceSpaceVertexData(step.draw.triangles, step.draw.color);
  const patchVertices = createStrokePatchInstanceData(
    step.draw.patches,
    step.draw.color,
    step.draw.halfWidth,
  );
  const fringeVertices = step.draw.fringeVertices
    ? createColoredDeviceSpaceVertexData(step.draw.fringeVertices)
    : null;

  return {
    pipelines: Object.freeze(pipelines),
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
  };
};

const prepareCommandResources = (
  sharedContext: DawnSharedContext,
  prepared: DrawingPreparedRecording,
): DrawingPreparedCommandResources => {
  const viewportTransformBuffer = createViewportTransformBuffer(sharedContext);
  const viewportBindGroup = sharedContext.resourceProvider.createViewportBindGroup(
    viewportTransformBuffer,
  );

  return {
    viewportTransformBuffer,
    viewportBindGroup,
    passes: Object.freeze(prepared.passes.map((passInfo) => ({
      steps: Object.freeze(passInfo.steps.map((step) => prepareStepResources(sharedContext, step))),
    }))),
  };
};

const encodeStencilClips = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  resources: DrawingPreparedStepResources,
  viewportBindGroup: GPUBindGroup,
): void => {
  if (resources.clipVertexBuffers.length === 0) {
    return;
  }

  const clipPipeline = resources.pipelines[0]!;
  pass.setStencilReference?.(0);
  pass.setPipeline(clipPipeline);
  pass.setBindGroup(0, viewportBindGroup);
  for (let index = 0; index < resources.clipVertexBuffers.length; index += 1) {
    pass.setVertexBuffer(0, resources.clipVertexBuffers[index]!);
    pass.draw(resources.clipVertexCounts[index]!);
  }
  pass.setStencilReference?.(resources.clipVertexBuffers.length);
};

const createRenderPassDescriptor = (
  colorView: GPUTextureView,
  resolveView: GPUTextureView | undefined,
  clearColor: readonly [number, number, number, number],
  loadOp: GPULoadOp,
  stencilView?: GPUTextureView,
): GPURenderPassDescriptor => ({
  colorAttachments: [
    {
      view: colorView,
      resolveTarget: resolveView,
      clearValue: toGpuColor(clearColor),
      loadOp,
      storeOp: 'store',
    },
  ],
  depthStencilAttachment: stencilView
    ? {
      view: stencilView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'discard',
      stencilClearValue: 0,
      stencilLoadOp: 'clear',
      stencilStoreOp: 'discard',
    }
    : undefined,
});

const encodePreparedFillStep = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  resources: DrawingPreparedStepResources,
  target: Readonly<{ width: number; height: number }>,
  viewportBindGroup: GPUBindGroup,
): void => {
  if (step.draw.kind !== 'pathFill') {
    return;
  }

  const usesPatchFill = step.draw.renderer !== 'middle-out-fan';
  const usesFillStencil = step.usesFillStencil;
  applyStepClip(pass, step, target);
  if (usesFillStencil) {
    const stencilPipeline = resources.pipelines[0]!;
    const coverPipeline = resources.pipelines[1]!;
    pass.setPipeline(stencilPipeline);
    pass.setBindGroup(0, viewportBindGroup);
    if (usesPatchFill && resources.patchVertexBuffer && resources.patchInstanceCount > 0) {
      pass.setVertexBuffer(0, resources.patchVertexBuffer);
      pass.draw(resources.patchVertexCount, resources.patchInstanceCount);
    } else if (resources.fillVertexBuffer && resources.fillVertexCount > 0) {
      pass.setVertexBuffer(0, resources.fillVertexBuffer);
      pass.draw(resources.fillVertexCount);
    }

    if (resources.boundsCoverVertexBuffer && resources.boundsCoverVertexCount > 0) {
      pass.setPipeline(coverPipeline);
      pass.setBindGroup(0, viewportBindGroup);
      pass.setVertexBuffer(0, resources.boundsCoverVertexBuffer);
      pass.draw(resources.boundsCoverVertexCount);
    }

    if (resources.fringeVertexBuffer && resources.fringeVertexCount > 0) {
      pass.setPipeline(resources.fringePipeline ?? resources.pipelines[0]!);
      pass.setBindGroup(0, viewportBindGroup);
      pass.setVertexBuffer(0, resources.fringeVertexBuffer);
      pass.draw(resources.fringeVertexCount);
    }
    return;
  }

  if (getStencilClipCount(step) > 0) {
    const colorPipeline = resources.pipelines[1]!;
    encodeStencilClips(pass, step, resources, viewportBindGroup);
    pass.setPipeline(colorPipeline);
  } else {
    pass.setPipeline(resources.pipelines[0]!);
  }
  pass.setBindGroup(0, viewportBindGroup);

  if (usesPatchFill && resources.patchVertexBuffer && resources.patchInstanceCount > 0) {
    pass.setVertexBuffer(0, resources.patchVertexBuffer);
    pass.draw(resources.patchVertexCount, resources.patchInstanceCount);
  } else if (resources.fillVertexBuffer && resources.fillVertexCount > 0) {
    pass.setVertexBuffer(0, resources.fillVertexBuffer);
    pass.draw(resources.fillVertexCount);
  }

  if (resources.fringeVertexBuffer && resources.fringeVertexCount > 0) {
    if (usesPatchFill) {
      pass.setPipeline(resources.fringePipeline ?? resources.pipelines[getStencilClipCount(step) > 0 ? 1 : 0]!);
      pass.setBindGroup(0, viewportBindGroup);
    }
    pass.setVertexBuffer(0, resources.fringeVertexBuffer);
    pass.draw(resources.fringeVertexCount);
  }
};

const encodePreparedStrokeStep = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  resources: DrawingPreparedStepResources,
  target: Readonly<{ width: number; height: number }>,
  viewportBindGroup: GPUBindGroup,
): void => {
  if (step.draw.kind !== 'pathStroke') {
    return;
  }

  applyStepClip(pass, step, target);
  if (getStencilClipCount(step) > 0) {
    encodeStencilClips(pass, step, resources, viewportBindGroup);
    pass.setPipeline(resources.pipelines[1]!);
  } else {
    pass.setPipeline(resources.pipelines[0]!);
  }
  pass.setBindGroup(0, viewportBindGroup);

  if (resources.patchVertexBuffer && resources.patchInstanceCount > 0) {
    pass.setVertexBuffer(0, resources.patchVertexBuffer);
    pass.draw(resources.patchVertexCount, resources.patchInstanceCount);
  } else {
    pass.setVertexBuffer(0, resources.fillVertexBuffer!);
    pass.draw(resources.fillVertexCount);
  }

  if (resources.fringeVertexBuffer && resources.fringeVertexCount > 0) {
    pass.setPipeline(resources.fringePipeline ?? resources.pipelines[getStencilClipCount(step) > 0 ? 1 : 0]!);
    pass.setBindGroup(0, viewportBindGroup);
    pass.setVertexBuffer(0, resources.fringeVertexBuffer);
    pass.draw(resources.fringeVertexCount);
  }
};

const encodePreparedStep = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  resources: DrawingPreparedStepResources,
  target: Readonly<{ width: number; height: number }>,
  viewportBindGroup: GPUBindGroup,
): void => {
  switch (step.draw.kind) {
    case 'pathFill':
      encodePreparedFillStep(pass, step, resources, target, viewportBindGroup);
      break;
    case 'pathStroke':
      encodePreparedStrokeStep(pass, step, resources, target, viewportBindGroup);
      break;
  }
};

export const encodeDawnCommandBuffer = (
  sharedContext: DawnSharedContext,
  recording: DrawingRecording,
  binding: RenderContextBinding,
): DawnCommandBuffer => {
  const encoder = sharedContext.backend.device.createCommandEncoder({
    label: `drawing-recorder-${recording.recorderId}`,
  });
  const prepared = prepareDrawingRecording(recording);
  const colorView = acquireColorAttachmentView(
    {
      device: sharedContext.backend.device,
    },
    binding,
  );
  const resolveView = acquireColorResolveView(binding);
  const unsupportedCommands: DrawingCommand[] = [...prepared.unsupportedCommands];
  let passCount = 0;
  const resources = prepareCommandResources(sharedContext, prepared);
  const hasStencilSteps = prepared.passes.some((passInfo) =>
    passInfo.steps.some((step) => step.usesStencil || step.usesFillStencil)
  );
  const stencilView = hasStencilSteps
    ? sharedContext.resourceProvider.getStencilAttachmentView()
    : undefined;

  for (let passIndex = 0; passIndex < prepared.passes.length; passIndex += 1) {
    const passInfo = prepared.passes[passIndex]!;
    const passResources = resources.passes[passIndex]!;
    if (passInfo.steps.length === 0) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            resolveTarget: resolveView,
            clearValue: toGpuColor(passInfo.clearColor),
            loadOp: passInfo.loadOp,
            storeOp: 'store',
          },
        ],
      });
      unsupportedCommands.push(...passInfo.unsupportedDraws);
      pass.end();
      passCount += 1;
      continue;
    }

    let colorLoadOp = passInfo.loadOp;
    let stepIndex = 0;
    while (stepIndex < passInfo.steps.length) {
      const step = passInfo.steps[stepIndex]!;
      if (step.usesStencil || step.usesFillStencil) {
        const pass = encoder.beginRenderPass(
          createRenderPassDescriptor(
            colorView,
            resolveView,
            passInfo.clearColor,
            colorLoadOp,
            stencilView,
          ),
        );
        encodePreparedStep(
          pass,
          step,
          passResources.steps[stepIndex]!,
          sharedContext.backend.target,
          resources.viewportBindGroup,
        );
        pass.end();
        passCount += 1;
        colorLoadOp = 'load';
        stepIndex += 1;
        continue;
      }

      const pass = encoder.beginRenderPass(
        createRenderPassDescriptor(colorView, resolveView, passInfo.clearColor, colorLoadOp),
      );
      while (
        stepIndex < passInfo.steps.length &&
        !passInfo.steps[stepIndex]!.usesStencil &&
        !passInfo.steps[stepIndex]!.usesFillStencil
      ) {
        encodePreparedStep(
          pass,
          passInfo.steps[stepIndex]!,
          passResources.steps[stepIndex]!,
          sharedContext.backend.target,
          resources.viewportBindGroup,
        );
        stepIndex += 1;
      }
      pass.end();
      passCount += 1;
      colorLoadOp = 'load';
    }

    unsupportedCommands.push(...passInfo.unsupportedDraws);
  }

  return {
    backend: 'graphite-dawn',
    recording,
    prepared,
    commandBuffer: encoder.finish(),
    passCount,
    unsupportedCommands: Object.freeze(unsupportedCommands),
  };
};

export const submitDawnCommandBuffer = (
  sharedContext: DawnSharedContext,
  commandBuffer: DawnCommandBuffer,
): void => {
  submitToDawnQueueManager(sharedContext.queueManager, commandBuffer);
};
