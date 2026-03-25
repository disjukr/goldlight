/// <reference lib="deno.unstable" />

import { createDesktopHost, type DesktopHost } from './ffi.ts';
import { createDesktopWindowRuntime, type DesktopWindowRuntime } from './runtime.ts';
import type {
  DesktopHostOptions,
  DesktopWindowEvent,
  DesktopWindowOptions,
  DesktopWindowState,
  DesktopWindowSurfaceInfo,
  GoldlightWindowOptions,
} from './types.ts';
import type {
  DesktopWindowManagerInboundMessage,
  DesktopWindowManagerOutboundMessage,
} from './window_manager_protocol.ts';
import type {
  DesktopWorkerInboundMessage,
  DesktopWorkerOutboundMessage,
} from './worker_protocol.ts';

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

type CoalescedWindowEvents = Readonly<{
  resized?: DesktopWindowEvent;
  focusChanged?: DesktopWindowEvent;
  pointerMoved?: DesktopWindowEvent;
}>;

type DesktopManagerWorkerSession = {
  ready: boolean;
  exited: boolean;
  closing: boolean;
  managerReady: boolean;
  moduleReady: boolean;
  moduleShutdownComplete: boolean;
  startupError?: Error;
  runtimeError?: Error;
  readyResolve?: () => void;
  readyReject?: (reason?: unknown) => void;
  exitResolve?: () => void;
  readyPromise: Promise<void>;
  exitPromise: Promise<void>;
  closedPromise: Promise<void>;
  onExited: () => void;
  dispatchMessage: (message: unknown) => void;
  moduleWorker?: Worker;
  moduleShutdownPromise: Promise<void>;
  moduleShutdownResolve?: () => void;
  handleManagerMessage: (message: DesktopWindowManagerOutboundMessage) => void;
  handleModuleMessage: (message: DesktopWorkerOutboundMessage) => void;
  fail: (error: Error) => void;
  window: GoldlightWindow;
};

type DesktopManagerWorkerController = {
  worker: Worker;
  session?: DesktopManagerWorkerSession;
  activeRunCount: number;
  poisoned: boolean;
};

let initializePromise: Promise<void> | undefined;
let desktopInitialized = false;
let desktopManagerWorkerController: DesktopManagerWorkerController | undefined;

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

const createGoldlightWindowSession = (
  postToManager: (message: DesktopWindowManagerInboundMessage) => void,
  options: GoldlightWindowOptions,
): DesktopManagerWorkerSession => {
  let readyResolve: (() => void) | undefined;
  let readyReject: ((reason?: unknown) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  void readyPromise.catch(() => {});
  let exitResolve: (() => void) | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });
  let moduleShutdownResolve: (() => void) | undefined;
  const moduleShutdownPromise = new Promise<void>((resolve) => {
    moduleShutdownResolve = resolve;
  });
  const target = new EventTarget();
  let onMessage: GoldlightWindowMessageListener = null;
  let closeEventDispatched = false;

  const session: DesktopManagerWorkerSession = {
    ready: false,
    exited: false,
    closing: false,
    managerReady: false,
    moduleReady: false,
    moduleShutdownComplete: false,
    readyResolve,
    readyReject,
    exitResolve,
    readyPromise,
    exitPromise,
    closedPromise: Promise.resolve(),
    onExited: () => {
      if (closeEventDispatched) {
        return;
      }
      closeEventDispatched = true;
      target.dispatchEvent(new Event('close'));
    },
    dispatchMessage: (message) => {
      queueMessageEvent(target, message, onMessage);
    },
    handleManagerMessage: () => {},
    handleModuleMessage: () => {},
    fail: () => {},
    moduleShutdownPromise,
    moduleShutdownResolve,
    window: {
      close: () => {
        if (session.exited || session.closing) {
          return;
        }
        session.closing = true;
        postToManager({ kind: 'close-window' });
      },
      postMessage: (message) => {
        if (session.exited) {
          throw new Error('Cannot postMessage() after the GoldlightWindow has closed');
        }
        if (!session.moduleWorker) {
          throw new Error('Cannot postMessage() before the GoldlightWindow is ready');
        }
        session.moduleWorker?.postMessage(
          {
            kind: 'post-message',
            message,
          } satisfies DesktopWorkerInboundMessage,
        );
      },
      whenReady: () => readyPromise,
      whenClosed: () => session.closedPromise,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
      getOnMessage: () => onMessage,
      setOnMessage: (listener) => {
        onMessage = listener;
      },
    },
  };

  session.closedPromise = (async () => {
    try {
      await readyPromise;
    } catch (error) {
      await exitPromise;
      if (isExpectedPreReadyCloseError(error)) {
        return;
      }
      throw error;
    }
    await exitPromise;
    if (session.runtimeError) {
      throw session.runtimeError;
    }
  })();

  const finalizeReady = (): void => {
    if (!session.ready && session.managerReady && session.moduleReady) {
      session.ready = true;
      session.readyResolve?.();
    }
  };

  session.fail = (error) => {
    if (!session.ready) {
      session.startupError = error;
      session.readyReject?.(error);
    } else {
      session.runtimeError = error;
    }
    session.exited = true;
    session.exitResolve?.();
    session.onExited();
  };

  session.handleModuleMessage = (message) => {
    switch (message.kind) {
      case 'ready':
        session.moduleReady = true;
        finalizeReady();
        return;
      case 'request-redraw':
        postToManager({ kind: 'request-redraw' });
        return;
      case 'close-window':
        session.closing = true;
        postToManager({ kind: 'close-window' });
        return;
      case 'shutdown-complete':
        session.moduleShutdownComplete = true;
        session.moduleShutdownResolve?.();
        return;
      case 'message':
        session.dispatchMessage(message.message);
        return;
      case 'error': {
        const error = new Error(message.message);
        if (message.stack) {
          error.stack = message.stack;
        }
        session.fail(error);
        return;
      }
    }
  };

  session.handleManagerMessage = (message) => {
    switch (message.kind) {
      case 'ready': {
        session.managerReady = true;
        const moduleWorker = new Worker(new URL('./worker_module.ts', import.meta.url).href, {
          type: 'module',
        });
        session.moduleWorker = moduleWorker;
        moduleWorker.onmessage = (event: MessageEvent<DesktopWorkerOutboundMessage>) => {
          session.handleModuleMessage(event.data);
        };
        moduleWorker.onerror = (event: ErrorEvent) => {
          const error = event.error instanceof Error
            ? event.error
            : new Error(event.message || 'Desktop module worker failed');
          session.fail(error);
        };
        moduleWorker.onmessageerror = () => {
          session.fail(new Error('Desktop module worker message deserialization failed'));
        };
        moduleWorker.postMessage(
          {
            kind: 'init',
            module: options.module instanceof URL ? options.module.href : options.module,
            windowId: message.windowId,
            surfaceInfo: message.surfaceInfo,
            windowState: message.windowState,
          } satisfies DesktopWorkerInboundMessage,
        );
        return;
      }
      case 'event':
        session.moduleWorker?.postMessage(
          {
            kind: 'event',
            event: message.event,
          } satisfies DesktopWorkerInboundMessage,
        );
        return;
      case 'exited':
        session.exited = true;
        if (!session.ready) {
          if (isExpectedPreReadyManagerExitReason(message.reason)) {
            session.closing = true;
            session.readyReject?.(
              new Error(
                `Window closed before initialization completed${
                  message.reason ? ` (${message.reason})` : ''
                }`,
              ),
            );
          } else {
            session.readyReject?.(
              session.startupError ??
                new Error(
                  `Window manager worker exited before initialization completed${
                    message.reason ? ` (${message.reason})` : ''
                  }`,
                ),
            );
          }
        }
        session.exitResolve?.();
        session.onExited();
        return;
      case 'error': {
        const error = new Error(message.message);
        if (message.stack) {
          error.stack = message.stack;
        }
        session.fail(error);
        return;
      }
    }
  };

  return session;
};

const failDesktopManagerWorkerSession = (
  controller: DesktopManagerWorkerController,
  error: Error,
): void => {
  const session = controller.session;
  if (!session) {
    controller.poisoned = true;
    return;
  }
  session.fail(error);
};

const createDesktopManagerWorkerController = (): DesktopManagerWorkerController => {
  const worker = new Worker(new URL('./window_manager_worker.ts', import.meta.url).href, {
    type: 'module',
  });
  const controller: DesktopManagerWorkerController = {
    worker,
    activeRunCount: 0,
    poisoned: false,
  };

  worker.onmessage = (event: MessageEvent<DesktopWindowManagerOutboundMessage>) => {
    const session = controller.session;
    if (!session) {
      return;
    }
    session.handleManagerMessage(event.data);
  };
  worker.onerror = (event: ErrorEvent) => {
    const error = event.error instanceof Error
      ? event.error
      : new Error(event.message || 'Window manager worker failed');
    controller.poisoned = true;
    failDesktopManagerWorkerSession(controller, error);
  };
  worker.onmessageerror = () => {
    controller.poisoned = true;
    failDesktopManagerWorkerSession(
      controller,
      new Error('Window manager worker message deserialization failed'),
    );
  };

  return controller;
};

const disposeDesktopManagerWorkerController = (): void => {
  desktopManagerWorkerController?.worker.terminate();
  desktopManagerWorkerController = undefined;
};

const isExpectedPreReadyManagerExitReason = (reason?: string): boolean =>
  reason === 'host-close-requested' || reason === 'manager-shutdown-requested';

const isExpectedPreReadyCloseError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.startsWith('Window closed before initialization completed');

const ensureDesktopManagerWorkerController = (): DesktopManagerWorkerController => {
  if (!desktopManagerWorkerController || desktopManagerWorkerController.poisoned) {
    disposeDesktopManagerWorkerController();
    desktopManagerWorkerController = createDesktopManagerWorkerController();
  }

  return desktopManagerWorkerController;
};

const assertDesktopInitialized = (): void => {
  if (!desktopInitialized) {
    throw new Error(
      '@goldlight/desktop main thread has not been initialized; call await initializeMain() before using desktop APIs',
    );
  }
};

export const initializeMain = async (): Promise<void> => {
  if (!initializePromise) {
    initializePromise = (async () => {
      await ensureDesktopWebGpuContext();
      ensureDesktopManagerWorkerController();
      desktopInitialized = true;
    })().catch((error) => {
      initializePromise = undefined;
      desktopInitialized = false;
      disposeDesktopManagerWorkerController();
      throw error;
    });
  }

  await initializePromise;
};

export const disposeMain = async (): Promise<void> => {
  if (!desktopInitialized && !initializePromise && !desktopManagerWorkerController) {
    return;
  }

  const controller = desktopManagerWorkerController;
  const session = controller?.session;
  if (session && !session.exited) {
    session.window.close();
    try {
      await session.window.whenClosed();
    } catch {
      // Let teardown continue even if window startup/runtime failed.
    }
  }

  disposeDesktopManagerWorkerController();
  desktopInitialized = false;
  initializePromise = undefined;
};

export const createDesktopApp = (
  options: DesktopWindowOptions & DesktopHostOptions,
): DesktopApp => {
  assertDesktopInitialized();
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

export const createWindow = (
  options: GoldlightWindowOptions,
): GoldlightWindow => {
  assertDesktopInitialized();
  const controller = ensureDesktopManagerWorkerController();
  if (controller.activeRunCount > 0 || controller.session) {
    throw new Error(
      'createWindow already has an active desktop module session; the desktop window manager worker is process-global',
    );
  }

  const postToManager = (message: DesktopWindowManagerInboundMessage): void => {
    controller.worker.postMessage(message);
  };
  const session = createGoldlightWindowSession(postToManager, options);
  controller.activeRunCount += 1;
  controller.session = session;

  session.closedPromise.finally(async () => {
    if (session.moduleWorker && !session.moduleShutdownComplete) {
      session.moduleWorker.postMessage(
        {
          kind: 'shutdown',
        } satisfies DesktopWorkerInboundMessage,
      );
      const shutdownDeadline = Date.now() + 250;
      while (!session.moduleShutdownComplete && Date.now() < shutdownDeadline) {
        await Promise.race([
          session.moduleShutdownPromise,
          new Promise((resolve) => setTimeout(resolve, 5)),
        ]);
      }
    }
    session.moduleWorker?.terminate();
    session.moduleWorker = undefined;
    if (!session.exited && !controller.poisoned) {
      postToManager({ kind: 'shutdown' });
      const shutdownDeadline = Date.now() + 250;
      while (!session.exited && Date.now() < shutdownDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    controller.session = undefined;
    controller.activeRunCount = Math.max(0, controller.activeRunCount - 1);
    if (controller.poisoned) {
      disposeDesktopManagerWorkerController();
    }
  });

  postToManager({
    kind: 'init',
    options,
  });

  return session.window;
};
