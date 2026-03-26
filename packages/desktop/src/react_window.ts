/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  type RenderContextBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
  resolveSupportedMsaaSampleCount,
} from '@goldlight/gpu';
import {
  createReactSceneRoot,
  createReactSceneRootForwardRenderer,
} from '@goldlight/react/reconciler';
import type { FrameState, PostProcessPass } from '@goldlight/renderer';

import type { DesktopModuleCleanup, DesktopModuleContext } from './app.ts';

export type FrameStateHandle = Readonly<{
  getSnapshot: () => FrameState;
  subscribe: (listener: () => void) => () => void;
  setFrameState: (nextState: FrameState) => void;
}>;

export type WindowMetrics = Readonly<{
  logicalWidth: number;
  logicalHeight: number;
  physicalWidth: number;
  physicalHeight: number;
  scaleFactor: number;
  focused: boolean;
}>;

export type WindowMetricsHandle = Readonly<{
  getSnapshot: () => WindowMetrics;
  subscribe: (listener: () => void) => () => void;
}>;

export type RendererConfig = Readonly<{
  msaaSampleCount: number;
  postProcessPasses: readonly PostProcessPass[];
}>;

export type RendererConfigHandle = Readonly<{
  getSnapshot: () => RendererConfig;
  subscribe: (listener: () => void) => () => void;
  setRendererConfig: (nextConfig: RendererConfig) => void;
}>;

export const FrameStateHandleContext = React.createContext<FrameStateHandle | null>(null);
export const WindowMetricsHandleContext = React.createContext<WindowMetricsHandle | null>(null);
export const RendererConfigHandleContext = React.createContext<RendererConfigHandle | null>(null);

export const useFrameStateHandle = (): FrameStateHandle => {
  const handle = React.useContext(FrameStateHandleContext);
  if (!handle) {
    throw new Error('useFrameStateHandle() must be used inside initializeWindow()');
  }
  return handle;
};

export const useSetFrameState = (): FrameStateHandle['setFrameState'] => {
  return useFrameStateHandle().setFrameState;
};

export const useFrameState = <TFrameState extends FrameState = FrameState>(): TFrameState => {
  const handle = React.useContext(FrameStateHandleContext);
  if (!handle) {
    throw new Error('useFrameState() must be used inside initializeWindow()');
  }
  return React.useSyncExternalStore(
    handle.subscribe,
    handle.getSnapshot,
    handle.getSnapshot,
  ) as TFrameState;
};

export const useWindowMetrics = (): WindowMetrics => {
  const handle = React.useContext(WindowMetricsHandleContext);
  if (!handle) {
    throw new Error('useWindowMetrics() must be used inside initializeWindow()');
  }
  return React.useSyncExternalStore(
    handle.subscribe,
    handle.getSnapshot,
    handle.getSnapshot,
  );
};

export const useSetRendererConfig = (): RendererConfigHandle['setRendererConfig'] => {
  const handle = React.useContext(RendererConfigHandleContext);
  if (!handle) {
    throw new Error('useSetRendererConfig() must be used inside initializeWindow()');
  }
  return handle.setRendererConfig;
};

export const useRendererConfig = (): RendererConfig => {
  const handle = React.useContext(RendererConfigHandleContext);
  if (!handle) {
    throw new Error('useRendererConfig() must be used inside initializeWindow()');
  }
  return React.useSyncExternalStore(
    handle.subscribe,
    handle.getSnapshot,
    handle.getSnapshot,
  );
};

type FrameStateHandleController = Readonly<{
  handle: FrameStateHandle;
}>;

type WindowMetricsHandleController = Readonly<{
  handle: WindowMetricsHandle;
  setMetrics: (nextMetrics: WindowMetrics) => void;
}>;

type RendererConfigHandleController = Readonly<{
  handle: RendererConfigHandle;
}>;

const defaultRendererConfig: RendererConfig = {
  msaaSampleCount: 1,
  postProcessPasses: [],
};

const areRendererConfigsEqual = (
  left: RendererConfig,
  right: RendererConfig,
): boolean =>
  left.msaaSampleCount === right.msaaSampleCount &&
  left.postProcessPasses.length === right.postProcessPasses.length &&
  left.postProcessPasses.every((pass, index) => Object.is(pass, right.postProcessPasses[index]));

const createFrameStateHandleController = (
  initialFrameState: FrameState,
  onChange: () => void,
): FrameStateHandleController => {
  let currentFrameState = initialFrameState;
  const listeners = new Set<() => void>();

  const notify = () => {
    onChange();
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    handle: {
      getSnapshot: () => currentFrameState,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      setFrameState: (nextState) => {
        if (Object.is(currentFrameState, nextState)) {
          return;
        }
        currentFrameState = nextState;
        notify();
      },
    },
  };
};

const readWindowMetrics = (window: DesktopModuleContext['window']): WindowMetrics => {
  const state = window.getState();
  return {
    logicalWidth: state.width,
    logicalHeight: state.height,
    physicalWidth: window.surfaceInfo.width,
    physicalHeight: window.surfaceInfo.height,
    scaleFactor: window.surfaceInfo.scaleFactor,
    focused: state.focused,
  };
};

const createWindowMetricsHandleController = (
  initialMetrics: WindowMetrics,
  onChange: () => void,
): WindowMetricsHandleController => {
  let currentMetrics = initialMetrics;
  const listeners = new Set<() => void>();

  const notify = () => {
    onChange();
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    handle: {
      getSnapshot: () => currentMetrics,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    setMetrics: (nextMetrics) => {
      if (
        currentMetrics.logicalWidth === nextMetrics.logicalWidth &&
        currentMetrics.logicalHeight === nextMetrics.logicalHeight &&
        currentMetrics.physicalWidth === nextMetrics.physicalWidth &&
        currentMetrics.physicalHeight === nextMetrics.physicalHeight &&
        currentMetrics.scaleFactor === nextMetrics.scaleFactor &&
        currentMetrics.focused === nextMetrics.focused
      ) {
        return;
      }
      currentMetrics = nextMetrics;
      notify();
    },
  };
};

const createRendererConfigHandleController = (
  initialConfig: RendererConfig,
  onChange: () => void,
): RendererConfigHandleController => {
  let currentConfig = initialConfig;
  const listeners = new Set<() => void>();

  const notify = () => {
    onChange();
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    handle: {
      getSnapshot: () => currentConfig,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      setRendererConfig: (nextConfig) => {
        if (areRendererConfigsEqual(currentConfig, nextConfig)) {
          return;
        }
        currentConfig = nextConfig;
        notify();
      },
    },
  };
};

const destroyBindingResources = (binding: RenderContextBinding): void => {
  binding.depthTexture.destroy?.();
  if (binding.kind === 'offscreen') {
    binding.texture.destroy?.();
    binding.resolveTexture?.destroy?.();
  }
};

export type InitializeWindowConfig = Readonly<{
  initialFrameState?: FrameState;
  initialRendererConfig?: RendererConfig;
}>;

export const initializeWindow = (
  Component: React.ComponentType,
  config?: InitializeWindowConfig,
) =>
async (
  { window }: DesktopModuleContext,
): Promise<void | DesktopModuleCleanup> => {
  const rootElement = (
    frameState: FrameStateHandle,
    windowMetrics: WindowMetricsHandle,
    rendererConfig: RendererConfigHandle,
  ) =>
    React.createElement(
      WindowMetricsHandleContext.Provider,
      { value: windowMetrics },
      React.createElement(
        RendererConfigHandleContext.Provider,
        { value: rendererConfig },
        React.createElement(
          FrameStateHandleContext.Provider,
          { value: frameState },
          React.createElement(Component),
        ),
      ),
    );

  let requestFrame = () => {};
  const { handle: frameState } = createFrameStateHandleController(
    config?.initialFrameState ?? {},
    () => requestFrame(),
  );
  const windowMetrics = createWindowMetricsHandleController(
    readWindowMetrics(window),
    () => requestFrame(),
  );
  let needsRendererReconfigure = false;
  const rendererConfig = createRendererConfigHandleController(
    config?.initialRendererConfig ?? defaultRendererConfig,
    () => {
      needsRendererReconfigure = true;
      requestFrame();
    },
  );

  const sceneRoot = createReactSceneRoot(
    rootElement(
      frameState,
      windowMetrics.handle,
      rendererConfig.handle,
    ),
  );
  const getEffectiveRendererConfig = (): RendererConfig => {
    const baseConfig = rendererConfig.handle.getSnapshot();
    const rootMsaaSampleCount = sceneRoot.getRootMsaaSampleCount();
    return rootMsaaSampleCount === undefined ? baseConfig : {
      ...baseConfig,
      msaaSampleCount: rootMsaaSampleCount,
    };
  };
  const initialMetrics = windowMetrics.handle.getSnapshot();
  const createTarget = (metrics: WindowMetrics, config: RendererConfig) => ({
    kind: 'surface' as const,
    width: metrics.physicalWidth,
    height: metrics.physicalHeight,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
    msaaSampleCount: resolveSupportedMsaaSampleCount(gpuContext.adapter, config.msaaSampleCount),
  });
  const initialTarget = {
    kind: 'surface' as const,
    width: initialMetrics.physicalWidth,
    height: initialMetrics.physicalHeight,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
    msaaSampleCount: 1,
  };
  const gpuContext = await requestGpuContext({ target: initialTarget });
  let target = createTarget(initialMetrics, getEffectiveRendererConfig());
  const createBinding = (nextTarget: typeof target) =>
    createSurfaceBinding({ ...gpuContext, target: nextTarget }, window.canvasContext);
  let binding = createBinding(target);
  const residency = createRuntimeResidency();
  const createForwardRenderer = (nextBinding: typeof binding, config: RendererConfig) =>
    createReactSceneRootForwardRenderer(sceneRoot, {
      context: gpuContext,
      binding: nextBinding,
      residency,
      postProcessPasses: config.postProcessPasses,
      msaaSampleCount: config.msaaSampleCount,
    });
  let currentForwardRenderer = createForwardRenderer(binding, getEffectiveRendererConfig());

  let frameHandle = 0;
  let disposed = false;
  let needsPresent = true;
  let lastRenderedContentRevision = sceneRoot.getContentRevision();

  const reconfigureRenderer = () => {
    const nextConfig = getEffectiveRendererConfig();
    const nextMetrics = windowMetrics.handle.getSnapshot();
    const nextTarget = createTarget(nextMetrics, nextConfig);
    currentForwardRenderer.dispose();
    destroyBindingResources(binding);
    target = nextTarget;
    binding = createBinding(nextTarget);
    currentForwardRenderer = createForwardRenderer(binding, nextConfig);
    needsRendererReconfigure = false;
    needsPresent = true;
  };

  const drawFrame = (_timeMs: number) => {
    frameHandle = 0;
    if (disposed) {
      return;
    }

    sceneRoot.flushUpdates();
    const effectiveConfig = getEffectiveRendererConfig();
    if (target.msaaSampleCount !== effectiveConfig.msaaSampleCount) {
      needsRendererReconfigure = true;
    }
    if (needsRendererReconfigure) {
      reconfigureRenderer();
    }
    const nextContentRevision = sceneRoot.getContentRevision();
    if (needsPresent || nextContentRevision !== lastRenderedContentRevision) {
      currentForwardRenderer.renderFrame(frameState.getSnapshot());
      window.present();
      needsPresent = false;
      lastRenderedContentRevision = nextContentRevision;
    }
  };

  requestFrame = () => {
    if (disposed) {
      return;
    }
    needsPresent = true;
    if (frameHandle === 0) {
      frameHandle = requestAnimationFrame(drawFrame);
    }
  };

  const handleResize = (event: Event) => {
    const _detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    const nextMetrics = readWindowMetrics(window);
    target.width = nextMetrics.physicalWidth;
    target.height = nextMetrics.physicalHeight;
    resizeSurfaceBindingTarget(binding, nextMetrics.physicalWidth, nextMetrics.physicalHeight);
    windowMetrics.setMetrics(nextMetrics);
    requestFrame();
  };

  const handleScaleFactorChange = () => {
    const nextMetrics = readWindowMetrics(window);
    target.width = nextMetrics.physicalWidth;
    target.height = nextMetrics.physicalHeight;
    resizeSurfaceBindingTarget(binding, nextMetrics.physicalWidth, nextMetrics.physicalHeight);
    windowMetrics.setMetrics(nextMetrics);
    requestFrame();
  };

  const handleFocusChange = () => {
    windowMetrics.setMetrics(readWindowMetrics(window));
    requestFrame();
  };

  const unsubscribe = sceneRoot.subscribe(() => {
    requestFrame();
  });

  window.runtime.addEventListener('resize', handleResize);
  window.runtime.addEventListener('scalefactorchange', handleScaleFactorChange);
  window.runtime.addEventListener('focuschange', handleFocusChange);

  requestFrame();

  return () => {
    disposed = true;
    if (frameHandle !== 0) {
      cancelAnimationFrame(frameHandle);
    }
    unsubscribe();
    window.runtime.removeEventListener('resize', handleResize);
    window.runtime.removeEventListener('scalefactorchange', handleScaleFactorChange);
    window.runtime.removeEventListener('focuschange', handleFocusChange);
    sceneRoot.unmount();
    currentForwardRenderer.dispose();
    destroyBindingResources(binding);
  };
};
