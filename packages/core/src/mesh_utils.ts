import type { MeshAttribute, MeshPrimitive, Quat } from '@rieul3d/ir';

export type MeshBounds = Readonly<{
  min: Readonly<{ x: number; y: number; z: number }>;
  max: Readonly<{ x: number; y: number; z: number }>;
  size: Readonly<{ x: number; y: number; z: number }>;
  center: Readonly<{ x: number; y: number; z: number }>;
  maxDimension: number;
}>;

const getPositionValues = (mesh: MeshPrimitive): readonly number[] => {
  const positions = mesh.attributes.find((attribute) => attribute.semantic === 'POSITION')?.values;
  if (!positions) {
    throw new Error(`Mesh "${mesh.id}" is missing POSITION data`);
  }
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error(`Mesh "${mesh.id}" has invalid POSITION data`);
  }

  return positions;
};

export const createQuaternionFromEulerDegrees = (
  xDegrees: number,
  yDegrees: number,
  zDegrees: number,
): Quat => {
  const x = (xDegrees * Math.PI) / 180;
  const y = (yDegrees * Math.PI) / 180;
  const z = (zDegrees * Math.PI) / 180;
  const sx = Math.sin(x / 2);
  const cx = Math.cos(x / 2);
  const sy = Math.sin(y / 2);
  const cy = Math.cos(y / 2);
  const sz = Math.sin(z / 2);
  const cz = Math.cos(z / 2);

  return {
    x: (sx * cy * cz) - (cx * sy * sz),
    y: (cx * sy * cz) + (sx * cy * sz),
    z: (cx * cy * sz) - (sx * sy * cz),
    w: (cx * cy * cz) + (sx * sy * sz),
  };
};

export const getMeshBounds = (mesh: MeshPrimitive): MeshBounds => {
  const positions = getPositionValues(mesh);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const size = {
    x: maxX - minX,
    y: maxY - minY,
    z: maxZ - minZ,
  };

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    maxDimension: Math.max(size.x, size.y, size.z),
  };
};

export const createMeshNormalsAttribute = (mesh: MeshPrimitive): MeshAttribute => {
  const positions = getPositionValues(mesh);
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  const indices = mesh.indices;

  const accumulateFaceNormal = (aIndex: number, bIndex: number, cIndex: number) => {
    if (
      aIndex < 0 || aIndex >= vertexCount ||
      bIndex < 0 || bIndex >= vertexCount ||
      cIndex < 0 || cIndex >= vertexCount
    ) {
      throw new Error(`Mesh "${mesh.id}" references an out-of-range vertex index`);
    }

    const ax = positions[aIndex * 3] ?? 0;
    const ay = positions[(aIndex * 3) + 1] ?? 0;
    const az = positions[(aIndex * 3) + 2] ?? 0;
    const bx = positions[bIndex * 3] ?? 0;
    const by = positions[(bIndex * 3) + 1] ?? 0;
    const bz = positions[(bIndex * 3) + 2] ?? 0;
    const cx = positions[cIndex * 3] ?? 0;
    const cy = positions[(cIndex * 3) + 1] ?? 0;
    const cz = positions[(cIndex * 3) + 2] ?? 0;

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = (aby * acz) - (abz * acy);
    const ny = (abz * acx) - (abx * acz);
    const nz = (abx * acy) - (aby * acx);

    normals[aIndex * 3] += nx;
    normals[(aIndex * 3) + 1] += ny;
    normals[(aIndex * 3) + 2] += nz;
    normals[bIndex * 3] += nx;
    normals[(bIndex * 3) + 1] += ny;
    normals[(bIndex * 3) + 2] += nz;
    normals[cIndex * 3] += nx;
    normals[(cIndex * 3) + 1] += ny;
    normals[(cIndex * 3) + 2] += nz;
  };

  if (indices && indices.length > 0) {
    if (indices.length % 3 !== 0) {
      throw new Error(`Mesh "${mesh.id}" must provide triangle indices in groups of three`);
    }

    for (let index = 0; index < indices.length; index += 3) {
      accumulateFaceNormal(
        indices[index] ?? -1,
        indices[index + 1] ?? -1,
        indices[index + 2] ?? -1,
      );
    }
  } else {
    if (vertexCount % 3 !== 0) {
      throw new Error(
        `Mesh "${mesh.id}" must provide indexed triangles or a non-indexed POSITION count divisible by three`,
      );
    }

    for (let index = 0; index < vertexCount; index += 3) {
      accumulateFaceNormal(index, index + 1, index + 2);
    }
  }

  for (let index = 0; index < vertexCount; index += 1) {
    const x = normals[index * 3] ?? 0;
    const y = normals[(index * 3) + 1] ?? 0;
    const z = normals[(index * 3) + 2] ?? 0;
    const length = Math.hypot(x, y, z) || 1;
    normals[index * 3] = x / length;
    normals[(index * 3) + 1] = y / length;
    normals[(index * 3) + 2] = z / length;
  }

  return {
    semantic: 'NORMAL',
    itemSize: 3,
    values: Array.from(normals),
  };
};
