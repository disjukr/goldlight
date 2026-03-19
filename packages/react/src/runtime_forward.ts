import type { GpuUploadContext, RenderContextBinding, RuntimeResidency } from '@rieul3d/gpu';
import { ensureSceneMeshResidency } from '@rieul3d/gpu';
import type {
  ForwardRenderResult,
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
} from '@rieul3d/renderer';
import { createMaterialRegistry, renderForwardFrame } from '@rieul3d/renderer';

import {
  createSceneRootFrameDriver,
  type SceneRootFrameAdvanceOptions,
  type SceneRootFrameDriver,
  type SceneRootFrameDriverOptions,
  type SceneRootFrameResult,
} from './runtime_driver.ts';

type EnsureSceneMeshResidencyHook = (
  context: GpuUploadContext,
  residency: RuntimeResidency,
  scene: SceneRootFrameResult['scene'],
  evaluatedScene: SceneRootFrameResult['evaluatedScene'],
) => RuntimeResidency;

type RenderForwardFrameHook = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: SceneRootFrameResult['evaluatedScene'],
  materialRegistry: MaterialRegistry,
  postProcessPasses: readonly PostProcessPass[],
) => ForwardRenderResult;

export type SceneRootForwardRendererHooks = Readonly<{
  ensureSceneMeshResidency?: EnsureSceneMeshResidencyHook;
  renderForwardFrame?: RenderForwardFrameHook;
}>;

export type SceneRootForwardRendererOptions = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuRenderExecutionContext & GpuUploadContext;
    binding: RenderContextBinding;
    residency: RuntimeResidency;
    materialRegistry?: MaterialRegistry;
    postProcessPasses?: readonly PostProcessPass[];
    hooks?: SceneRootForwardRendererHooks;
  }
>;

export type SceneRootForwardFrameResult = Readonly<
  & SceneRootFrameResult
  & {
    renderResult: ForwardRenderResult;
  }
>;

export type SceneRootForwardRenderer = Readonly<{
  getFrameDriver: () => SceneRootFrameDriver;
  renderFrame: (
    timeMs: number,
    options?: SceneRootFrameAdvanceOptions,
  ) => SceneRootForwardFrameResult;
  dispose: () => void;
}>;

export const createSceneRootForwardRenderer = (
  sceneRoot: Parameters<typeof createSceneRootFrameDriver>[0],
  options: SceneRootForwardRendererOptions,
): SceneRootForwardRenderer => {
  const frameDriver = createSceneRootFrameDriver(sceneRoot, {
    flushUpdates: options.flushUpdates,
    residency: options.residency,
    initialTimeMs: options.initialTimeMs,
  });
  const ensureMeshResidency = options.hooks?.ensureSceneMeshResidency ?? ensureSceneMeshResidency;
  const renderForward = options.hooks?.renderForwardFrame ?? renderForwardFrame;
  const materialRegistry = options.materialRegistry ?? createMaterialRegistry();
  const postProcessPasses = options.postProcessPasses ?? [];

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
      const renderResult = renderForward(
        options.context,
        options.binding,
        options.residency,
        frame.evaluatedScene,
        materialRegistry,
        postProcessPasses,
      );
      return {
        ...frame,
        renderResult,
      };
    },
    dispose: () => frameDriver.dispose(),
  };
};
