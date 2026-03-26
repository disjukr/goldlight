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
import type { FrameState } from '@goldlight/renderer';

import type { DesktopModuleCleanup, DesktopModuleContext } from './app.ts';

export type FrameStateStore = Readonly<{
  getSnapshot: () => FrameState;
  subscribe: (listener: () => void) => () => void;
}>;

export type FrameController = Readonly<{
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

export type WindowMetricsStore = Readonly<{
  getSnapshot: () => WindowMetrics;
  subscribe: (listener: () => void) => () => void;
}>;

export const FrameControllerContext = React.createContext<FrameController | null>(null);
export const FrameStateStoreContext = React.createContext<FrameStateStore | null>(null);
export const WindowMetricsStoreContext = React.createContext<WindowMetricsStore | null>(null);

const FrameContextProvider = (
  {
    controller,
    store,
    children,
  }: React.PropsWithChildren<{ controller: FrameController; store: FrameStateStore }>,
) =>
  React.createElement(
    FrameControllerContext.Provider,
    { value: controller },
    React.createElement(
      FrameStateStoreContext.Provider,
      { value: store },
      children,
    ),
  );

const WindowMetricsContextProvider = (
  {
    store,
    children,
  }: React.PropsWithChildren<{ store: WindowMetricsStore }>,
) =>
  React.createElement(
    WindowMetricsStoreContext.Provider,
    { value: store },
    children,
  );

export const useFrameController = (): FrameController => {
  const controller = React.useContext(FrameControllerContext);
  if (!controller) {
    throw new Error('useFrameController() must be used inside initializeWindow()');
  }
  return controller;
};

export const useSetFrameState = (): FrameController['setFrameState'] => {
  return useFrameController().setFrameState;
};

export const useFrameState = <TFrameState extends FrameState = FrameState>(): TFrameState => {
  const store = React.useContext(FrameStateStoreContext);
  if (!store) {
    throw new Error('useFrameState() must be used inside initializeWindow()');
  }
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  ) as TFrameState;
};

export const useWindowMetrics = (): WindowMetrics => {
  const store = React.useContext(WindowMetricsStoreContext);
  if (!store) {
    throw new Error('useWindowMetrics() must be used inside initializeWindow()');
  }
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
};

type FrameStateStoreController = Readonly<{
  store: FrameStateStore;
  controller: FrameController;
}>;

type WindowMetricsStoreController = Readonly<{
  store: WindowMetricsStore;
  setMetrics: (nextMetrics: WindowMetrics) => void;
}>;

const createFrameStateStoreController = (
  initialFrameState: FrameState,
  onChange: () => void,
): FrameStateStoreController => {
  let currentFrameState = initialFrameState;
  const listeners = new Set<() => void>();

  const notify = () => {
    onChange();
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    store: {
      getSnapshot: () => currentFrameState,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    controller: {
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

const createWindowMetricsStoreController = (
  initialMetrics: WindowMetrics,
  onChange: () => void,
): WindowMetricsStoreController => {
  let currentMetrics = initialMetrics;
  const listeners = new Set<() => void>();

  const notify = () => {
    onChange();
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    store: {
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

export type InitializeWindowOptions<TProps> = Readonly<{
  props?: TProps;
  initialFrameState?: FrameState;
  onReady?: (
    context: Readonly<{
      window: DesktopModuleContext['window'];
      sceneRoot: React3dSceneRoot;
      forwardRenderer: SceneRootForwardRenderer;
      frameController: FrameController;
    }>,
  ) => void;
}>;

export const initializeWindow = <TProps>(
  Component: React.ComponentType<TProps>,
  options?: InitializeWindowOptions<TProps>,
) =>
async (
  { window }: DesktopModuleContext,
): Promise<void | DesktopModuleCleanup> => {
  const rootElement = (
    frameController: FrameController,
    frameStateStore: FrameStateStore,
    windowMetricsStore: WindowMetricsStore,
  ) =>
    React.createElement(
      WindowMetricsContextProvider,
      { store: windowMetricsStore },
      React.createElement(
        FrameContextProvider,
        { controller: frameController, store: frameStateStore },
        React.createElement(Component, (options?.props ?? {}) as TProps),
      ),
    );

  let requestFrame = () => {};
  const { store: frameStateStore, controller: frameController } = createFrameStateStoreController(
    options?.initialFrameState ?? {},
    () => requestFrame(),
  );
  const windowMetrics = createWindowMetricsStoreController(
    readWindowMetrics(window),
    () => requestFrame(),
  );

  const sceneRoot = createReactSceneRoot(
    rootElement(frameController, frameStateStore, windowMetrics.store),
  );
  const initialMetrics = windowMetrics.store.getSnapshot();
  const target = {
    kind: 'surface' as const,
    width: initialMetrics.physicalWidth,
    height: initialMetrics.physicalHeight,
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
  });

  let frameHandle = 0;
  let disposed = false;
  let needsPresent = true;
  let lastRenderedContentRevision = sceneRoot.getContentRevision();

  const drawFrame = (_timeMs: number) => {
    frameHandle = 0;
    if (disposed) {
      return;
    }

    sceneRoot.flushUpdates();
    const nextContentRevision = sceneRoot.getContentRevision();
    if (needsPresent || nextContentRevision !== lastRenderedContentRevision) {
      forwardRenderer.renderFrame(frameStateStore.getSnapshot());
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
  options?.onReady?.({
    window,
    sceneRoot,
    forwardRenderer,
    frameController,
  });

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
    forwardRenderer.dispose();
  };
};
