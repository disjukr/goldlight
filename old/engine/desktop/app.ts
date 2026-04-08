import { GpuWindow, webgpu } from 'electrobun/bun';

import { createDesktopWindowRuntime } from './runtime.ts';
import type {
  DesktopModuleContext,
  DesktopWindow,
  DesktopWindowState,
  DesktopWindowSurfaceInfo,
  GoldlightWindowOptions,
} from './types.ts';

type GoldlightWindowMessageListener = ((event: MessageEvent<unknown>) => void) | null;

export type GoldlightWindow = Readonly<{
  close: () => void;
  postMessage: (message: unknown) => void;
  whenReady: () => Promise<void>;
  whenClosed: () => Promise<void>;
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
  dispatchEvent: EventTarget['dispatchEvent'];
  getOnMessage: () => GoldlightWindowMessageListener;
  setOnMessage: (listener: GoldlightWindowMessageListener) => void;
}>;

let desktopInitialized = false;
let nextWindowId = 1n;
const openWindows = new Set<GoldlightWindow>();
let desktopKeepAliveHandle: ReturnType<typeof setInterval> | null = null;

const syncDesktopKeepAlive = (): void => {
  if (openWindows.size > 0) {
    if (desktopKeepAliveHandle === null) {
      desktopKeepAliveHandle = setInterval(() => {}, 1000);
    }
    return;
  }

  if (desktopKeepAliveHandle !== null) {
    clearInterval(desktopKeepAliveHandle);
    desktopKeepAliveHandle = null;
  }
};

const installWebGpuGlobals = (): void => {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope.GPUShaderStage) {
    globalScope.GPUShaderStage = {
      VERTEX: 0x1,
      FRAGMENT: 0x2,
      COMPUTE: 0x4,
    };
  }
};

const assertDesktopInitialized = (): void => {
  if (!desktopInitialized) {
    throw new Error(
      '@disjukr/goldlight/desktop has not been initialized; call await initializeMain() before creating windows',
    );
  }
};

const queueMessageEvent = (
  target: EventTarget,
  message: unknown,
  onMessage: GoldlightWindowMessageListener,
): void => {
  queueMicrotask(() => {
    const event = new MessageEvent('message', {
      data: message,
      origin: 'desktop://window',
    });
    target.dispatchEvent(event);
    onMessage?.(event);
  });
};

const createGpuCanvasContext = (gpuWindow: InstanceType<typeof GpuWindow>): {
  compatibleSurface: unknown;
  context: GPUCanvasContext;
} => {
  const contextHandle = webgpu.createContext(gpuWindow) as unknown as GPUCanvasContext & {
    context?: GPUCanvasContext;
  };
  return {
    compatibleSurface: contextHandle,
    context: contextHandle.context ?? contextHandle,
  };
};

const createDesktopWindow = (
  gpuWindow: InstanceType<typeof GpuWindow>,
  windowId: bigint,
): DesktopWindow => {
  const runtime = createDesktopWindowRuntime(windowId, () => {});
  const size = gpuWindow.getSize();
  const surfaceInfo: DesktopWindowSurfaceInfo = {
    width: size.width,
    height: size.height,
    scaleFactor: 1,
  };
  let state: DesktopWindowState = {
    width: size.width,
    height: size.height,
    focused: true,
  };
  const { compatibleSurface, context } = createGpuCanvasContext(gpuWindow);

  const syncSize = (width: number, height: number) => {
    state = {
      ...state,
      width,
      height,
    };
    (surfaceInfo as { width: number; height: number }).width = width;
    (surfaceInfo as { width: number; height: number }).height = height;
  };

  gpuWindow.on('resize', (event: unknown) => {
    const resizeEvent = event as { data: { width: number; height: number } };
    syncSize(resizeEvent.data.width, resizeEvent.data.height);
    runtime.dispatchHostEvent({
      kind: 'resized',
      windowId,
      width: resizeEvent.data.width,
      height: resizeEvent.data.height,
    });
  });
  gpuWindow.on('close', () => {
    runtime.dispatchHostEvent({
      kind: 'close-requested',
      windowId,
    });
  });

  return {
    id: windowId,
    runtime,
    surfaceInfo,
    canvasContext: context,
    compatibleSurface,
    getState: () => state,
    requestRedraw: () => {},
    present: () => {},
    resizeSurface: (width, height) => {
      syncSize(width, height);
    },
    close: () => {
      gpuWindow.close();
    },
  };
};

export const initializeMain = async (): Promise<void> => {
  if (desktopInitialized) {
    return;
  }

  webgpu.install();
  installWebGpuGlobals();
  const gpu = navigator.gpu;
  if (!gpu) {
    throw new Error('WebGPU is unavailable in the desktop shell');
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable for the desktop shell');
  }
  desktopInitialized = true;
};

export const disposeMain = async (): Promise<void> => {
  const windows = [...openWindows];
  for (const window of windows) {
    window.close();
  }
  for (const window of windows) {
    try {
      await window.whenClosed();
    } catch {
      // Ignore teardown errors during application shutdown.
    }
  }
  openWindows.clear();
  syncDesktopKeepAlive();
  desktopInitialized = false;
};

export const createWindow = (
  options: GoldlightWindowOptions,
): GoldlightWindow => {
  assertDesktopInitialized();

  const gpuWindow = new GpuWindow({
    title: options.title,
    frame: {
      x: 0,
      y: 0,
      width: options.width,
      height: options.height,
    },
  });
  const windowId = nextWindowId;
  nextWindowId += 1n;
  const window = createDesktopWindow(gpuWindow, windowId);
  const target = new EventTarget();

  let readyResolve!: () => void;
  let readyReject!: (reason?: unknown) => void;
  let closeResolve!: () => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const closedPromise = new Promise<void>((resolve) => {
    closeResolve = resolve;
  });

  let cleanup: (() => void | Promise<void>) | undefined;
  let closed = false;
  let runtimeError: Error | undefined;
  let onMessage: GoldlightWindowMessageListener = null;

  const closeWindow = async () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      await cleanup?.();
    } finally {
      gpuWindow.close();
      closeResolve();
    }
  };

  gpuWindow.on('close', () => {
    void closeWindow();
  });

  const goldlightWindow: GoldlightWindow = {
    close: () => {
      void closeWindow();
    },
    postMessage: (message: unknown) => {
      queueMessageEvent(target, message, onMessage);
      window.runtime.postMessage(message);
    },
    whenReady: async () => {
      await readyPromise;
    },
    whenClosed: async () => {
      await closedPromise;
      if (runtimeError) {
        throw runtimeError;
      }
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    getOnMessage: () => onMessage,
    setOnMessage: (listener) => {
      onMessage = listener;
    },
  };

  openWindows.add(goldlightWindow);
  closedPromise.finally(() => {
    openWindows.delete(goldlightWindow);
    syncDesktopKeepAlive();
  });
  syncDesktopKeepAlive();

  const context: DesktopModuleContext = {
    window,
  };

  void Promise.resolve(options.entry(context))
    .then((result) => {
      if (typeof result === 'function') {
        cleanup = result;
      }
      readyResolve();
    })
    .catch((error: unknown) => {
      runtimeError = error instanceof Error ? error : new Error(String(error));
      readyReject(runtimeError);
      void closeWindow();
    });

  return goldlightWindow;
};
