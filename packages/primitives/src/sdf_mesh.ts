import type { MeshPrimitive, SdfPrimitive } from '@rieul3d/ir';

type Vec3 = readonly [number, number, number];
type Vec2 = readonly [number, number];

export type SdfExtractionAlgorithm = 'marching-cubes' | 'surface-nets';

export type SdfExtractionBounds = Readonly<{
  min: Vec3;
  max: Vec3;
}>;

export type SdfExtractionResolution = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type ExtractSdfMeshOptions = Readonly<{
  id?: string;
  materialId?: string;
  algorithm?: SdfExtractionAlgorithm;
  bounds?: SdfExtractionBounds;
  resolution?: SdfExtractionResolution;
  isoLevel?: number;
  padding?: number;
}>;

type SampledGrid = Readonly<{
  bounds: SdfExtractionBounds;
  resolution: SdfExtractionResolution;
  step: Vec3;
  isoLevel: number;
  values: readonly number[];
}>;

type SurfaceNetVertex = Readonly<{
  position: Vec3;
  normal: Vec3;
  uv: Vec2;
}>;

const defaultResolution: SdfExtractionResolution = { x: 24, y: 24, z: 24 };
const defaultIsoLevel = 0;
const defaultPadding = 0.05;
const epsilon = 1e-6;

const cubeCorners: readonly Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

const cubeEdges: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

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

const lengthVec3 = ([x, y, z]: Vec3): number => Math.hypot(x, y, z);

const normalizeVec3 = (vector: Vec3): Vec3 => {
  const length = lengthVec3(vector);
  if (length < epsilon) {
    return [0, 1, 0];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const assertFiniteNumber = (name: string, value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`"${name}" must be a finite number`);
  }

  return value;
};

const assertPositiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`"${name}" must be a positive integer`);
  }

  return value;
};

const getScalarParameter = (
  primitive: SdfPrimitive,
  name: string,
  fallback: number,
): number => primitive.parameters[name]?.x ?? fallback;

const getVec3Parameter = (
  primitive: SdfPrimitive,
  name: string,
  fallback: Vec3,
): Vec3 => {
  const value = primitive.parameters[name];
  if (!value) {
    return fallback;
  }

  return [value.x, value.y, value.z];
};

const samplePrimitiveSdf = (primitive: SdfPrimitive, point: Vec3): number => {
  if (primitive.op === 'sphere') {
    const radius = assertFiniteNumber('radius', getScalarParameter(primitive, 'radius', 0.5));
    return lengthVec3(point) - radius;
  }

  if (primitive.op === 'box') {
    const halfExtents = getVec3Parameter(primitive, 'size', [0.5, 0.5, 0.5]);
    const q: Vec3 = [
      Math.abs(point[0]) - halfExtents[0],
      Math.abs(point[1]) - halfExtents[1],
      Math.abs(point[2]) - halfExtents[2],
    ];
    const outside = lengthVec3([
      Math.max(q[0], 0),
      Math.max(q[1], 0),
      Math.max(q[2], 0),
    ]);
    const inside = Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);
    return outside + inside;
  }

  throw new Error(
    `unsupported sdf op "${primitive.op}"; extraction currently supports sphere and box only`,
  );
};

export const inferSdfExtractionBounds = (
  primitive: SdfPrimitive,
  padding = defaultPadding,
): SdfExtractionBounds => {
  const validatedPadding = assertFiniteNumber('padding', padding);

  if (primitive.op === 'sphere') {
    const radius = assertFiniteNumber('radius', getScalarParameter(primitive, 'radius', 0.5));
    const extent = radius + validatedPadding;
    return {
      min: [-extent, -extent, -extent],
      max: [extent, extent, extent],
    };
  }

  if (primitive.op === 'box') {
    const size = getVec3Parameter(primitive, 'size', [0.5, 0.5, 0.5]);
    return {
      min: [
        -(size[0] + validatedPadding),
        -(size[1] + validatedPadding),
        -(size[2] + validatedPadding),
      ],
      max: [
        size[0] + validatedPadding,
        size[1] + validatedPadding,
        size[2] + validatedPadding,
      ],
    };
  }

  throw new Error(
    `unsupported sdf op "${primitive.op}"; extraction currently supports sphere and box only`,
  );
};

const validateResolution = (
  resolution: SdfExtractionResolution = defaultResolution,
): SdfExtractionResolution => ({
  x: assertPositiveInteger('resolution.x', resolution.x),
  y: assertPositiveInteger('resolution.y', resolution.y),
  z: assertPositiveInteger('resolution.z', resolution.z),
});

const latticeIndex = (
  resolution: SdfExtractionResolution,
  x: number,
  y: number,
  z: number,
): number => x + ((resolution.x + 1) * (y + ((resolution.y + 1) * z)));

const cellIndex = (resolution: SdfExtractionResolution, x: number, y: number, z: number): number =>
  x + (resolution.x * (y + (resolution.y * z)));

const pointAt = (
  bounds: SdfExtractionBounds,
  step: Vec3,
  x: number,
  y: number,
  z: number,
): Vec3 => [
  bounds.min[0] + (step[0] * x),
  bounds.min[1] + (step[1] * y),
  bounds.min[2] + (step[2] * z),
];

const crossesIsoLevel = (a: number, b: number, isoLevel: number): boolean => {
  const da = a - isoLevel;
  const db = b - isoLevel;
  return (da === 0 || db === 0 || (da < 0 && db > 0) || (da > 0 && db < 0));
};

const interpolateIsoPoint = (
  pointA: Vec3,
  valueA: number,
  pointB: Vec3,
  valueB: number,
  isoLevel: number,
): Vec3 => {
  const delta = valueB - valueA;
  if (Math.abs(delta) < epsilon) {
    return scaleVec3(addVec3(pointA, pointB), 0.5);
  }

  const t = (isoLevel - valueA) / delta;
  return [
    pointA[0] + ((pointB[0] - pointA[0]) * t),
    pointA[1] + ((pointB[1] - pointA[1]) * t),
    pointA[2] + ((pointB[2] - pointA[2]) * t),
  ];
};

const createUv = (point: Vec3, bounds: SdfExtractionBounds): Vec2 => {
  const width = Math.max(bounds.max[0] - bounds.min[0], epsilon);
  const depth = Math.max(bounds.max[2] - bounds.min[2], epsilon);
  return [
    clamp01((point[0] - bounds.min[0]) / width),
    clamp01((point[2] - bounds.min[2]) / depth),
  ];
};

const sampleGrid = (primitive: SdfPrimitive, options: ExtractSdfMeshOptions): SampledGrid => {
  const resolution = validateResolution(options.resolution);
  const isoLevel = assertFiniteNumber('isoLevel', options.isoLevel ?? defaultIsoLevel);
  const bounds = options.bounds ??
    inferSdfExtractionBounds(primitive, options.padding ?? defaultPadding);
  const step: Vec3 = [
    (bounds.max[0] - bounds.min[0]) / resolution.x,
    (bounds.max[1] - bounds.min[1]) / resolution.y,
    (bounds.max[2] - bounds.min[2]) / resolution.z,
  ];

  const values = new Array<number>((resolution.x + 1) * (resolution.y + 1) * (resolution.z + 1));

  for (let z = 0; z <= resolution.z; z += 1) {
    for (let y = 0; y <= resolution.y; y += 1) {
      for (let x = 0; x <= resolution.x; x += 1) {
        values[latticeIndex(resolution, x, y, z)] = samplePrimitiveSdf(
          primitive,
          pointAt(bounds, step, x, y, z),
        );
      }
    }
  }

  return { bounds, resolution, step, isoLevel, values };
};

const estimateNormal = (
  primitive: SdfPrimitive,
  point: Vec3,
  sampleStep: number,
): Vec3 => {
  const epsilonStep = Math.max(sampleStep * 0.5, 1e-4);
  const dx = samplePrimitiveSdf(primitive, [point[0] + epsilonStep, point[1], point[2]]) -
    samplePrimitiveSdf(primitive, [point[0] - epsilonStep, point[1], point[2]]);
  const dy = samplePrimitiveSdf(primitive, [point[0], point[1] + epsilonStep, point[2]]) -
    samplePrimitiveSdf(primitive, [point[0], point[1] - epsilonStep, point[2]]);
  const dz = samplePrimitiveSdf(primitive, [point[0], point[1], point[2] + epsilonStep]) -
    samplePrimitiveSdf(primitive, [point[0], point[1], point[2] - epsilonStep]);
  return normalizeVec3([dx, dy, dz]);
};

const createMeshPrimitive = (
  id: string,
  materialId: string | undefined,
  positions: readonly number[],
  normals: readonly number[],
  texcoords: readonly number[],
  indices: readonly number[],
): MeshPrimitive => ({
  id,
  materialId,
  attributes: [
    {
      semantic: 'POSITION',
      itemSize: 3,
      values: positions,
    },
    {
      semantic: 'NORMAL',
      itemSize: 3,
      values: normals,
    },
    {
      semantic: 'TEXCOORD_0',
      itemSize: 2,
      values: texcoords,
    },
  ],
  indices,
});

const pushVertex = (
  positions: number[],
  normals: number[],
  texcoords: number[],
  point: Vec3,
  normal: Vec3,
  bounds: SdfExtractionBounds,
): number => {
  const index = positions.length / 3;
  positions.push(point[0], point[1], point[2]);
  normals.push(normal[0], normal[1], normal[2]);
  texcoords.push(...createUv(point, bounds));
  return index;
};

const sortPointsOnPlane = (
  points: readonly Vec3[],
  center: Vec3,
  normal: Vec3,
): readonly Vec3[] => {
  const tangentSeed = Math.abs(normal[1]) > 0.9 ? [1, 0, 0] as const : [0, 1, 0] as const;
  const tangent = normalizeVec3(crossVec3(tangentSeed, normal));
  const bitangent = normalizeVec3(crossVec3(normal, tangent));

  return [...points].sort((left, right) => {
    const leftOffset = subtractVec3(left, center);
    const rightOffset = subtractVec3(right, center);
    const leftAngle = Math.atan2(dotVec3(leftOffset, bitangent), dotVec3(leftOffset, tangent));
    const rightAngle = Math.atan2(dotVec3(rightOffset, bitangent), dotVec3(rightOffset, tangent));
    return leftAngle - rightAngle;
  });
};

const dedupePoints = (points: readonly Vec3[]): readonly Vec3[] => {
  const unique: Vec3[] = [];

  for (const point of points) {
    const duplicate = unique.some((candidate) =>
      Math.abs(candidate[0] - point[0]) < epsilon &&
      Math.abs(candidate[1] - point[1]) < epsilon &&
      Math.abs(candidate[2] - point[2]) < epsilon
    );
    if (!duplicate) {
      unique.push(point);
    }
  }

  return unique;
};

export const extractMarchingCubesMesh = (
  primitive: SdfPrimitive,
  options: ExtractSdfMeshOptions = {},
): MeshPrimitive => {
  const grid = sampleGrid(primitive, { ...options, algorithm: 'marching-cubes' });
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const normalStep = Math.min(grid.step[0], grid.step[1], grid.step[2]);

  for (let z = 0; z < grid.resolution.z; z += 1) {
    for (let y = 0; y < grid.resolution.y; y += 1) {
      for (let x = 0; x < grid.resolution.x; x += 1) {
        const cornerPoints = cubeCorners.map(([ox, oy, oz]) =>
          pointAt(grid.bounds, grid.step, x + ox, y + oy, z + oz)
        );
        const cornerValues = cubeCorners.map(([ox, oy, oz]) =>
          grid.values[latticeIndex(grid.resolution, x + ox, y + oy, z + oz)]
        );
        const intersections = dedupePoints(
          cubeEdges.flatMap(([a, b]) =>
            crossesIsoLevel(cornerValues[a], cornerValues[b], grid.isoLevel)
              ? [interpolateIsoPoint(
                cornerPoints[a],
                cornerValues[a],
                cornerPoints[b],
                cornerValues[b],
                grid.isoLevel,
              )]
              : []
          ),
        );

        if (intersections.length < 3) {
          continue;
        }

        const center = scaleVec3(
          intersections.reduce<Vec3>((acc, point) => addVec3(acc, point), [0, 0, 0]),
          1 / intersections.length,
        );
        const centerNormal = estimateNormal(primitive, center, normalStep);
        const ordered = sortPointsOnPlane(intersections, center, centerNormal);
        const centerIndex = pushVertex(
          positions,
          normals,
          texcoords,
          center,
          centerNormal,
          grid.bounds,
        );
        const ringIndices = ordered.map((point) =>
          pushVertex(
            positions,
            normals,
            texcoords,
            point,
            estimateNormal(primitive, point, normalStep),
            grid.bounds,
          )
        );

        for (let index = 0; index < ringIndices.length; index += 1) {
          const current = ringIndices[index];
          const next = ringIndices[(index + 1) % ringIndices.length];
          const triangleNormal = crossVec3(
            subtractVec3(ordered[index], center),
            subtractVec3(ordered[(index + 1) % ordered.length], center),
          );
          if (dotVec3(triangleNormal, centerNormal) >= 0) {
            indices.push(centerIndex, current, next);
          } else {
            indices.push(centerIndex, next, current);
          }
        }
      }
    }
  }

  return createMeshPrimitive(
    options.id ?? `${primitive.id}-marching-cubes`,
    options.materialId,
    positions,
    normals,
    texcoords,
    indices,
  );
};

const buildSurfaceNetVertices = (
  primitive: SdfPrimitive,
  grid: SampledGrid,
): Readonly<{
  vertices: readonly (SurfaceNetVertex | undefined)[];
  indicesByCell: readonly number[];
  positions: readonly number[];
  normals: readonly number[];
  texcoords: readonly number[];
}> => {
  const vertices = new Array<SurfaceNetVertex | undefined>(
    grid.resolution.x * grid.resolution.y * grid.resolution.z,
  );
  const indicesByCell = new Array<number>(vertices.length).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const normalStep = Math.min(grid.step[0], grid.step[1], grid.step[2]);

  for (let z = 0; z < grid.resolution.z; z += 1) {
    for (let y = 0; y < grid.resolution.y; y += 1) {
      for (let x = 0; x < grid.resolution.x; x += 1) {
        const cornerPoints = cubeCorners.map(([ox, oy, oz]) =>
          pointAt(grid.bounds, grid.step, x + ox, y + oy, z + oz)
        );
        const cornerValues = cubeCorners.map(([ox, oy, oz]) =>
          grid.values[latticeIndex(grid.resolution, x + ox, y + oy, z + oz)]
        );
        const intersections = dedupePoints(
          cubeEdges.flatMap(([a, b]) =>
            crossesIsoLevel(cornerValues[a], cornerValues[b], grid.isoLevel)
              ? [interpolateIsoPoint(
                cornerPoints[a],
                cornerValues[a],
                cornerPoints[b],
                cornerValues[b],
                grid.isoLevel,
              )]
              : []
          ),
        );

        if (intersections.length < 3) {
          continue;
        }

        const position = scaleVec3(
          intersections.reduce<Vec3>((acc, point) => addVec3(acc, point), [0, 0, 0]),
          1 / intersections.length,
        );
        const normal = estimateNormal(primitive, position, normalStep);
        const vertex: SurfaceNetVertex = {
          position,
          normal,
          uv: createUv(position, grid.bounds),
        };
        const index = positions.length / 3;
        const cell = cellIndex(grid.resolution, x, y, z);
        vertices[cell] = vertex;
        indicesByCell[cell] = index;
        positions.push(position[0], position[1], position[2]);
        normals.push(normal[0], normal[1], normal[2]);
        texcoords.push(vertex.uv[0], vertex.uv[1]);
      }
    }
  }

  return { vertices, indicesByCell, positions, normals, texcoords };
};

const maybeAddSurfaceNetQuad = (
  indices: number[],
  quad: readonly [number, number, number, number],
  primitive: SdfPrimitive,
  grid: SampledGrid,
  positions: readonly number[],
): void => {
  if (quad.some((index) => index < 0)) {
    return;
  }

  if (new Set(quad).size < 4) {
    return;
  }

  const getPosition = (index: number): Vec3 => [
    positions[index * 3],
    positions[(index * 3) + 1],
    positions[(index * 3) + 2],
  ];

  const a = getPosition(quad[0]);
  const b = getPosition(quad[1]);
  const c = getPosition(quad[2]);
  const d = getPosition(quad[3]);
  const center = scaleVec3(addVec3(addVec3(a, b), addVec3(c, d)), 0.25);
  const normal = estimateNormal(
    primitive,
    center,
    Math.min(grid.step[0], grid.step[1], grid.step[2]),
  );
  const faceNormal = crossVec3(subtractVec3(b, a), subtractVec3(c, a));
  const ordered = dotVec3(faceNormal, normal) >= 0
    ? quad
    : [quad[0], quad[3], quad[2], quad[1]] as const;
  indices.push(ordered[0], ordered[1], ordered[2], ordered[0], ordered[2], ordered[3]);
};

export const extractSurfaceNetMesh = (
  primitive: SdfPrimitive,
  options: ExtractSdfMeshOptions = {},
): MeshPrimitive => {
  const grid = sampleGrid(primitive, { ...options, algorithm: 'surface-nets' });
  const { indicesByCell, positions, normals, texcoords } = buildSurfaceNetVertices(primitive, grid);
  const indices: number[] = [];
  const getCellVertexIndex = (x: number, y: number, z: number): number =>
    indicesByCell[cellIndex(grid.resolution, x, y, z)];

  for (let z = 0; z <= grid.resolution.z; z += 1) {
    for (let y = 0; y <= grid.resolution.y; y += 1) {
      for (let x = 0; x < grid.resolution.x; x += 1) {
        if (
          y === 0 || y === grid.resolution.y || z === 0 || z === grid.resolution.z ||
          !crossesIsoLevel(
            grid.values[latticeIndex(grid.resolution, x, y, z)],
            grid.values[latticeIndex(grid.resolution, x + 1, y, z)],
            grid.isoLevel,
          )
        ) {
          continue;
        }

        maybeAddSurfaceNetQuad(
          indices,
          [
            getCellVertexIndex(x, y - 1, z - 1),
            getCellVertexIndex(x, y, z - 1),
            getCellVertexIndex(x, y, z),
            getCellVertexIndex(x, y - 1, z),
          ],
          primitive,
          grid,
          positions,
        );
      }
    }
  }

  for (let z = 0; z <= grid.resolution.z; z += 1) {
    for (let y = 0; y < grid.resolution.y; y += 1) {
      for (let x = 0; x <= grid.resolution.x; x += 1) {
        if (
          x === 0 || x === grid.resolution.x || z === 0 || z === grid.resolution.z ||
          !crossesIsoLevel(
            grid.values[latticeIndex(grid.resolution, x, y, z)],
            grid.values[latticeIndex(grid.resolution, x, y + 1, z)],
            grid.isoLevel,
          )
        ) {
          continue;
        }

        maybeAddSurfaceNetQuad(
          indices,
          [
            getCellVertexIndex(x - 1, y, z - 1),
            getCellVertexIndex(x, y, z - 1),
            getCellVertexIndex(x, y, z),
            getCellVertexIndex(x - 1, y, z),
          ],
          primitive,
          grid,
          positions,
        );
      }
    }
  }

  for (let z = 0; z < grid.resolution.z; z += 1) {
    for (let y = 0; y <= grid.resolution.y; y += 1) {
      for (let x = 0; x <= grid.resolution.x; x += 1) {
        if (
          x === 0 || x === grid.resolution.x || y === 0 || y === grid.resolution.y ||
          !crossesIsoLevel(
            grid.values[latticeIndex(grid.resolution, x, y, z)],
            grid.values[latticeIndex(grid.resolution, x, y, z + 1)],
            grid.isoLevel,
          )
        ) {
          continue;
        }

        maybeAddSurfaceNetQuad(
          indices,
          [
            getCellVertexIndex(x - 1, y - 1, z),
            getCellVertexIndex(x, y - 1, z),
            getCellVertexIndex(x, y, z),
            getCellVertexIndex(x - 1, y, z),
          ],
          primitive,
          grid,
          positions,
        );
      }
    }
  }

  return createMeshPrimitive(
    options.id ?? `${primitive.id}-surface-nets`,
    options.materialId,
    positions,
    normals,
    texcoords,
    indices,
  );
};

export const extractSdfMesh = (
  primitive: SdfPrimitive,
  options: ExtractSdfMeshOptions = {},
): MeshPrimitive =>
  (options.algorithm ?? 'marching-cubes') === 'surface-nets'
    ? extractSurfaceNetMesh(primitive, options)
    : extractMarchingCubesMesh(primitive, options);
