import { assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createRuntimeResidency } from '@rieul3d/gpu';
import { appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import { renderForwardCubemapSnapshot } from '@rieul3d/renderer';

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
      ({
        descriptor,
        getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
      }) as unknown as GPURenderPipeline,
    createBindGroup: () => ({}) as GPUBindGroup,
    createSampler: () => ({}) as GPUSampler,
    createTexture: () => ({
      createView: () => ({ textureId: 0 } as unknown as GPUTextureView),
    } as GPUTexture),
    createBuffer: ({ label, size }: GPUBufferDescriptor) => {
      const bytes = new Uint8Array(size);
      if (label === 'offscreen-readback-buffer') {
        bytes.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
        bytes.set([9, 10, 11, 12, 13, 14, 15, 16], 256);
      }

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
          setBindGroup: () => undefined,
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
    writeBuffer: () => undefined,
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

Deno.test('renderForwardCubemapSnapshot returns six ordered cubemap faces for mesh scenes', async () => {
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

  const snapshot = await renderForwardCubemapSnapshot(
    mocks as unknown as Parameters<typeof renderForwardCubemapSnapshot>[0],
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
    { size: 2 },
  );

  assertEquals(snapshot.drawCount, 6);
  assertEquals(snapshot.submittedCommandBufferCount, 6);
  assertEquals(snapshot.size, 2);
  assertEquals(
    snapshot.faces.map((face) => face.face),
    ['positive-x', 'negative-x', 'positive-y', 'negative-y', 'positive-z', 'negative-z'],
  );
  assertEquals(snapshot.faces.map((face) => face.width), [2, 2, 2, 2, 2, 2]);
  assertEquals(snapshot.faces.map((face) => face.height), [2, 2, 2, 2, 2, 2]);
  assertEquals(
    snapshot.faces[0].bytes,
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
  );
  assertEquals(new Set(snapshot.faces.map((face) => face.viewMatrix.join(','))).size, 6);
  assertEquals(new Set(snapshot.faces.map((face) => face.projectionMatrix.join(','))).size, 1);
  assertEquals(mocks.submits.length, 12);
  assertEquals(mocks.copyCalls.length, 6);
});

Deno.test('renderForwardCubemapSnapshot rejects raymarched scene content until face cameras are supported', async () => {
  const mocks = createSnapshotMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [{
      id: 'sdf-0',
      op: 'sphere',
      parameters: {
        radius: { x: 0.5, y: 0, z: 0, w: 0 },
      },
    }],
  };
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));

  await assertRejects(
    () =>
      renderForwardCubemapSnapshot(
        mocks as unknown as Parameters<typeof renderForwardCubemapSnapshot>[0],
        runtimeResidency,
        evaluateScene(scene, { timeMs: 0 }),
        { size: 2 },
      ),
    Error,
    'mesh-only scenes',
  );
});

Deno.test('renderForwardCubemapSnapshot rejects formats that are not readback-safe yet', async () => {
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

  await assertRejects(
    () =>
      renderForwardCubemapSnapshot(
        mocks as unknown as Parameters<typeof renderForwardCubemapSnapshot>[0],
        runtimeResidency,
        evaluateScene(scene, { timeMs: 0 }),
        { size: 2, format: 'rgba16float' },
      ),
    Error,
    'requires rgba8unorm',
  );
});
