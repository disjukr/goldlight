function normalizeWindowOptions(options = {}) {
  const {
    title = "untitled",
    width = 640,
    height = 480,
    workerEntrypoint = undefined,
  } = options;

  return { title, width, height, workerEntrypoint };
}

export function createWindow(options = {}) {
  return Deno.core.ops.op_goldlight_create_window(normalizeWindowOptions(options));
}

const windowEventListeners = new Map();
let animationFrameCallbacks = [];
let nextAnimationFrameHandle = 1;

export function requestAnimationFrame(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("requestAnimationFrame expects a function");
  }

  const handle = nextAnimationFrameHandle++;
  animationFrameCallbacks.push({ handle, callback });
  Deno.core.ops.op_goldlight_worker_request_animation_frame();
  return handle;
}

export function addWindowEventListener(type, listener) {
  if (typeof listener !== "function") {
    throw new TypeError("addWindowEventListener expects a function");
  }

  const listeners = windowEventListeners.get(type) ?? [];
  listeners.push(listener);
  windowEventListeners.set(type, listeners);
}

function dispatchWindowEvent(event) {
  if (event.type === "animationFrame") {
    const callbacks = animationFrameCallbacks;
    animationFrameCallbacks = [];
    for (const { callback } of callbacks) {
      callback(event.timestampMs);
    }
  }

  const listeners = windowEventListeners.get(event.type) ?? [];
  for (const listener of listeners) {
    listener(event);
  }
}

globalThis.__goldlightPump = function () {
  const events = Deno.core.ops.op_goldlight_worker_drain_events();
  for (const event of events) {
    dispatchWindowEvent(event);
  }
};
