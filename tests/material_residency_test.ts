import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1.0.14';
import {
  createMaterialAlphaPolicyData,
  createMaterialUploadPlan,
  createRuntimeResidency,
  ensureMaterialResidency,
  ensureSceneMaterialResidency,
  type GpuUploadContext,
  uploadMaterialResidency,
} from '@goldlight/gpu';
import { evaluateScene } from '@goldlight/renderer';
import { appendMaterial, appendMesh, appendNode, createNode, createSceneIr } from '@goldlight/ir';

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

Deno.test('createMaterialUploadPlan prefers color in the first slot and pads remaining space', () => {
  const plan = createMaterialUploadPlan({
    id: 'material-0',
    kind: 'unlit',
    alphaMode: 'mask',
    alphaCutoff: 0.25,
    textures: [],
    parameters: {
      roughness: { x: 0.2, y: 0, z: 0, w: 0 },
      color: { x: 1, y: 0.5, z: 0.25, w: 1 },
    },
  });

  assertEquals(plan.parameterNames, ['color', 'roughness']);
  assertEquals(
    [...plan.uniformData.slice(0, 12)],
    [1, 0.5, 0.25, 1, 0.25, 1, 1, 0, 0.20000000298023224, 0, 0, 0],
  );
  assertEquals(plan.byteLength, 256);
});

Deno.test('uploadMaterialResidency allocates a uniform buffer and uploads parameter data', () => {
  const context = createMockUploadContext();
  const residency = uploadMaterialResidency(context, {
    id: 'material-0',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0.2, y: 0.4, z: 0.6, w: 1 },
    },
  });

  assertEquals(residency.parameterNames, ['color']);
  assertEquals(context.buffers.length, 2);
  assertEquals(context.writes.length, 2);
  assertEquals(context.buffers[0].size, 256);
  assertEquals(context.buffers[1].size, 16);
  assertEquals([...residency.alphaPolicyData], [0.5, 0, 1, 0]);
});

Deno.test('createMaterialAlphaPolicyData encodes explicit renderer policy fields', () => {
  const data = createMaterialAlphaPolicyData({
    id: 'material-alpha',
    kind: 'custom',
    alphaMode: 'mask',
    alphaCutoff: 0.25,
    depthWrite: false,
    doubleSided: true,
    textures: [],
    parameters: {},
  });

  assertEquals([...data], [0.25, 1, 0, 1]);
});

Deno.test('createMaterialAlphaPolicyData uses renderer depth-write defaults for blend materials', () => {
  const data = createMaterialAlphaPolicyData({
    id: 'material-blend',
    kind: 'custom',
    alphaMode: 'blend',
    textures: [],
    parameters: {},
  });

  assertEquals([...data], [0.5, 2, 0, 0]);
});

Deno.test('ensureMaterialResidency reuses cached material buffers', () => {
  const context = createMockUploadContext();
  const runtimeResidency = createRuntimeResidency();
  const material = {
    id: 'material-0',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  };

  const first = ensureMaterialResidency(context, runtimeResidency, material);
  const second = ensureMaterialResidency(context, runtimeResidency, material);

  assertStrictEquals(first, second);
  assertEquals(context.buffers.length, 2);
});

Deno.test('ensureSceneMaterialResidency uploads only materials referenced by evaluated nodes', () => {
  const context = createMockUploadContext();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-used',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 1, y: 0, z: 0, w: 1 },
    },
  });
  scene = appendMaterial(scene, {
    id: 'material-unused',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0, y: 1, z: 0, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-used',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('node-0', { meshId: 'mesh-0' }));

  ensureSceneMaterialResidency(context, runtimeResidency, evaluateScene(scene, { timeMs: 0 }));

  assertEquals([...runtimeResidency.materials.keys()], ['material-used']);
  assertEquals(context.buffers.length, 2);
});
