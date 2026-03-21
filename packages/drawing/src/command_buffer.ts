import {
  acquireColorResolveView,
  acquireColorAttachmentView,
  type RenderContextBinding,
} from '@rieul3d/gpu';
import { prepareDrawingRecording, type DrawingPreparedRecording } from './draw_pass.ts';
import type { DrawingRecording } from './recording.ts';
import type { DrawingPreparedVertex } from './path_renderer.ts';
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
const floatBytes = Float32Array.BYTES_PER_ELEMENT;
const floatsPerVertex = 6;

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
          const fillVertices = createClipSpaceVertexData(
            step.draw.triangles,
            step.draw.color,
            sharedContext.backend.target,
          );
          const fillVertexBuffer = createVertexBuffer(sharedContext, fillVertices);
          const fringeVertices = step.draw.fringeVertices
            ? createColoredClipSpaceVertexData(step.draw.fringeVertices, sharedContext.backend.target)
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
            depthStencilAttachment: step.draw.clip?.triangles
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
          if (step.draw.clip?.triangles) {
            const clipPipeline = sharedContext.resourceProvider.getPipeline(step.pipelineKeys[0]!);
            const clipVertices = createClipSpaceVertexData(
              step.draw.clip.triangles,
              [0, 0, 0, 0],
              sharedContext.backend.target,
            );
            const clipVertexBuffer = createVertexBuffer(sharedContext, clipVertices);
            const colorPipeline = sharedContext.resourceProvider.getPipeline(step.pipelineKeys[1]!);
            pass.setStencilReference?.(1);
            pass.setPipeline(clipPipeline);
            pass.setVertexBuffer(0, clipVertexBuffer);
            pass.draw(clipVertices.length / floatsPerVertex);
            pass.setStencilReference?.(1);
            pass.setPipeline(colorPipeline);
            pass.setVertexBuffer(0, fillVertexBuffer);
            pass.draw(fillVertices.length / floatsPerVertex);
            if (fringeVertices && fringeVertexBuffer) {
              pass.setVertexBuffer(0, fringeVertexBuffer);
              pass.draw(fringeVertices.length / floatsPerVertex);
            }
          } else {
            const fillPipeline = sharedContext.resourceProvider.getPipeline(step.pipelineKeys[0]!);
            pass.setPipeline(fillPipeline);
            pass.setVertexBuffer(0, fillVertexBuffer);
            pass.draw(fillVertices.length / floatsPerVertex);
            if (fringeVertices && fringeVertexBuffer) {
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
          const fringeVertices = step.draw.fringeVertices
            ? createColoredClipSpaceVertexData(step.draw.fringeVertices, sharedContext.backend.target)
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
            depthStencilAttachment: step.draw.clip?.triangles
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
          if (step.draw.clip?.triangles) {
            const clipPipeline = sharedContext.resourceProvider.getPipeline(step.pipelineKeys[0]!);
            const clipVertices = createClipSpaceVertexData(
              step.draw.clip.triangles,
              [0, 0, 0, 0],
              sharedContext.backend.target,
            );
            const clipVertexBuffer = createVertexBuffer(sharedContext, clipVertices);
            pass.setStencilReference?.(1);
            pass.setPipeline(clipPipeline);
            pass.setVertexBuffer(0, clipVertexBuffer);
            pass.draw(clipVertices.length / floatsPerVertex);
            pass.setStencilReference?.(1);
            pass.setPipeline(sharedContext.resourceProvider.getPipeline(step.pipelineKeys[1]!));
          } else {
            pass.setPipeline(sharedContext.resourceProvider.getPipeline(step.pipelineKeys[0]!));
          }
          pass.setVertexBuffer(0, strokeVertexBuffer);
          pass.draw(strokeVertices.length / floatsPerVertex);
          if (fringeVertices && fringeVertexBuffer) {
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
