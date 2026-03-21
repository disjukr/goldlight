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
  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index])) {
      throw new Error(`Mesh "${mesh.id}" has non-finite POSITION data`);
    }
  }

  return positions;
};

const requireTriangleIndex = (mesh: MeshPrimitive, vertexCount: number, index: number): number => {
  if (!Number.isInteger(index)) {
    throw new Error(`Mesh "${mesh.id}" references a non-integer vertex index`);
  }
  if (index < 0 || index >= vertexCount) {
    throw new Error(`Mesh "${mesh.id}" references an out-of-range vertex index`);
  }

  return index;
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
    const validatedAIndex = requireTriangleIndex(mesh, vertexCount, aIndex);
    const validatedBIndex = requireTriangleIndex(mesh, vertexCount, bIndex);
    const validatedCIndex = requireTriangleIndex(mesh, vertexCount, cIndex);

    const ax = positions[validatedAIndex * 3] ?? 0;
    const ay = positions[(validatedAIndex * 3) + 1] ?? 0;
    const az = positions[(validatedAIndex * 3) + 2] ?? 0;
    const bx = positions[validatedBIndex * 3] ?? 0;
    const by = positions[(validatedBIndex * 3) + 1] ?? 0;
    const bz = positions[(validatedBIndex * 3) + 2] ?? 0;
    const cx = positions[validatedCIndex * 3] ?? 0;
    const cy = positions[(validatedCIndex * 3) + 1] ?? 0;
    const cz = positions[(validatedCIndex * 3) + 2] ?? 0;

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = (aby * acz) - (abz * acy);
    const ny = (abz * acx) - (abx * acz);
    const nz = (abx * acy) - (aby * acx);

    normals[validatedAIndex * 3] += nx;
    normals[(validatedAIndex * 3) + 1] += ny;
    normals[(validatedAIndex * 3) + 2] += nz;
    normals[validatedBIndex * 3] += nx;
    normals[(validatedBIndex * 3) + 1] += ny;
    normals[(validatedBIndex * 3) + 2] += nz;
    normals[validatedCIndex * 3] += nx;
    normals[(validatedCIndex * 3) + 1] += ny;
    normals[(validatedCIndex * 3) + 2] += nz;
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

export const createMeshTangentsAttribute = (mesh: MeshPrimitive): MeshAttribute => {
  const positions = getPositionValues(mesh);
  const normals = mesh.attributes.find((attribute) => attribute.semantic === 'NORMAL')?.values;
  const texcoords = mesh.attributes.find((attribute) => attribute.semantic === 'TEXCOORD_0')
    ?.values;

  if (!normals || normals.length !== positions.length) {
    throw new Error(`Mesh "${mesh.id}" is missing NORMAL data required for tangent generation`);
  }
  if (!texcoords || texcoords.length !== (positions.length / 3) * 2) {
    throw new Error(`Mesh "${mesh.id}" is missing TEXCOORD_0 data required for tangent generation`);
  }

  const vertexCount = positions.length / 3;
  const tan1 = new Float32Array(vertexCount * 3);
  const tan2 = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 4);
  const indices = mesh.indices;

  const accumulateTriangle = (aIndex: number, bIndex: number, cIndex: number) => {
    const a = requireTriangleIndex(mesh, vertexCount, aIndex);
    const b = requireTriangleIndex(mesh, vertexCount, bIndex);
    const c = requireTriangleIndex(mesh, vertexCount, cIndex);

    const ax = positions[a * 3] ?? 0;
    const ay = positions[(a * 3) + 1] ?? 0;
    const az = positions[(a * 3) + 2] ?? 0;
    const bx = positions[b * 3] ?? 0;
    const by = positions[(b * 3) + 1] ?? 0;
    const bz = positions[(b * 3) + 2] ?? 0;
    const cx = positions[c * 3] ?? 0;
    const cy = positions[(c * 3) + 1] ?? 0;
    const cz = positions[(c * 3) + 2] ?? 0;

    const au = texcoords[a * 2] ?? 0;
    const av = texcoords[(a * 2) + 1] ?? 0;
    const bu = texcoords[b * 2] ?? 0;
    const bv = texcoords[(b * 2) + 1] ?? 0;
    const cu = texcoords[c * 2] ?? 0;
    const cv = texcoords[(c * 2) + 1] ?? 0;

    const x1 = bx - ax;
    const y1 = by - ay;
    const z1 = bz - az;
    const x2 = cx - ax;
    const y2 = cy - ay;
    const z2 = cz - az;
    const s1 = bu - au;
    const t1 = bv - av;
    const s2 = cu - au;
    const t2 = cv - av;
    const denominator = (s1 * t2) - (s2 * t1);
    if (Math.abs(denominator) <= 1e-8) {
      return;
    }

    const inverse = 1 / denominator;
    const tangent = [
      (t2 * x1 - t1 * x2) * inverse,
      (t2 * y1 - t1 * y2) * inverse,
      (t2 * z1 - t1 * z2) * inverse,
    ] as const;
    const bitangent = [
      (s1 * x2 - s2 * x1) * inverse,
      (s1 * y2 - s2 * y1) * inverse,
      (s1 * z2 - s2 * z1) * inverse,
    ] as const;

    for (const index of [a, b, c]) {
      tan1[index * 3] += tangent[0];
      tan1[(index * 3) + 1] += tangent[1];
      tan1[(index * 3) + 2] += tangent[2];
      tan2[index * 3] += bitangent[0];
      tan2[(index * 3) + 1] += bitangent[1];
      tan2[(index * 3) + 2] += bitangent[2];
    }
  };

  if (indices && indices.length > 0) {
    if (indices.length % 3 !== 0) {
      throw new Error(`Mesh "${mesh.id}" must provide triangle indices in groups of three`);
    }
    for (let index = 0; index < indices.length; index += 3) {
      accumulateTriangle(indices[index] ?? -1, indices[index + 1] ?? -1, indices[index + 2] ?? -1);
    }
  } else {
    if (vertexCount % 3 !== 0) {
      throw new Error(
        `Mesh "${mesh.id}" must provide indexed triangles or a non-indexed POSITION count divisible by three`,
      );
    }
    for (let index = 0; index < vertexCount; index += 3) {
      accumulateTriangle(index, index + 1, index + 2);
    }
  }

  for (let index = 0; index < vertexCount; index += 1) {
    const nx = normals[index * 3] ?? 0;
    const ny = normals[(index * 3) + 1] ?? 0;
    const nz = normals[(index * 3) + 2] ?? 0;
    const tx = tan1[index * 3] ?? 0;
    const ty = tan1[(index * 3) + 1] ?? 0;
    const tz = tan1[(index * 3) + 2] ?? 0;
    const handednessX = tan2[index * 3] ?? 0;
    const handednessY = tan2[(index * 3) + 1] ?? 0;
    const handednessZ = tan2[(index * 3) + 2] ?? 0;

    const dot = (nx * tx) + (ny * ty) + (nz * tz);
    let tangentX = tx - (nx * dot);
    let tangentY = ty - (ny * dot);
    let tangentZ = tz - (nz * dot);
    const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1;
    tangentX /= tangentLength;
    tangentY /= tangentLength;
    tangentZ /= tangentLength;

    const crossX = (ny * tangentZ) - (nz * tangentY);
    const crossY = (nz * tangentX) - (nx * tangentZ);
    const crossZ = (nx * tangentY) - (ny * tangentX);
    const handedness =
      ((crossX * handednessX) + (crossY * handednessY) + (crossZ * handednessZ)) < 0 ? -1 : 1;

    tangents[index * 4] = tangentX;
    tangents[(index * 4) + 1] = tangentY;
    tangents[(index * 4) + 2] = tangentZ;
    tangents[(index * 4) + 3] = handedness;
  }

  return {
    semantic: 'TANGENT',
    itemSize: 4,
    values: Array.from(tangents),
  };
};
