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
  convexTessellatedWedges: () => DrawingRendererKind;
  stencilTessellatedWedges: (fillRule: PathFillRule2D) => DrawingRendererKind;
  stencilTessellatedCurves: (fillRule: PathFillRule2D) => DrawingRendererKind;
  tessellatedStrokes: () => DrawingRendererKind;
  getPathFillRenderer: (
    options: Readonly<{
      fillRule: PathFillRule2D;
      patchCount: number;
      hasWedges: boolean;
      isSingleConvexContour: boolean;
      verbCount: number;
      drawBoundsArea: number;
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

const preferredWedgeVerbThreshold = 50;
const preferredWedgeAreaThreshold = 256 * 256;

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

  const convexTessellatedWedges = (): DrawingRendererKind => 'convex-tessellated-wedges';
  const stencilTessellatedWedges = (_fillRule: PathFillRule2D): DrawingRendererKind =>
    'stencil-tessellated-wedges';
  const stencilTessellatedCurves = (_fillRule: PathFillRule2D): DrawingRendererKind =>
    'stencil-tessellated-curves';
  const tessellatedStrokes = (): DrawingRendererKind => 'tessellated-strokes';

  return {
    pathRendererStrategy,
    renderers: kTessellationRenderers,
    convexTessellatedWedges,
    stencilTessellatedWedges,
    stencilTessellatedCurves,
    tessellatedStrokes,
    getPathFillRenderer: (options) => {
      if (options.isSingleConvexContour && options.hasWedges && options.patchCount > 0) {
        return convexTessellatedWedges();
      }

      const preferWedges = options.verbCount < preferredWedgeVerbThreshold ||
        options.drawBoundsArea <= preferredWedgeAreaThreshold;
      if (preferWedges && options.hasWedges && options.patchCount > 0) {
        return stencilTessellatedWedges(options.fillRule);
      }

      return stencilTessellatedCurves(options.fillRule);
    },
    getPathStrokeRenderer: (_patches) => tessellatedStrokes(),
  };
};
