import type { GpuUploadContext, RenderContextBinding, RuntimeResidency } from '@rieul3d/gpu';
import { ensureSceneMeshResidency } from '@rieul3d/gpu';
import type {
  GpuRenderExecutionContext,
  HybridRenderResult,
  MaterialRegistry,
  PostProcessPass,
} from '@rieul3d/renderer';
import { createMaterialRegistry, renderHybridFrame } from '@rieul3d/renderer';

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

type RenderHybridFrameHook = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: SceneRootFrameResult['evaluatedScene'],
  materialRegistry: MaterialRegistry,
  postProcessPasses: readonly PostProcessPass[],
) => HybridRenderResult;

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

export type SceneRootHybridFrameResult = Readonly<
  & SceneRootFrameResult
  & {
    renderResult: HybridRenderResult;
  }
>;

export type SceneRootHybridRenderer = Readonly<{
  getFrameDriver: () => SceneRootFrameDriver;
  renderFrame: (
    timeMs: number,
    options?: SceneRootFrameAdvanceOptions,
  ) => SceneRootHybridFrameResult;
  dispose: () => void;
}>;

export const createSceneRootHybridRenderer = (
  sceneRoot: Parameters<typeof createSceneRootFrameDriver>[0],
  options: SceneRootHybridRendererOptions,
): SceneRootHybridRenderer => {
  const frameDriver = createSceneRootFrameDriver(sceneRoot, {
    flushUpdates: options.flushUpdates,
    residency: options.residency,
    initialTimeMs: options.initialTimeMs,
  });
  const ensureMeshResidency = options.hooks?.ensureSceneMeshResidency ?? ensureSceneMeshResidency;
  const renderHybrid = options.hooks?.renderHybridFrame ?? renderHybridFrame;
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
      const renderResult = renderHybrid(
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
