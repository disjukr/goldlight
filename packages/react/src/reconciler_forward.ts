import {
  createOffscreenBinding,
  ensureSceneMeshResidency,
  ensureSceneTextureResidency,
  type GpuContext,
  type GpuTextureUploadContext,
  type GpuUploadContext,
  type OffscreenBinding,
  type OffscreenTarget,
  type RenderContextBinding,
  resolveSupportedMsaaSampleCount,
  type RuntimeResidency,
  type TextureResidency,
} from '@goldlight/gpu';
import { evaluateScene } from '@goldlight/core';
import {
  createDrawingContextFromGpuContext,
  type DrawingContext,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
} from '@goldlight/drawing';
import type {
  ForwardRenderResult,
  FrameState,
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
} from '@goldlight/renderer';
import { renderForwardFrame } from '@goldlight/renderer';

import type { SceneRootFrameDriverOptions } from './runtime_driver.ts';
import {
  createSceneRootForwardRenderer,
  type SceneRootForwardFrameResult,
  type SceneRootForwardRenderer,
} from './runtime_forward.ts';
import type { React2dScene, React3dScene, React3dSceneRoot } from './reconciler.ts';

type React3dSceneRootLike =
  & React3dSceneRoot
  & Readonly<{
    get2dScenes: () => readonly React2dScene[];
    get3dScenes: () => readonly React3dScene[];
    getRootClearColor: () => readonly [number, number, number, number] | undefined;
    getRootMsaaSampleCount: () => number | undefined;
    getContentRevision: () => number;
  }>;

type ReactSceneRootForwardRendererHooks = Readonly<{
  renderForwardFrame?: (
    context: GpuRenderExecutionContext,
    binding: RenderContextBinding,
    residency: RuntimeResidency,
    frameState: FrameState,
    evaluatedScene: Parameters<typeof renderForwardFrame>[4],
    materialRegistry: MaterialRegistry,
    postProcessPasses: readonly PostProcessPass[],
    clearColor?: readonly [number, number, number, number],
  ) => ForwardRenderResult;
}>;

export type ReactSceneRootForwardRendererOptions = Readonly<
  & SceneRootFrameDriverOptions
  & {
    context: GpuContext & GpuRenderExecutionContext & GpuUploadContext & GpuTextureUploadContext;
    binding: RenderContextBinding;
    residency: RuntimeResidency;
    msaaSampleCount?: number;
    materialRegistry?: MaterialRegistry;
    postProcessPasses?: readonly PostProcessPass[];
    hooks?: ReactSceneRootForwardRendererHooks;
  }
>;

type Scene2dRuntimeState = {
  scene2d: React2dScene;
  target: OffscreenTarget;
  binding: OffscreenBinding;
  drawingContext: DrawingContext;
  sampler: GPUSampler;
  renderedRevision?: number;
};

type Scene3dRuntimeState = {
  scene3d: React3dScene;
  target: OffscreenTarget;
  binding: OffscreenBinding;
  sampler: GPUSampler;
  renderedRevision?: number;
};

const surfaceTextureFormat = 'rgba8unorm' as const;

const create2dSceneTarget = (
  adapter: GpuContext['adapter'],
  scene2d: React2dScene,
): OffscreenTarget => ({
  kind: 'offscreen',
  width: scene2d.textureWidth,
  height: scene2d.textureHeight,
  format: surfaceTextureFormat,
  msaaSampleCount: resolveSupportedMsaaSampleCount(adapter, scene2d.msaaSampleCount),
});

const create3dSceneTarget = (
  adapter: GpuContext['adapter'],
  scene3d: React3dScene,
): OffscreenTarget => ({
  kind: 'offscreen',
  width: scene3d.textureWidth,
  height: scene3d.textureHeight,
  format: surfaceTextureFormat,
  msaaSampleCount: resolveSupportedMsaaSampleCount(adapter, scene3d.msaaSampleCount),
});

const create2dSceneRuntimeState = (
  context: ReactSceneRootForwardRendererOptions['context'],
  scene2d: React2dScene,
): Scene2dRuntimeState => {
  const target = create2dSceneTarget(context.adapter, scene2d);
  const surfaceContext: GpuContext = {
    adapter: context.adapter,
    device: context.device,
    queue: context.queue,
    target,
  };
  return {
    scene2d,
    target,
    binding: createOffscreenBinding(surfaceContext),
    drawingContext: createDrawingContextFromGpuContext(surfaceContext),
    sampler: context.device.createSampler({
      label: `${scene2d.id}:g2d-scene-sampler`,
      magFilter: 'linear',
      minFilter: 'linear',
    }),
  };
};

const create3dSceneRuntimeState = (
  context: ReactSceneRootForwardRendererOptions['context'],
  scene3d: React3dScene,
): Scene3dRuntimeState => {
  const target = create3dSceneTarget(context.adapter, scene3d);
  const surfaceContext: GpuContext = {
    adapter: context.adapter,
    device: context.device,
    queue: context.queue,
    target,
  };
  return {
    scene3d,
    target,
    binding: createOffscreenBinding(surfaceContext),
    sampler: context.device.createSampler({
      label: `${scene3d.id}:g3d-scene-sampler`,
      magFilter: 'linear',
      minFilter: 'linear',
    }),
  };
};

const destroySurfaceRuntimeState = (
  state: Scene2dRuntimeState | Scene3dRuntimeState,
): void => {
  state.binding.texture.destroy?.();
  state.binding.resolveTexture?.destroy?.();
  state.binding.depthTexture.destroy?.();
};

const syncSurfaceRuntimeState = (
  context: ReactSceneRootForwardRendererOptions['context'],
  runtimeStates: Map<string, Scene2dRuntimeState>,
  scene2d: React2dScene,
): Scene2dRuntimeState => {
  const current = runtimeStates.get(scene2d.id);
  const nextTarget = create2dSceneTarget(context.adapter, scene2d);
  if (
    current &&
    current.target.width === nextTarget.width &&
    current.target.height === nextTarget.height
  ) {
    current.scene2d = scene2d;
    return current;
  }

  if (current) {
    destroySurfaceRuntimeState(current);
  }

  const next = create2dSceneRuntimeState(context, scene2d);
  runtimeStates.set(scene2d.id, next);
  return next;
};

const syncScene3dRuntimeState = (
  context: ReactSceneRootForwardRendererOptions['context'],
  runtimeStates: Map<string, Scene3dRuntimeState>,
  scene3d: React3dScene,
): Scene3dRuntimeState => {
  const current = runtimeStates.get(scene3d.id);
  const nextTarget = create3dSceneTarget(context.adapter, scene3d);
  if (
    current &&
    current.target.width === nextTarget.width &&
    current.target.height === nextTarget.height &&
    current.target.msaaSampleCount === nextTarget.msaaSampleCount
  ) {
    current.scene3d = scene3d;
    return current;
  }

  if (current) {
    destroySurfaceRuntimeState(current);
  }

  const next = create3dSceneRuntimeState(context, scene3d);
  runtimeStates.set(scene3d.id, next);
  return next;
};

const create2dSceneTextureResidency = (
  scene2d: React2dScene,
  state: Scene2dRuntimeState,
): TextureResidency => ({
  textureId: scene2d.textureId,
  texture: state.binding.texture,
  view: state.binding.view,
  sampler: state.sampler,
  width: state.target.width,
  height: state.target.height,
  format: state.target.format,
});

const create3dSceneTextureResidency = (
  scene3d: React3dScene,
  state: Scene3dRuntimeState,
): TextureResidency => ({
  textureId: scene3d.textureId,
  texture: state.binding.texture,
  view: state.binding.view,
  sampler: state.sampler,
  width: state.target.width,
  height: state.target.height,
  format: state.target.format,
});

export type ReactSceneRootForwardFrameResult = SceneRootForwardFrameResult;

export const createReactSceneRootForwardRenderer = (
  sceneRoot: React3dSceneRootLike,
  options: ReactSceneRootForwardRendererOptions,
): SceneRootForwardRenderer => {
  const scene2dRuntimeStates = new Map<string, Scene2dRuntimeState>();
  const scene3dRuntimeStates = new Map<string, Scene3dRuntimeState>();
  let currentFrameState: FrameState = options.initialFrameState ?? {};
  let currentTimeMs = typeof currentFrameState.timeMs === 'number' ? currentFrameState.timeMs : 0;

  const baseRenderer = createSceneRootForwardRenderer(sceneRoot, {
    ...options,
    hooks: {
      renderForwardFrame: (
        context,
        binding,
        residency,
        frameState,
        evaluatedScene,
        materialRegistry,
        postProcessPasses,
      ) => {
        currentFrameState = frameState;
        currentTimeMs = typeof frameState.timeMs === 'number' ? frameState.timeMs : 0;
        const activeScene3dIds = new Set<string>();
        for (const scene3d of sceneRoot.get3dScenes()) {
          activeScene3dIds.add(scene3d.id);
          const state = syncScene3dRuntimeState(
            options.context,
            scene3dRuntimeStates,
            scene3d,
          );
          if (state.renderedRevision !== scene3d.revision) {
            const evaluatedScene3d = evaluateScene(scene3d.scene, { timeMs: currentTimeMs });
            ensureSceneMeshResidency(options.context, residency, scene3d.scene, evaluatedScene3d);
            ensureSceneTextureResidency(options.context, residency, scene3d.scene, {
              images: new Map(),
            });
            renderForwardFrame(
              context,
              state.binding,
              residency,
              currentFrameState,
              evaluatedScene3d,
              {
                materialRegistry,
                postProcessPasses,
                clearColor: scene3d.clearColor,
              },
            );
            state.renderedRevision = scene3d.revision;
          }
          residency.textures.set(scene3d.textureId, create3dSceneTextureResidency(scene3d, state));
        }

        const activeScene2dIds = new Set<string>();
        for (const scene2d of sceneRoot.get2dScenes()) {
          activeScene2dIds.add(scene2d.id);
          const state = syncSurfaceRuntimeState(options.context, scene2dRuntimeStates, scene2d);
          if (state.renderedRevision !== scene2d.revision) {
            const recorder = state.drawingContext.createRecorder();
            scene2d.draw(recorder, currentFrameState);
            const recording = finishDrawingRecorder(recorder);
            const commandBuffer = encodeDawnCommandBuffer(
              state.drawingContext.sharedContext,
              recording,
              state.binding,
            );
            context.queue.submit([commandBuffer.commandBuffer]);
            state.renderedRevision = scene2d.revision;
          }
          residency.textures.set(scene2d.textureId, create2dSceneTextureResidency(scene2d, state));
        }

        for (const [scene3dId, state] of [...scene3dRuntimeStates.entries()]) {
          if (activeScene3dIds.has(scene3dId)) {
            continue;
          }
          destroySurfaceRuntimeState(state);
          scene3dRuntimeStates.delete(scene3dId);
          residency.textures.delete(state.scene3d.textureId);
        }

        for (const [scene2dId, state] of [...scene2dRuntimeStates.entries()]) {
          if (activeScene2dIds.has(scene2dId)) {
            continue;
          }
          destroySurfaceRuntimeState(state);
          scene2dRuntimeStates.delete(scene2dId);
          residency.textures.delete(state.scene2d.textureId);
        }

        if (options.hooks?.renderForwardFrame) {
          return options.hooks.renderForwardFrame(
            context,
            binding,
            residency,
            frameState,
            evaluatedScene,
            materialRegistry,
            postProcessPasses,
            sceneRoot.getRootClearColor(),
          );
        }
        return renderForwardFrame(
          context,
          binding,
          residency,
          frameState,
          evaluatedScene,
          {
            materialRegistry,
            postProcessPasses,
            clearColor: sceneRoot.getRootClearColor(),
          },
        );
      },
    },
  });

  return {
    getFrameDriver: () => baseRenderer.getFrameDriver(),
    renderFrame: (frameState, frameOptions) => {
      currentFrameState = frameState;
      currentTimeMs = typeof frameState.timeMs === 'number' ? frameState.timeMs : 0;
      return baseRenderer.renderFrame(frameState, frameOptions);
    },
    dispose: () => {
      for (const state of scene2dRuntimeStates.values()) {
        destroySurfaceRuntimeState(state);
      }
      scene2dRuntimeStates.clear();
      for (const state of scene3dRuntimeStates.values()) {
        destroySurfaceRuntimeState(state);
      }
      scene3dRuntimeStates.clear();
      baseRenderer.dispose();
    },
  };
};
