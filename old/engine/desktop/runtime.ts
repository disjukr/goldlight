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
  timerHandle: ReturnType<typeof setTimeout> | null;
  lastTimeMs: number;
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
    timerHandle: null,
    lastTimeMs: 0,
  };
  let onMessage: MessageListener = null;

  const normalizeAnimationFrameTime = (timeMs: number): number => {
    const normalizedTimeMs = Math.max(timeMs, animationFrameState.lastTimeMs);
    animationFrameState.lastTimeMs = normalizedTimeMs;
    return normalizedTimeMs;
  };

  const getLocalAnimationFrameTime = (): number => normalizeAnimationFrameTime(performance.now());

  const scheduleLocalFrame = (): void => {
    if (animationFrameState.timerHandle !== null || animationFrameState.callbacks.size === 0) {
      return;
    }

    animationFrameState.timerHandle = setTimeout(() => {
      animationFrameState.timerHandle = null;
      flushAnimationFrameCallbacks(getLocalAnimationFrameTime());
    }, 16);
  };

  const requestAnimationFrame = (callback: DesktopAnimationFrameCallback): number => {
    const handle = animationFrameState.nextHandle;
    animationFrameState.nextHandle += 1;
    animationFrameState.callbacks.set(handle, callback);
    requestHostFrame();
    scheduleLocalFrame();
    return handle;
  };

  const cancelAnimationFrame = (handle: AnimationFrameHandle): void => {
    animationFrameState.callbacks.delete(handle);
    if (animationFrameState.callbacks.size === 0 && animationFrameState.timerHandle !== null) {
      clearTimeout(animationFrameState.timerHandle);
      animationFrameState.timerHandle = null;
    }
  };

  const flushAnimationFrameCallbacks = (timeMs: number): void => {
    if (animationFrameState.timerHandle !== null) {
      clearTimeout(animationFrameState.timerHandle);
      animationFrameState.timerHandle = null;
    }

    if (animationFrameState.callbacks.size === 0) {
      return;
    }

    const pendingCallbacks = [...animationFrameState.callbacks.entries()];
    animationFrameState.callbacks.clear();
    for (const [, callback] of pendingCallbacks) {
      callback(timeMs);
    }

    if (animationFrameState.callbacks.size > 0) {
      requestHostFrame();
      scheduleLocalFrame();
    }
  };

  const postMessage = (message: unknown): void => {
    queueMessageEvent(target, message, onMessage);
  };

  const dispatchHostEvent = (event: DesktopWindowEvent): void => {
    switch (event.kind) {
      case 'resized':
        dispatchTypedEvent(target, 'resize', {
          width: event.width,
          height: event.height,
        });
        return;
      case 'scale-factor-changed':
        dispatchTypedEvent(target, 'scalefactorchange', {
          scaleFactor: event.scaleFactor,
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
      case 'keyboard': {
        const keyboardDetail = {
          keyCode: event.keyCode,
          pressed: event.pressed,
        };
        dispatchTypedEvent(target, 'keyboard', keyboardDetail);
        dispatchTypedEvent(target, event.pressed ? 'keydown' : 'keyup', keyboardDetail);
        return;
      }
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
