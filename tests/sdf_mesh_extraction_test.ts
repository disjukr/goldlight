import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import {
  extractMarchingCubesMesh,
  extractSdfMesh,
  extractSurfaceNetMesh,
  inferSdfExtractionBounds,
  type SdfPrimitive,
  triangulateMarchingCubesCell,
} from '@rieul3d/geometry';
import type { MeshPrimitive } from '@rieul3d/ir';

const getAttribute = (mesh: MeshPrimitive, semantic: string): readonly number[] => {
  const attribute = mesh.attributes.find((candidate) => candidate.semantic === semantic);
  if (!attribute) {
    throw new Error(`missing attribute "${semantic}"`);
  }

  return attribute.values;
};

const assertFiniteMesh = (mesh: MeshPrimitive): void => {
  const positions = getAttribute(mesh, 'POSITION');
  const normals = getAttribute(mesh, 'NORMAL');
  const texcoords = getAttribute(mesh, 'TEXCOORD_0');

  assert(positions.length > 0);
  assert(normals.length === positions.length);
  assert(texcoords.length === (positions.length / 3) * 2);
  assert(Boolean(mesh.indices));
  assert((mesh.indices?.length ?? 0) > 0);
  assertEquals((mesh.indices?.length ?? 0) % 3, 0);

  for (const value of [...positions, ...normals, ...texcoords, ...(mesh.indices ?? [])]) {
    assert(Number.isFinite(value));
  }

  const vertexCount = positions.length / 3;
  for (const index of mesh.indices ?? []) {
    assert(index >= 0 && index < vertexCount);
  }
};

const assertPositionsInsideBounds = (mesh: MeshPrimitive, primitive: SdfPrimitive): void => {
  const bounds = inferSdfExtractionBounds(primitive, 0.1);
  const positions = getAttribute(mesh, 'POSITION');

  for (let index = 0; index < positions.length; index += 3) {
    assert(positions[index] >= bounds.min[0] - 1e-4);
    assert(positions[index] <= bounds.max[0] + 1e-4);
    assert(positions[index + 1] >= bounds.min[1] - 1e-4);
    assert(positions[index + 1] <= bounds.max[1] + 1e-4);
    assert(positions[index + 2] >= bounds.min[2] - 1e-4);
    assert(positions[index + 2] <= bounds.max[2] + 1e-4);
  }
};

const sphere: SdfPrimitive = {
  id: 'sphere',
  op: 'sphere',
  parameters: {
    radius: { x: 0.75, y: 0, z: 0, w: 0 },
  },
};

const box: SdfPrimitive = {
  id: 'box',
  op: 'box',
  parameters: {
    size: { x: 0.5, y: 0.25, z: 0.75, w: 0 },
  },
};

Deno.test('extractSdfMesh produces deterministic marching-cubes output for supported sdf primitives', () => {
  const first = extractMarchingCubesMesh(sphere, {
    resolution: { x: 10, y: 11, z: 12 },
    padding: 0.1,
  });
  const second = extractSdfMesh(sphere, {
    algorithm: 'marching-cubes',
    resolution: { x: 10, y: 11, z: 12 },
    padding: 0.1,
  });

  assertEquals(first, second);
  assertFiniteMesh(first);
  assertPositionsInsideBounds(first, sphere);
});

Deno.test('extractSurfaceNetMesh produces deterministic indexed output for supported sdf primitives', () => {
  const first = extractSurfaceNetMesh(box, {
    resolution: { x: 12, y: 10, z: 14 },
    padding: 0.1,
  });
  const second = extractSdfMesh(box, {
    algorithm: 'surface-nets',
    resolution: { x: 12, y: 10, z: 14 },
    padding: 0.1,
  });

  assertEquals(first, second);
  assertFiniteMesh(first);
  assertPositionsInsideBounds(first, box);
});

Deno.test('marching-cubes sphere extraction stays near the requested radius', () => {
  const mesh = extractMarchingCubesMesh(sphere, {
    resolution: { x: 18, y: 18, z: 18 },
    padding: 0.05,
  });
  const positions = getAttribute(mesh, 'POSITION');

  let averageRadius = 0;
  for (let index = 0; index < positions.length; index += 3) {
    averageRadius += Math.hypot(positions[index], positions[index + 1], positions[index + 2]);
  }
  averageRadius /= positions.length / 3;

  assert(Math.abs(averageRadius - 0.75) < 0.12);
});

Deno.test('surface-nets box extraction reaches each signed extent', () => {
  const mesh = extractSurfaceNetMesh(box, {
    resolution: { x: 18, y: 14, z: 20 },
    padding: 0.05,
  });
  const positions = getAttribute(mesh, 'POSITION');
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    maxX = Math.max(maxX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    maxY = Math.max(maxY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }

  assert(Math.abs(minX + 0.5) < 0.12);
  assert(Math.abs(maxX - 0.5) < 0.12);
  assert(Math.abs(minY + 0.25) < 0.12);
  assert(Math.abs(maxY - 0.25) < 0.12);
  assert(Math.abs(minZ + 0.75) < 0.12);
  assert(Math.abs(maxZ - 0.75) < 0.12);
});

Deno.test('surface-nets sphere extraction closes tight bounds at the poles', () => {
  const mesh = extractSurfaceNetMesh(sphere, {
    resolution: { x: 18, y: 18, z: 18 },
    bounds: {
      min: [-0.75, -0.75, -0.75],
      max: [0.75, 0.75, 0.75],
    },
  });
  const positions = getAttribute(mesh, 'POSITION');
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < positions.length; index += 3) {
    minY = Math.min(minY, positions[index + 1]);
    maxY = Math.max(maxY, positions[index + 1]);
  }

  assert(Math.abs(minY + 0.75) < 0.05);
  assert(Math.abs(maxY - 0.75) < 0.05);
});

Deno.test('triangulateMarchingCubesCell follows canonical case-table edge wiring', () => {
  const triangles = triangulateMarchingCubesCell(
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    [-1, 1, -1, 1, 1, 1, 1, 1],
    0,
  );

  assertEquals(triangles.length, 2);
  assertEquals(
    triangles.map((triangle) => triangle.map(([x, y, z]) => [x, y, z])),
    [
      [
        [0.5, 0, 0],
        [0, 0, 0.5],
        [0, 0.5, 0],
      ],
      [
        [1, 0.5, 0],
        [0.5, 1, 0],
        [1, 1, 0.5],
      ],
    ],
  );
});

Deno.test('triangulateMarchingCubesCell emits one quad split instead of a centroid fan', () => {
  const triangles = triangulateMarchingCubesCell(
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    [-1, -1, 1, 1, -1, -1, 1, 1],
    0,
  );

  assertEquals(triangles.length, 2);
});

Deno.test('marching-cubes sphere extraction drops degenerate triangles at exact iso hits', () => {
  const mesh = extractMarchingCubesMesh(sphere, {
    resolution: { x: 18, y: 18, z: 18 },
    bounds: {
      min: [-0.75, -0.75, -0.75],
      max: [0.75, 0.75, 0.75],
    },
  });
  const positions = getAttribute(mesh, 'POSITION');
  const indices = mesh.indices ?? [];

  for (let index = 0; index < indices.length; index += 3) {
    const pointAIndex = indices[index] * 3;
    const pointBIndex = indices[index + 1] * 3;
    const pointCIndex = indices[index + 2] * 3;
    const ab = [
      positions[pointBIndex] - positions[pointAIndex],
      positions[pointBIndex + 1] - positions[pointAIndex + 1],
      positions[pointBIndex + 2] - positions[pointAIndex + 2],
    ];
    const ac = [
      positions[pointCIndex] - positions[pointAIndex],
      positions[pointCIndex + 1] - positions[pointAIndex + 1],
      positions[pointCIndex + 2] - positions[pointAIndex + 2],
    ];
    const doubledArea = Math.hypot(
      (ab[1] * ac[2]) - (ab[2] * ac[1]),
      (ab[2] * ac[0]) - (ab[0] * ac[2]),
      (ab[0] * ac[1]) - (ab[1] * ac[0]),
    );
    assert(doubledArea > 1e-6);
  }
});

Deno.test('sdf extraction rejects unsupported ops, invalid dimensions, and invalid resolutions', () => {
  assertThrows(() =>
    extractSdfMesh({
      id: 'torus',
      op: 'torus',
      parameters: {},
    })
  );
  assertThrows(() =>
    extractSdfMesh({
      id: 'bad-sphere',
      op: 'sphere',
      parameters: {
        radius: { x: -1, y: 0, z: 0, w: 0 },
      },
    })
  );
  assertThrows(() =>
    extractSdfMesh({
      id: 'bad-box',
      op: 'box',
      parameters: {
        size: { x: 0.5, y: 0, z: 0.75, w: 0 },
      },
    })
  );
  assertThrows(() =>
    extractSdfMesh(sphere, {
      resolution: { x: 0, y: 8, z: 8 },
    })
  );
});
