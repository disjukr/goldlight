import type { PathFillRule2D } from '@rieul3d/geometry';
import type { DrawingPreparedPatch } from './path_renderer.ts';

export type DrawingRendererKind =
  | 'middle-out-fan'
  | 'stencil-tessellated-wedges'
  | 'stencil-tessellated-curves'
  | 'tessellated-strokes';

export const selectPathFillRenderer = (
  options: Readonly<{
    fillRule: PathFillRule2D;
    patchCount: number;
    hasCurves: boolean;
    hasWedges: boolean;
    isSingleConvexContour: boolean;
  }>,
): DrawingRendererKind => {
  if (options.isSingleConvexContour && options.fillRule === 'nonzero' && !options.hasCurves) {
    return 'middle-out-fan';
  }
  if (options.hasWedges && options.patchCount > 0) {
    return 'stencil-tessellated-wedges';
  }
  return 'stencil-tessellated-curves';
};

export const selectPathStrokeRenderer = (
  _patches: readonly DrawingPreparedPatch[],
): DrawingRendererKind => 'tessellated-strokes';
