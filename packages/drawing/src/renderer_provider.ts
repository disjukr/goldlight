import type { PathFillRule2D } from '@rieul3d/geometry';
import type { DawnCaps } from './caps.ts';
import type { DrawingPreparedPatch } from './path_renderer.ts';

export type DrawingPathRendererStrategy = 'tessellation';

export type DrawingRendererKind =
  | 'convex-tessellated-wedges'
  | 'stencil-tessellated-wedges'
  | 'stencil-tessellated-curves'
  | 'tessellated-strokes';

export type DrawingRendererProvider = Readonly<{
  pathRendererStrategy: DrawingPathRendererStrategy;
  renderers: readonly DrawingRendererKind[];
  getPathFillRenderer: (
    options: Readonly<{
      fillRule: PathFillRule2D;
      patchCount: number;
      hasCurves: boolean;
      hasWedges: boolean;
      isSingleConvexContour: boolean;
    }>,
  ) => DrawingRendererKind;
  getPathStrokeRenderer: (patches: readonly DrawingPreparedPatch[]) => DrawingRendererKind;
}>;

const kTessellationRenderers = Object.freeze(
  [
    'convex-tessellated-wedges',
    'stencil-tessellated-wedges',
    'stencil-tessellated-curves',
    'tessellated-strokes',
  ] as const satisfies readonly DrawingRendererKind[],
);

export const isDrawingPatchFillRenderer = (
  renderer: DrawingRendererKind,
): boolean =>
  renderer === 'convex-tessellated-wedges' ||
  renderer === 'stencil-tessellated-wedges' ||
  renderer === 'stencil-tessellated-curves';

export const isDrawingStencilFillRenderer = (
  renderer: DrawingRendererKind,
): boolean =>
  renderer === 'stencil-tessellated-wedges' || renderer === 'stencil-tessellated-curves';

export const isDrawingRendererProviderStrategySupported = (
  strategy: DrawingPathRendererStrategy,
  _caps: DawnCaps,
): boolean => strategy === 'tessellation';

export const createDrawingRendererProvider = (
  caps: DawnCaps,
): DrawingRendererProvider => {
  const pathRendererStrategy: DrawingPathRendererStrategy = 'tessellation';
  if (!isDrawingRendererProviderStrategySupported(pathRendererStrategy, caps)) {
    throw new Error(`Unsupported drawing path renderer strategy: ${pathRendererStrategy}`);
  }

  return {
    pathRendererStrategy,
    renderers: kTessellationRenderers,
    getPathFillRenderer: (options) => {
      if (options.isSingleConvexContour && options.patchCount > 0) {
        return 'convex-tessellated-wedges';
      }
      if (options.hasWedges && options.patchCount > 0) {
        return 'stencil-tessellated-wedges';
      }
      return 'stencil-tessellated-curves';
    },
    getPathStrokeRenderer: (_patches) => 'tessellated-strokes',
  };
};
