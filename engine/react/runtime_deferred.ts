import type {
  GpuTextureUploadContext,
  GpuUploadContext,
  RenderContextBinding,
  RuntimeResidency,
} from '@disjukr/goldlight/gpu';
import type {
  DeferredRenderResult,
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
} from '@disjukr/goldlight/renderer';
import { renderDeferredFrame } from '@disjukr/goldlight/renderer';

import { type SceneRootFrameDriverOptions } from './runtime_driver.ts';
import {
  createSceneRootRenderer,
  type EnsureSceneMeshResidencyHook,
  type EnsureSceneTextureResidencyHook,
  type SceneRootRenderer,
  type SceneRootRenderFrameHook,
  type SceneRootRenderFrameResult,
} from './runtime_renderer.ts';

type RenderDeferredFrameHook = SceneRootRenderFrameHook<DeferredRenderResult>;

export type SceneRootDeferredRendererHooks = Readonly<{
  ensureSceneMeshResidency?: EnsureSceneMeshResidencyHook;
  ensureSceneTextureResidency?: EnsureSceneTextureResidencyHook;
  renderDeferredFrame?: RenderDeferredFrameHook;
}>;

export type SceneRootDeferredRendererOptions = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuRenderExecutionContext & GpuUploadContext & GpuTextureUploadContext;
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
      ensureSceneTextureResidency: options.hooks?.ensureSceneTextureResidency,
      renderFrame: options.hooks?.renderDeferredFrame ?? renderDeferredFrame,
    },
  });
};
