import {
  assertAlmostEquals,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createOffscreenBinding, createRuntimeResidency } from '@rieul3d/gpu';
import { appendMaterial, appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import {
  createNodePickItems,
  decodePickId,
  ensureNodePickPipeline,
  type GpuRenderExecutionContext,
  readNodePickHit,
  renderNodePickFrame,
  renderNodePickSnapshot,
} from '@rieul3d/renderer';
import { createHeadlessTarget } from '@rieul3d/platform';

type MockBuffer = Readonly<{ id: number }>;
type MockPipeline = Readonly<{
  id: number;
  descriptor: GPURenderPipelineDescriptor;
  getBindGroupLayout: (index: number) => GPUBindGroupLayout;
}>;

const createRenderMocks = (readbackRows?: readonly number[][]) => {
  const pipelines: MockPipeline[] = [];
  const writeBufferCalls: Uint8Array[] = [];
  const submits: unknown[][] = [];
  const renderPassCount = { current: 0 };
  const passDraws = { indexed: 0, nonIndexed: 0 };

  const device = {
    createShaderModule: ({ code }: GPUShaderModuleDescriptor) =>
      ({ code }) as unknown as GPUShaderModule,
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      const pipeline: MockPipeline = {
        id: pipelines.length,
        descriptor,
        getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
      };
      pipelines.push(pipeline);
      return pipeline as unknown as GPURenderPipeline;
    },
    createBuffer: ({ label, size }: GPUBufferDescriptor) => {
      const bytes = new Uint8Array(size);
      if (label === 'offscreen-readback-buffer' && readbackRows) {
        for (let row = 0; row < readbackRows.length; row += 1) {
          bytes.set(readbackRows[row], row * 256);
        }
      }

      return {
        mapAsync: () => Promise.resolve(),
        getMappedRange: () => bytes.buffer,
        unmap: () => undefined,
        destroy: () => undefined,
      } as unknown as GPUBuffer;
    },
    createBindGroup: () => ({}) as GPUBindGroup,
    createTexture: () => ({
      createView: () => ({ textureId: 0 } as unknown as GPUTextureView),
    } as GPUTexture),
    createCommandEncoder: ({ label }: GPUCommandEncoderDescriptor = {}) => {
      if (label === 'offscreen-readback') {
        return {
          copyTextureToBuffer: () => undefined,
          finish: () => ({ label } as unknown as GPUCommandBuffer),
        } as unknown as GPUCommandEncoder;
      }

      return {
        beginRenderPass: () => {
          renderPassCount.current += 1;
          return ({
            setPipeline: () => undefined,
            setBindGroup: () => undefined,
            setVertexBuffer: () => undefined,
            setIndexBuffer: () => undefined,
            draw: () => {
              passDraws.nonIndexed += 1;
            },
            drawIndexed: () => {
              passDraws.indexed += 1;
            },
            end: () => undefined,
          });
        },
        finish: () => ({ label } as unknown as GPUCommandBuffer),
      } as unknown as GPUCommandEncoder;
    },
  };

  const queue = {
    writeBuffer: (_buffer: GPUBuffer, _offset: number, data: BufferSource) => {
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data.slice(0))
        : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      writeBufferCalls.push(bytes);
    },
    submit: (buffers: readonly GPUCommandBuffer[]) => {
      submits.push([...buffers]);
    },
  };

  return {
    device,
    queue,
    pipelines,
    writeBufferCalls,
    submits,
    renderPassCount,
    passDraws,
  };
};

Deno.test('createNodePickItems assigns stable ids to mesh nodes only', () => {
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-a',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0] }],
  });
  scene = appendMesh(scene, {
    id: 'mesh-b',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [1, 0, 0] }],
  });
  scene = appendNode(scene, createNode('empty-node'));
  scene = appendNode(scene, createNode('mesh-node-a', { meshId: 'mesh-a' }));
  scene = appendNode(scene, createNode('mesh-node-b', { meshId: 'mesh-b' }));

  const picks = createNodePickItems(evaluateScene(scene, { timeMs: 0 }));

  assertEquals(picks, [
    { encodedId: 1, nodeId: 'mesh-node-a', meshId: 'mesh-a' },
    { encodedId: 2, nodeId: 'mesh-node-b', meshId: 'mesh-b' },
  ]);
});

Deno.test('ensureNodePickPipeline caches the generated pipeline', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();

  const first = ensureNodePickPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    runtimeResidency,
    'rgba8unorm',
  );
  const second = ensureNodePickPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    runtimeResidency,
    'rgba8unorm',
  );

  assertStrictEquals(first, second);
  assertEquals(mocks.pipelines.length, 1);
  assertEquals(
    mocks.pipelines[0].descriptor.vertex?.buffers?.[0]?.attributes?.[0]?.shaderLocation ?? -1,
    0,
  );
});

Deno.test('renderNodePickFrame draws mesh nodes and uploads encoded id colors', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-indexed',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
    indices: [0, 1, 2],
  });
  scene = appendMesh(scene, {
    id: 'mesh-plain',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, -1, 0, 0, 0, -1, 0] }],
  });
  scene = appendNode(scene, createNode('node-indexed', { meshId: 'mesh-indexed' }));
  scene = appendNode(scene, createNode('node-plain', { meshId: 'mesh-plain' }));

  runtimeResidency.geometry.set('mesh-indexed', {
    meshId: 'mesh-indexed',
    attributeBuffers: { POSITION: { id: 0 } as unknown as GPUBuffer },
    indexBuffer: { id: 1 } as unknown as GPUBuffer,
    vertexCount: 3,
    indexCount: 3,
  });
  runtimeResidency.geometry.set('mesh-plain', {
    meshId: 'mesh-plain',
    attributeBuffers: { POSITION: { id: 2 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  const result = renderNodePickFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenBinding({
      device: mocks.device as unknown as GPUDevice,
      target: createHeadlessTarget(16, 16),
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 2);
  assertEquals(result.submittedCommandBufferCount, 1);
  assertEquals(result.picks, [
    { encodedId: 1, nodeId: 'node-indexed', meshId: 'mesh-indexed' },
    { encodedId: 2, nodeId: 'node-plain', meshId: 'mesh-plain' },
  ]);
  assertEquals(mocks.submits.length, 1);
  assertEquals(mocks.renderPassCount.current, 1);
  assertEquals(mocks.passDraws.indexed, 1);
  assertEquals(mocks.passDraws.nonIndexed, 1);
  assertEquals(mocks.writeBufferCalls.length, 2);

  const firstUpload = Array.from(new Float32Array(mocks.writeBufferCalls[0].buffer.slice(0)));
  const secondUpload = Array.from(new Float32Array(mocks.writeBufferCalls[1].buffer.slice(0)));
  assertEquals(firstUpload.length, 36);
  assertEquals(secondUpload.length, 36);
  firstUpload.slice(32).forEach((value, index) => {
    assertAlmostEquals(value, [1 / 255, 0, 0, 0][index], 1e-7);
  });
  secondUpload.slice(32).forEach((value, index) => {
    assertAlmostEquals(value, [2 / 255, 0, 0, 0][index], 1e-7);
  });
});

Deno.test('renderNodePickFrame rejects non-rgba8unorm targets', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();

  assertThrows(() =>
    renderNodePickFrame(
      mocks as unknown as GpuRenderExecutionContext,
      createOffscreenBinding({
        device: mocks.device as unknown as GPUDevice,
        target: {
          kind: 'offscreen',
          width: 16,
          height: 16,
          format: 'bgra8unorm',
          sampleCount: 1,
        },
      }),
      runtimeResidency,
      evaluateScene(createSceneIr('scene'), { timeMs: 0 }),
    )
  );
});

Deno.test('renderNodePickFrame rejects custom shader materials', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'custom-material',
    kind: 'custom',
    shaderId: 'custom:shader',
    textures: [],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh',
    materialId: 'custom-material',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('node', { meshId: 'mesh' }));

  runtimeResidency.geometry.set('mesh', {
    meshId: 'mesh',
    attributeBuffers: { POSITION: { id: 0 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  assertThrows(() =>
    renderNodePickFrame(
      mocks as unknown as GpuRenderExecutionContext,
      createOffscreenBinding({
        device: mocks.device as unknown as GPUDevice,
        target: createHeadlessTarget(16, 16),
      }),
      runtimeResidency,
      evaluateScene(scene, { timeMs: 0 }),
    )
  );
});

Deno.test('decodePickId and readNodePickHit map snapshot pixels back to node ids', () => {
  const snapshot = {
    width: 2,
    height: 2,
    bytes: new Uint8Array([
      1,
      0,
      0,
      0,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]),
    picks: [
      { encodedId: 1, nodeId: 'node-a', meshId: 'mesh-a' },
      { encodedId: 2, nodeId: 'node-b', meshId: 'mesh-b' },
    ],
  };

  assertEquals(decodePickId([2, 0, 0, 0]), 2);
  assertEquals(readNodePickHit(snapshot, 0, 0), {
    encodedId: 1,
    nodeId: 'node-a',
    meshId: 'mesh-a',
  });
  assertEquals(readNodePickHit(snapshot, 1, 0), {
    encodedId: 2,
    nodeId: 'node-b',
    meshId: 'mesh-b',
  });
  assertEquals(readNodePickHit(snapshot, 0, 1), undefined);
  assertThrows(() => readNodePickHit(snapshot, 2, 0));
});

Deno.test('renderNodePickSnapshot returns compact offscreen bytes and pick metadata', async () => {
  const mocks = createRenderMocks([
    [1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ]);
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

  const snapshot = await renderNodePickSnapshot(
    mocks as unknown as Parameters<typeof renderNodePickSnapshot>[0],
    createOffscreenBinding({
      device: mocks.device as unknown as GPUDevice,
      target: createHeadlessTarget(2, 2),
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(snapshot.drawCount, 1);
  assertEquals(snapshot.submittedCommandBufferCount, 1);
  assertEquals(snapshot.width, 2);
  assertEquals(snapshot.height, 2);
  assertEquals(snapshot.picks, [{ encodedId: 1, nodeId: 'node', meshId: 'mesh' }]);
  assertEquals(
    [...snapshot.bytes],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  assertEquals(readNodePickHit(snapshot, 0, 0), {
    encodedId: 1,
    nodeId: 'node',
    meshId: 'mesh',
  });
});

Deno.test('renderNodePickSnapshot uses an internal rgba8unorm target for readback', async () => {
  const mocks = createRenderMocks([
    [1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ]);
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

  const snapshot = await renderNodePickSnapshot(
    mocks as unknown as Parameters<typeof renderNodePickSnapshot>[0],
    createOffscreenBinding({
      device: mocks.device as unknown as GPUDevice,
      target: {
        kind: 'offscreen',
        width: 2,
        height: 2,
        format: 'bgra8unorm',
        sampleCount: 1,
      },
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(snapshot.width, 2);
  assertEquals(snapshot.height, 2);
  assertEquals(snapshot.picks, [{ encodedId: 1, nodeId: 'node', meshId: 'mesh' }]);
  assertEquals(readNodePickHit(snapshot, 0, 0), {
    encodedId: 1,
    nodeId: 'node',
    meshId: 'mesh',
  });
});
