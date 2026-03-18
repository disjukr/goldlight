import type { EvaluatedCamera } from './evaluate_scene.ts';

export type ScreenRay = Readonly<{
  origin: Readonly<{ x: number; y: number; z: number }>;
  direction: Readonly<{ x: number; y: number; z: number }>;
}>;

export type ScreenRayOptions = Readonly<{
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportX?: number;
  viewportY?: number;
}>;

const assertFiniteNumber = (name: string, value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`"${name}" must be a finite number`);
  }

  return value;
};

const assertPositiveNumber = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`"${name}" must be a positive number`);
  }

  return value;
};

const transformPoint = (
  matrix: readonly number[],
  point: Readonly<{ x: number; y: number; z: number }>,
): Readonly<{ x: number; y: number; z: number }> => ({
  x: (matrix[0] ?? 0) * point.x + (matrix[4] ?? 0) * point.y + (matrix[8] ?? 0) * point.z +
    (matrix[12] ?? 0),
  y: (matrix[1] ?? 0) * point.x + (matrix[5] ?? 0) * point.y + (matrix[9] ?? 0) * point.z +
    (matrix[13] ?? 0),
  z: (matrix[2] ?? 0) * point.x + (matrix[6] ?? 0) * point.y + (matrix[10] ?? 0) * point.z +
    (matrix[14] ?? 0),
});

const normalizeVector = (
  vector: Readonly<{ x: number; y: number; z: number }>,
): Readonly<{ x: number; y: number; z: number }> => {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length <= 1e-8) {
    throw new Error('screen ray direction is degenerate');
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
};

const viewportCoordinatesToNdc = (
  options: ScreenRayOptions,
): Readonly<{ x: number; y: number }> => {
  const viewportWidth = assertPositiveNumber('viewportWidth', options.viewportWidth);
  const viewportHeight = assertPositiveNumber('viewportHeight', options.viewportHeight);
  const viewportX = assertFiniteNumber('viewportX', options.viewportX ?? 0);
  const viewportY = assertFiniteNumber('viewportY', options.viewportY ?? 0);
  const localX = assertFiniteNumber('x', options.x) - viewportX;
  const localY = assertFiniteNumber('y', options.y) - viewportY;

  return {
    x: ((localX / viewportWidth) * 2) - 1,
    y: 1 - ((localY / viewportHeight) * 2),
  };
};

export const createScreenWorldRay = (
  activeCamera: EvaluatedCamera,
  options: ScreenRayOptions,
): ScreenRay => {
  const ndc = viewportCoordinatesToNdc(options);
  const origin = activeCamera.camera.type === 'perspective'
    ? transformPoint(activeCamera.worldMatrix, { x: 0, y: 0, z: 0 })
    : (() => {
      const xmag = activeCamera.camera.xmag ?? 1;
      const ymag = activeCamera.camera.ymag ?? 1;
      return transformPoint(activeCamera.worldMatrix, {
        x: ndc.x * xmag,
        y: ndc.y * ymag,
        z: -activeCamera.camera.znear,
      });
    })();
  const target = activeCamera.camera.type === 'perspective'
    ? (() => {
      const yfov = activeCamera.camera.yfov ?? Math.PI / 3;
      const aspect = options.viewportWidth / options.viewportHeight;
      const halfHeight = Math.tan(yfov / 2);
      return transformPoint(activeCamera.worldMatrix, {
        x: ndc.x * halfHeight * aspect,
        y: ndc.y * halfHeight,
        z: -1,
      });
    })()
    : (() => {
      const xmag = activeCamera.camera.xmag ?? 1;
      const ymag = activeCamera.camera.ymag ?? 1;
      return transformPoint(activeCamera.worldMatrix, {
        x: ndc.x * xmag,
        y: ndc.y * ymag,
        z: -(activeCamera.camera.znear + 1),
      });
    })();

  return {
    origin,
    direction: normalizeVector({
      x: target.x - origin.x,
      y: target.y - origin.y,
      z: target.z - origin.z,
    }),
  };
};
