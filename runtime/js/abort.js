function createAbortEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (typeof listener !== "function") {
        return;
      }
      let bucket = listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        listeners.set(type, bucket);
      }
      bucket.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event) {
      const bucket = listeners.get(type);
      if (!bucket) {
        return;
      }
      for (const listener of bucket) {
        listener.call(undefined, event);
      }
    },
  };
}

class AbortSignalImpl {
  #target = createAbortEventTarget();

  constructor() {
    this.aborted = false;
    this.reason = undefined;
    this.onabort = null;
  }

  addEventListener(type, listener) {
    this.#target.addEventListener(type, listener);
  }

  removeEventListener(type, listener) {
    this.#target.removeEventListener(type, listener);
  }

  _abort(reason = new Error("The operation was aborted")) {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.reason = reason;
    const event = { type: "abort", target: this };
    if (typeof this.onabort === "function") {
      this.onabort.call(this, event);
    }
    this.#target.dispatch("abort", event);
  }
}

class AbortController {
  constructor() {
    this.signal = new AbortSignalImpl();
  }

  abort(reason = new Error("The operation was aborted")) {
    this.signal._abort(reason);
  }
}

const AbortSignal = AbortSignalImpl;

globalThis.AbortController = AbortController;
globalThis.AbortSignal = AbortSignal;
