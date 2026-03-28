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

type WindowManagerGlobalScope = typeof globalThis & {
  postMessage: (message: DesktopWindowManagerOutboundMessage) => void;
  onmessage: ((event: MessageEvent<DesktopWindowManagerInboundMessage>) => void) | null;
};

type ManagerState = {
  initialized: boolean;
  running: boolean;
  managerShutdownRequested: boolean;
  host?: ReturnType<typeof createDesktopHost>;
  hostLibraryPath?: string;
  windows: Map<number, { windowId: bigint; destroyed: boolean }>;
};

const state: ManagerState = {
  initialized: false,
  running: false,
  managerShutdownRequested: false,
  windows: new Map(),
};

const resetManagerState = (): void => {
  state.initialized = false;
  state.running = false;
  state.managerShutdownRequested = false;
  state.host = undefined;
  state.hostLibraryPath = undefined;
  state.windows.clear();
};

const postToMain = (message: DesktopWindowManagerOutboundMessage): void => {
  (globalThis as WindowManagerGlobalScope).postMessage(message);
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

const destroyHostWindow = (requestId: number): void => {
  const windowState = state.windows.get(requestId);
  if (!state.host || !windowState || windowState.destroyed) {
    return;
  }

  try {
    state.host.destroyWindow(windowState.windowId);
  } catch {
    // Window may already be gone during close flow.
  }
  windowState.destroyed = true;
};

const cleanupManager = (): void => {
  state.running = false;
  for (const requestId of state.windows.keys()) {
    destroyHostWindow(requestId);
  }
  state.host?.close();
  state.host = undefined;
};

const failManager = (error: unknown): void => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  postToMain({
    kind: 'error',
    message: normalized.message,
    stack: normalized.stack,
  });
  cleanupManager();
  for (const [requestId, windowState] of state.windows.entries()) {
    postToMain({
      kind: 'exited',
      requestId,
      windowId: windowState.windowId,
      reason: `manager-error: ${normalized.message}`,
    });
  }
  resetManagerState();
};

const ensureHost = (
  message: Extract<DesktopWindowManagerInboundMessage, { kind: 'init' }>,
): ReturnType<typeof createDesktopHost> => {
  if (!state.host) {
    state.host = createDesktopHost(message.options);
    state.hostLibraryPath = message.options.libraryPath;
  }
  return state.host;
};

const runManager = async (): Promise<void> => {
  while (state.running) {
    const host = state.host;
    if (!host) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      continue;
    }
    const events = coalesceDesktopWindowEvents(host.pollEvents(4));
    for (const hostEvent of events) {
      postToMain({
        kind: 'event',
        event: hostEvent,
      });

      if (hostEvent.kind === 'close-requested') {
        const requestEntry = [...state.windows.entries()].find(([, windowState]) =>
          windowState.windowId === hostEvent.windowId
        );
        if (requestEntry) {
          const [requestId] = requestEntry;
          destroyHostWindow(requestId);
          postToMain({
            kind: 'exited',
            requestId,
            windowId: hostEvent.windowId,
            reason: 'host-close-requested',
          });
          state.windows.delete(requestId);
        }
      }
    }

    if (state.managerShutdownRequested && state.windows.size === 0) {
      state.running = false;
    }

    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  cleanupManager();
  resetManagerState();
};

(globalThis as WindowManagerGlobalScope).onmessage = (
  event: MessageEvent<DesktopWindowManagerInboundMessage>,
) => {
  const message = event.data;
  if (message.kind === 'init') {
    const host = ensureHost(message);
    const windowId = host.createWindow(message.options);
    const surfaceInfo = host.getWindowSurfaceInfo(windowId);
    const windowState = host.getWindowState(windowId);
    host.showWindow(windowId);

    state.initialized = true;
    if (!state.running) {
      state.running = true;
      void runManager().catch((error) => {
        failManager(error);
      });
    }
    state.windows.set(message.requestId, { windowId, destroyed: false });
    postToMain({
      kind: 'ready',
      requestId: message.requestId,
      windowId,
      surfaceInfo: toWorkerSurfaceInfo(surfaceInfo),
      windowState,
    });
    return;
  }

  if (message.kind === 'shutdown') {
    state.managerShutdownRequested = true;
    if (state.windows.size === 0) {
      state.running = false;
    }
    return;
  }

  if (message.kind === 'request-redraw') {
    const windowState = state.windows.get(message.requestId);
    if (!state.host || !windowState || windowState.destroyed || !state.running) {
      return;
    }
    try {
      state.host.requestRedraw(windowState.windowId);
    } catch {
      windowState.destroyed = true;
      postToMain({
        kind: 'exited',
        requestId: message.requestId,
        windowId: windowState.windowId,
        reason: 'host-close-requested',
      });
      state.windows.delete(message.requestId);
    }
    return;
  }

  if (message.kind === 'close-window') {
    const windowState = state.windows.get(message.requestId);
    if (!windowState) {
      return;
    }
    destroyHostWindow(message.requestId);
    postToMain({
      kind: 'exited',
      requestId: message.requestId,
      windowId: windowState.windowId,
      reason: 'host-close-requested',
    });
    state.windows.delete(message.requestId);
    if (state.managerShutdownRequested && state.windows.size === 0) {
      state.running = false;
    }
  }
};
