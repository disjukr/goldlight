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
} from '@disjukr/goldlight/gpu';
import {
  createReactSceneRoot,
  createReactSceneRootForwardRenderer,
} from '@disjukr/goldlight/react/reconciler';
import {
  advanceFrameProgression,
  type FrameState,
  type PostProcessPass,
} from '@disjukr/goldlight/renderer';

import type { DesktopModuleCleanup, DesktopModuleContext } from './app.ts';

export type RuntimeFrameState = Readonly<{
  deltaTimeMs: number;
  frameIndex: number;
  viewportWidth: number;
  viewportHeight: number;
}>;

export type FrameStateHandle = Readonly<{
  getSnapshot: () => RuntimeFrameState;
  subscribe: (listener: () => void) => () => void;
}>;

export type TimeMsHandle = Readonly<{
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
  setTimeMs: (
    nextState: number | ((previousTimeMs: number) => number),
  ) => void;
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
  setRendererConfig: (
    nextConfig: RendererConfig | ((previousConfig: RendererConfig) => RendererConfig),
  ) => void;
}>;

export const FrameStateHandleContext = React.createContext<FrameStateHandle | null>(null);
export const TimeMsHandleContext = React.createContext<TimeMsHandle | null>(null);
export const WindowMetricsHandleContext = React.createContext<WindowMetricsHandle | null>(null);
export const RendererConfigHandleContext = React.createContext<RendererConfigHandle | null>(null);

export const useFrameStateHandle = (): FrameStateHandle => {
  const handle = React.useContext(FrameStateHandleContext);
  if (!handle) {
    throw new Error('useFrameStateHandle() must be used inside initializeWindow()');
  }
  return handle;
};

export const useFrameState = <
  TFrameState extends RuntimeFrameState = RuntimeFrameState,
>(): TFrameState => {
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

export const useTimeMsHandle = (): TimeMsHandle => {
  const handle = React.useContext(TimeMsHandleContext);
  if (!handle) {
    throw new Error('useTimeMsHandle() must be used inside initializeWindow()');
  }
  return handle;
};

export const useSetTimeMs = (): TimeMsHandle['setTimeMs'] => {
  return useTimeMsHandle().setTimeMs;
};

export const useTimeMs = (): number => {
  const handle = React.useContext(TimeMsHandleContext);
  if (!handle) {
    throw new Error('useTimeMs() must be used inside initializeWindow()');
  }
  return React.useSyncExternalStore(
    handle.subscribe,
    handle.getSnapshot,
    handle.getSnapshot,
  );
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
  setFrameState: (
    nextState: RuntimeFrameState | ((previousState: RuntimeFrameState) => RuntimeFrameState),
    options?: { notifyListeners?: boolean; requestFrame?: boolean },
  ) => void;
}>;

type TimeMsHandleController = Readonly<{
  handle: TimeMsHandle;
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
  initialFrameState: RuntimeFrameState,
  onChange: () => void,
): FrameStateHandleController => {
  let currentFrameState = initialFrameState;
  const listeners = new Set<() => void>();

  const notifyListeners = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const applyFrameState = (
    nextState: RuntimeFrameState | ((previousState: RuntimeFrameState) => RuntimeFrameState),
    options?: { notifyListeners?: boolean; requestFrame?: boolean },
  ) => {
    const resolvedState = typeof nextState === 'function'
      ? nextState(currentFrameState)
      : nextState;
    if (Object.is(currentFrameState, resolvedState)) {
      return;
    }
    currentFrameState = resolvedState;
    if (options?.notifyListeners !== false) {
      notifyListeners();
    }
    if (options?.requestFrame !== false) {
      onChange();
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
    },
    setFrameState: applyFrameState,
  };
};

const createTimeMsHandleController = (
  initialTimeMs: number,
  onChange: () => void,
): TimeMsHandleController => {
  let currentTimeMs = initialTimeMs;
  const listeners = new Set<() => void>();

  const notify = () => {
    onChange();
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    handle: {
      getSnapshot: () => currentTimeMs,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      setTimeMs: (nextState) => {
        const resolvedState = typeof nextState === 'function'
          ? nextState(currentTimeMs)
          : nextState;
        if (Object.is(currentTimeMs, resolvedState)) {
          return;
        }
        currentTimeMs = resolvedState;
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
        const resolvedConfig = typeof nextConfig === 'function'
          ? nextConfig(currentConfig)
          : nextConfig;
        if (areRendererConfigsEqual(currentConfig, resolvedConfig)) {
          return;
        }
        currentConfig = resolvedConfig;
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
  initialTimeMs?: number;
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
    timeMs: TimeMsHandle,
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
          React.createElement(
            TimeMsHandleContext.Provider,
            { value: timeMs },
            React.createElement(Component),
          ),
        ),
      ),
    );

  let requestFrameImpl = () => {};
  const requestFrame = () => requestFrameImpl();
  const initialWindowMetrics = readWindowMetrics(window);
  const windowMetrics = createWindowMetricsHandleController(
    initialWindowMetrics,
    requestFrame,
  );
  const frameStateController = createFrameStateHandleController(
    {
      deltaTimeMs: 0,
      frameIndex: 0,
      viewportWidth: initialWindowMetrics.logicalWidth,
      viewportHeight: initialWindowMetrics.logicalHeight,
    },
    requestFrame,
  );
  const frameState = frameStateController.handle;
  const timeMs = createTimeMsHandleController(
    config?.initialTimeMs ?? 0,
    requestFrame,
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
    {
      rootViewportWidth: windowMetrics.handle.getSnapshot().logicalWidth,
      rootViewportHeight: windowMetrics.handle.getSnapshot().logicalHeight,
    },
    rootElement(
      frameState,
      timeMs.handle,
      windowMetrics.handle,
      rendererConfig.handle,
    ),
  );
  const getEffectiveRendererConfig = (): RendererConfig => {
    return rendererConfig.handle.getSnapshot();
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
  let lastPreparedFrameClockMs: number | undefined;

  const syncRuntimeFrameState = (): void => {
    const viewportWidth = sceneRoot.getRootViewportWidth();
    const viewportHeight = sceneRoot.getRootViewportHeight();
    frameStateController.setFrameState((previousState) => {
      if (
        previousState.viewportWidth === viewportWidth &&
        previousState.viewportHeight === viewportHeight
      ) {
        return previousState;
      }
      return {
        ...previousState,
        viewportWidth,
        viewportHeight,
      };
    }, { requestFrame: false });
  };

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

  const drawFrame = (_nowMs: number) => {
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
      currentForwardRenderer.renderFrame(
        {
          ...frameState.getSnapshot(),
          timeMs: timeMs.handle.getSnapshot(),
        } satisfies FrameState,
      );
      window.present();
      needsPresent = false;
      lastRenderedContentRevision = nextContentRevision;
    }
  };

  requestFrameImpl = () => {
    if (disposed) {
      return;
    }
    needsPresent = true;
    if (frameHandle === 0) {
      const nextFrameClockMs = performance.now();
      const previousFrameState = frameState.getSnapshot();
      const progression = advanceFrameProgression(
        previousFrameState,
        nextFrameClockMs,
        lastPreparedFrameClockMs,
      );
      frameStateController.setFrameState((previousState) => ({
        ...previousState,
        ...progression,
      }), { requestFrame: false });
      lastPreparedFrameClockMs = nextFrameClockMs;
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
    sceneRoot.setRootViewport(nextMetrics.logicalWidth, nextMetrics.logicalHeight);
    syncRuntimeFrameState();
    requestFrame();
  };

  const handleScaleFactorChange = () => {
    const nextMetrics = readWindowMetrics(window);
    target.width = nextMetrics.physicalWidth;
    target.height = nextMetrics.physicalHeight;
    resizeSurfaceBindingTarget(binding, nextMetrics.physicalWidth, nextMetrics.physicalHeight);
    windowMetrics.setMetrics(nextMetrics);
    sceneRoot.setRootViewport(nextMetrics.logicalWidth, nextMetrics.logicalHeight);
    syncRuntimeFrameState();
    requestFrame();
  };

  const handleFocusChange = () => {
    windowMetrics.setMetrics(readWindowMetrics(window));
    requestFrame();
  };

  const unsubscribe = sceneRoot.subscribe(() => {
    syncRuntimeFrameState();
    requestFrame();
  });

  window.runtime.addEventListener('resize', handleResize);
  window.runtime.addEventListener('scalefactorchange', handleScaleFactorChange);
  window.runtime.addEventListener('focuschange', handleFocusChange);

  sceneRoot.setRootViewport(initialMetrics.logicalWidth, initialMetrics.logicalHeight);
  syncRuntimeFrameState();
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
