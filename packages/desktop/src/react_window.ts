/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@goldlight/gpu';
import {
  createReactSceneRoot,
  createReactSceneRootForwardRenderer,
  type React3dSceneRoot,
  type SceneRootForwardRenderer,
} from '@goldlight/react/reconciler';

import type { DesktopModuleCleanup, DesktopModuleContext } from './app.ts';

export type WindowSceneProps = Readonly<{
  timeMs?: number;
}>;

export type InitializeWindowOptions<TProps extends WindowSceneProps> = Readonly<{
  props?: Omit<TProps, 'timeMs'>;
  initialTimeMs?: number;
  onReady?: (
    context: Readonly<{
      window: DesktopModuleContext['window'];
      sceneRoot: React3dSceneRoot;
      forwardRenderer: SceneRootForwardRenderer;
    }>,
  ) => void;
}>;

export const initializeWindow = <TProps extends WindowSceneProps>(
  Component: React.ComponentType<TProps>,
  options?: InitializeWindowOptions<TProps>,
) =>
async (
  { window }: DesktopModuleContext,
): Promise<void | DesktopModuleCleanup> => {
  const renderScene = (timeMs: number) =>
    React.createElement(Component, {
      ...(options?.props ?? {}),
      timeMs,
    } as TProps);

  const initialTimeMs = options?.initialTimeMs ?? performance.now();
  const sceneRoot = createReactSceneRoot(renderScene(initialTimeMs));
  const target = {
    kind: 'surface' as const,
    width: window.surfaceInfo.width,
    height: window.surfaceInfo.height,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
  };
  const gpuContext = await requestGpuContext({ target });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const residency = createRuntimeResidency();
  const forwardRenderer = createReactSceneRootForwardRenderer(sceneRoot, {
    context: gpuContext,
    binding,
    residency,
    initialTimeMs,
  });

  const handleResize = (event: Event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  };

  window.runtime.addEventListener('resize', handleResize);
  options?.onReady?.({
    window,
    sceneRoot,
    forwardRenderer,
  });

  let frameHandle = 0;
  const drawFrame = (timeMs: number) => {
    sceneRoot.render(renderScene(timeMs));
    forwardRenderer.renderFrame(timeMs);
    window.present();
    frameHandle = requestAnimationFrame(drawFrame);
  };

  drawFrame(initialTimeMs);

  return () => {
    cancelAnimationFrame(frameHandle);
    window.runtime.removeEventListener('resize', handleResize);
    sceneRoot.unmount();
    forwardRenderer.dispose();
  };
};
