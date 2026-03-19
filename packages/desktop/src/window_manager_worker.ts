/// <reference lib="deno.unstable" />

import { createDesktopHost } from './ffi.ts';
import type { DesktopWindowEvent, DesktopWindowSurfaceInfo } from './types.ts';
import type {
  DesktopWorkerInboundMessage,
  DesktopWorkerOutboundMessage,
  DesktopWorkerSurfaceInfo,
} from './worker_protocol.ts';
import type {
  DesktopWindowManagerInboundMessage,
  DesktopWindowManagerOutboundMessage,
} from './window_manager_protocol.ts';

type CoalescedWindowEvents = Readonly<{
  resized?: DesktopWindowEvent;
  focusChanged?: DesktopWindowEvent;
  pointerMoved?: DesktopWindowEvent;
}>;

type ManagerState = {
  initialized: boolean;
  running: boolean;
  managerShutdownRequested: boolean;
  windowId?: bigint;
  moduleWorker?: Worker;
  host?: ReturnType<typeof createDesktopHost>;
  moduleReady: boolean;
  moduleShutdownComplete: boolean;
  moduleError?: Error;
  exitReason?: string;
};

const state: ManagerState = {
  initialized: false,
  running: false,
  managerShutdownRequested: false,
  moduleReady: false,
  moduleShutdownComplete: false,
};

const postToMain = (message: DesktopWindowManagerOutboundMessage): void => {
  globalThis.postMessage(message);
};

const encodePointerValue = (value: Deno.PointerValue<unknown>): bigint =>
  value === null ? 0n : Deno.UnsafePointer.value(value);

const toWorkerSurfaceInfo = (
  surfaceInfo: DesktopWindowSurfaceInfo,
): DesktopWorkerSurfaceInfo => ({
  system: surfaceInfo.system,
  windowHandle: encodePointerValue(surfaceInfo.windowHandle),
  displayHandle: encodePointerValue(surfaceInfo.displayHandle),
  width: surfaceInfo.width,
  height: surfaceInfo.height,
  scaleFactor: surfaceInfo.scaleFactor,
});

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

const postToModule = (message: DesktopWorkerInboundMessage): void => {
  state.moduleWorker?.postMessage(message);
};

const cleanupManager = async (): Promise<void> => {
  state.running = false;
  if (state.moduleWorker) {
    postToModule({ kind: 'shutdown' });
    const deadline = Date.now() + 250;
    while (!state.moduleShutdownComplete && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    state.moduleWorker.terminate();
    state.moduleWorker = undefined;
  }

  if (state.host && state.windowId !== undefined) {
    try {
      state.host.destroyWindow(state.windowId);
    } catch {
      // Window may already be gone during close flow.
    }
  }
  state.host?.close();
  state.host = undefined;
  state.windowId = undefined;
};

const failManager = async (error: unknown): Promise<void> => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  state.exitReason = `manager-error: ${normalized.message}`;
  postToMain({
    kind: 'error',
    message: normalized.message,
    stack: normalized.stack,
  });
  await cleanupManager();
  postToMain({ kind: 'exited', reason: state.exitReason });
  globalThis.close();
};

const runManager = async (
  message: Extract<DesktopWindowManagerInboundMessage, { kind: 'init' }>,
): Promise<void> => {
  const host = createDesktopHost(message.options);
  const windowId = host.createWindow(message.options);
  const surfaceInfo = host.getWindowSurfaceInfo(windowId);
  const windowState = host.getWindowState(windowId);
  const moduleWorker = new Worker(new URL('./worker_module.ts', import.meta.url).href, {
    type: 'module',
  });

  state.initialized = true;
  state.running = true;
  state.host = host;
  state.windowId = windowId;
  state.moduleWorker = moduleWorker;

  moduleWorker.onmessage = (event: MessageEvent<DesktopWorkerOutboundMessage>) => {
    switch (event.data.kind) {
      case 'ready':
        state.moduleReady = true;
        postToMain({ kind: 'ready' });
        return;
      case 'request-redraw':
        host.requestRedraw(windowId);
        return;
      case 'close-window':
        state.exitReason = 'module-requested-close';
        state.running = false;
        try {
          host.destroyWindow(windowId);
        } catch {
          // Window may already be closed.
        }
        return;
      case 'shutdown-complete':
        state.moduleShutdownComplete = true;
        return;
      case 'error':
        state.moduleError = new Error(event.data.message);
        if (event.data.stack) {
          state.moduleError.stack = event.data.stack;
        }
        state.exitReason = `module-error: ${state.moduleError.message}`;
        state.running = false;
        return;
    }
  };
  moduleWorker.onerror = (event: ErrorEvent) => {
    state.moduleError = event.error instanceof Error
      ? event.error
      : new Error(event.message || 'Desktop module worker failed');
    state.exitReason = `module-worker-error: ${state.moduleError.message}`;
    state.running = false;
  };
  moduleWorker.onmessageerror = () => {
    state.moduleError = new Error('Desktop module worker message deserialization failed');
    state.exitReason = `module-worker-message-error: ${state.moduleError.message}`;
    state.running = false;
  };

  postToModule({
    kind: 'init',
    module: message.module,
    windowId,
    surfaceInfo: toWorkerSurfaceInfo(surfaceInfo),
    windowState,
  });

  while (state.running) {
    if (state.moduleError) {
      throw state.moduleError;
    }

    const events = coalesceDesktopWindowEvents(host.pollEvents(4));
    for (const hostEvent of events) {
      if (hostEvent.windowId !== windowId) {
        continue;
      }

      postToModule({
        kind: 'event',
        event: hostEvent,
      });

      if (hostEvent.kind === 'close-requested') {
        state.exitReason = 'host-close-requested';
        state.running = false;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  await cleanupManager();
  postToMain({ kind: 'exited', reason: state.exitReason ?? 'manager-loop-complete' });
  globalThis.close();
};

globalThis.onmessage = (event: MessageEvent<DesktopWindowManagerInboundMessage>) => {
  const message = event.data;
  if (message.kind === 'init') {
    if (state.initialized) {
      return;
    }

    void runManager(message).catch((error) => {
      void failManager(error);
    });
    return;
  }

  if (message.kind === 'shutdown') {
    state.managerShutdownRequested = true;
    state.exitReason = state.exitReason ?? 'manager-shutdown-requested';
    state.running = false;
  }
};
