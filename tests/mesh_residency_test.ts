import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@goldlight/renderer';
import {
  createMeshUploadPlan,
  createRuntimeResidency,
  ensureMeshResidency,
  ensureSceneMeshResidency,
  type GpuUploadContext,
  uploadMeshResidency,
} from '@goldlight/gpu';
import { appendMesh, appendNode, createNode, createSceneIr } from '@goldlight/ir';

type MockBuffer = Readonly<{
  id: number;
  label?: string;
  size: number;
  usage: number;
}>;

type BufferWrite = Readonly<{
  buffer: MockBuffer;
  offset: number;
  data: ArrayBuffer;
}>;

const createMockUploadContext = (): GpuUploadContext & {
  buffers: MockBuffer[];
  writes: BufferWrite[];
} => {
  const buffers: MockBuffer[] = [];
  const writes: BufferWrite[] = [];

  return {
    buffers,
    writes,
    device: {
      createBuffer: (descriptor) => {
        const buffer: MockBuffer = {
          id: buffers.length,
          label: descriptor.label,
          size: descriptor.size,
          usage: descriptor.usage,
        };
        buffers.push(buffer);
        return buffer as unknown as GPUBuffer;
      },
    },
    queue: {
      writeBuffer: (buffer, offset, data) => {
        writes.push({
          buffer: buffer as unknown as MockBuffer,
          offset,
          data: data instanceof ArrayBuffer ? data : data.buffer.slice(0),
        });
      },
    },
  };
};

Deno.test('createMeshUploadPlan describes attribute and index upload work', () => {
  const plan = createMeshUploadPlan({
    id: 'mesh-0',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0] }],
    indices: [0, 1],
  });

  assertEquals(plan.meshId, 'mesh-0');
  assertEquals(plan.attributes[0].vertexCount, 2);
  assertEquals(plan.hasIndices, true);
  assertEquals(plan.indexCount, 2);
});

Deno.test('uploadMeshResidency allocates and uploads attribute and index buffers', () => {
  const context = createMockUploadContext();
  const residency = uploadMeshResidency(context, {
    id: 'mesh-0',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
    indices: [0, 1, 2],
  });

  assertEquals(Object.keys(residency.attributeBuffers), ['POSITION', 'NORMAL']);
  assertEquals(residency.vertexCount, 3);
  assertEquals(residency.indexCount, 3);
  assertEquals(context.buffers.length, 3);
  assertEquals(context.writes.length, 3);
});

Deno.test('ensureMeshResidency reuses cached geometry residency', () => {
  const context = createMockUploadContext();
  const runtimeResidency = createRuntimeResidency();
  const mesh = {
    id: 'mesh-0',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0] }],
  };

  const first = ensureMeshResidency(context, runtimeResidency, mesh);
  const second = ensureMeshResidency(context, runtimeResidency, mesh);

  assertStrictEquals(first, second);
  assertEquals(context.buffers.length, 1);
  assertEquals(runtimeResidency.geometry.size, 1);
});

Deno.test('ensureSceneMeshResidency uploads only meshes used by evaluated scene nodes', () => {
  const context = createMockUploadContext();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-used',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0] }],
  });
  scene = appendMesh(scene, {
    id: 'mesh-unused',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('node-0', { meshId: 'mesh-used' }));

  ensureSceneMeshResidency(
    context,
    runtimeResidency,
    scene,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals([...runtimeResidency.geometry.keys()], ['mesh-used']);
  assertEquals(context.buffers.length, 1);
});
