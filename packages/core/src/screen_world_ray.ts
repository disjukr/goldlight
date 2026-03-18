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

const invertAffineMatrix = (matrix: readonly number[]): readonly number[] => {
  const m00 = matrix[0] ?? 0;
  const m01 = matrix[1] ?? 0;
  const m02 = matrix[2] ?? 0;
  const m10 = matrix[4] ?? 0;
  const m11 = matrix[5] ?? 0;
  const m12 = matrix[6] ?? 0;
  const m20 = matrix[8] ?? 0;
  const m21 = matrix[9] ?? 0;
  const m22 = matrix[10] ?? 0;
  const tx = matrix[12] ?? 0;
  const ty = matrix[13] ?? 0;
  const tz = matrix[14] ?? 0;

  const c00 = (m11 * m22) - (m12 * m21);
  const c01 = -((m10 * m22) - (m12 * m20));
  const c02 = (m10 * m21) - (m11 * m20);
  const c10 = -((m01 * m22) - (m02 * m21));
  const c11 = (m00 * m22) - (m02 * m20);
  const c12 = -((m00 * m21) - (m01 * m20));
  const c20 = (m01 * m12) - (m02 * m11);
  const c21 = -((m00 * m12) - (m02 * m10));
  const c22 = (m00 * m11) - (m01 * m10);
  const determinant = (m00 * c00) + (m01 * c01) + (m02 * c02);

  if (Math.abs(determinant) < 1e-8) {
    throw new Error('activeCamera.viewMatrix must be invertible');
  }

  const inverseDeterminant = 1 / determinant;
  const i00 = c00 * inverseDeterminant;
  const i01 = c10 * inverseDeterminant;
  const i02 = c20 * inverseDeterminant;
  const i10 = c01 * inverseDeterminant;
  const i11 = c11 * inverseDeterminant;
  const i12 = c21 * inverseDeterminant;
  const i20 = c02 * inverseDeterminant;
  const i21 = c12 * inverseDeterminant;
  const i22 = c22 * inverseDeterminant;

  return [
    i00,
    i01,
    i02,
    0,
    i10,
    i11,
    i12,
    0,
    i20,
    i21,
    i22,
    0,
    -((i00 * tx) + (i10 * ty) + (i20 * tz)),
    -((i01 * tx) + (i11 * ty) + (i21 * tz)),
    -((i02 * tx) + (i12 * ty) + (i22 * tz)),
    1,
  ];
};

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
  const cameraTransform = invertAffineMatrix(activeCamera.viewMatrix);
  const origin = activeCamera.camera.type === 'perspective'
    ? transformPoint(cameraTransform, { x: 0, y: 0, z: 0 })
    : (() => {
      const xmag = activeCamera.camera.xmag ?? 1;
      const ymag = activeCamera.camera.ymag ?? 1;
      return transformPoint(cameraTransform, {
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
      return transformPoint(cameraTransform, {
        x: ndc.x * halfHeight * aspect,
        y: ndc.y * halfHeight,
        z: -1,
      });
    })()
    : (() => {
      const xmag = activeCamera.camera.xmag ?? 1;
      const ymag = activeCamera.camera.ymag ?? 1;
      return transformPoint(cameraTransform, {
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
