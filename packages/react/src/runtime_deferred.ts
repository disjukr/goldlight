import type { GpuUploadContext, RenderContextBinding, RuntimeResidency } from '@rieul3d/gpu';
import type {
  DeferredRenderResult,
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
} from '@rieul3d/renderer';
import { renderDeferredFrame } from '@rieul3d/renderer';

import { type SceneRootFrameDriverOptions } from './runtime_driver.ts';
import {
  createSceneRootRenderer,
  type EnsureSceneMeshResidencyHook,
  type SceneRootRenderer,
  type SceneRootRenderFrameHook,
  type SceneRootRenderFrameResult,
} from './runtime_renderer.ts';

type RenderDeferredFrameHook = SceneRootRenderFrameHook<DeferredRenderResult>;

export type SceneRootDeferredRendererHooks = Readonly<{
  ensureSceneMeshResidency?: EnsureSceneMeshResidencyHook;
  renderDeferredFrame?: RenderDeferredFrameHook;
}>;

export type SceneRootDeferredRendererOptions = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuRenderExecutionContext & GpuUploadContext;
    binding: RenderContextBinding;
    residency: RuntimeResidency;
    materialRegistry?: MaterialRegistry;
    postProcessPasses?: readonly PostProcessPass[];
    hooks?: SceneRootDeferredRendererHooks;
  }
>;

export type SceneRootDeferredFrameResult = SceneRootRenderFrameResult<DeferredRenderResult>;

export type SceneRootDeferredRenderer = SceneRootRenderer<DeferredRenderResult>;

export const createSceneRootDeferredRenderer = (
  sceneRoot: Parameters<typeof createSceneRootRenderer<DeferredRenderResult>>[0],
  options: SceneRootDeferredRendererOptions,
): SceneRootDeferredRenderer => {
  return createSceneRootRenderer(sceneRoot, {
    ...options,
    hooks: {
      ensureSceneMeshResidency: options.hooks?.ensureSceneMeshResidency,
      renderFrame: options.hooks?.renderDeferredFrame ?? renderDeferredFrame,
    },
  });
};
