import { createPath2dFromShape, type Path2d, type Shape2d } from '@goldlight/geometry';

export const createDrawingPath2dFromShape = (shape: Shape2d): Path2d =>
  createPath2dFromShape(shape);

export const createDrawingPathsFromShapes = (
  shapes: readonly Shape2d[],
): readonly Path2d[] => shapes.map((shape) => createDrawingPath2dFromShape(shape));
