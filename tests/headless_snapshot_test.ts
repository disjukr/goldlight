import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import {
  compactOffscreenReadback,
  createOffscreenContext,
  createOffscreenReadbackPlan,
  createRuntimeResidency,
} from '@rieul3d/gpu';
import { appendMaterial, appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import {
  createBlitPostProcessPass,
  renderDeferredSnapshot,
  renderForwardSnapshot,
} from '@rieul3d/renderer';
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

Deno.test('renderForwardSnapshot also captures volume-only scenes with seeded residency', async () => {
  const mocks = createSnapshotMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('volume-node', { volumeId: 'volume-0' }));

  runtimeResidency.volumes.set('volume-0', {
    volumeId: 'volume-0',
    texture: {} as GPUTexture,
    view: { textureId: 0 } as unknown as GPUTextureView,
    sampler: { id: 0 } as unknown as GPUSampler,
    width: 4,
    height: 4,
    depth: 4,
    format: 'r8unorm',
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
});

Deno.test('renderDeferredSnapshot returns compact offscreen bytes for minimal deferred scenes', async () => {
  const mocks = createSnapshotMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node', { meshId: 'mesh' }));

  runtimeResidency.geometry.set('mesh', {
    meshId: 'mesh',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(2, 2),
  });

  const snapshot = await renderDeferredSnapshot(
    mocks as unknown as Parameters<typeof renderDeferredSnapshot>[0],
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(snapshot.drawCount, 3);
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

Deno.test('renderDeferredSnapshot also accepts textured deferred scenes with resident baseColor data', async () => {
  const mocks = createSnapshotMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-textured',
    kind: 'unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh',
    materialId: 'material-textured',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node', { meshId: 'mesh' }));

  runtimeResidency.geometry.set('mesh', {
    meshId: 'mesh',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
      TEXCOORD_0: { id: 2 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });
  runtimeResidency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 2,
    height: 2,
    format: 'rgba8unorm-srgb',
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(2, 2),
  });

  const snapshot = await renderDeferredSnapshot(
    mocks as unknown as Parameters<typeof renderDeferredSnapshot>[0],
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(snapshot.drawCount, 3);
  assertEquals(snapshot.submittedCommandBufferCount, 1);
  assertEquals(snapshot.width, 2);
  assertEquals(snapshot.height, 2);
  assertEquals(
    [...snapshot.bytes],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
  assertEquals(mocks.submits.length, 2);
});

Deno.test('renderForwardSnapshot also supports post-process blit passes', async () => {
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
    undefined,
    [createBlitPostProcessPass()],
  );

  assertEquals(snapshot.drawCount, 2);
  assertEquals(snapshot.submittedCommandBufferCount, 1);
  assertEquals(mocks.submits.length, 2);
});
