/// <reference lib="deno.unstable" />

import { createDesktopHost } from './ffi.ts';
import type { DesktopWindowEvent, DesktopWindowSurfaceInfo } from './types.ts';
import type { DesktopWorkerSurfaceInfo } from './worker_protocol.ts';
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
  windowDestroyed: boolean;
  host?: ReturnType<typeof createDesktopHost>;
  exitReason?: string;
};

const state: ManagerState = {
  initialized: false,
  running: false,
  managerShutdownRequested: false,
  windowDestroyed: false,
};

const resetManagerState = (): void => {
  state.initialized = false;
  state.running = false;
  state.managerShutdownRequested = false;
  state.windowId = undefined;
  state.windowDestroyed = false;
  state.host = undefined;
  state.exitReason = undefined;
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

const destroyHostWindow = (): void => {
  if (!state.host || state.windowId === undefined || state.windowDestroyed) {
    return;
  }

  try {
    state.host.destroyWindow(state.windowId);
  } catch {
    // Window may already be gone during close flow.
  }
  state.windowDestroyed = true;
};

const cleanupManager = (): void => {
  state.running = false;
  destroyHostWindow();
  state.host?.close();
  state.host = undefined;
  state.windowId = undefined;
};

const failManager = (error: unknown): void => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  state.exitReason = `manager-error: ${normalized.message}`;
  postToMain({
    kind: 'error',
    message: normalized.message,
    stack: normalized.stack,
  });
  cleanupManager();
  postToMain({ kind: 'exited', reason: state.exitReason });
  resetManagerState();
};

const runManager = async (
  message: Extract<DesktopWindowManagerInboundMessage, { kind: 'init' }>,
): Promise<void> => {
  const host = createDesktopHost(message.options);
  const windowId = host.createWindow(message.options);
  const surfaceInfo = host.getWindowSurfaceInfo(windowId);
  const windowState = host.getWindowState(windowId);

  state.initialized = true;
  state.running = true;
  state.host = host;
  state.windowId = windowId;
  state.windowDestroyed = false;

  postToMain({
    kind: 'ready',
    windowId,
    surfaceInfo: toWorkerSurfaceInfo(surfaceInfo),
    windowState,
  });

  while (state.running) {
    const events = coalesceDesktopWindowEvents(host.pollEvents(4));
    for (const hostEvent of events) {
      if (hostEvent.windowId !== windowId) {
        continue;
      }

      postToMain({
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

  cleanupManager();
  postToMain({ kind: 'exited', reason: state.exitReason ?? 'manager-loop-complete' });
  resetManagerState();
};

globalThis.onmessage = (event: MessageEvent<DesktopWindowManagerInboundMessage>) => {
  const message = event.data;
  if (message.kind === 'init') {
    if (state.initialized) {
      return;
    }

    void runManager(message).catch((error) => {
      failManager(error);
    });
    return;
  }

  if (message.kind === 'shutdown') {
    state.managerShutdownRequested = true;
    state.exitReason = state.exitReason ?? 'manager-shutdown-requested';
    state.running = false;
    return;
  }

  if (message.kind === 'request-redraw') {
    if (!state.host || state.windowId === undefined || state.windowDestroyed || !state.running) {
      return;
    }
    try {
      state.host.requestRedraw(state.windowId);
    } catch {
      state.windowDestroyed = true;
      state.exitReason = state.exitReason ?? 'host-close-requested';
      state.running = false;
    }
    return;
  }

  if (message.kind === 'close-window') {
    state.exitReason = state.exitReason ?? 'host-close-requested';
    state.running = false;
    destroyHostWindow();
  }
};
