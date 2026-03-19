import type { GpuUploadContext, RenderContextBinding, RuntimeResidency } from '@rieul3d/gpu';
import type {
  GpuRenderExecutionContext,
  HybridRenderResult,
  MaterialRegistry,
  PostProcessPass,
} from '@rieul3d/renderer';
import { renderHybridFrame } from '@rieul3d/renderer';

import { type SceneRootFrameDriverOptions } from './runtime_driver.ts';
import {
  createSceneRootRenderer,
  type EnsureSceneMeshResidencyHook,
  type SceneRootRenderer,
  type SceneRootRenderFrameHook,
  type SceneRootRenderFrameResult,
} from './runtime_renderer.ts';

type RenderHybridFrameHook = SceneRootRenderFrameHook<HybridRenderResult>;

export type SceneRootHybridRendererHooks = Readonly<{
  ensureSceneMeshResidency?: EnsureSceneMeshResidencyHook;
  renderHybridFrame?: RenderHybridFrameHook;
}>;

export type SceneRootHybridRendererOptions = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuRenderExecutionContext & GpuUploadContext;
    binding: RenderContextBinding;
    residency: RuntimeResidency;
    materialRegistry?: MaterialRegistry;
    postProcessPasses?: readonly PostProcessPass[];
    hooks?: SceneRootHybridRendererHooks;
  }
>;

export type SceneRootHybridFrameResult = SceneRootRenderFrameResult<HybridRenderResult>;

export type SceneRootHybridRenderer = SceneRootRenderer<HybridRenderResult>;

export const createSceneRootHybridRenderer = (
  sceneRoot: Parameters<typeof createSceneRootRenderer<HybridRenderResult>>[0],
  options: SceneRootHybridRendererOptions,
): SceneRootHybridRenderer => {
  return createSceneRootRenderer(sceneRoot, {
    ...options,
    hooks: {
      ensureSceneMeshResidency: options.hooks?.ensureSceneMeshResidency,
      renderFrame: options.hooks?.renderHybridFrame ?? renderHybridFrame,
    },
  });
};
