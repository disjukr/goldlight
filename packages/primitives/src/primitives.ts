import type { MeshPrimitive } from '@rieul3d/ir';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

type BaseMeshOptions = Readonly<{
  id: string;
  materialId?: string;
}>;

export type CreateBoxMeshOptions =
  & BaseMeshOptions
  & Readonly<{
    width?: number;
    height?: number;
    depth?: number;
  }>;

export type CreateSphereMeshOptions =
  & BaseMeshOptions
  & Readonly<{
    radius?: number;
    widthSegments?: number;
    heightSegments?: number;
  }>;

export type CreateCylinderMeshOptions =
  & BaseMeshOptions
  & Readonly<{
    radiusTop?: number;
    radiusBottom?: number;
    height?: number;
    radialSegments?: number;
    heightSegments?: number;
    openEnded?: boolean;
  }>;

export type CreateCapsuleMeshOptions =
  & BaseMeshOptions
  & Readonly<{
    radius?: number;
    height?: number;
    radialSegments?: number;
    capSegments?: number;
  }>;

export type CreateTorusMeshOptions =
  & BaseMeshOptions
  & Readonly<{
    radius?: number;
    tubeRadius?: number;
    radialSegments?: number;
    tubularSegments?: number;
  }>;

export type CreateRegularPolyhedronMeshOptions =
  & BaseMeshOptions
  & Readonly<{
    radius?: number;
  }>;

type MeshBuffers = Readonly<{
  positions: readonly number[];
  normals: readonly number[];
  texcoords: readonly number[];
  indices: readonly number[];
}>;

const defaultBoxSize = 1;
const defaultSphereRadius = 0.5;
const defaultSphereWidthSegments = 16;
const defaultSphereHeightSegments = 8;
const defaultCylinderRadius = 0.5;
const defaultCylinderHeight = 1;
const defaultCylinderRadialSegments = 16;
const defaultCylinderHeightSegments = 1;
const defaultCapsuleRadius = 0.25;
const defaultCapsuleHeight = 1;
const defaultCapsuleRadialSegments = 16;
const defaultCapsuleCapSegments = 8;
const defaultTorusRadius = 0.5;
const defaultTorusTubeRadius = 0.2;
const defaultTorusRadialSegments = 12;
const defaultTorusTubularSegments = 24;
const defaultPolyhedronRadius = 0.5;
const epsilon = 1e-8;

const assertPositive = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`"${name}" must be a positive finite number`);
  }

  return value;
};

const assertIntegerAtLeast = (name: string, value: number, minimum: number): number => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`"${name}" must be an integer greater than or equal to ${minimum}`);
  }

  return value;
};

const normalizeVec3 = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z);
  if (length < epsilon) {
    return [0, 0, 0];
  }

  return [x / length, y / length, z / length];
};

const addVec3 = ([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): Vec3 => [ax + bx, ay + by, az + bz];

const subtractVec3 = ([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): Vec3 => [ax - bx, ay - by, az - bz];

const scaleVec3 = ([x, y, z]: Vec3, scalar: number): Vec3 => [x * scalar, y * scalar, z * scalar];

const dotVec3 = ([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): number =>
  (ax * bx) + (ay * by) + (az * bz);

const crossVec3 = ([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): Vec3 => [
  (ay * bz) - (az * by),
  (az * bx) - (ax * bz),
  (ax * by) - (ay * bx),
];

const createMeshPrimitive = (
  options: BaseMeshOptions,
  buffers: MeshBuffers,
): MeshPrimitive => ({
  id: options.id,
  attributes: [
    {
      semantic: 'POSITION',
      itemSize: 3,
      values: buffers.positions,
    },
    {
      semantic: 'NORMAL',
      itemSize: 3,
      values: buffers.normals,
    },
    {
      semantic: 'TEXCOORD_0',
      itemSize: 2,
      values: buffers.texcoords,
    },
  ],
  indices: buffers.indices,
  materialId: options.materialId,
});

const createGridMesh = (
  options: BaseMeshOptions,
  ringCount: number,
  segmentCount: number,
  vertexAt: (ringIndex: number, segmentIndex: number) => Readonly<{
    position: Vec3;
    normal: Vec3;
    uv: Vec2;
  }>,
): MeshPrimitive => {
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const vertex = vertexAt(ringIndex, segmentIndex);
      positions.push(...vertex.position);
      normals.push(...normalizeVec3(vertex.normal));
      texcoords.push(...vertex.uv);
    }
  }

  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex += 1) {
    for (let segmentIndex = 0; segmentIndex < segmentCount - 1; segmentIndex += 1) {
      const a = (ringIndex * segmentCount) + segmentIndex;
      const b = a + segmentCount;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  return createMeshPrimitive(options, { positions, normals, texcoords, indices });
};

const appendCap = (
  positions: number[],
  normals: number[],
  texcoords: number[],
  indices: number[],
  centerY: number,
  radius: number,
  radialSegments: number,
  normalY: number,
): void => {
  if (radius <= 0) {
    return;
  }

  const startIndex = positions.length / 3;
  positions.push(0, centerY, 0);
  normals.push(0, normalY, 0);
  texcoords.push(0.5, 0.5);

  for (let segmentIndex = 0; segmentIndex <= radialSegments; segmentIndex += 1) {
    const u = segmentIndex / radialSegments;
    const theta = u * Math.PI * 2;
    const x = Math.sin(theta) * radius;
    const z = Math.cos(theta) * radius;
    positions.push(x, centerY, z);
    normals.push(0, normalY, 0);
    texcoords.push((x / (radius * 2)) + 0.5, (z / (radius * 2 * normalY)) + 0.5);
  }

  for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
    const first = startIndex + 1 + segmentIndex;
    const second = first + 1;
    if (normalY > 0) {
      indices.push(startIndex, first, second);
    } else {
      indices.push(startIndex, second, first);
    }
  }
};

const projectFaceUvs = (points: readonly Vec3[], normal: Vec3): readonly Vec2[] => {
  const centroid = points.reduce<Vec3>((acc, point) => addVec3(acc, point), [0, 0, 0]);
  const faceCenter = scaleVec3(centroid, 1 / points.length);
  const tangentSeed = subtractVec3(points[0], faceCenter);
  const tangent = normalizeVec3(
    Math.hypot(...tangentSeed) < epsilon
      ? crossVec3(Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], normal)
      : tangentSeed,
  );
  const bitangent = normalizeVec3(crossVec3(normal, tangent));
  const projected = points.map((point) => {
    const relative = subtractVec3(point, faceCenter);
    return [dotVec3(relative, tangent), dotVec3(relative, bitangent)] as const;
  });
  const minU = Math.min(...projected.map(([u]) => u));
  const maxU = Math.max(...projected.map(([u]) => u));
  const minV = Math.min(...projected.map(([, v]) => v));
  const maxV = Math.max(...projected.map(([, v]) => v));
  const sizeU = Math.max(maxU - minU, epsilon);
  const sizeV = Math.max(maxV - minV, epsilon);

  return projected.map(([u, v]) => [(u - minU) / sizeU, (v - minV) / sizeV] as const);
};

const buildFlatShadedPolyhedron = (
  options: BaseMeshOptions,
  vertices: readonly Vec3[],
  faces: readonly (readonly number[])[],
): MeshPrimitive => {
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];

  for (const face of faces) {
    let orderedPoints = face.map((index) => vertices[index]);
    let normal = normalizeVec3(
      crossVec3(
        subtractVec3(orderedPoints[1], orderedPoints[0]),
        subtractVec3(orderedPoints[2], orderedPoints[0]),
      ),
    );
    const centroid = normalizeVec3(
      scaleVec3(
        orderedPoints.reduce<Vec3>((acc, point) => addVec3(acc, point), [0, 0, 0]),
        1 / orderedPoints.length,
      ),
    );

    if (dotVec3(normal, centroid) < 0) {
      orderedPoints = [...orderedPoints].reverse();
      normal = scaleVec3(normal, -1);
    }

    const uvs = projectFaceUvs(orderedPoints, normal);
    const startIndex = positions.length / 3;

    for (let index = 0; index < orderedPoints.length; index += 1) {
      positions.push(...orderedPoints[index]);
      normals.push(...normal);
      texcoords.push(...uvs[index]);
    }

    for (let index = 1; index < orderedPoints.length - 1; index += 1) {
      indices.push(startIndex, startIndex + index, startIndex + index + 1);
    }
  }

  return createMeshPrimitive(options, { positions, normals, texcoords, indices });
};

const createDualFaces = (
  vertices: readonly Vec3[],
  faces: readonly (readonly [number, number, number])[],
): readonly (readonly number[])[] => {
  const adjacency = vertices.map(() => [] as number[]);

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    adjacency[face[0]].push(faceIndex);
    adjacency[face[1]].push(faceIndex);
    adjacency[face[2]].push(faceIndex);
  }

  return adjacency.map((adjacentFaceIndices, vertexIndex) => {
    const outward = normalizeVec3(vertices[vertexIndex]);
    const reference = Math.abs(outward[1]) > 0.9 ? [1, 0, 0] as const : [0, 1, 0] as const;
    const basisX = normalizeVec3(crossVec3(reference, outward));
    const basisY = normalizeVec3(crossVec3(outward, basisX));

    return [...adjacentFaceIndices].sort((leftIndex, rightIndex) => {
      const left = normalizeVec3(dualIcosahedronVertices[leftIndex]);
      const right = normalizeVec3(dualIcosahedronVertices[rightIndex]);
      const leftProjected = normalizeVec3(
        subtractVec3(left, scaleVec3(outward, dotVec3(left, outward))),
      );
      const rightProjected = normalizeVec3(
        subtractVec3(right, scaleVec3(outward, dotVec3(right, outward))),
      );
      const leftAngle = Math.atan2(dotVec3(leftProjected, basisY), dotVec3(leftProjected, basisX));
      const rightAngle = Math.atan2(
        dotVec3(rightProjected, basisY),
        dotVec3(rightProjected, basisX),
      );
      return leftAngle - rightAngle;
    });
  });
};

const goldenRatio = (1 + Math.sqrt(5)) / 2;

const tetrahedronVertices: readonly Vec3[] = [
  [1, 1, 1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, -1, -1],
].map(([x, y, z]) => normalizeVec3([x, y, z] as const));

const tetrahedronFaces = [
  [0, 1, 2],
  [0, 3, 1],
  [0, 2, 3],
  [1, 3, 2],
] as const;

const octahedronVertices: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const octahedronFaces = [
  [0, 2, 4],
  [4, 2, 1],
  [1, 2, 5],
  [5, 2, 0],
  [4, 3, 0],
  [1, 3, 4],
  [5, 3, 1],
  [0, 3, 5],
] as const;

const icosahedronVertices: readonly Vec3[] = [
  [-1, goldenRatio, 0],
  [1, goldenRatio, 0],
  [-1, -goldenRatio, 0],
  [1, -goldenRatio, 0],
  [0, -1, goldenRatio],
  [0, 1, goldenRatio],
  [0, -1, -goldenRatio],
  [0, 1, -goldenRatio],
  [goldenRatio, 0, -1],
  [goldenRatio, 0, 1],
  [-goldenRatio, 0, -1],
  [-goldenRatio, 0, 1],
].map(([x, y, z]) => normalizeVec3([x, y, z] as const));

const icosahedronFaces = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
] as const satisfies readonly (readonly [number, number, number])[];

const dualIcosahedronVertices: readonly Vec3[] = icosahedronFaces.map((face) =>
  normalizeVec3(
    scaleVec3(
      addVec3(
        addVec3(icosahedronVertices[face[0]], icosahedronVertices[face[1]]),
        icosahedronVertices[face[2]],
      ),
      1 / 3,
    ),
  )
);

const dodecahedronFaces = createDualFaces(icosahedronVertices, icosahedronFaces);

export const createBoxMesh = (options: CreateBoxMeshOptions): MeshPrimitive => {
  const width = assertPositive('width', options.width ?? defaultBoxSize);
  const height = assertPositive('height', options.height ?? defaultBoxSize);
  const depth = assertPositive('depth', options.depth ?? defaultBoxSize);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const halfDepth = depth / 2;

  const faces = [
    {
      normal: [0, 0, 1] as const,
      corners: [
        [-halfWidth, -halfHeight, halfDepth],
        [halfWidth, -halfHeight, halfDepth],
        [halfWidth, halfHeight, halfDepth],
        [-halfWidth, halfHeight, halfDepth],
      ] as const,
    },
    {
      normal: [0, 0, -1] as const,
      corners: [
        [halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
        [halfWidth, halfHeight, -halfDepth],
      ] as const,
    },
    {
      normal: [1, 0, 0] as const,
      corners: [
        [halfWidth, -halfHeight, halfDepth],
        [halfWidth, -halfHeight, -halfDepth],
        [halfWidth, halfHeight, -halfDepth],
        [halfWidth, halfHeight, halfDepth],
      ] as const,
    },
    {
      normal: [-1, 0, 0] as const,
      corners: [
        [-halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, halfDepth],
        [-halfWidth, halfHeight, halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
      ] as const,
    },
    {
      normal: [0, 1, 0] as const,
      corners: [
        [-halfWidth, halfHeight, halfDepth],
        [halfWidth, halfHeight, halfDepth],
        [halfWidth, halfHeight, -halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
      ] as const,
    },
    {
      normal: [0, -1, 0] as const,
      corners: [
        [-halfWidth, -halfHeight, -halfDepth],
        [halfWidth, -halfHeight, -halfDepth],
        [halfWidth, -halfHeight, halfDepth],
        [-halfWidth, -halfHeight, halfDepth],
      ] as const,
    },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];

  for (const face of faces) {
    const startIndex = positions.length / 3;
    const uvs: readonly Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let index = 0; index < face.corners.length; index += 1) {
      positions.push(...face.corners[index]);
      normals.push(...face.normal);
      texcoords.push(...uvs[index]);
    }
    indices.push(
      startIndex,
      startIndex + 1,
      startIndex + 2,
      startIndex,
      startIndex + 2,
      startIndex + 3,
    );
  }

  return createMeshPrimitive(options, { positions, normals, texcoords, indices });
};

export const createHexahedronMesh = (options: CreateBoxMeshOptions): MeshPrimitive =>
  createBoxMesh(options);

export const createSphereMesh = (options: CreateSphereMeshOptions): MeshPrimitive => {
  const radius = assertPositive('radius', options.radius ?? defaultSphereRadius);
  const widthSegments = assertIntegerAtLeast(
    'widthSegments',
    options.widthSegments ?? defaultSphereWidthSegments,
    3,
  );
  const heightSegments = assertIntegerAtLeast(
    'heightSegments',
    options.heightSegments ?? defaultSphereHeightSegments,
    2,
  );

  return createGridMesh(
    options,
    heightSegments + 1,
    widthSegments + 1,
    (ringIndex, segmentIndex) => {
      const u = segmentIndex / widthSegments;
      const v = ringIndex / heightSegments;
      const theta = u * Math.PI * 2;
      const phi = v * Math.PI;
      const radial = Math.sin(phi);
      const normal = normalizeVec3([
        Math.sin(theta) * radial,
        Math.cos(phi),
        Math.cos(theta) * radial,
      ]);

      return {
        position: scaleVec3(normal, radius),
        normal,
        uv: [u, v],
      };
    },
  );
};

export const createCylinderMesh = (options: CreateCylinderMeshOptions): MeshPrimitive => {
  const radiusTop = assertPositive('radiusTop', options.radiusTop ?? defaultCylinderRadius);
  const radiusBottom = assertPositive(
    'radiusBottom',
    options.radiusBottom ?? defaultCylinderRadius,
  );
  const height = assertPositive('height', options.height ?? defaultCylinderHeight);
  const radialSegments = assertIntegerAtLeast(
    'radialSegments',
    options.radialSegments ?? defaultCylinderRadialSegments,
    3,
  );
  const heightSegments = assertIntegerAtLeast(
    'heightSegments',
    options.heightSegments ?? defaultCylinderHeightSegments,
    1,
  );
  const halfHeight = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  const sideMesh = createGridMesh(
    options,
    heightSegments + 1,
    radialSegments + 1,
    (ringIndex, segmentIndex) => {
      const u = segmentIndex / radialSegments;
      const v = ringIndex / heightSegments;
      const theta = u * Math.PI * 2;
      const radius = radiusTop + ((radiusBottom - radiusTop) * v);
      const y = halfHeight - (v * height);
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      return {
        position: [sinTheta * radius, y, cosTheta * radius],
        normal: normalizeVec3([sinTheta, slope, cosTheta]),
        uv: [u, v],
      };
    },
  );

  if (options.openEnded) {
    return sideMesh;
  }

  const positions = [...sideMesh.attributes[0].values];
  const normals = [...sideMesh.attributes[1].values];
  const texcoords = [...sideMesh.attributes[2].values];
  const indices = [...(sideMesh.indices ?? [])];

  appendCap(positions, normals, texcoords, indices, halfHeight, radiusTop, radialSegments, 1);
  appendCap(positions, normals, texcoords, indices, -halfHeight, radiusBottom, radialSegments, -1);

  return createMeshPrimitive(options, { positions, normals, texcoords, indices });
};

export const createCapsuleMesh = (options: CreateCapsuleMeshOptions): MeshPrimitive => {
  const radius = assertPositive('radius', options.radius ?? defaultCapsuleRadius);
  const height = assertPositive('height', options.height ?? defaultCapsuleHeight);
  const radialSegments = assertIntegerAtLeast(
    'radialSegments',
    options.radialSegments ?? defaultCapsuleRadialSegments,
    3,
  );
  const capSegments = assertIntegerAtLeast(
    'capSegments',
    options.capSegments ?? defaultCapsuleCapSegments,
    2,
  );
  const cylinderHeight = Math.max(height - (radius * 2), 0);
  const halfCylinder = cylinderHeight / 2;
  const ringCount = (capSegments * 2) + 2;
  const totalHeight = cylinderHeight + (radius * 2);

  return createGridMesh(options, ringCount, radialSegments + 1, (ringIndex, segmentIndex) => {
    const u = segmentIndex / radialSegments;
    const theta = u * Math.PI * 2;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    let ringRadius = radius;
    let localY = 0;
    let normal: Vec3 = [sinTheta, 0, cosTheta];

    if (ringIndex <= capSegments) {
      const phi = (ringIndex / capSegments) * (Math.PI / 2);
      ringRadius = Math.sin(phi) * radius;
      localY = halfCylinder + (Math.cos(phi) * radius);
      normal = normalizeVec3([sinTheta * Math.sin(phi), Math.cos(phi), cosTheta * Math.sin(phi)]);
    } else if (ringIndex === capSegments + 1) {
      ringRadius = radius;
      localY = -halfCylinder;
      normal = [sinTheta, 0, cosTheta];
    } else {
      const southIndex = ringIndex - (capSegments + 1);
      const phi = (Math.PI / 2) + ((southIndex / capSegments) * (Math.PI / 2));
      ringRadius = Math.sin(phi) * radius;
      localY = -halfCylinder + (Math.cos(phi) * radius);
      normal = normalizeVec3([sinTheta * Math.sin(phi), Math.cos(phi), cosTheta * Math.sin(phi)]);
    }

    return {
      position: [sinTheta * ringRadius, localY, cosTheta * ringRadius],
      normal,
      uv: [u, (halfCylinder + radius - localY) / totalHeight],
    };
  });
};

export const createTorusMesh = (options: CreateTorusMeshOptions): MeshPrimitive => {
  const radius = assertPositive('radius', options.radius ?? defaultTorusRadius);
  const tubeRadius = assertPositive('tubeRadius', options.tubeRadius ?? defaultTorusTubeRadius);
  const radialSegments = assertIntegerAtLeast(
    'radialSegments',
    options.radialSegments ?? defaultTorusRadialSegments,
    3,
  );
  const tubularSegments = assertIntegerAtLeast(
    'tubularSegments',
    options.tubularSegments ?? defaultTorusTubularSegments,
    3,
  );

  return createGridMesh(
    options,
    radialSegments + 1,
    tubularSegments + 1,
    (ringIndex, segmentIndex) => {
      const u = segmentIndex / tubularSegments;
      const v = ringIndex / radialSegments;
      const theta = u * Math.PI * 2;
      const phi = v * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const radialDistance = radius + (tubeRadius * cosPhi);
      const normal: Vec3 = [sinTheta * cosPhi, sinPhi, cosTheta * cosPhi];

      return {
        position: [sinTheta * radialDistance, tubeRadius * sinPhi, cosTheta * radialDistance],
        normal: normalizeVec3(normal),
        uv: [u, v],
      };
    },
  );
};

const scalePolyhedronVertices = (vertices: readonly Vec3[], radius: number): readonly Vec3[] =>
  vertices.map((vertex) => scaleVec3(vertex, radius));

export const createTetrahedronMesh = (
  options: CreateRegularPolyhedronMeshOptions,
): MeshPrimitive => {
  const radius = assertPositive('radius', options.radius ?? defaultPolyhedronRadius);
  return buildFlatShadedPolyhedron(
    options,
    scalePolyhedronVertices(tetrahedronVertices, radius),
    tetrahedronFaces,
  );
};

export const createOctahedronMesh = (
  options: CreateRegularPolyhedronMeshOptions,
): MeshPrimitive => {
  const radius = assertPositive('radius', options.radius ?? defaultPolyhedronRadius);
  return buildFlatShadedPolyhedron(
    options,
    scalePolyhedronVertices(octahedronVertices, radius),
    octahedronFaces,
  );
};

export const createIcosahedronMesh = (
  options: CreateRegularPolyhedronMeshOptions,
): MeshPrimitive => {
  const radius = assertPositive('radius', options.radius ?? defaultPolyhedronRadius);
  return buildFlatShadedPolyhedron(
    options,
    scalePolyhedronVertices(icosahedronVertices, radius),
    icosahedronFaces,
  );
};

export const createDodecahedronMesh = (
  options: CreateRegularPolyhedronMeshOptions,
): MeshPrimitive => {
  const radius = assertPositive('radius', options.radius ?? defaultPolyhedronRadius);
  return buildFlatShadedPolyhedron(
    options,
    scalePolyhedronVertices(dualIcosahedronVertices, radius),
    dodecahedronFaces,
  );
};
