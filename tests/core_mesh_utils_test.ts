import { assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import {
  createMeshNormalsAttribute,
  createMeshTangentsAttribute,
  getMeshBounds,
} from '@goldlight/geometry';
import { createQuaternionFromEulerDegrees } from '@goldlight/math';
import type { MeshPrimitive } from '@goldlight/ir';

const createMesh = (mesh: Partial<MeshPrimitive> & Pick<MeshPrimitive, 'id'>): MeshPrimitive => ({
  id: mesh.id,
  attributes: mesh.attributes ?? [],
  indices: mesh.indices,
  materialId: mesh.materialId,
});

Deno.test('createQuaternionFromEulerDegrees returns the identity quaternion at zero rotation', () => {
  const quat = createQuaternionFromEulerDegrees(0, 0, 0);

  assertAlmostEquals(quat.x, 0, 1e-7);
  assertAlmostEquals(quat.y, 0, 1e-7);
  assertAlmostEquals(quat.z, 0, 1e-7);
  assertAlmostEquals(quat.w, 1, 1e-7);
});

Deno.test('createQuaternionFromEulerDegrees converts degree input into quaternion output', () => {
  const quat = createQuaternionFromEulerDegrees(0, 90, 0);

  assertAlmostEquals(quat.x, 0, 1e-7);
  assertAlmostEquals(quat.y, Math.SQRT1_2, 1e-7);
  assertAlmostEquals(quat.z, 0, 1e-7);
  assertAlmostEquals(quat.w, Math.SQRT1_2, 1e-7);
});

Deno.test('getMeshBounds returns min max center size and maxDimension', () => {
  const bounds = getMeshBounds(createMesh({
    id: 'mesh',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [-2, 1, 3, 4, -5, 9, 1, 2, -1],
    }],
  }));

  assertEquals(bounds.min, { x: -2, y: -5, z: -1 });
  assertEquals(bounds.max, { x: 4, y: 2, z: 9 });
  assertEquals(bounds.center, { x: 1, y: -1.5, z: 4 });
  assertEquals(bounds.size, { x: 6, y: 7, z: 10 });
  assertEquals(bounds.maxDimension, 10);
});

Deno.test('getMeshBounds rejects meshes without valid POSITION data', () => {
  assertThrows(() => getMeshBounds(createMesh({ id: 'mesh-missing' })));
  assertThrows(() =>
    getMeshBounds(createMesh({
      id: 'mesh-invalid',
      attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 1] }],
    }))
  );
  assertThrows(() =>
    getMeshBounds(createMesh({
      id: 'mesh-nan',
      attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 1, Number.NaN] }],
    }))
  );
});

Deno.test('createMeshNormalsAttribute builds normalized indexed normals', () => {
  const normals = createMeshNormalsAttribute(createMesh({
    id: 'mesh',
    indices: [0, 1, 2],
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    }],
  }));

  assertEquals(normals.semantic, 'NORMAL');
  assertEquals(normals.itemSize, 3);
  assertEquals(normals.values, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
});

Deno.test('createMeshNormalsAttribute also supports non-indexed triangle meshes', () => {
  const normals = createMeshNormalsAttribute(createMesh({
    id: 'mesh',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        -1,
        0,
        0,
      ],
    }],
  }));

  assertEquals(normals.values.length, 18);
  for (let index = 2; index < normals.values.length; index += 3) {
    assertAlmostEquals(Math.abs(normals.values[index] ?? 0), 1, 1e-7);
  }
});

Deno.test('createMeshNormalsAttribute rejects invalid triangle topology', () => {
  assertThrows(() =>
    createMeshNormalsAttribute(createMesh({
      id: 'mesh-indices',
      indices: [0, 1],
      attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
    }))
  );
  assertThrows(() =>
    createMeshNormalsAttribute(createMesh({
      id: 'mesh-range',
      indices: [0, 1, 3],
      attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
    }))
  );
  assertThrows(() =>
    createMeshNormalsAttribute(createMesh({
      id: 'mesh-fractional-index',
      indices: [0, 1.5, 2],
      attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
    }))
  );
  assertThrows(() =>
    createMeshNormalsAttribute(createMesh({
      id: 'mesh-nan-index',
      indices: [0, Number.NaN, 2],
      attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
    }))
  );
  assertThrows(() =>
    createMeshNormalsAttribute(createMesh({
      id: 'mesh-non-indexed',
      attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0] }],
    }))
  );
  assertThrows(() =>
    createMeshNormalsAttribute(createMesh({
      id: 'mesh-nan-position',
      indices: [0, 1, 2],
      attributes: [{
        semantic: 'POSITION',
        itemSize: 3,
        values: [0, 0, 0, 1, 0, 0, 0, Number.NaN, 0],
      }],
    }))
  );
});

Deno.test('createMeshTangentsAttribute builds tangent basis from indexed uv triangles', () => {
  const tangents = createMeshTangentsAttribute(createMesh({
    id: 'mesh',
    indices: [0, 1, 2],
    attributes: [
      {
        semantic: 'POSITION',
        itemSize: 3,
        values: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      },
      {
        semantic: 'NORMAL',
        itemSize: 3,
        values: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      },
      {
        semantic: 'TEXCOORD_0',
        itemSize: 2,
        values: [0, 0, 1, 0, 0, 1],
      },
    ],
  }));

  assertEquals(tangents.semantic, 'TANGENT');
  assertEquals(tangents.itemSize, 4);
  assertEquals(tangents.values.length, 12);
  for (let index = 0; index < tangents.values.length; index += 4) {
    assertAlmostEquals(tangents.values[index] ?? 0, 1, 1e-6);
    assertAlmostEquals(tangents.values[index + 1] ?? 0, 0, 1e-6);
    assertAlmostEquals(tangents.values[index + 2] ?? 0, 0, 1e-6);
    assertAlmostEquals(Math.abs(tangents.values[index + 3] ?? 0), 1, 1e-6);
  }
});
