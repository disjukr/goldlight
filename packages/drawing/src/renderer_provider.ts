import type { PathFillRule2D } from '@rieul3d/geometry';
import type { DawnCaps } from './caps.ts';
import type { DrawingPreparedPatch } from './path_renderer.ts';

export type DrawingPathRendererStrategy =
  | 'tessellation'
  | 'tessellation-and-small-atlas'
  | 'raster-atlas'
  | 'compute-analytic-aa'
  | 'compute-msaa16'
  | 'compute-msaa8'
  | 'cpu-sparse-strips-msaa8';

export type DrawingRendererKind =
  | 'convex-tessellated-wedges'
  | 'stencil-tessellated-wedges'
  | 'stencil-tessellated-curves'
  | 'tessellated-strokes';

export type DrawingRendererPatchMode = 'none' | 'wedge' | 'curve' | 'stroke';

export type DrawingRenderer = Readonly<{
  name: string;
  kind: DrawingRendererKind;
  patchMode: DrawingRendererPatchMode;
  fillRule?: PathFillRule2D;
  requiresStencil: boolean;
  usesDepth: boolean;
}>;

export type DrawingRendererProvider = Readonly<{
  pathRendererStrategy: DrawingPathRendererStrategy;
  renderers: readonly DrawingRenderer[];
  convexTessellatedWedges: () => DrawingRenderer;
  stencilTessellatedWedges: (fillRule: PathFillRule2D) => DrawingRenderer;
  stencilTessellatedCurves: (fillRule: PathFillRule2D) => DrawingRenderer;
  tessellatedStrokes: () => DrawingRenderer;
  getPathFillRenderer: (
    options: Readonly<{
      fillRule: PathFillRule2D;
      patchCount: number;
      hasWedges: boolean;
      isSingleConvexContour: boolean;
      verbCount: number;
      drawBoundsArea: number;
    }>,
  ) => DrawingRenderer;
  getPathStrokeRenderer: (patches: readonly DrawingPreparedPatch[]) => DrawingRenderer;
}>;

const preferredWedgeVerbThreshold = 50;
const preferredWedgeAreaThreshold = 256 * 256;

const createRenderer = (
  renderer: DrawingRenderer,
): DrawingRenderer => Object.freeze(renderer);

export const isDrawingPatchFillRenderer = (
  renderer: DrawingRenderer,
): boolean => renderer.patchMode === 'wedge' || renderer.patchMode === 'curve';

export const isDrawingStencilFillRenderer = (
  renderer: DrawingRenderer,
): boolean => renderer.requiresStencil && renderer.kind !== 'tessellated-strokes';

export const isDrawingRendererProviderStrategySupported = (
  strategy: DrawingPathRendererStrategy,
  _caps: DawnCaps,
): boolean => strategy === 'tessellation';

const selectDrawingRendererProviderStrategy = (
  caps: DawnCaps,
): DrawingPathRendererStrategy => {
  if (
    caps.requestedPathRendererStrategy &&
    isDrawingRendererProviderStrategySupported(caps.requestedPathRendererStrategy, caps)
  ) {
    return caps.requestedPathRendererStrategy;
  }
  return 'tessellation';
};

export const createDrawingRendererProvider = (
  caps: DawnCaps,
): DrawingRendererProvider => {
  const pathRendererStrategy = selectDrawingRendererProviderStrategy(caps);
  if (!isDrawingRendererProviderStrategySupported(pathRendererStrategy, caps)) {
    throw new Error(`Unsupported drawing path renderer strategy: ${pathRendererStrategy}`);
  }

  const convexWedges = createRenderer({
    name: 'ConvexTessellatedWedges',
    kind: 'convex-tessellated-wedges',
    patchMode: 'wedge',
    requiresStencil: false,
    usesDepth: true,
  });
  const stencilWedges = Object.freeze({
    nonzero: createRenderer({
      name: 'StencilTessellatedWedges[winding]',
      kind: 'stencil-tessellated-wedges',
      patchMode: 'wedge',
      fillRule: 'nonzero',
      requiresStencil: true,
      usesDepth: false,
    }),
    evenodd: createRenderer({
      name: 'StencilTessellatedWedges[evenodd]',
      kind: 'stencil-tessellated-wedges',
      patchMode: 'wedge',
      fillRule: 'evenodd',
      requiresStencil: true,
      usesDepth: false,
    }),
  });
  const stencilCurves = Object.freeze({
    nonzero: createRenderer({
      name: 'StencilTessellatedCurvesAndTris[winding]',
      kind: 'stencil-tessellated-curves',
      patchMode: 'curve',
      fillRule: 'nonzero',
      requiresStencil: true,
      usesDepth: false,
    }),
    evenodd: createRenderer({
      name: 'StencilTessellatedCurvesAndTris[evenodd]',
      kind: 'stencil-tessellated-curves',
      patchMode: 'curve',
      fillRule: 'evenodd',
      requiresStencil: true,
      usesDepth: false,
    }),
  });
  const tessellatedStrokes = createRenderer({
    name: 'TessellatedStrokes',
    kind: 'tessellated-strokes',
    patchMode: 'stroke',
    requiresStencil: false,
    usesDepth: true,
  });

  const renderers = Object.freeze([
    convexWedges,
    stencilWedges.nonzero,
    stencilWedges.evenodd,
    stencilCurves.nonzero,
    stencilCurves.evenodd,
    tessellatedStrokes,
  ]);

  const selectFillRuleRenderer = <
    T extends {
      readonly nonzero: DrawingRenderer;
      readonly evenodd: DrawingRenderer;
    },
  >(variants: T, fillRule: PathFillRule2D): DrawingRenderer =>
    fillRule === 'evenodd' ? variants.evenodd : variants.nonzero;

  return {
    pathRendererStrategy,
    renderers,
    convexTessellatedWedges: () => convexWedges,
    stencilTessellatedWedges: (fillRule) => selectFillRuleRenderer(stencilWedges, fillRule),
    stencilTessellatedCurves: (fillRule) => selectFillRuleRenderer(stencilCurves, fillRule),
    tessellatedStrokes: () => tessellatedStrokes,
    getPathFillRenderer: (options) => {
      if (options.isSingleConvexContour && options.hasWedges && options.patchCount > 0) {
        return convexWedges;
      }

      const preferWedges = options.verbCount < preferredWedgeVerbThreshold ||
        options.drawBoundsArea <= preferredWedgeAreaThreshold;
      if (preferWedges && options.hasWedges && options.patchCount > 0) {
        return selectFillRuleRenderer(stencilWedges, options.fillRule);
      }

      return selectFillRuleRenderer(stencilCurves, options.fillRule);
    },
    getPathStrokeRenderer: (_patches) => tessellatedStrokes,
  };
};
