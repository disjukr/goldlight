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
const wedgePatchFloats = 10;
const curvePatchFloats = 14;
const strokePatchFloats = 16;
const curvePatchVertexCount = 16 * 3;
const strokePatchVertexCount = 16 * 6;

const toGpuColor = (color: readonly [number, number, number, number]): GPUColor => ({
  r: color[0],
  g: color[1],
  b: color[2],
  a: color[3],
});

const createClipSpaceVertexData = (
  triangles: readonly (readonly [number, number])[],
  color: readonly [number, number, number, number],
  target: Readonly<{
    width: number;
    height: number;
  }>,
): Float32Array => {
  const vertices = new Float32Array(triangles.length * floatsPerVertex);
  let offset = 0;
  const toClipX = (value: number) => (value / target.width) * 2 - 1;
  const toClipY = (value: number) => 1 - (value / target.height) * 2;

  for (const point of triangles) {
    vertices[offset++] = toClipX(point[0]);
    vertices[offset++] = toClipY(point[1]);
    vertices[offset++] = color[0];
    vertices[offset++] = color[1];
    vertices[offset++] = color[2];
    vertices[offset++] = color[3];
  }

  return vertices;
};

const createColoredClipSpaceVertexData = (
  triangles: readonly DrawingPreparedVertex[],
  target: Readonly<{
    width: number;
    height: number;
  }>,
): Float32Array => {
  const vertices = new Float32Array(triangles.length * floatsPerVertex);
  let offset = 0;
  const toClipX = (value: number) => (value / target.width) * 2 - 1;
  const toClipY = (value: number) => 1 - (value / target.height) * 2;

  for (const vertex of triangles) {
    vertices[offset++] = toClipX(vertex.point[0]);
    vertices[offset++] = toClipY(vertex.point[1]);
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

const hasStencilClipTriangles = (
  clips: readonly { triangles?: readonly unknown[] }[] | undefined,
): boolean => Boolean(clips?.some((clip) => Boolean(clip.triangles?.length)));

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
      return -1;
  }
};

const createWedgePatchInstanceData = (
  patches: readonly DrawingPreparedPatch[],
  color: readonly [number, number, number, number],
  target: Readonly<{ width: number; height: number }>,
): Float32Array => {
  const wedgePatches = patches.filter((patch) => patch.kind === 'wedge');
  const data = new Float32Array(wedgePatches.length * wedgePatchFloats);
  const toClipX = (value: number) => (value / target.width) * 2 - 1;
  const toClipY = (value: number) => 1 - (value / target.height) * 2;
  let offset = 0;
  for (const patch of wedgePatches) {
    data[offset++] = toClipX(patch.fanPoint[0]);
    data[offset++] = toClipY(patch.fanPoint[1]);
    data[offset++] = toClipX(patch.points[0][0]);
    data[offset++] = toClipY(patch.points[0][1]);
    data[offset++] = toClipX(patch.points[1][0]);
    data[offset++] = toClipY(patch.points[1][1]);
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
  target: Readonly<{ width: number; height: number }>,
): Float32Array => {
  const curvePatches = patches.filter((patch) => patch.kind !== 'wedge');
  const data = new Float32Array(curvePatches.length * curvePatchFloats);
  const toClipX = (value: number) => (value / target.width) * 2 - 1;
  const toClipY = (value: number) => 1 - (value / target.height) * 2;
  let offset = 0;
  for (const patch of curvePatches) {
    const points = patch.kind === 'line'
      ? [patch.points[0], patch.points[1], patch.points[1], patch.points[1]]
      : patch.kind === 'quadratic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : patch.kind === 'conic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];
    data[offset++] = toClipX(points[0]![0]);
    data[offset++] = toClipY(points[0]![1]);
    data[offset++] = toClipX(points[1]![0]);
    data[offset++] = toClipY(points[1]![1]);
    data[offset++] = toClipX(points[2]![0]);
    data[offset++] = toClipY(points[2]![1]);
    data[offset++] = toClipX(points[3]![0]);
    data[offset++] = toClipY(points[3]![1]);
    data[offset++] = toCurveType(patch);
    data[offset++] = patch.kind === 'conic' ? patch.weight : 1;
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
  target: Readonly<{ width: number; height: number }>,
): Float32Array => {
  const curvePatches = patches.filter((patch) => patch.kind !== 'wedge');
  const data = new Float32Array(curvePatches.length * strokePatchFloats);
  const toClipX = (value: number) => (value / target.width) * 2 - 1;
  const toClipY = (value: number) => 1 - (value / target.height) * 2;
  let offset = 0;
  const clipHalfWidth = Math.max(
    1 / Math.max(target.width, 1),
    1 / Math.max(target.height, 1),
  ) * halfWidth * 2;
  for (const patch of curvePatches) {
    const points = patch.kind === 'line'
      ? [patch.points[0], patch.points[1], patch.points[1], patch.points[1]]
      : patch.kind === 'quadratic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : patch.kind === 'conic'
      ? [patch.points[0], patch.points[1], patch.points[2], patch.points[2]]
      : [patch.points[0], patch.points[1], patch.points[2], patch.points[3]];
    data[offset++] = toClipX(points[0]![0]);
    data[offset++] = toClipY(points[0]![1]);
    data[offset++] = toClipX(points[1]![0]);
    data[offset++] = toClipY(points[1]![1]);
    data[offset++] = toClipX(points[2]![0]);
    data[offset++] = toClipY(points[2]![1]);
    data[offset++] = toClipX(points[3]![0]);
    data[offset++] = toClipY(points[3]![1]);
    data[offset++] = toCurveType(patch);
    data[offset++] = patch.kind === 'conic' ? patch.weight : 1;
    data[offset++] = clipHalfWidth;
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

const encodeStencilClipStack = (
  pass: GPURenderPassEncoder,
  clips: NonNullable<
    DrawingPreparedRecording['passes'][number]['steps'][number]['draw']['clips']
  >,
  sharedContext: DawnSharedContext,
  firstPipelineKey:
    DrawingPreparedRecording['passes'][number]['steps'][number]['pipelineKeys'][number],
): number => {
  for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
    const clip = clips[clipIndex]!;
    const clipVertices = createClipSpaceVertexData(
      clip.triangles,
      [0, 0, 0, 0],
      sharedContext.backend.target,
    );
    const clipVertexBuffer = createVertexBuffer(sharedContext, clipVertices);
    pass.setStencilReference?.(clipIndex + 1);
    pass.setPipeline(sharedContext.resourceProvider.getPipeline(
      clipIndex === 0 ? firstPipelineKey : 'clip-stencil-intersect',
    ));
    pass.setVertexBuffer(0, clipVertexBuffer);
    pass.draw(clipVertices.length / floatsPerVertex);
  }

  return clips.length;
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
    for (const step of passInfo.steps) {
      switch (step.draw.kind) {
        case 'pathFill': {
          const usesPatchFill = step.draw.renderer === 'stencil-tessellated-wedges' ||
            step.draw.renderer === 'stencil-tessellated-curves';
          const fillVertices = usesPatchFill ? null : createClipSpaceVertexData(
            step.draw.triangles,
            step.draw.color,
            sharedContext.backend.target,
          );
          const fillVertexBuffer = fillVertices
            ? createVertexBuffer(sharedContext, fillVertices)
            : null;
          const patchVertices = step.draw.renderer === 'stencil-tessellated-wedges'
            ? createWedgePatchInstanceData(
              step.draw.patches,
              step.draw.color,
              sharedContext.backend.target,
            )
            : step.draw.renderer === 'stencil-tessellated-curves'
            ? createCurvePatchInstanceData(
              step.draw.patches,
              step.draw.color,
              sharedContext.backend.target,
            )
            : null;
          const patchVertexBuffer = patchVertices && patchVertices.length > 0
            ? createVertexBuffer(sharedContext, patchVertices)
            : null;
          const fringeVertices = step.draw.fringeVertices
            ? createColoredClipSpaceVertexData(
              step.draw.fringeVertices,
              sharedContext.backend.target,
            )
            : null;
          const fringeVertexBuffer = fringeVertices
            ? createVertexBuffer(sharedContext, fringeVertices)
            : null;
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
            depthStencilAttachment: step.draw.clips && step.draw.clips.length > 0
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
                step.draw.renderer === 'stencil-tessellated-wedges' ? 3 : curvePatchVertexCount,
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
                pass.setPipeline(
                  sharedContext.resourceProvider.getPipeline('path-fill-clip-cover'),
                );
              }
              pass.setVertexBuffer(0, fringeVertexBuffer);
              pass.draw(fringeVertices.length / floatsPerVertex);
            }
          } else {
            const fillPipeline = sharedContext.resourceProvider.getPipeline(step.pipelineKeys[0]!);
            pass.setPipeline(fillPipeline);
            if (usesPatchFill && patchVertexBuffer && patchVertices) {
              pass.setVertexBuffer(0, patchVertexBuffer);
              pass.draw(
                step.draw.renderer === 'stencil-tessellated-wedges' ? 3 : curvePatchVertexCount,
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
                pass.setPipeline(sharedContext.resourceProvider.getPipeline('path-fill-cover'));
              }
              pass.setVertexBuffer(0, fringeVertexBuffer);
              pass.draw(fringeVertices.length / floatsPerVertex);
            }
          }
          pass.end();
          passCount += 1;
          colorLoadOp = 'load';
          break;
        }
        case 'pathStroke': {
          const strokeVertices = createClipSpaceVertexData(
            step.draw.triangles,
            step.draw.color,
            sharedContext.backend.target,
          );
          const strokeVertexBuffer = createVertexBuffer(sharedContext, strokeVertices);
          const patchVertices = createStrokePatchInstanceData(
            step.draw.patches,
            step.draw.color,
            step.draw.halfWidth,
            sharedContext.backend.target,
          );
          const patchVertexBuffer = patchVertices.length > 0
            ? createVertexBuffer(sharedContext, patchVertices)
            : null;
          const usesPatchStroke = Boolean(patchVertexBuffer);
          const fringeVertices = step.draw.fringeVertices
            ? createColoredClipSpaceVertexData(
              step.draw.fringeVertices,
              sharedContext.backend.target,
            )
            : null;
          const fringeVertexBuffer = fringeVertices
            ? createVertexBuffer(sharedContext, fringeVertices)
            : null;
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
            depthStencilAttachment: step.draw.clips && step.draw.clips.length > 0
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
            pass.draw(strokePatchVertexCount, patchVertices.length / strokePatchFloats);
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
          pass.end();
          passCount += 1;
          colorLoadOp = 'load';
          break;
        }
      }
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
