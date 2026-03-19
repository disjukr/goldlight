import type { DesktopWindowEvent } from './types.ts';

type AnimationFrameHandle = number;
type MessageListener = ((event: MessageEvent<unknown>) => void) | null;
export type DesktopAnimationFrameCallback = (timeMs: number) => void;

export type DesktopWindowRuntime = Readonly<{
  windowId: bigint;
  requestAnimationFrame: (callback: DesktopAnimationFrameCallback) => number;
  cancelAnimationFrame: (handle: AnimationFrameHandle) => void;
  flushAnimationFrameCallbacks: (timeMs: number) => void;
  hasPendingAnimationFrameCallbacks: () => boolean;
  postMessage: (message: unknown) => void;
  dispatchHostEvent: (event: DesktopWindowEvent) => void;
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
  dispatchEvent: EventTarget['dispatchEvent'];
  getOnMessage: () => MessageListener;
  setOnMessage: (listener: MessageListener) => void;
}>;

type MutableAnimationFrameState = {
  nextHandle: number;
  callbacks: Map<number, DesktopAnimationFrameCallback>;
};

const queueMessageEvent = (
  target: EventTarget,
  message: unknown,
  onMessage: MessageListener,
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

const dispatchTypedEvent = (
  target: EventTarget,
  type: string,
  detail?: unknown,
): void => {
  target.dispatchEvent(detail === undefined ? new Event(type) : new CustomEvent(type, { detail }));
};

export const createDesktopWindowRuntime = (
  windowId: bigint,
  requestHostFrame: () => void,
): DesktopWindowRuntime => {
  const target = new EventTarget();
  const animationFrameState: MutableAnimationFrameState = {
    nextHandle: 1,
    callbacks: new Map(),
  };
  let onMessage: MessageListener = null;
  let hostFrameRequested = false;

  const requestAnimationFrame = (callback: DesktopAnimationFrameCallback): number => {
    const handle = animationFrameState.nextHandle;
    animationFrameState.nextHandle += 1;
    const shouldRequestHostFrame = !hostFrameRequested;
    animationFrameState.callbacks.set(handle, callback);
    if (shouldRequestHostFrame) {
      hostFrameRequested = true;
      requestHostFrame();
    }
    return handle;
  };

  const cancelAnimationFrame = (handle: AnimationFrameHandle): void => {
    animationFrameState.callbacks.delete(handle);
  };

  const flushAnimationFrameCallbacks = (timeMs: number): void => {
    hostFrameRequested = false;
    if (animationFrameState.callbacks.size === 0) {
      return;
    }

    const pendingCallbacks = [...animationFrameState.callbacks.entries()];
    animationFrameState.callbacks.clear();
    for (const [, callback] of pendingCallbacks) {
      callback(timeMs);
    }

    if (animationFrameState.callbacks.size > 0 && !hostFrameRequested) {
      hostFrameRequested = true;
      requestHostFrame();
    }
  };

  const postMessage = (message: unknown): void => {
    queueMessageEvent(target, message, onMessage);
  };

  const dispatchHostEvent = (event: DesktopWindowEvent): void => {
    switch (event.kind) {
      case 'frame':
        flushAnimationFrameCallbacks(event.timeMs);
        return;
      case 'resized':
        dispatchTypedEvent(target, 'resize', {
          width: event.width,
          height: event.height,
        });
        return;
      case 'close-requested':
        dispatchTypedEvent(target, 'close');
        return;
      case 'focus-changed':
        dispatchTypedEvent(target, 'focuschange', {
          focused: event.focused,
        });
        return;
      case 'pointer-moved':
        dispatchTypedEvent(target, 'pointermove', {
          x: event.x,
          y: event.y,
        });
        return;
      case 'pointer-button':
        dispatchTypedEvent(target, 'pointerbutton', {
          button: event.button,
          pressed: event.pressed,
        });
        return;
      case 'keyboard':
        dispatchTypedEvent(target, 'keyboard', {
          keyCode: event.keyCode,
          pressed: event.pressed,
        });
        return;
      case 'message':
        dispatchTypedEvent(target, 'desktopmessage', {
          messageKind: event.messageKind,
          messageData: event.messageData,
        });
        return;
    }
  };

  return {
    windowId,
    requestAnimationFrame,
    cancelAnimationFrame,
    flushAnimationFrameCallbacks,
    hasPendingAnimationFrameCallbacks: () => animationFrameState.callbacks.size > 0,
    postMessage,
    dispatchHostEvent,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    getOnMessage: () => onMessage,
    setOnMessage: (listener) => {
      onMessage = listener;
    },
  };
};
