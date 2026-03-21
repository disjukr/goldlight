import { createPath2DFromShape, type Path2D, type Shape2D } from '@rieul3d/geometry';

export const createDrawingPath2DFromShape = (shape: Shape2D): Path2D =>
  createPath2DFromShape(shape);

export const createDrawingPathsFromShapes = (
  shapes: readonly Shape2D[],
): readonly Path2D[] => shapes.map((shape) => createDrawingPath2DFromShape(shape));
