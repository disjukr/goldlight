function createEventTarget() {
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
    dispatchEvent(type, event) {
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

const websocketRegistry = new Map();
const HTTP_TOKEN_CODE_POINT_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isValidOutgoingCloseCode(code) {
  return code === 1000 || (code >= 3000 && code <= 4999);
}

function normalizeProtocols(protocols) {
  const list =
    protocols == null ? [] : Array.isArray(protocols) ? protocols.map(String) : [String(protocols)];
  const seen = new Set();
  for (const protocol of list) {
    const normalized = protocol.toLowerCase();
    if (!HTTP_TOKEN_CODE_POINT_RE.test(protocol)) {
      throw new SyntaxError("Invalid protocol value");
    }
    if (seen.has(normalized)) {
      throw new SyntaxError("Cannot supply the same protocol multiple times");
    }
    seen.add(normalized);
  }
  return list;
}

function normalizeWebSocketURL(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  } else if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new SyntaxError(`Only ws & wss schemes are allowed in a WebSocket URL: received ${parsed.protocol}`);
  }
  if (parsed.hash) {
    throw new SyntaxError("Fragments are not allowed in a WebSocket URL");
  }
  return parsed.toString();
}

function toCloseEventPayload(payload) {
  return {
    type: "close",
    code: payload.code ?? 1000,
    reason: payload.reason ?? "",
    wasClean: payload.wasClean ?? true,
  };
}

function toMessageEventPayload(payload, socket) {
  if (payload.dataText !== undefined) {
    return {
      type: "message",
      data: payload.dataText,
    };
  }
  const bytes = new Uint8Array(payload.dataBinary ?? []);
  return {
    type: "message",
    data: socket.binaryType === "blob" ? new Blob([bytes]) : bytes.buffer.slice(0),
  };
}

class WebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;

  #id;
  #events = createEventTarget();

  constructor(url, protocols = undefined) {
    const protocolList = normalizeProtocols(protocols);
    this.url = normalizeWebSocketURL(url);
    this.readyState = WebSocket.CONNECTING;
    this.protocol = "";
    this.extensions = "";
    this.binaryType = "blob";
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;

    this.#id = Deno.core.ops.op_goldlight_websocket_create(this.url, protocolList);
    websocketRegistry.set(this.#id, this);
  }

  get binaryType() {
    return this._binaryType ?? "blob";
  }

  set binaryType(value) {
    if (value !== "blob" && value !== "arraybuffer") {
      throw new TypeError("Failed to set 'binaryType' on 'WebSocket'");
    }
    this._binaryType = value;
  }

  get bufferedAmount() {
    if (this.readyState !== WebSocket.OPEN) {
      return 0;
    }
    return Deno.core.ops.op_goldlight_websocket_get_buffered_amount(this.#id);
  }

  addEventListener(type, listener) {
    this.#events.addEventListener(type, listener);
  }

  removeEventListener(type, listener) {
    this.#events.removeEventListener(type, listener);
  }

  send(data) {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    if (typeof data === "string") {
      Deno.core.ops.op_goldlight_websocket_send_text(this.#id, data);
      return;
    }
    if (data instanceof Blob) {
      const bytes = data._bytes();
      Deno.core.ops.op_goldlight_websocket_send_binary(this.#id, bytes);
      return;
    }
    if (data instanceof ArrayBuffer) {
      Deno.core.ops.op_goldlight_websocket_send_binary(this.#id, new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      Deno.core.ops.op_goldlight_websocket_send_binary(
        this.#id,
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
      return;
    }
    throw new TypeError("Unsupported WebSocket send payload");
  }

  close(code = undefined, reason = undefined) {
    if (this.readyState >= WebSocket.CLOSING) {
      return;
    }
    if (code !== undefined && !isValidOutgoingCloseCode(code)) {
      throw new RangeError("The close code must be 1000 or between 3000 and 4999");
    }
    if (reason !== undefined && utf8ByteLength(reason) > 123) {
      throw new SyntaxError("The close reason must be at most 123 bytes");
    }
    this.readyState = WebSocket.CLOSING;
    Deno.core.ops.op_goldlight_websocket_close(this.#id, code ?? null, reason ?? null);
  }

  _emit(type, event) {
    const handler = this[`on${type}`];
    if (typeof handler === "function") {
      handler.call(this, event);
    }
    this.#events.dispatchEvent(type, event);
  }

  _handleEvent(payload) {
    switch (payload.type) {
      case "open":
        this.readyState = WebSocket.OPEN;
        this.protocol = payload.protocol ?? "";
        this.extensions = payload.extensions ?? "";
        this._emit("open", { type: "open" });
        break;
      case "message":
        this._emit("message", toMessageEventPayload(payload, this));
        break;
      case "error":
        this._emit("error", {
          type: "error",
          message: payload.message ?? "WebSocket error",
        });
        break;
      case "close":
        this.readyState = WebSocket.CLOSED;
        websocketRegistry.delete(this.#id);
        this._emit("close", toCloseEventPayload(payload));
        break;
      default:
        break;
    }
  }
}

globalThis.WebSocket = WebSocket;

globalThis.__goldlightPumpWebSockets = function () {
  const events = Deno.core.ops.op_goldlight_websocket_drain_events();
  for (const payload of events) {
    websocketRegistry.get(payload.socketId)?._handleEvent(payload);
  }
};
