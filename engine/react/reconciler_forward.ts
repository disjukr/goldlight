import {
  acquireColorAttachmentView,
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
} from '@disjukr/goldlight/gpu';
import { evaluateScene } from '@disjukr/goldlight/renderer';
import {
  createDrawingContextFromGpuContext,
  type DrawingContext,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  scaleDrawingRecorder,
} from '@disjukr/goldlight/drawing';
import type {
  ForwardRenderResult,
  FrameState,
  FrameStateInit,
  GpuRenderExecutionContext,
  MaterialRegistry,
  PostProcessPass,
} from '@disjukr/goldlight/renderer';
import { createFrameState, renderForwardFrame } from '@disjukr/goldlight/renderer';

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
    getRootType: () => 'g3d-scene' | 'g2d-scene' | undefined;
    get2dScenes: () => readonly React2dScene[];
    get3dScenes: () => readonly React3dScene[];
    getRootClearColor: () => readonly [number, number, number, number] | undefined;
    getRootViewportWidth: () => number;
    getRootViewportHeight: () => number;
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

type Root2dPresentResources = {
  pipeline: GPURenderPipeline;
  sampler: GPUSampler;
};

const surfaceTextureFormat = 'rgba8unorm' as const;
const root2dPresentShaderSource = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0,  1.0),
    vec2f( 3.0,  1.0),
  );
  let xy = positions[vertexIndex];
  var out : VertexOutput;
  out.position = vec4f(xy, 0.0, 1.0);
  out.uv = 0.5 * vec2f(xy.x + 1.0, 1.0 - xy.y);
  return out;
}

@group(0) @binding(0) var presentSampler : sampler;
@group(0) @binding(1) var presentTexture : texture_2d<f32>;

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4f {
  return textureSample(presentTexture, presentSampler, in.uv);
}
`;

const create2dSceneTarget = (
  adapter: GpuContext['adapter'],
  scene2d: React2dScene,
  msaaSampleCount: number,
): OffscreenTarget => ({
  kind: 'offscreen',
  width: scene2d.textureWidth,
  height: scene2d.textureHeight,
  format: surfaceTextureFormat,
  msaaSampleCount: resolveSupportedMsaaSampleCount(adapter, msaaSampleCount),
});

const create3dSceneTarget = (
  adapter: GpuContext['adapter'],
  scene3d: React3dScene,
  msaaSampleCount: number,
): OffscreenTarget => ({
  kind: 'offscreen',
  width: scene3d.textureWidth,
  height: scene3d.textureHeight,
  format: surfaceTextureFormat,
  msaaSampleCount: resolveSupportedMsaaSampleCount(adapter, msaaSampleCount),
});

const create2dSceneRuntimeState = (
  context: ReactSceneRootForwardRendererOptions['context'],
  scene2d: React2dScene,
  msaaSampleCount: number,
): Scene2dRuntimeState => {
  const target = create2dSceneTarget(context.adapter, scene2d, msaaSampleCount);
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
  msaaSampleCount: number,
): Scene3dRuntimeState => {
  const target = create3dSceneTarget(context.adapter, scene3d, msaaSampleCount);
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
  msaaSampleCount: number,
): Scene2dRuntimeState => {
  const current = runtimeStates.get(scene2d.id);
  const nextTarget = create2dSceneTarget(context.adapter, scene2d, msaaSampleCount);
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

  const next = create2dSceneRuntimeState(context, scene2d, msaaSampleCount);
  runtimeStates.set(scene2d.id, next);
  return next;
};

const syncScene3dRuntimeState = (
  context: ReactSceneRootForwardRendererOptions['context'],
  runtimeStates: Map<string, Scene3dRuntimeState>,
  scene3d: React3dScene,
  msaaSampleCount: number,
): Scene3dRuntimeState => {
  const current = runtimeStates.get(scene3d.id);
  const nextTarget = create3dSceneTarget(context.adapter, scene3d, msaaSampleCount);
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

  const next = create3dSceneRuntimeState(context, scene3d, msaaSampleCount);
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

const createRoot2dPresentResources = (
  device: GPUDevice,
  targetFormat: GPUTextureFormat,
): Root2dPresentResources => {
  const shaderModule = device.createShaderModule({
    label: 'react-root-g2d-present-shader',
    code: root2dPresentShaderSource,
  });
  const pipeline = device.createRenderPipeline({
    label: 'react-root-g2d-present-pipeline',
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format: targetFormat }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });
  const sampler = device.createSampler({
    label: 'react-root-g2d-present-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  return { pipeline, sampler };
};

export type ReactSceneRootForwardFrameResult = SceneRootForwardFrameResult;

export const createReactSceneRootForwardRenderer = (
  sceneRoot: React3dSceneRootLike,
  options: ReactSceneRootForwardRendererOptions,
): SceneRootForwardRenderer => {
  const scene2dRuntimeStates = new Map<string, Scene2dRuntimeState>();
  const scene3dRuntimeStates = new Map<string, Scene3dRuntimeState>();
  let root2dRuntimeState: Scene2dRuntimeState | undefined;
  const root2dPresentResources = createRoot2dPresentResources(
    options.context.device,
    options.binding.target.format,
  );
  let currentFrameState: FrameState = createFrameState({
    viewportWidth: options.binding.target.width,
    viewportHeight: options.binding.target.height,
    ...(options.initialFrameState as FrameStateInit | undefined),
  });
  let currentTimeMs = currentFrameState.timeMs;

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
        currentTimeMs = frameState.timeMs;
        if (sceneRoot.getRootType() === 'g2d-scene') {
          const rootScene2d = sceneRoot.get2dScenes()[0];
          if (!rootScene2d) {
            return {
              drawCount: 0,
              submittedCommandBufferCount: 0,
            };
          }
          const rootTargetWidth = rootScene2d.usesBindingTextureSize
            ? Math.max(1, options.binding.target.width)
            : rootScene2d.textureWidth;
          const rootTargetHeight = rootScene2d.usesBindingTextureSize
            ? Math.max(1, options.binding.target.height)
            : rootScene2d.textureHeight;
          const rootTargetMsaaSampleCount = resolveSupportedMsaaSampleCount(
            options.context.adapter,
            options.msaaSampleCount ?? 1,
          );
          root2dRuntimeState = root2dRuntimeState &&
              root2dRuntimeState.target.width === rootTargetWidth &&
              root2dRuntimeState.target.height === rootTargetHeight &&
              root2dRuntimeState.target.msaaSampleCount === rootTargetMsaaSampleCount
            ? ((root2dRuntimeState.scene2d = rootScene2d), root2dRuntimeState)
            : (() => {
              if (root2dRuntimeState) {
                destroySurfaceRuntimeState(root2dRuntimeState);
              }
              const target: OffscreenTarget = {
                kind: 'offscreen',
                width: rootTargetWidth,
                height: rootTargetHeight,
                format: surfaceTextureFormat,
                msaaSampleCount: rootTargetMsaaSampleCount,
              };
              const surfaceContext: GpuContext = {
                adapter: options.context.adapter,
                device: options.context.device,
                queue: options.context.queue,
                target,
              };
              return {
                scene2d: rootScene2d,
                target,
                binding: createOffscreenBinding(surfaceContext),
                drawingContext: createDrawingContextFromGpuContext(surfaceContext),
                sampler: options.context.device.createSampler({
                  label: `${rootScene2d.id}:g2d-scene-sampler`,
                  magFilter: 'linear',
                  minFilter: 'linear',
                }),
              };
            })();
          const recorder = root2dRuntimeState.drawingContext.createRecorder();
          const nestedFrameState: FrameState = {
            ...currentFrameState,
            viewportWidth: rootScene2d.viewportWidth,
            viewportHeight: rootScene2d.viewportHeight,
          };
          const scaleX = root2dRuntimeState.target.width / Math.max(1, rootScene2d.viewportWidth);
          const scaleY = root2dRuntimeState.target.height / Math.max(1, rootScene2d.viewportHeight);
          if (Math.abs(scaleX - 1) > 1e-5 || Math.abs(scaleY - 1) > 1e-5) {
            scaleDrawingRecorder(recorder, scaleX, scaleY);
          }
          rootScene2d.draw(recorder, nestedFrameState);
          const recording = finishDrawingRecorder(recorder);
          const offscreenCommandBuffer = encodeDawnCommandBuffer(
            root2dRuntimeState.drawingContext.sharedContext,
            recording,
            root2dRuntimeState.binding,
          );
          const encoder = context.device.createCommandEncoder({
            label: 'react-root-g2d-present-encoder',
          });
          const pass = encoder.beginRenderPass({
            label: 'react-root-g2d-present-pass',
            colorAttachments: [{
              view: acquireColorAttachmentView({ device: context.device }, binding),
              clearValue: {
                r: sceneRoot.getRootClearColor()?.[0] ?? 0,
                g: sceneRoot.getRootClearColor()?.[1] ?? 0,
                b: sceneRoot.getRootClearColor()?.[2] ?? 0,
                a: sceneRoot.getRootClearColor()?.[3] ?? 0,
              },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          const bindGroup = context.device.createBindGroup({
            label: 'react-root-g2d-present-bind-group',
            layout: root2dPresentResources.pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: root2dPresentResources.sampler },
              { binding: 1, resource: root2dRuntimeState.binding.view },
            ],
          });
          pass.setPipeline(root2dPresentResources.pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3);
          pass.end();
          const presentCommandBuffer = encoder.finish({
            label: 'react-root-g2d-present-command-buffer',
          });
          context.queue.submit([offscreenCommandBuffer.commandBuffer, presentCommandBuffer]);
          return {
            drawCount: recording.commands.length,
            submittedCommandBufferCount: 2,
          };
        }
        const activeScene3dIds = new Set<string>();
        for (const scene3d of sceneRoot.get3dScenes()) {
          activeScene3dIds.add(scene3d.id);
          const state = syncScene3dRuntimeState(
            options.context,
            scene3dRuntimeStates,
            scene3d,
            options.msaaSampleCount ?? 1,
          );
          if (state.renderedRevision !== scene3d.revision) {
            const nestedFrameState: FrameState = {
              ...currentFrameState,
              viewportWidth: scene3d.viewportWidth,
              viewportHeight: scene3d.viewportHeight,
            };
            const evaluatedScene3d = evaluateScene(scene3d.scene, { timeMs: currentTimeMs });
            ensureSceneMeshResidency(options.context, residency, scene3d.scene, evaluatedScene3d);
            ensureSceneTextureResidency(options.context, residency, scene3d.scene, {
              images: new Map(),
            });
            renderForwardFrame(
              context,
              state.binding,
              residency,
              nestedFrameState,
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
          const state = syncSurfaceRuntimeState(
            options.context,
            scene2dRuntimeStates,
            scene2d,
            options.msaaSampleCount ?? 1,
          );
          if (state.renderedRevision !== scene2d.revision) {
            const recorder = state.drawingContext.createRecorder();
            const nestedFrameState: FrameState = {
              ...currentFrameState,
              viewportWidth: scene2d.viewportWidth,
              viewportHeight: scene2d.viewportHeight,
            };
            const scaleX = state.target.width / Math.max(1, scene2d.viewportWidth);
            const scaleY = state.target.height / Math.max(1, scene2d.viewportHeight);
            if (Math.abs(scaleX - 1) > 1e-5 || Math.abs(scaleY - 1) > 1e-5) {
              scaleDrawingRecorder(recorder, scaleX, scaleY);
            }
            scene2d.draw(recorder, nestedFrameState);
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
      currentTimeMs = frameState.timeMs;
      return baseRenderer.renderFrame(frameState, frameOptions);
    },
    dispose: () => {
      if (root2dRuntimeState) {
        destroySurfaceRuntimeState(root2dRuntimeState);
        root2dRuntimeState = undefined;
      }
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
