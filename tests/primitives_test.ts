import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@goldlight/core';
import {
  createRuntimeResidency,
  ensureSceneMeshResidency,
  type GpuUploadContext,
} from '@goldlight/gpu';
import {
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
  type MeshPrimitive,
} from '@goldlight/ir';
import {
  createBoxMesh,
  createCapsuleMesh,
  createCylinderMesh,
  createDodecahedronMesh,
  createHexahedronMesh,
  createIcosahedronMesh,
  createOctahedronMesh,
  createSphereMesh,
  createTetrahedronMesh,
  createTorusMesh,
} from '@goldlight/geometry';

type MockBuffer = Readonly<{
  id: number;
  size: number;
  usage: number;
  label?: string;
}>;

const createMockUploadContext = (): GpuUploadContext & { buffers: MockBuffer[] } => {
  const buffers: MockBuffer[] = [];

  return {
    buffers,
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
      writeBuffer: () => undefined,
    },
  };
};

const getAttribute = (mesh: MeshPrimitive, semantic: string) => {
  const attribute = mesh.attributes.find((entry) => entry.semantic === semantic);
  if (!attribute) {
    throw new Error(`missing attribute: ${semantic}`);
  }

  return attribute;
};

const assertNormalizedNormals = (values: readonly number[]) => {
  for (let index = 0; index < values.length; index += 3) {
    const length = Math.hypot(values[index], values[index + 1], values[index + 2]);
    assert(Math.abs(length - 1) < 1e-4, `normal at ${index / 3} is not unit length`);
  }
};

const assertNormalizedUvRange = (values: readonly number[]) => {
  for (const value of values) {
    assert(value >= -1e-6 && value <= 1 + 1e-6, `uv value ${value} is out of range`);
  }
};

const assertApproxArrayEquals = (
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-6,
) => {
  assertEquals(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `value mismatch at ${index}: ${actual[index]} vs ${expected[index]}`,
    );
  }
};

const assertTriangleWindingMatchesNormals = (mesh: MeshPrimitive) => {
  const positions = getAttribute(mesh, 'POSITION').values;
  const normals = getAttribute(mesh, 'NORMAL').values;
  const indices = mesh.indices ?? [];

  for (let index = 0; index < indices.length; index += 3) {
    const aIndex = indices[index] * 3;
    const bIndex = indices[index + 1] * 3;
    const cIndex = indices[index + 2] * 3;

    const ax = positions[aIndex];
    const ay = positions[aIndex + 1];
    const az = positions[aIndex + 2];
    const bx = positions[bIndex];
    const by = positions[bIndex + 1];
    const bz = positions[bIndex + 2];
    const cx = positions[cIndex];
    const cy = positions[cIndex + 1];
    const cz = positions[cIndex + 2];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    const faceX = (aby * acz) - (abz * acy);
    const faceY = (abz * acx) - (abx * acz);
    const faceZ = (abx * acy) - (aby * acx);
    const faceLength = Math.hypot(faceX, faceY, faceZ);

    if (faceLength < 1e-6) {
      continue;
    }

    const averageNormalX = (normals[aIndex] + normals[bIndex] + normals[cIndex]) / 3;
    const averageNormalY = (normals[aIndex + 1] + normals[bIndex + 1] + normals[cIndex + 1]) / 3;
    const averageNormalZ = (normals[aIndex + 2] + normals[bIndex + 2] + normals[cIndex + 2]) / 3;
    const orientation = (faceX * averageNormalX) + (faceY * averageNormalY) +
      (faceZ * averageNormalZ);

    assert(
      orientation > 0,
      `triangle ${index / 3} winding opposes its vertex normals`,
    );
  }
};

const assertMeshShape = (
  mesh: MeshPrimitive,
  expectedVertexCount: number,
  expectedIndexCount: number,
) => {
  const positions = getAttribute(mesh, 'POSITION');
  const normals = getAttribute(mesh, 'NORMAL');
  const texcoords = getAttribute(mesh, 'TEXCOORD_0');

  assertEquals(positions.itemSize, 3);
  assertEquals(normals.itemSize, 3);
  assertEquals(texcoords.itemSize, 2);
  assertEquals(positions.values.length / positions.itemSize, expectedVertexCount);
  assertEquals(normals.values.length / normals.itemSize, expectedVertexCount);
  assertEquals(texcoords.values.length / texcoords.itemSize, expectedVertexCount);
  assertEquals(mesh.indices?.length, expectedIndexCount);
  assert(mesh.indices?.every((index) => index >= 0 && index < expectedVertexCount));
  assertNormalizedNormals(normals.values);
  assertNormalizedUvRange(texcoords.values);
};

Deno.test('primitive mesh generators expose indexed POSITION/NORMAL/TEXCOORD_0 data', () => {
  assertMeshShape(createBoxMesh({ id: 'box' }), 24, 36);
  assertMeshShape(createHexahedronMesh({ id: 'hexahedron' }), 24, 36);
  assertMeshShape(createSphereMesh({ id: 'sphere' }), 153, 768);
  assertMeshShape(createCylinderMesh({ id: 'cylinder' }), 70, 192);
  assertMeshShape(createCapsuleMesh({ id: 'capsule' }), 306, 1632);
  assertMeshShape(createTorusMesh({ id: 'torus' }), 325, 1728);
  assertMeshShape(createTetrahedronMesh({ id: 'tetrahedron' }), 12, 12);
  assertMeshShape(createOctahedronMesh({ id: 'octahedron' }), 24, 24);
  assertMeshShape(createIcosahedronMesh({ id: 'icosahedron' }), 60, 60);
  assertMeshShape(createDodecahedronMesh({ id: 'dodecahedron' }), 60, 108);
});

Deno.test('primitive mesh generators reject invalid sizes and segment counts', () => {
  assertThrows(() => createBoxMesh({ id: 'box', width: 0 }));
  assertThrows(() => createSphereMesh({ id: 'sphere', widthSegments: 2 }));
  assertThrows(() => createCylinderMesh({ id: 'cylinder', radialSegments: 2 }));
  assertThrows(() => createCapsuleMesh({ id: 'capsule', capSegments: 1 }));
  assertThrows(() => createTorusMesh({ id: 'torus', tubularSegments: 2 }));
  assertThrows(() => createTetrahedronMesh({ id: 'tetrahedron', radius: -1 }));
});

Deno.test('torus and capsule duplicate seam vertices with matching attributes', () => {
  const torus = createTorusMesh({ id: 'torus' });
  const torusPositions = getAttribute(torus, 'POSITION').values;
  const torusNormals = getAttribute(torus, 'NORMAL').values;
  const torusTexcoords = getAttribute(torus, 'TEXCOORD_0').values;
  const torusRadialSegments = 12;
  const torusTubularSegments = 24;
  const torusStride = torusTubularSegments + 1;
  for (let ringIndex = 0; ringIndex <= torusRadialSegments; ringIndex += 1) {
    const first = ringIndex * torusStride;
    const last = first + torusTubularSegments;
    assertApproxArrayEquals(
      torusPositions.slice(first * 3, (first * 3) + 3),
      torusPositions.slice(last * 3, (last * 3) + 3),
    );
    assertApproxArrayEquals(
      torusNormals.slice(first * 3, (first * 3) + 3),
      torusNormals.slice(last * 3, (last * 3) + 3),
    );
    assertEquals(torusTexcoords.slice(first * 2, (first * 2) + 1), [0]);
    assertEquals(torusTexcoords.slice(last * 2, (last * 2) + 1), [1]);
  }

  const capsule = createCapsuleMesh({ id: 'capsule' });
  const capsulePositions = getAttribute(capsule, 'POSITION').values;
  const capsuleRadialSegments = 16;
  const capsuleStride = capsuleRadialSegments + 1;
  for (let ringIndex = 0; ringIndex < capsulePositions.length / 3 / capsuleStride; ringIndex += 1) {
    const first = ringIndex * capsuleStride;
    const last = first + capsuleRadialSegments;
    assertApproxArrayEquals(
      capsulePositions.slice(first * 3, (first * 3) + 3),
      capsulePositions.slice(last * 3, (last * 3) + 3),
    );
  }
});

Deno.test('torus triangle winding matches outward normals', () => {
  assertTriangleWindingMatchesNormals(createTorusMesh({ id: 'torus' }));
});

Deno.test('generated meshes integrate with scene evaluation and residency upload', () => {
  const context = createMockUploadContext();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('primitive-scene');
  scene = appendMesh(scene, createBoxMesh({ id: 'box', materialId: 'mat-0' }));
  scene = appendNode(scene, createNode('box-node', { meshId: 'box' }));

  ensureSceneMeshResidency(context, runtimeResidency, scene, evaluateScene(scene, { timeMs: 0 }));

  assertEquals([...runtimeResidency.geometry.keys()], ['box']);
  assertEquals(context.buffers.length, 4);
});
