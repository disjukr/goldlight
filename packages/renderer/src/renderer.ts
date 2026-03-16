import type { EvaluatedScene } from '@rieul3d/core';
import type { RuntimeResidency } from '@rieul3d/gpu';

export type RendererKind = 'forward' | 'deferred';
export type PassKind =
  | 'depth-prepass'
  | 'gbuffer'
  | 'lighting'
  | 'mesh'
  | 'raymarch'
  | 'present';

export type RenderPassPlan = Readonly<{
  id: string;
  kind: PassKind;
  reads: readonly string[];
  writes: readonly string[];
}>;

export type Renderer = Readonly<{
  kind: RendererKind;
  label: string;
  passes: readonly RenderPassPlan[];
}>;

export type FramePlan = Readonly<{
  renderer: RendererKind;
  nodeCount: number;
  meshNodeCount: number;
  sdfNodeCount: number;
  volumeNodeCount: number;
  passes: readonly RenderPassPlan[];
}>;

const countPrimitiveNodes = (evaluatedScene: EvaluatedScene) => ({
  meshNodeCount: evaluatedScene.nodes.filter((node) => Boolean(node.mesh)).length,
  sdfNodeCount: evaluatedScene.nodes.filter((node) => Boolean(node.sdf)).length,
  volumeNodeCount: evaluatedScene.nodes.filter((node) => Boolean(node.volume)).length,
});

export const createForwardRenderer = (label = 'forward'): Renderer => ({
  kind: 'forward',
  label,
  passes: [
    { id: 'mesh', kind: 'mesh', reads: ['scene'], writes: ['color', 'depth'] },
    { id: 'raymarch', kind: 'raymarch', reads: ['scene', 'depth'], writes: ['color'] },
    { id: 'present', kind: 'present', reads: ['color'], writes: ['target'] },
  ],
});

export const createDeferredRenderer = (label = 'deferred'): Renderer => ({
  kind: 'deferred',
  label,
  passes: [
    { id: 'depth-prepass', kind: 'depth-prepass', reads: ['scene'], writes: ['depth'] },
    { id: 'gbuffer', kind: 'gbuffer', reads: ['scene', 'depth'], writes: ['gbuffer'] },
    { id: 'lighting', kind: 'lighting', reads: ['gbuffer', 'depth'], writes: ['color'] },
    { id: 'raymarch', kind: 'raymarch', reads: ['scene', 'depth', 'color'], writes: ['color'] },
    { id: 'present', kind: 'present', reads: ['color'], writes: ['target'] },
  ],
});

export const planFrame = (
  renderer: Renderer,
  evaluatedScene: EvaluatedScene,
  _residency: RuntimeResidency,
): FramePlan => {
  const counts = countPrimitiveNodes(evaluatedScene);

  return {
    renderer: renderer.kind,
    nodeCount: evaluatedScene.nodes.length,
    meshNodeCount: counts.meshNodeCount,
    sdfNodeCount: counts.sdfNodeCount,
    volumeNodeCount: counts.volumeNodeCount,
    passes: renderer.passes.filter((pass) =>
      pass.kind === 'raymarch' ? counts.sdfNodeCount > 0 || counts.volumeNodeCount > 0 : true
    ),
  };
};
