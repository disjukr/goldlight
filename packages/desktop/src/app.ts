/// <reference lib="deno.unstable" />

import { createDesktopHost, type DesktopHost } from './ffi.ts';
import { createDesktopWindowRuntime, type DesktopWindowRuntime } from './runtime.ts';
import type {
  DesktopHostOptions,
  DesktopModuleOptions,
  DesktopWindowEvent,
  DesktopWindowOptions,
  DesktopWindowState,
  DesktopWindowSurfaceInfo,
} from './types.ts';
import type {
  DesktopWindowManagerInboundMessage,
  DesktopWindowManagerOutboundMessage,
} from './window_manager_protocol.ts';

export type DesktopWindow = Readonly<{
  id: bigint;
  runtime: DesktopWindowRuntime;
  surfaceInfo: DesktopWindowSurfaceInfo;
  surface: Deno.UnsafeWindowSurface;
  canvasContext: GPUCanvasContext;
  getState: () => DesktopWindowState;
  requestRedraw: () => void;
  present: () => void;
  resizeSurface: (width: number, height: number) => void;
  close: () => void;
}>;

export type DesktopModuleContext = Readonly<{
  host: DesktopHost;
  window: DesktopWindow;
}>;

export type DesktopApp = Readonly<{
  host: DesktopHost;
  window: DesktopWindow;
  pumpEvents: (timeoutMs?: number) => readonly DesktopWindowEvent[];
  run: () => Promise<void>;
  close: () => void;
}>;

export type DesktopModuleCleanup = () => void | Promise<void>;

type CoalescedWindowEvents = Readonly<{
  resized?: DesktopWindowEvent;
  focusChanged?: DesktopWindowEvent;
  pointerMoved?: DesktopWindowEvent;
}>;

const resizeDesktopSurface = (
  surface: Deno.UnsafeWindowSurface,
  surfaceInfo: DesktopWindowSurfaceInfo,
  width: number,
  height: number,
): void => {
  surface.resize(width, height);
  (surfaceInfo as { width: number; height: number }).width = width;
  (surfaceInfo as { width: number; height: number }).height = height;
};

const flushCoalescedWindowEvents = (
  events: DesktopWindowEvent[],
  pendingByWindowId: Map<bigint, CoalescedWindowEvents>,
  windowId: bigint,
): void => {
  const pending = pendingByWindowId.get(windowId);
  if (!pending) {
    return;
  }

  if (pending.resized) {
    events.push(pending.resized);
  }
  if (pending.focusChanged) {
    events.push(pending.focusChanged);
  }
  if (pending.pointerMoved) {
    events.push(pending.pointerMoved);
  }

  pendingByWindowId.delete(windowId);
};

const coalesceDesktopWindowEvents = (
  events: readonly DesktopWindowEvent[],
): readonly DesktopWindowEvent[] => {
  const coalescedEvents: DesktopWindowEvent[] = [];
  const pendingByWindowId = new Map<bigint, CoalescedWindowEvents>();

  for (const event of events) {
    switch (event.kind) {
      case 'resized': {
        const pending = pendingByWindowId.get(event.windowId) ?? {};
        pendingByWindowId.set(event.windowId, {
          ...pending,
          resized: event,
        });
        break;
      }
      case 'focus-changed': {
        const pending = pendingByWindowId.get(event.windowId) ?? {};
        pendingByWindowId.set(event.windowId, {
          ...pending,
          focusChanged: event,
        });
        break;
      }
      case 'pointer-moved': {
        const pending = pendingByWindowId.get(event.windowId) ?? {};
        pendingByWindowId.set(event.windowId, {
          ...pending,
          pointerMoved: event,
        });
        break;
      }
      default:
        flushCoalescedWindowEvents(coalescedEvents, pendingByWindowId, event.windowId);
        coalescedEvents.push(event);
        break;
    }
  }

  for (const windowId of pendingByWindowId.keys()) {
    flushCoalescedWindowEvents(coalescedEvents, pendingByWindowId, windowId);
  }

  return coalescedEvents;
};

export const createDesktopWindow = (
  host: DesktopHost,
  options: DesktopWindowOptions,
): DesktopWindow => {
  const windowId = host.createWindow(options);
  const surfaceInfo = host.getWindowSurfaceInfo(windowId);
  const runtime = createDesktopWindowRuntime(windowId, () => host.requestRedraw(windowId));
  const surface = new Deno.UnsafeWindowSurface({
    system: surfaceInfo.system,
    windowHandle: surfaceInfo.windowHandle,
    displayHandle: surfaceInfo.displayHandle,
    width: surfaceInfo.width,
    height: surfaceInfo.height,
  });
  const canvasContext = surface.getContext('webgpu');

  runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    resizeDesktopSurface(surface, surfaceInfo, detail.width, detail.height);
  });

  return {
    id: windowId,
    runtime,
    surfaceInfo,
    surface,
    canvasContext,
    getState: () => host.getWindowState(windowId),
    requestRedraw: () => host.requestRedraw(windowId),
    present: () => surface.present(),
    resizeSurface: (width, height) => resizeDesktopSurface(surface, surfaceInfo, width, height),
    close: () => host.destroyWindow(windowId),
  };
};

const ensureDesktopWebGpuContext = async (): Promise<void> => {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable for the desktop shell');
  }
};

export const createDesktopApp = async (
  options: DesktopWindowOptions & DesktopHostOptions,
): Promise<DesktopApp> => {
  await ensureDesktopWebGpuContext();
  const host = createDesktopHost(options);
  const window = createDesktopWindow(host, options);

  const pumpEvents = (timeoutMs = 16): readonly DesktopWindowEvent[] => {
    const events = coalesceDesktopWindowEvents(host.pollEvents(timeoutMs));
    for (const event of events) {
      if (event.windowId === window.id) {
        window.runtime.dispatchHostEvent(event);
      }
    }

    return events;
  };

  let running = true;
  window.runtime.addEventListener('close', () => {
    running = false;
  });

  return {
    host,
    window,
    pumpEvents,
    run: async () => {
      while (running) {
        const timeoutMs = window.runtime.hasPendingAnimationFrameCallbacks() ? 0 : 4;
        pumpEvents(timeoutMs);
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    },
    close: () => {
      running = false;
      window.close();
      host.close();
    },
  };
};

export const runDesktopModule = async (
  options: DesktopModuleOptions,
): Promise<void> => {
  const managerWorker = new Worker(new URL('./window_manager_worker.ts', import.meta.url).href, {
    type: 'module',
  });

  let exited = false;
  let ready = false;
  let startupError: Error | undefined;
  let runtimeError: Error | undefined;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((reason?: unknown) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let exitResolve: (() => void) | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });

  const failManagerWorker = (error: Error): void => {
    if (!ready) {
      startupError = error;
      readyReject?.(error);
    } else {
      runtimeError = error;
    }
    exited = true;
    exitResolve?.();
  };

  managerWorker.onmessage = (event: MessageEvent<DesktopWindowManagerOutboundMessage>) => {
    switch (event.data.kind) {
      case 'ready':
        ready = true;
        readyResolve?.();
        return;
      case 'exited':
        exited = true;
        if (!ready) {
          readyReject?.(
            startupError ??
              new Error(
                `Window manager worker exited before initialization completed${
                  event.data.reason ? ` (${event.data.reason})` : ''
                }`,
              ),
          );
        }
        exitResolve?.();
        return;
      case 'error': {
        const error = new Error(event.data.message);
        if (event.data.stack) {
          error.stack = event.data.stack;
        }
        failManagerWorker(error);
        return;
      }
    }
  };
  managerWorker.onerror = (event: ErrorEvent) => {
    const error = event.error instanceof Error
      ? event.error
      : new Error(event.message || 'Window manager worker failed');
    failManagerWorker(error);
  };
  managerWorker.onmessageerror = () => {
    failManagerWorker(new Error('Window manager worker message deserialization failed'));
  };

  const postToManager = (message: DesktopWindowManagerInboundMessage): void => {
    managerWorker.postMessage(message);
  };

  try {
    postToManager({
      kind: 'init',
      options,
      module: options.module instanceof URL ? options.module.href : options.module,
    });
    await readyPromise;
    await exitPromise;
    if (runtimeError) {
      throw runtimeError;
    }
  } finally {
    if (!exited) {
      postToManager({ kind: 'shutdown' });
      const shutdownDeadline = Date.now() + 250;
      while (!exited && Date.now() < shutdownDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    managerWorker.terminate();
  }
};
