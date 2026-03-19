export type RaytraceTriangle = Readonly<{
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  c: readonly [number, number, number];
}>;

export type BvhNode = Readonly<{
  boundsMin: readonly [number, number, number];
  boundsMax: readonly [number, number, number];
  leftChild: number;
  rightChild: number;
  triangleOffset: number;
  triangleCount: number;
}>;

export type BvhBuildResult = Readonly<{
  nodes: readonly BvhNode[];
  triangleIndices: readonly number[];
}>;

export type BuildBvhOptions = Readonly<{
  maxLeafSize?: number;
}>;

type TriangleBounds = Readonly<{
  boundsMin: readonly [number, number, number];
  boundsMax: readonly [number, number, number];
  centroid: readonly [number, number, number];
}>;

const defaultMaxLeafSize = 4;

const mergeMin = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.min(a[2], b[2]),
];

const mergeMax = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.max(a[2], b[2]),
];

const getTriangleBounds = (triangle: RaytraceTriangle): TriangleBounds => {
  const boundsMin: readonly [number, number, number] = [
    Math.min(triangle.a[0], triangle.b[0], triangle.c[0]),
    Math.min(triangle.a[1], triangle.b[1], triangle.c[1]),
    Math.min(triangle.a[2], triangle.b[2], triangle.c[2]),
  ];
  const boundsMax: readonly [number, number, number] = [
    Math.max(triangle.a[0], triangle.b[0], triangle.c[0]),
    Math.max(triangle.a[1], triangle.b[1], triangle.c[1]),
    Math.max(triangle.a[2], triangle.b[2], triangle.c[2]),
  ];

  return {
    boundsMin,
    boundsMax,
    centroid: [
      (boundsMin[0] + boundsMax[0]) / 2,
      (boundsMin[1] + boundsMax[1]) / 2,
      (boundsMin[2] + boundsMax[2]) / 2,
    ],
  };
};

const getLongestAxis = (
  minBounds: readonly [number, number, number],
  maxBounds: readonly [number, number, number],
): number => {
  const extentX = maxBounds[0] - minBounds[0];
  const extentY = maxBounds[1] - minBounds[1];
  const extentZ = maxBounds[2] - minBounds[2];
  if (extentX >= extentY && extentX >= extentZ) {
    return 0;
  }
  if (extentY >= extentZ) {
    return 1;
  }
  return 2;
};

export const buildBvh = (
  triangles: readonly RaytraceTriangle[],
  options: BuildBvhOptions = {},
): BvhBuildResult => {
  if (triangles.length === 0) {
    return {
      nodes: [],
      triangleIndices: [],
    };
  }

  const maxLeafSize = options.maxLeafSize ?? defaultMaxLeafSize;
  if (!Number.isInteger(maxLeafSize) || maxLeafSize <= 0) {
    throw new Error('"maxLeafSize" must be a positive integer');
  }

  const triangleBounds = triangles.map(getTriangleBounds);
  const nodes: BvhNode[] = [];
  const orderedTriangleIndices: number[] = [];

  const buildNode = (triangleIndices: readonly number[]): number => {
    let boundsMin: readonly [number, number, number] = [Infinity, Infinity, Infinity];
    let boundsMax: readonly [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let centroidMin: readonly [number, number, number] = [Infinity, Infinity, Infinity];
    let centroidMax: readonly [number, number, number] = [-Infinity, -Infinity, -Infinity];

    for (const triangleIndex of triangleIndices) {
      const bounds = triangleBounds[triangleIndex];
      boundsMin = mergeMin(boundsMin, bounds.boundsMin);
      boundsMax = mergeMax(boundsMax, bounds.boundsMax);
      centroidMin = mergeMin(centroidMin, bounds.centroid);
      centroidMax = mergeMax(centroidMax, bounds.centroid);
    }

    const nodeIndex = nodes.length;
    nodes.push({
      boundsMin,
      boundsMax,
      leftChild: -1,
      rightChild: -1,
      triangleOffset: -1,
      triangleCount: 0,
    });

    if (triangleIndices.length <= maxLeafSize) {
      const triangleOffset = orderedTriangleIndices.length;
      orderedTriangleIndices.push(...triangleIndices);
      nodes[nodeIndex] = {
        boundsMin,
        boundsMax,
        leftChild: -1,
        rightChild: -1,
        triangleOffset,
        triangleCount: triangleIndices.length,
      };
      return nodeIndex;
    }

    const axis = getLongestAxis(centroidMin, centroidMax);
    const sortedIndices = [...triangleIndices].sort((left, right) =>
      triangleBounds[left].centroid[axis] - triangleBounds[right].centroid[axis]
    );
    const midpoint = Math.floor(sortedIndices.length / 2);
    const leftIndices = sortedIndices.slice(0, midpoint);
    const rightIndices = sortedIndices.slice(midpoint);

    if (leftIndices.length === 0 || rightIndices.length === 0) {
      const triangleOffset = orderedTriangleIndices.length;
      orderedTriangleIndices.push(...sortedIndices);
      nodes[nodeIndex] = {
        boundsMin,
        boundsMax,
        leftChild: -1,
        rightChild: -1,
        triangleOffset,
        triangleCount: sortedIndices.length,
      };
      return nodeIndex;
    }

    const leftChild = buildNode(leftIndices);
    const rightChild = buildNode(rightIndices);
    nodes[nodeIndex] = {
      boundsMin,
      boundsMax,
      leftChild,
      rightChild,
      triangleOffset: -1,
      triangleCount: 0,
    };
    return nodeIndex;
  };

  buildNode(triangles.map((_, index) => index));

  return {
    nodes,
    triangleIndices: orderedTriangleIndices,
  };
};
