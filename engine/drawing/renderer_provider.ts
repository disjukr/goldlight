import type { PathFillRule2d } from '@disjukr/goldlight/geometry';
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
  | 'analytic-rrect'
  | 'per-edge-aa-quad'
  | 'convex-tessellated-wedges'
  | 'stencil-tessellated-wedges'
  | 'stencil-tessellated-curves'
  | 'tessellated-strokes'
  | 'bitmap-text'
  | 'sdf-text';

export type DrawingRendererPatchMode = 'none' | 'wedge' | 'curve' | 'stroke' | 'text';

export type DrawingRenderer = Readonly<{
  name: string;
  kind: DrawingRendererKind;
  patchMode: DrawingRendererPatchMode;
  fillRule?: PathFillRule2d;
  requiresStencil: boolean;
  usesDepth: boolean;
  requiresMSAA: boolean;
}>;

export type DrawingRendererProvider = Readonly<{
  pathRendererStrategy: DrawingPathRendererStrategy;
  renderers: readonly DrawingRenderer[];
  analyticRRect: () => DrawingRenderer;
  perEdgeAAQuad: () => DrawingRenderer;
  convexTessellatedWedges: () => DrawingRenderer;
  stencilTessellatedWedges: (fillRule: PathFillRule2d) => DrawingRenderer;
  stencilTessellatedCurves: (fillRule: PathFillRule2d) => DrawingRenderer;
  tessellatedStrokes: () => DrawingRenderer;
  getPathFillRenderer: (
    options: Readonly<{
      fillRule: PathFillRule2d;
      isConvex: boolean;
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
    requiresMSAA: true,
  });
  const stencilWedges = Object.freeze({
    nonzero: createRenderer({
      name: 'StencilTessellatedWedges[winding]',
      kind: 'stencil-tessellated-wedges',
      patchMode: 'wedge',
      fillRule: 'nonzero',
      requiresStencil: true,
      usesDepth: false,
      requiresMSAA: true,
    }),
    evenodd: createRenderer({
      name: 'StencilTessellatedWedges[evenodd]',
      kind: 'stencil-tessellated-wedges',
      patchMode: 'wedge',
      fillRule: 'evenodd',
      requiresStencil: true,
      usesDepth: false,
      requiresMSAA: true,
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
      requiresMSAA: true,
    }),
    evenodd: createRenderer({
      name: 'StencilTessellatedCurvesAndTris[evenodd]',
      kind: 'stencil-tessellated-curves',
      patchMode: 'curve',
      fillRule: 'evenodd',
      requiresStencil: true,
      usesDepth: false,
      requiresMSAA: true,
    }),
  });
  const tessellatedStrokes = createRenderer({
    name: 'TessellatedStrokes',
    kind: 'tessellated-strokes',
    patchMode: 'stroke',
    requiresStencil: false,
    usesDepth: true,
    requiresMSAA: true,
  });
  const analyticRRect = createRenderer({
    name: 'AnalyticRRect',
    kind: 'analytic-rrect',
    patchMode: 'none',
    requiresStencil: false,
    usesDepth: true,
    requiresMSAA: false,
  });
  const perEdgeAAQuad = createRenderer({
    name: 'PerEdgeAAQuad',
    kind: 'per-edge-aa-quad',
    patchMode: 'none',
    requiresStencil: false,
    usesDepth: true,
    requiresMSAA: false,
  });

  const renderers = Object.freeze([
    analyticRRect,
    perEdgeAAQuad,
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
  >(variants: T, fillRule: PathFillRule2d): DrawingRenderer =>
    fillRule === 'evenodd' ? variants.evenodd : variants.nonzero;

  return {
    pathRendererStrategy,
    renderers,
    analyticRRect: () => analyticRRect,
    perEdgeAAQuad: () => perEdgeAAQuad,
    convexTessellatedWedges: () => convexWedges,
    stencilTessellatedWedges: (fillRule) => selectFillRuleRenderer(stencilWedges, fillRule),
    stencilTessellatedCurves: (fillRule) => selectFillRuleRenderer(stencilCurves, fillRule),
    tessellatedStrokes: () => tessellatedStrokes,
    getPathFillRenderer: (options) => {
      if (options.isConvex) {
        return convexWedges;
      }

      const preferWedges = options.verbCount < preferredWedgeVerbThreshold ||
        options.drawBoundsArea <= preferredWedgeAreaThreshold;
      if (preferWedges) {
        return selectFillRuleRenderer(stencilWedges, options.fillRule);
      }

      return selectFillRuleRenderer(stencilCurves, options.fillRule);
    },
    getPathStrokeRenderer: (_patches) => tessellatedStrokes,
  };
};
