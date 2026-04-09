const timerCallbacks = new Map();

function normalizeDelay(delay) {
  const numericDelay = Number(delay);
  if (!Number.isFinite(numericDelay) || numericDelay < 0) {
    return 0;
  }
  return numericDelay;
}

function ensureTimerCallback(callback, name) {
  if (typeof callback !== "function") {
    throw new TypeError(`${name} expects a function`);
  }
}

function scheduleTimer(callback, delay, repeat, args) {
  ensureTimerCallback(callback, repeat ? "setInterval" : "setTimeout");
  const timerId = Deno.core.ops.op_goldlight_timer_schedule(normalizeDelay(delay), repeat);
  timerCallbacks.set(timerId, {
    callback,
    args,
    repeat,
  });
  return timerId;
}

globalThis.setTimeout = function (callback, delay = 0, ...args) {
  return scheduleTimer(callback, delay, false, args);
};

globalThis.setInterval = function (callback, delay = 0, ...args) {
  return scheduleTimer(callback, delay, true, args);
};

globalThis.clearTimeout = function (timerId) {
  Deno.core.ops.op_goldlight_timer_cancel(timerId >>> 0);
  timerCallbacks.delete(timerId >>> 0);
};

globalThis.clearInterval = globalThis.clearTimeout;

globalThis.__goldlightPumpTimers = function () {
  const readyTimerIds = Deno.core.ops.op_goldlight_timer_drain_ready();
  for (const timerId of readyTimerIds) {
    const entry = timerCallbacks.get(timerId);
    if (!entry) {
      continue;
    }
    if (!entry.repeat) {
      timerCallbacks.delete(timerId);
    }
    entry.callback(...entry.args);
  }
};
