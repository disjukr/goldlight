import { acquireColorAttachmentView, type RenderContextBinding } from '@rieul3d/gpu';
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
const fillPathShaderSource = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>,
) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
}
`;

const createSolidFillPipeline = (
  sharedContext: DawnSharedContext,
): GPURenderPipeline => {
  const shaderModule = sharedContext.backend.device.createShaderModule({
    label: 'drawing-solid-fill',
    code: fillPathShaderSource,
  });

  return sharedContext.backend.device.createRenderPipeline({
    label: 'drawing-solid-fill',
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: floatBytes * floatsPerVertex,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'float32x2',
            },
            {
              shaderLocation: 1,
              offset: floatBytes * 2,
              format: 'float32x4',
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format: sharedContext.backend.target.format,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });
};

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
  const fillPipeline = createSolidFillPipeline(sharedContext);

  for (const passInfo of prepared.passes) {
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

    for (const draw of passInfo.draws) {
      if (draw.kind !== 'pathFill') {
        continue;
      }

      const vertices = createClipSpaceVertexData(draw.points, draw.color, sharedContext.backend.target);
      const vertexBuffer = createVertexBuffer(sharedContext, vertices);
      pass.setPipeline(fillPipeline);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(vertices.length / floatsPerVertex);
    }

    unsupportedCommands.push(...passInfo.unsupportedDraws);
    pass.end();
    passCount += 1;
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
