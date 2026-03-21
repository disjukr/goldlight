import {
  acquireColorAttachmentView,
  type RenderContextBinding,
} from '@rieul3d/gpu';
import { prepareDrawingRecording, type DrawingPreparedRecording } from './draw_pass.ts';
import type { DrawingRecording } from './recording.ts';
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

const toGpuColor = (color: readonly [number, number, number, number]): GPUColor => ({
  r: color[0],
  g: color[1],
  b: color[2],
  a: color[3],
});

const vertexBufferUsage = 0x0020;
const floatBytes = Float32Array.BYTES_PER_ELEMENT;
const floatsPerVertex = 6;

const createClipSpaceVertexData = (
  points: readonly (readonly [number, number])[],
  color: readonly [number, number, number, number],
  target: Readonly<{
    width: number;
    height: number;
  }>,
): Float32Array => {
  const triangleCount = points.length - 2;
  const vertices = new Float32Array(triangleCount * 3 * floatsPerVertex);
  let offset = 0;

  const toClipX = (value: number) => (value / target.width) * 2 - 1;
  const toClipY = (value: number) => 1 - (value / target.height) * 2;
  const writeVertex = (point: readonly [number, number]): void => {
    vertices[offset++] = toClipX(point[0]);
    vertices[offset++] = toClipY(point[1]);
    vertices[offset++] = color[0];
    vertices[offset++] = color[1];
    vertices[offset++] = color[2];
    vertices[offset++] = color[3];
  };

  const origin = points[0]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    writeVertex(origin);
    writeVertex(points[index]!);
    writeVertex(points[index + 1]!);
  }

  return vertices;
};

const createVertexBuffer = (
  sharedContext: DawnSharedContext,
  vertices: Float32Array,
): GPUBuffer => {
  const buffer = sharedContext.backend.device.createBuffer({
    label: 'drawing-path-fill-vertices',
    size: vertices.byteLength,
    usage: vertexBufferUsage,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(vertices);
  buffer.unmap();
  return buffer;
};

const createCoverVertices = (
  color: readonly [number, number, number, number],
): Float32Array => new Float32Array([
  -1, -1, color[0], color[1], color[2], color[3],
  1, -1, color[0], color[1], color[2], color[3],
  1, 1, color[0], color[1], color[2], color[3],
  -1, -1, color[0], color[1], color[2], color[3],
  1, 1, color[0], color[1], color[2], color[3],
  -1, 1, color[0], color[1], color[2], color[3],
]);

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
  const unsupportedCommands: DrawingCommand[] = [...prepared.unsupportedCommands];
  let passCount = 0;
  const coverPipeline = sharedContext.resourceProvider.getPathCoverPipeline();
  const stencilView = sharedContext.resourceProvider.getStencilAttachmentView();

  for (const passInfo of prepared.passes) {
    if (passInfo.draws.length === 0) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
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
    for (const draw of passInfo.draws) {
      if (draw.kind !== 'pathFill') {
        continue;
      }

      const stencilPipeline = sharedContext.resourceProvider.getPathStencilPipeline(draw.fillRule);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            clearValue: toGpuColor(passInfo.clearColor),
            loadOp: colorLoadOp,
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: stencilView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
          stencilClearValue: 0,
          stencilLoadOp: 'clear',
          stencilStoreOp: 'discard',
        },
      });

      for (const contour of draw.contours) {
        const vertices = createClipSpaceVertexData(contour, draw.color, sharedContext.backend.target);
        if (vertices.length === 0) {
          continue;
        }
        const vertexBuffer = createVertexBuffer(sharedContext, vertices);
        pass.setPipeline(stencilPipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(vertices.length / floatsPerVertex);
      }

      const coverVertices = createCoverVertices(draw.color);
      const coverVertexBuffer = createVertexBuffer(sharedContext, coverVertices);
      pass.setPipeline(coverPipeline);
      pass.setVertexBuffer(0, coverVertexBuffer);
      pass.draw(coverVertices.length / floatsPerVertex);
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
