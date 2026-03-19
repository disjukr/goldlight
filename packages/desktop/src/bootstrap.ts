import type { DesktopWindowRuntime } from './runtime.ts';

type DesktopGlobalRequestAnimationFrame = (callback: (timeMs: number) => void) => number;
type DesktopGlobalCancelAnimationFrame = (handle: number) => void;
type DesktopGlobalPostMessage = (...args: unknown[]) => void;

type GlobalWithDesktopHooks = typeof globalThis & {
  requestAnimationFrame?: DesktopGlobalRequestAnimationFrame;
  cancelAnimationFrame?: DesktopGlobalCancelAnimationFrame;
  postMessage?: DesktopGlobalPostMessage;
  onmessage?: ((event: MessageEvent<unknown>) => void) | null;
};

export type DesktopGlobalRestore = () => void;

type DesktopGlobalSnapshot = Readonly<{
  requestAnimationFrame: DesktopGlobalRequestAnimationFrame | undefined;
  cancelAnimationFrame: DesktopGlobalCancelAnimationFrame | undefined;
  postMessage: DesktopGlobalPostMessage | undefined;
  onmessage: ((event: MessageEvent<unknown>) => void) | null | undefined;
}>;

const getGlobalSnapshot = (): DesktopGlobalSnapshot => {
  const globals = globalThis as GlobalWithDesktopHooks;
  return {
    requestAnimationFrame: globals.requestAnimationFrame,
    cancelAnimationFrame: globals.cancelAnimationFrame,
    postMessage: globals.postMessage,
    onmessage: globals.onmessage,
  };
};

export const installDesktopWindowGlobals = (
  runtime: DesktopWindowRuntime,
): DesktopGlobalRestore => {
  const snapshot = getGlobalSnapshot();
  const globals = globalThis as GlobalWithDesktopHooks;

  globals.requestAnimationFrame = runtime.requestAnimationFrame;
  globals.cancelAnimationFrame = runtime.cancelAnimationFrame;
  globals.postMessage = ((message: unknown) => {
    runtime.postMessage(message);
  }) as DesktopGlobalPostMessage;

  Object.defineProperty(globals, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: () => runtime.getOnMessage(),
    set: (listener: ((event: MessageEvent<unknown>) => void) | null | undefined) => {
      runtime.setOnMessage(listener ?? null);
    },
  });

  return () => {
    globals.requestAnimationFrame = snapshot.requestAnimationFrame;
    globals.cancelAnimationFrame = snapshot.cancelAnimationFrame;
    globals.postMessage = snapshot.postMessage;
    Object.defineProperty(globals, 'onmessage', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: snapshot.onmessage,
    });
  };
};
