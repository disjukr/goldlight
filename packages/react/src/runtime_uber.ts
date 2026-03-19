import type { GpuUploadContext, RenderContextBinding, RuntimeResidency } from '@rieul3d/gpu';
import type {
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
  UberRenderResult,
} from '@rieul3d/renderer';
import { renderUberFrame } from '@rieul3d/renderer';

import { type SceneRootFrameDriverOptions } from './runtime_driver.ts';
import {
  createSceneRootRenderer,
  type EnsureSceneMeshResidencyHook,
  type SceneRootRenderer,
  type SceneRootRenderFrameHook,
  type SceneRootRenderFrameResult,
} from './runtime_renderer.ts';

type RenderUberFrameHook = SceneRootRenderFrameHook<UberRenderResult>;

export type SceneRootUberRendererHooks = Readonly<{
  ensureSceneMeshResidency?: EnsureSceneMeshResidencyHook;
  renderUberFrame?: RenderUberFrameHook;
}>;

export type SceneRootUberRendererOptions = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuRenderExecutionContext & GpuUploadContext;
    binding: RenderContextBinding;
    residency: RuntimeResidency;
    materialRegistry?: MaterialRegistry;
    postProcessPasses?: readonly PostProcessPass[];
    hooks?: SceneRootUberRendererHooks;
  }
>;

export type SceneRootUberFrameResult = SceneRootRenderFrameResult<UberRenderResult>;

export type SceneRootUberRenderer = SceneRootRenderer<UberRenderResult>;

export const createSceneRootUberRenderer = (
  sceneRoot: Parameters<typeof createSceneRootRenderer<UberRenderResult>>[0],
  options: SceneRootUberRendererOptions,
): SceneRootUberRenderer => {
  return createSceneRootRenderer(sceneRoot, {
    ...options,
    hooks: {
      ensureSceneMeshResidency: options.hooks?.ensureSceneMeshResidency,
      renderFrame: options.hooks?.renderUberFrame ?? renderUberFrame,
    },
  });
};
