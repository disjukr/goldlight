import {
  acquireColorAttachmentView,
  acquireColorResolveView,
  type RenderContextBinding,
} from '@rieul3d/gpu';
import { type DrawingPreparedRecording, prepareDrawingRecording } from './draw_pass.ts';
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

const vertexBufferUsage = 0x0020;
const floatsPerVertex = 6;
const wedgePatchFloats = 18;
const curvePatchFloats = 16;
const strokePatchFloats = 18;

const toGpuColor = (color: readonly [number, number, number, number]): GPUColor => ({
  r: color[0],
  g: color[1],
  b: color[2],
  a: color[3],
});

const createVertexData = (
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

const createColoredVertexData = (
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

const createWedgePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
  color: readonly [number, number, number, number],
): Float32Array => {
  const wedgePatches = patches.filter((patch) => patch.kind === 'wedge');
  const data = new Float32Array(wedgePatches.length * wedgePatchFloats);
  let offset = 0;
  for (const patch of wedgePatches) {
    data[offset++] = patch.fanPoint[0];
    data[offset++] = patch.fanPoint[1];
    data[offset++] = patch.points[0][0];
    data[offset++] = patch.points[0][1];
    data[offset++] = patch.points[1][0];
    data[offset++] = patch.points[1][1];
    data[offset++] = patch.points[2][0];
    data[offset++] = patch.points[2][1];
    data[offset++] = patch.points[3][0];
    data[offset++] = patch.points[3][1];
    data[offset++] = toCurveType(patch);
    data[offset++] = patch.weight;
    data[offset++] = patch.resolveLevel;
    data[offset++] = 0;
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
  const curvePatches = patches.filter((patch) => patch.kind !== 'wedge');
  const data = new Float32Array(curvePatches.length * curvePatchFloats);
  let offset = 0;
  for (const patch of curvePatches) {
    const points = patch.kind === 'line'
      ? [patch.points[0], patch.points[1], patch.points[1], patch.points[1]]
      : patch.kind === 'quadratic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : patch.kind === 'conic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];
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
    data[offset++] = patch.resolveLevel;
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
  const curvePatches = patches.filter((patch) => patch.kind !== 'wedge');
  const data = new Float32Array(curvePatches.length * strokePatchFloats);
  let offset = 0;
  for (const patch of curvePatches) {
    const points = patch.kind === 'line'
      ? [patch.points[0], patch.points[1], patch.points[1], patch.points[1]]
      : patch.kind === 'quadratic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : patch.kind === 'conic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];
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
    data[offset++] = patch.resolveLevel;
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

const createVertexBuffer = (
  sharedContext: DawnSharedContext,
  vertices: Float32Array,
): GPUBuffer => {
  const buffer = sharedContext.backend.device.createBuffer({
    label: 'drawing-vertices',
    size: vertices.byteLength,
    usage: vertexBufferUsage,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(vertices);
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
    case 'wedge':
      switch (patch.curveKind) {
        case 'line':
          return 0;
        case 'quadratic':
          return 1;
        case 'conic':
          return 2;
        case 'cubic':
          return 3;
      }
  }
};

const maxResolveLevelForPatches = (
  patches: readonly DrawingPreparedPatch[],
  kind: 'wedge' | 'curve' | 'stroke',
): number => {
  const relevant = patches.filter((patch) =>
    kind === 'wedge' ? patch.kind === 'wedge' : patch.kind !== 'wedge'
  );
  return relevant.reduce((max, patch) => Math.max(max, patch.resolveLevel), 0);
};

const applyClipRect = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  target: Readonly<{ width: number; height: number }>,
): void => {
  const drawBounds = step.drawBounds;
  const clipRect = step.clipRect;
  const clipBounds = step.clipBounds;
  const clipX = clipRect?.origin[0] ?? clipBounds?.origin[0] ?? drawBounds.origin[0];
  const clipY = clipRect?.origin[1] ?? clipBounds?.origin[1] ?? drawBounds.origin[1];
  const clipRight = clipRect
    ? clipRect.origin[0] + clipRect.size.width
    : clipBounds
    ? clipBounds.origin[0] + clipBounds.size.width
    : drawBounds.origin[0] + drawBounds.size.width;
  const clipBottom = clipRect
    ? clipRect.origin[1] + clipRect.size.height
    : clipBounds
    ? clipBounds.origin[1] + clipBounds.size.height
    : drawBounds.origin[1] + drawBounds.size.height;
  const drawX = drawBounds.origin[0];
  const drawY = drawBounds.origin[1];
  const drawRight = drawBounds.origin[0] + drawBounds.size.width;
  const drawBottom = drawBounds.origin[1] + drawBounds.size.height;
  const clip2X = clipBounds?.origin[0] ?? clipX;
  const clip2Y = clipBounds?.origin[1] ?? clipY;
  const clip2Right = clipBounds ? clipBounds.origin[0] + clipBounds.size.width : clipRight;
  const clip2Bottom = clipBounds ? clipBounds.origin[1] + clipBounds.size.height : clipBottom;
  const x = Math.max(0, Math.floor(Math.max(clipX, clip2X, drawX)));
  const y = Math.max(0, Math.floor(Math.max(clipY, clip2Y, drawY)));
  const right = Math.min(target.width, Math.ceil(Math.min(clipRight, clip2Right, drawRight)));
  const bottom = Math.min(target.height, Math.ceil(Math.min(clipBottom, clip2Bottom, drawBottom)));
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

const encodeStencilClipStack = (
  pass: GPURenderPassEncoder,
  clips: NonNullable<
    DrawingPreparedRecording['passes'][number]['steps'][number]['draw']['clips']
  >,
  sharedContext: DawnSharedContext,
  firstPipelineKey:
    DrawingPreparedRecording['passes'][number]['steps'][number]['pipelineKeys'][number],
): number => {
  let emittedClipCount = 0;
  for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
    const clip = clips[clipIndex]!;
    if (!clip.triangles.length) {
      continue;
    }
    const clipVertices = createVertexData(
      clip.triangles,
      [0, 0, 0, 0],
    );
    const clipVertexBuffer = createVertexBuffer(sharedContext, clipVertices);
    emittedClipCount += 1;
    pass.setStencilReference?.(emittedClipCount);
    pass.setPipeline(sharedContext.resourceProvider.getPipeline(
      emittedClipCount === 1 ? firstPipelineKey : 'clip-stencil-intersect',
    ));
    pass.setVertexBuffer(0, clipVertexBuffer);
    pass.draw(clipVertices.length / floatsPerVertex);
  }

  return emittedClipCount;
};

type DrawingPreparedStep = DrawingPreparedRecording['passes'][number]['steps'][number];
type DrawingPreparedFillStep = DrawingPreparedStep & {
  draw: Extract<DrawingPreparedStep['draw'], { kind: 'pathFill' }>;
};
type DrawingPreparedStrokeStep = DrawingPreparedStep & {
  draw: Extract<DrawingPreparedStep['draw'], { kind: 'pathStroke' }>;
};

const encodePathFillStep = (
  pass: GPURenderPassEncoder,
  sharedContext: DawnSharedContext,
  step: DrawingPreparedFillStep,
): void => {
  const usesPatchFill = step.draw.renderer === 'stencil-tessellated-wedges' ||
    step.draw.renderer === 'stencil-tessellated-curves';
  const fillVertices = usesPatchFill ? null : createVertexData(
    step.draw.triangles,
    step.draw.color,
  );
  const fillVertexBuffer = fillVertices ? createVertexBuffer(sharedContext, fillVertices) : null;
  const patchVertices = step.draw.renderer === 'stencil-tessellated-wedges'
    ? createWedgePatchInstanceData(step.draw.patches, step.draw.color)
    : step.draw.renderer === 'stencil-tessellated-curves'
    ? createCurvePatchInstanceData(step.draw.patches, step.draw.color)
    : null;
  const patchVertexBuffer = patchVertices && patchVertices.length > 0
    ? createVertexBuffer(sharedContext, patchVertices)
    : null;
  const patchVertexCount = step.draw.renderer === 'stencil-tessellated-wedges'
    ? (1 << maxResolveLevelForPatches(step.draw.patches, 'wedge')) * 3
    : (1 << maxResolveLevelForPatches(step.draw.patches, 'curve')) * 3;
  const fringeVertices = step.draw.fringeVertices
    ? createColoredVertexData(step.draw.fringeVertices)
    : null;
  const fringeVertexBuffer = fringeVertices
    ? createVertexBuffer(sharedContext, fringeVertices)
    : null;

  applyStepClip(pass, step, sharedContext.backend.target);
  if (step.draw.clips && step.draw.clips.length > 0) {
    const colorPipeline = sharedContext.resourceProvider.getPipeline(step.pipelineKeys[1]!);
    const stencilReference = encodeStencilClipStack(
      pass,
      step.draw.clips,
      sharedContext,
      step.pipelineKeys[0]!,
    );
    pass.setStencilReference?.(stencilReference);
    pass.setPipeline(colorPipeline);
    if (usesPatchFill && patchVertexBuffer && patchVertices) {
      pass.setVertexBuffer(0, patchVertexBuffer);
      pass.draw(
        Math.max(3, patchVertexCount),
        patchVertices.length /
          (step.draw.renderer === 'stencil-tessellated-wedges'
            ? wedgePatchFloats
            : curvePatchFloats),
      );
    } else if (fillVertexBuffer && fillVertices) {
      pass.setVertexBuffer(0, fillVertexBuffer);
      pass.draw(fillVertices.length / floatsPerVertex);
    }
    if (fringeVertices && fringeVertexBuffer) {
      if (usesPatchFill) {
        pass.setPipeline(sharedContext.resourceProvider.getPipeline('path-fill-clip-cover'));
      }
      pass.setVertexBuffer(0, fringeVertexBuffer);
      pass.draw(fringeVertices.length / floatsPerVertex);
    }
    return;
  }

  pass.setPipeline(sharedContext.resourceProvider.getPipeline(step.pipelineKeys[0]!));
  if (usesPatchFill && patchVertexBuffer && patchVertices) {
    pass.setVertexBuffer(0, patchVertexBuffer);
    pass.draw(
      Math.max(3, patchVertexCount),
      patchVertices.length /
        (step.draw.renderer === 'stencil-tessellated-wedges' ? wedgePatchFloats : curvePatchFloats),
    );
  } else if (fillVertexBuffer && fillVertices) {
    pass.setVertexBuffer(0, fillVertexBuffer);
    pass.draw(fillVertices.length / floatsPerVertex);
  }
  if (fringeVertices && fringeVertexBuffer) {
    if (usesPatchFill) {
      pass.setPipeline(sharedContext.resourceProvider.getPipeline('path-fill-cover'));
    }
    pass.setVertexBuffer(0, fringeVertexBuffer);
    pass.draw(fringeVertices.length / floatsPerVertex);
  }
};

const encodePathStrokeStep = (
  pass: GPURenderPassEncoder,
  sharedContext: DawnSharedContext,
  step: DrawingPreparedStrokeStep,
): void => {
  const strokeVertices = createVertexData(step.draw.triangles, step.draw.color);
  const strokeVertexBuffer = createVertexBuffer(sharedContext, strokeVertices);
  const patchVertices = createStrokePatchInstanceData(
    step.draw.patches,
    step.draw.color,
    step.draw.halfWidth,
  );
  const patchVertexBuffer = patchVertices.length > 0
    ? createVertexBuffer(sharedContext, patchVertices)
    : null;
  const usesPatchStroke = Boolean(patchVertexBuffer);
  const patchVertexCount = (1 << maxResolveLevelForPatches(step.draw.patches, 'stroke')) * 6;
  const fringeVertices = step.draw.fringeVertices
    ? createColoredVertexData(step.draw.fringeVertices)
    : null;
  const fringeVertexBuffer = fringeVertices
    ? createVertexBuffer(sharedContext, fringeVertices)
    : null;

  applyStepClip(pass, step, sharedContext.backend.target);
  if (step.draw.clips && step.draw.clips.length > 0) {
    const stencilReference = encodeStencilClipStack(
      pass,
      step.draw.clips,
      sharedContext,
      step.pipelineKeys[0]!,
    );
    pass.setStencilReference?.(stencilReference);
    pass.setPipeline(sharedContext.resourceProvider.getPipeline(
      usesPatchStroke ? step.pipelineKeys[1]! : 'path-stroke-clip-cover',
    ));
  } else {
    pass.setPipeline(sharedContext.resourceProvider.getPipeline(
      usesPatchStroke ? step.pipelineKeys[0]! : 'path-stroke-cover',
    ));
  }
  if (usesPatchStroke && patchVertexBuffer) {
    pass.setVertexBuffer(0, patchVertexBuffer);
    pass.draw(Math.max(6, patchVertexCount), patchVertices.length / strokePatchFloats);
  } else {
    pass.setVertexBuffer(0, strokeVertexBuffer);
    pass.draw(strokeVertices.length / floatsPerVertex);
  }
  if (fringeVertices && fringeVertexBuffer) {
    pass.setPipeline(sharedContext.resourceProvider.getPipeline(
      step.draw.clips && step.draw.clips.length > 0
        ? 'path-stroke-clip-cover'
        : 'path-stroke-cover',
    ));
    pass.setVertexBuffer(0, fringeVertexBuffer);
    pass.draw(fringeVertices.length / floatsPerVertex);
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
  const stencilView = sharedContext.resourceProvider.getStencilAttachmentView();
  const intrinsicBindGroup = sharedContext.resourceProvider.getIntrinsicBindGroup();

  for (const passInfo of prepared.passes) {
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
    for (let stepIndex = 0; stepIndex < passInfo.steps.length;) {
      const step = passInfo.steps[stepIndex]!;
      const requiresStencilPass = Boolean(step.draw.clips && step.draw.clips.length > 0);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            resolveTarget: resolveView,
            clearValue: toGpuColor(passInfo.clearColor),
            loadOp: colorLoadOp,
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: requiresStencilPass
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
      pass.setBindGroup(0, intrinsicBindGroup);

      do {
        const currentStep = passInfo.steps[stepIndex]!;
        switch (currentStep.draw.kind) {
          case 'pathFill':
            encodePathFillStep(pass, sharedContext, currentStep as DrawingPreparedFillStep);
            break;
          case 'pathStroke':
            encodePathStrokeStep(pass, sharedContext, currentStep as DrawingPreparedStrokeStep);
            break;
        }
        stepIndex += 1;
      } while (
        !requiresStencilPass &&
        stepIndex < passInfo.steps.length &&
        !(passInfo.steps[stepIndex]?.draw.clips?.length)
      );

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
  sharedContext.backend.queue.submit([commandBuffer.commandBuffer]);
};
