import type {
  GpuTextureUploadContext,
  GpuUploadContext,
  RenderContextBinding,
  RuntimeResidency,
} from '@goldlight/gpu';
import type {
  ForwardRenderResult,
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
} from '@goldlight/renderer';
import { renderForwardFrame } from '@goldlight/renderer';

import { type SceneRootFrameDriverOptions } from './runtime_driver.ts';
import {
  createSceneRootRenderer,
  type EnsureSceneMeshResidencyHook,
  type EnsureSceneTextureResidencyHook,
  type SceneRootRenderer,
  type SceneRootRenderFrameHook,
  type SceneRootRenderFrameResult,
} from './runtime_renderer.ts';

type RenderForwardFrameHook = SceneRootRenderFrameHook<ForwardRenderResult>;

export type SceneRootForwardRendererHooks = Readonly<{
  ensureSceneMeshResidency?: EnsureSceneMeshResidencyHook;
  ensureSceneTextureResidency?: EnsureSceneTextureResidencyHook;
  renderForwardFrame?: RenderForwardFrameHook;
}>;

export type SceneRootForwardRendererOptions = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuRenderExecutionContext & GpuUploadContext & GpuTextureUploadContext;
    binding: RenderContextBinding;
    residency: RuntimeResidency;
    materialRegistry?: MaterialRegistry;
    postProcessPasses?: readonly PostProcessPass[];
    hooks?: SceneRootForwardRendererHooks;
  }
>;

export type SceneRootForwardFrameResult = SceneRootRenderFrameResult<ForwardRenderResult>;

export type SceneRootForwardRenderer = SceneRootRenderer<ForwardRenderResult>;

export const createSceneRootForwardRenderer = (
  sceneRoot: Parameters<typeof createSceneRootRenderer<ForwardRenderResult>>[0],
  options: SceneRootForwardRendererOptions,
): SceneRootForwardRenderer => {
  return createSceneRootRenderer(sceneRoot, {
    ...options,
    hooks: {
      ensureSceneMeshResidency: options.hooks?.ensureSceneMeshResidency,
      ensureSceneTextureResidency: options.hooks?.ensureSceneTextureResidency,
      renderFrame: options.hooks?.renderForwardFrame ?? renderForwardFrame,
    },
  });
};
