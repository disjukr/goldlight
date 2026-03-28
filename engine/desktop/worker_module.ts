/// <reference lib="deno.unstable" />

import { installDesktopWindowGlobals } from './bootstrap.ts';
import { createDesktopWindowRuntime } from './runtime.ts';
import type { DesktopHost } from './ffi.ts';
import type { DesktopModuleCleanup, DesktopModuleContext } from './app.ts';
import type { DesktopModuleContext as RuntimeDesktopModuleContext, DesktopWindow } from './app.ts';
import type { DesktopWindowEvent, DesktopWindowState, DesktopWindowSurfaceInfo } from './types.ts';
import type {
  DesktopWorkerInboundMessage,
  DesktopWorkerOutboundMessage,
} from './worker_protocol.ts';

type DesktopModuleExports = Readonly<{
  default?: (
    context: DesktopModuleContext,
  ) => void | DesktopModuleCleanup | Promise<void | DesktopModuleCleanup>;
}>;

type WorkerState = {
  context?: RuntimeDesktopModuleContext;
  cleanup?: DesktopModuleCleanup;
  restoreGlobals?: () => void;
  runtimeWindowState?: { current: DesktopWindowState };
  initialized: boolean;
  pendingHostEvents: DesktopWindowEvent[];
  pendingMessages: unknown[];
  shutdownRequested: boolean;
  closed: boolean;
};

const workerState: WorkerState = {
  initialized: false,
  pendingHostEvents: [],
  pendingMessages: [],
  shutdownRequested: false,
  closed: false,
};

const postMessageToParent = globalThis.postMessage.bind(globalThis);

const postToHost = (message: DesktopWorkerOutboundMessage): void => {
  if (workerState.closed) {
    return;
  }
  postMessageToParent(message);
};

const queuePendingHostEvent = (event: DesktopWindowEvent): void => {
  if (event.kind === 'frame') {
    return;
  }

  if (
    event.kind === 'resized' ||
    event.kind === 'scale-factor-changed' ||
    event.kind === 'focus-changed' ||
    event.kind === 'pointer-moved'
  ) {
    const existingIndex = workerState.pendingHostEvents.findIndex((pendingEvent) =>
      pendingEvent.kind === event.kind && pendingEvent.windowId === event.windowId
    );
    if (existingIndex >= 0) {
      workerState.pendingHostEvents[existingIndex] = event;
      return;
    }
  }

  workerState.pendingHostEvents.push(event);
};

const closeWorker = (): void => {
  if (workerState.closed) {
    return;
  }

  workerState.closed = true;
  workerState.restoreGlobals?.();
  globalThis.close();
};

const reportWorkerError = (error: unknown): void => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  postToHost({
    kind: 'error',
    message: errorMessage,
    stack,
  });
};

const ensureWorkerWebGpuContext = async (): Promise<void> => {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable for the desktop module worker');
  }
};

const createWorkerDesktopContext = (
  message: Extract<DesktopWorkerInboundMessage, { kind: 'init' }>,
): RuntimeDesktopModuleContext => {
  const runtime = createDesktopWindowRuntime(message.windowId, () => {
    postToHost({ kind: 'request-redraw' });
  });
  const runtimeWindowState = {
    current: message.windowState,
  };
  const surfaceInfo: DesktopWindowSurfaceInfo = {
    system: message.surfaceInfo.system,
    windowHandle: Deno.UnsafePointer.create(message.surfaceInfo.windowHandle),
    displayHandle: Deno.UnsafePointer.create(message.surfaceInfo.displayHandle),
    width: message.surfaceInfo.width,
    height: message.surfaceInfo.height,
    scaleFactor: message.surfaceInfo.scaleFactor,
  };
  const surface = new Deno.UnsafeWindowSurface({
    system: surfaceInfo.system,
    windowHandle: surfaceInfo.windowHandle,
    displayHandle: surfaceInfo.displayHandle,
    width: surfaceInfo.width,
    height: surfaceInfo.height,
  });
  const canvasContext = surface.getContext('webgpu');
  const resizeSurfaceFromLogicalSize = (logicalWidth: number, logicalHeight: number) => {
    const physicalWidth = Math.max(1, Math.round(logicalWidth * surfaceInfo.scaleFactor));
    const physicalHeight = Math.max(1, Math.round(logicalHeight * surfaceInfo.scaleFactor));
    surface.resize(physicalWidth, physicalHeight);
    (surfaceInfo as { width: number; height: number }).width = physicalWidth;
    (surfaceInfo as { width: number; height: number }).height = physicalHeight;
  };

  runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    runtimeWindowState.current = {
      ...runtimeWindowState.current,
      width: detail.width,
      height: detail.height,
    };
    resizeSurfaceFromLogicalSize(detail.width, detail.height);
  });

  runtime.addEventListener('scalefactorchange', (event) => {
    const detail = (event as CustomEvent<{ scaleFactor: number }>).detail;
    (surfaceInfo as { scaleFactor: number }).scaleFactor = detail.scaleFactor;
    resizeSurfaceFromLogicalSize(
      runtimeWindowState.current.width,
      runtimeWindowState.current.height,
    );
  });

  runtime.addEventListener('focuschange', (event) => {
    const detail = (event as CustomEvent<{ focused: boolean }>).detail;
    runtimeWindowState.current = {
      ...runtimeWindowState.current,
      focused: detail.focused,
    };
  });

  const hostProxy: DesktopHost = {
    createWindow: () => {
      throw new Error(
        'Desktop workers do not support creating additional windows from module code',
      );
    },
    destroyWindow: () => {
      postToHost({ kind: 'close-window' });
    },
    requestRedraw: () => {
      postToHost({ kind: 'request-redraw' });
    },
    showWindow: () => {
      throw new Error(
        'Desktop workers do not support showing windows directly from module code',
      );
    },
    pollEvents: () => [],
    getWindowSurfaceInfo: () => surfaceInfo,
    getWindowState: () => runtimeWindowState.current,
    close: () => {
      postToHost({ kind: 'close-window' });
    },
  };

  const windowProxy: DesktopWindow = {
    id: message.windowId,
    runtime,
    surfaceInfo,
    surface,
    canvasContext,
    getState: () => runtimeWindowState.current,
    requestRedraw: () => {
      postToHost({ kind: 'request-redraw' });
    },
    present: () => surface.present(),
    resizeSurface: (width, height) => {
      resizeSurfaceFromLogicalSize(width, height);
    },
    close: () => {
      postToHost({ kind: 'close-window' });
    },
  };

  workerState.runtimeWindowState = runtimeWindowState;

  return {
    host: hostProxy,
    window: windowProxy,
  };
};

const runModule = async (
  message: Extract<DesktopWorkerInboundMessage, { kind: 'init' }>,
): Promise<void> => {
  await ensureWorkerWebGpuContext();
  const context = createWorkerDesktopContext(message);
  const restoreGlobals = installDesktopWindowGlobals(context.window.runtime, (payload) => {
    postToHost({
      kind: 'message',
      message: payload,
    });
  });
  workerState.context = context;
  workerState.restoreGlobals = restoreGlobals;

  const module = await import(message.module) as DesktopModuleExports;
  if (typeof module.default === 'function') {
    const result = await module.default(context);
    if (typeof result === 'function') {
      workerState.cleanup = result;
    }
  }

  workerState.initialized = true;
  const pendingHostEvents = workerState.pendingHostEvents;
  workerState.pendingHostEvents = [];
  for (const pendingEvent of pendingHostEvents) {
    handleHostEvent(pendingEvent);
  }
  const pendingMessages = workerState.pendingMessages;
  workerState.pendingMessages = [];
  for (const pendingMessage of pendingMessages) {
    context.window.runtime.postMessage(pendingMessage);
  }
  if (workerState.shutdownRequested) {
    await shutdownWorker();
    return;
  }
  postToHost({ kind: 'request-redraw' });
  postToHost({ kind: 'ready' });
};

const handleHostEvent = (event: DesktopWindowEvent): void => {
  const context = workerState.context;
  if (!context) {
    return;
  }

  if (event.kind === 'resized' && workerState.runtimeWindowState) {
    workerState.runtimeWindowState.current = {
      ...workerState.runtimeWindowState.current,
      width: event.width,
      height: event.height,
    };
  }
  if (event.kind === 'focus-changed' && workerState.runtimeWindowState) {
    workerState.runtimeWindowState.current = {
      ...workerState.runtimeWindowState.current,
      focused: event.focused,
    };
  }

  context.window.runtime.dispatchHostEvent(event);
};

const shutdownWorker = async (): Promise<void> => {
  try {
    await workerState.cleanup?.();
    postToHost({ kind: 'shutdown-complete' });
  } catch (error) {
    reportWorkerError(error);
  } finally {
    closeWorker();
  }
};

globalThis.onmessage = (event: MessageEvent<DesktopWorkerInboundMessage>) => {
  const message = event.data;
  if (message.kind === 'init') {
    void runModule(message).catch((error: unknown) => {
      reportWorkerError(error);
    });
    return;
  }

  if (!workerState.initialized) {
    if (message.kind === 'shutdown') {
      workerState.shutdownRequested = true;
      postToHost({ kind: 'shutdown-complete' });
      closeWorker();
      return;
    }
    if (message.kind === 'event') {
      queuePendingHostEvent(message.event);
      return;
    }
    if (message.kind === 'post-message') {
      workerState.pendingMessages.push(message.message);
    }
    return;
  }

  if (message.kind === 'event') {
    handleHostEvent(message.event);
    return;
  }

  if (message.kind === 'post-message') {
    workerState.context?.window.runtime.postMessage(message.message);
    return;
  }

  if (message.kind === 'shutdown') {
    void shutdownWorker();
  }
};
