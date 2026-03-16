import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import {
  compactOffscreenReadback,
  createOffscreenContext,
  createOffscreenReadbackPlan,
  createRuntimeResidency,
} from '@rieul3d/gpu';
import { appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import { renderForwardSnapshot } from '@rieul3d/renderer';
import { createHeadlessTarget } from '@rieul3d/platform';

const createSnapshotMocks = () => {
  const submits: unknown[][] = [];
  const copyCalls: Array<{
    bytesPerRow: number;
    rowsPerImage: number;
    width: number;
    height: number;
  }> = [];

  const device = {
    createShaderModule: ({ code }: GPUShaderModuleDescriptor) =>
      ({ code }) as unknown as GPUShaderModule,
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) =>
      ({ descriptor }) as unknown as GPURenderPipeline,
    createTexture: () => ({
      createView: () => ({ textureId: 0 } as unknown as GPUTextureView),
    } as GPUTexture),
    createBuffer: ({ size }: GPUBufferDescriptor) => {
      const bytes = new Uint8Array(size);
      bytes.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
      bytes.set([9, 10, 11, 12, 13, 14, 15, 16], 256);

      return {
        mapAsync: () => Promise.resolve(),
        getMappedRange: () => bytes.buffer,
        unmap: () => undefined,
        destroy: () => undefined,
      } as unknown as GPUBuffer;
    },
    createCommandEncoder: ({ label }: GPUCommandEncoderDescriptor = {}) => {
      if (label === 'offscreen-readback') {
        return {
          copyTextureToBuffer: (
            _source: unknown,
            destination: { bytesPerRow?: number; rowsPerImage?: number },
            size: { width: number; height?: number },
          ) => {
            copyCalls.push({
              bytesPerRow: destination.bytesPerRow ?? 0,
              rowsPerImage: destination.rowsPerImage ?? 0,
              width: size.width,
              height: size.height ?? 1,
            });
          },
          finish: () => ({ label } as unknown as GPUCommandBuffer),
        } as unknown as GPUCommandEncoder;
      }

      return {
        beginRenderPass: () => ({
          setPipeline: () => undefined,
          setVertexBuffer: () => undefined,
          setIndexBuffer: () => undefined,
          draw: () => undefined,
          drawIndexed: () => undefined,
          end: () => undefined,
        }),
        finish: () => ({ label } as unknown as GPUCommandBuffer),
      } as unknown as GPUCommandEncoder;
    },
  };

  const queue = {
    submit: (buffers: readonly GPUCommandBuffer[]) => {
      submits.push([...buffers]);
    },
  };

  return {
    device,
    queue,
    submits,
    copyCalls,
  };
};

Deno.test('createOffscreenReadbackPlan aligns rows and compactOffscreenReadback removes padding', () => {
  const plan = createOffscreenReadbackPlan(createHeadlessTarget(2, 2));
  const padded = new Uint8Array(plan.byteLength);
  padded.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
  padded.set([9, 10, 11, 12, 13, 14, 15, 16], plan.paddedBytesPerRow);

  const compact = compactOffscreenReadback(padded, plan);

  assertEquals(plan.bytesPerRow, 8);
  assertEquals(plan.paddedBytesPerRow, 256);
  assertEquals(
    [...compact],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
});

Deno.test('renderForwardSnapshot returns compact offscreen bytes for headless snapshots', async () => {
  const mocks = createSnapshotMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('node', { meshId: 'mesh' }));

  runtimeResidency.geometry.set('mesh', {
    meshId: 'mesh',
    attributeBuffers: { POSITION: { id: 0 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(2, 2),
  });

  const snapshot = await renderForwardSnapshot(
    mocks as unknown as Parameters<typeof renderForwardSnapshot>[0],
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(snapshot.drawCount, 1);
  assertEquals(snapshot.submittedCommandBufferCount, 1);
  assertEquals(snapshot.width, 2);
  assertEquals(snapshot.height, 2);
  assertEquals(
    [...snapshot.bytes],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
  assertEquals(mocks.submits.length, 2);
  assertEquals(mocks.copyCalls, [{
    bytesPerRow: 256,
    rowsPerImage: 2,
    width: 2,
    height: 2,
  }]);
});
