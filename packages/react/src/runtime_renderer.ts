import type { GpuUploadContext, RenderContextBinding, RuntimeResidency } from '@rieul3d/gpu';
import { ensureSceneMeshResidency } from '@rieul3d/gpu';
import type {
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
} from '@rieul3d/renderer';
import { createMaterialRegistry } from '@rieul3d/renderer';

import {
  createSceneRootFrameDriver,
  type SceneRootFrameAdvanceOptions,
  type SceneRootFrameDriver,
  type SceneRootFrameDriverOptions,
  type SceneRootFrameResult,
} from './runtime_driver.ts';

type SceneRootLike = Parameters<typeof createSceneRootFrameDriver>[0];

export type EnsureSceneMeshResidencyHook = (
  context: GpuUploadContext,
  residency: RuntimeResidency,
  scene: SceneRootFrameResult['scene'],
  evaluatedScene: SceneRootFrameResult['evaluatedScene'],
) => RuntimeResidency;

export type SceneRootRenderFrameHook<TRenderResult> = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: SceneRootFrameResult['evaluatedScene'],
  materialRegistry: MaterialRegistry,
  postProcessPasses: readonly PostProcessPass[],
) => TRenderResult;

export type SceneRootRendererHooks<TRenderResult> = Readonly<{
  ensureSceneMeshResidency?: EnsureSceneMeshResidencyHook;
  renderFrame?: SceneRootRenderFrameHook<TRenderResult>;
}>;

export type SceneRootRendererOptions<TRenderResult> = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuRenderExecutionContext & GpuUploadContext;
    binding: RenderContextBinding;
    residency: RuntimeResidency;
    materialRegistry?: MaterialRegistry;
    postProcessPasses?: readonly PostProcessPass[];
    hooks?: SceneRootRendererHooks<TRenderResult>;
  }
>;

export type SceneRootRenderFrameResult<TRenderResult> = Readonly<
  & SceneRootFrameResult
  & {
    renderResult: TRenderResult;
  }
>;

export type SceneRootRenderer<TRenderResult> = Readonly<{
  getFrameDriver: () => SceneRootFrameDriver;
  renderFrame: (
    timeMs: number,
    options?: SceneRootFrameAdvanceOptions,
  ) => SceneRootRenderFrameResult<TRenderResult>;
  dispose: () => void;
}>;

export const createSceneRootRenderer = <TRenderResult>(
  sceneRoot: SceneRootLike,
  options: SceneRootRendererOptions<TRenderResult>,
): SceneRootRenderer<TRenderResult> => {
  const frameDriver = createSceneRootFrameDriver(sceneRoot, {
    residency: options.residency,
    initialTimeMs: options.initialTimeMs,
  });
  const ensureMeshResidency = options.hooks?.ensureSceneMeshResidency ?? ensureSceneMeshResidency;
  const renderFrame = options.hooks?.renderFrame;
  const materialRegistry = options.materialRegistry ?? createMaterialRegistry();
  const postProcessPasses = options.postProcessPasses ?? [];

  if (!renderFrame) {
    throw new Error('Scene root renderer requires a renderFrame hook');
  }

  return {
    getFrameDriver: () => frameDriver,
    renderFrame: (timeMs, frameOptions) => {
      const frame = frameDriver.advanceFrame(timeMs, frameOptions);
      ensureMeshResidency(
        options.context,
        options.residency,
        frame.scene,
        frame.evaluatedScene,
      );
      return {
        ...frame,
        renderResult: renderFrame(
          options.context,
          options.binding,
          options.residency,
          frame.evaluatedScene,
          materialRegistry,
          postProcessPasses,
        ),
      };
    },
    dispose: () => frameDriver.dispose(),
  };
};
