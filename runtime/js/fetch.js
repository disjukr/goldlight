const core = Deno.core;

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function encodeUtf8(value) {
  if (typeof core.encode === "function") {
    return core.encode(value);
  }
  return new TextEncoder().encode(value);
}

function decodeUtf8(bytes) {
  if (typeof core.decode === "function") {
    return core.decode(bytes);
  }
  return new TextDecoder().decode(bytes);
}

function normalizeURL(value) {
  return String(value);
}

function normalizeMethod(method) {
  const normalized = String(method).trim();
  if (!normalized || !HEADER_NAME_RE.test(normalized)) {
    throw new TypeError("Invalid HTTP method");
  }
  switch (normalized.toUpperCase()) {
    case "DELETE":
    case "GET":
    case "HEAD":
    case "OPTIONS":
    case "POST":
    case "PUT":
      return normalized.toUpperCase();
    default:
      return normalized;
  }
}

function normalizeHeaderName(name) {
  const normalized = String(name).trim().toLowerCase();
  if (!normalized || !HEADER_NAME_RE.test(normalized)) {
    throw new TypeError("Invalid header name");
  }
  return normalized;
}

function normalizeHeaderValue(value) {
  const normalized = String(value);
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(normalized)) {
    throw new TypeError("Invalid header value");
  }
  return normalized;
}

function normalizeHeaderEntries(init) {
  if (!init) {
    return [];
  }
  if (init instanceof Headers) {
    return [...init];
  }
  if (Array.isArray(init)) {
    return init.map(([name, value]) => [normalizeHeaderName(name), normalizeHeaderValue(value)]);
  }
  return Object.entries(init).map(([name, value]) => [
    normalizeHeaderName(name),
    normalizeHeaderValue(value),
  ]);
}

function inferContentType(body) {
  if (typeof body === "string") {
    return "text/plain;charset=UTF-8";
  }
  if (body instanceof Blob && body.type) {
    return body.type;
  }
  return null;
}

function normalizeBody(body) {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return Array.from(encodeUtf8(body));
  }
  if (body instanceof Blob) {
    return Array.from(body._bytes());
  }
  if (body instanceof Uint8Array) {
    return Array.from(body);
  }
  if (body instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  throw new TypeError("Unsupported request body");
}

function normalizeRequestBodyBytes(body) {
  if (body == null) {
    return undefined;
  }
  if (body instanceof ReadableStream) {
    return null;
  }
  return normalizeBody(body);
}

function cloneUint8Array(bytes) {
  return bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
}

function createBodyRecordFromReadableStream(stream, cancel = () => {}) {
  return {
    stream,
    cancel,
    consumed: false,
  };
}

function createBodyRecordFromBufferedSource(bytes) {
  const chunk = cloneUint8Array(bytes);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
  return createBodyRecordFromReadableStream(stream);
}

function extractBodyRecord(body) {
  if (body == null) {
    return null;
  }
  if (body instanceof ReadableStream) {
    return createBodyRecordFromReadableStream(body);
  }
  if (typeof body === "string") {
    return createBodyRecordFromBufferedSource(encodeUtf8(body));
  }
  if (body instanceof Blob) {
    return createBodyRecordFromBufferedSource(body._bytes());
  }
  if (body instanceof Uint8Array) {
    return createBodyRecordFromBufferedSource(body);
  }
  if (body instanceof ArrayBuffer) {
    return createBodyRecordFromBufferedSource(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return createBodyRecordFromBufferedSource(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  throw new TypeError("Unsupported body");
}

function cloneBodyRecord(bodyRecord) {
  if (!bodyRecord) {
    return null;
  }
  if (bodyRecord.consumed || bodyRecord.stream.locked) {
    throw new TypeError("Body is unusable");
  }
  const [left, right] = bodyRecord.stream.tee();
  bodyRecord.stream = left;
  return createBodyRecordFromReadableStream(right, bodyRecord.cancel);
}

async function consumeBodyRecord(bodyRecord) {
  if (!bodyRecord) {
    return new Uint8Array(0);
  }
  if (bodyRecord.consumed || bodyRecord.stream.locked) {
    throw new TypeError("Body is unusable");
  }
  bodyRecord.consumed = true;
  const reader = bodyRecord.stream.getReader();
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(cloneUint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  return globalThis.__goldlightConcatUint8Arrays(chunks);
}

function bodyUsed(bodyRecord) {
  return !!bodyRecord && (bodyRecord.consumed || bodyRecord.stream.locked);
}

class Headers {
  #entries = new Map();

  constructor(init = undefined) {
    for (const [name, value] of normalizeHeaderEntries(init)) {
      this.append(name, value);
    }
  }

  append(name, value) {
    const key = normalizeHeaderName(name);
    const normalizedValue = normalizeHeaderValue(value);
    const existing = this.#entries.get(key);
    this.#entries.set(key, existing ? `${existing}, ${normalizedValue}` : normalizedValue);
  }

  delete(name) {
    this.#entries.delete(normalizeHeaderName(name));
  }

  get(name) {
    return this.#entries.get(normalizeHeaderName(name)) ?? null;
  }

  has(name) {
    return this.#entries.has(normalizeHeaderName(name));
  }

  set(name, value) {
    this.#entries.set(normalizeHeaderName(name), normalizeHeaderValue(value));
  }

  *entries() {
    yield* this.#entries.entries();
  }

  *keys() {
    for (const [name] of this.#entries) {
      yield name;
    }
  }

  *values() {
    for (const [, value] of this.#entries) {
      yield value;
    }
  }

  forEach(callback, thisArg = undefined) {
    for (const [name, value] of this.#entries) {
      callback.call(thisArg, value, name, this);
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

class BodyMixin {
  async arrayBuffer() {
    const bytes = await consumeBodyRecord(this._bodyRecord);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  async text() {
    return decodeUtf8(await consumeBodyRecord(this._bodyRecord));
  }

  async json() {
    return JSON.parse(await this.text());
  }

  async blob() {
    return new Blob([await this.arrayBuffer()], {
      type: this.headers.get("content-type") ?? "",
    });
  }
}

class Request extends BodyMixin {
  constructor(input, init = {}) {
    super();
    const source = input instanceof Request ? input : null;
    const bodyInit = init.body !== undefined ? init.body : undefined;
    const effectiveBody = bodyInit !== undefined ? bodyInit : source?._originalBody ?? null;

    this.url = normalizeURL(source ? source.url : input);
    this.method = normalizeMethod(init.method ?? source?.method ?? "GET");
    this.headers = new Headers(init.headers ?? source?.headers);
    this.destination = "";
    this.referrer = init.referrer ?? source?.referrer ?? "about:client";
    this.referrerPolicy = init.referrerPolicy ?? source?.referrerPolicy ?? "";
    this.mode = init.mode ?? source?.mode ?? "cors";
    this.credentials = init.credentials ?? source?.credentials ?? "same-origin";
    this.cache = init.cache ?? source?.cache ?? "default";
    this.redirect = init.redirect ?? source?.redirect ?? "follow";
    this.integrity = init.integrity ?? source?.integrity ?? "";
    this.keepalive = init.keepalive ?? source?.keepalive ?? false;
    this.duplex = init.duplex ?? source?.duplex ?? (effectiveBody instanceof ReadableStream ? "half" : undefined);
    this.signal = init.signal ?? source?.signal ?? null;

    if ((this.method === "GET" || this.method === "HEAD") && effectiveBody != null) {
      throw new TypeError("Request with GET/HEAD method cannot have body");
    }
    if (effectiveBody instanceof ReadableStream && this.duplex !== "half") {
      throw new TypeError("Streaming request bodies require duplex: 'half'");
    }

    this._originalBody = effectiveBody;
    this._sendBodyBytes =
      bodyInit !== undefined
        ? normalizeRequestBodyBytes(bodyInit)
        : source
          ? source._sendBodyBytes === null
            ? null
            : source._sendBodyBytes !== undefined
              ? [...source._sendBodyBytes]
              : undefined
          : undefined;
    this._bodyRecord =
      bodyInit !== undefined
        ? extractBodyRecord(bodyInit)
        : source?._bodyRecord
          ? cloneBodyRecord(source._bodyRecord)
          : null;

    if (effectiveBody != null && !this.headers.has("content-type")) {
      const contentType = inferContentType(effectiveBody);
      if (contentType) {
        this.headers.set("content-type", contentType);
      }
    }
    if (this.credentials === "omit") {
      this.headers.delete("authorization");
      this.headers.delete("cookie");
      this.headers.delete("proxy-authorization");
    }
    if (this.referrer && this.referrer !== "about:client" && this.referrer !== "no-referrer") {
      this.headers.set("referer", this.referrer);
    } else {
      this.headers.delete("referer");
    }
  }

  get body() {
    return this._bodyRecord?.stream ?? null;
  }

  get bodyUsed() {
    return bodyUsed(this._bodyRecord);
  }

  clone() {
    return new Request(this);
  }
}

class Response extends BodyMixin {
  constructor(body = null, init = {}) {
    super();
    const status = init.status ?? 200;
    if ((status < 200 || status > 599) && status !== 0) {
      throw new RangeError("Invalid response status code");
    }
    if (NULL_BODY_STATUSES.has(status) && body != null) {
      throw new TypeError("Response status must not include a body");
    }
    this._bodyRecord = body instanceof ReadableStream ? extractBodyRecord(body) : body;
    this.type = init.type ?? "default";
    this.status = status;
    this.statusText = init.statusText ?? "";
    this.headers = new Headers(init.headers);
    this.url = init.url ?? "";
    this.redirected = init.redirected ?? false;
    this.ok = this.status >= 200 && this.status < 300;

    const originalBody = init.originalBody ?? null;
    if (body != null && !this.headers.has("content-type")) {
      const contentType = inferContentType(originalBody);
      if (contentType) {
        this.headers.set("content-type", contentType);
      }
    }
  }

  get body() {
    return this._bodyRecord?.stream ?? null;
  }

  get bodyUsed() {
    return bodyUsed(this._bodyRecord);
  }

  clone() {
    return new Response(cloneBodyRecord(this._bodyRecord), {
      type: this.type,
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      url: this.url,
      redirected: this.redirected,
    });
  }

  static error() {
    return new Response(null, {
      status: 0,
      type: "error",
    });
  }

  static redirect(url, status = 302) {
    if (!REDIRECT_STATUSES.has(status)) {
      throw new RangeError("Invalid redirect status code");
    }
    return new Response(null, {
      status,
      headers: {
        location: normalizeURL(url),
      },
    });
  }
}

const fetchRequests = new Map();

function completeFetchRequest(requestId) {
  fetchRequests.delete(requestId);
}

globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;

async function pumpRequestBody(requestId, stream, signal) {
  const reader = stream.getReader();
  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("The operation was aborted");
      }
      const { done, value } = await reader.read();
      if (done) {
        Deno.core.ops.op_goldlight_fetch_close_body(requestId);
        return;
      }
      const chunk = value instanceof Uint8Array
        ? value
        : new Uint8Array(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength ?? 0);
      Deno.core.ops.op_goldlight_fetch_write_chunk(requestId, chunk);
    }
  } catch (error) {
    Deno.core.ops.op_goldlight_fetch_abort(requestId);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

globalThis.fetch = function (input, init = {}) {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  if (request.signal?.aborted) {
    return Promise.reject(request.signal.reason ?? new Error("The operation was aborted"));
  }
  const hasStreamingBody = request._sendBodyBytes === null;

  const requestId = Deno.core.ops.op_goldlight_fetch_start({
    url: request.url,
    method: request.method,
    headers: [...request.headers],
    body: request._sendBodyBytes,
    streamingBody: hasStreamingBody,
    redirect: request.redirect,
    credentials: request.credentials,
    cache: request.cache,
    referrer: request.headers.get("referer"),
  });

  let settled = false;
  let resolveResponse;
  let rejectResponse;
  const responsePromise = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  let controller = null;
  const bodyRecord = createBodyRecordFromReadableStream(
    new ReadableStream({
      start(streamController) {
        controller = streamController;
      },
      cancel(reason) {
        Deno.core.ops.op_goldlight_fetch_abort(requestId);
        return Promise.resolve(reason);
      },
    }),
    () => {
      Deno.core.ops.op_goldlight_fetch_abort(requestId);
    },
  );

  const abortListener = () => {
    Deno.core.ops.op_goldlight_fetch_abort(requestId);
    const reason = request.signal?.reason ?? new Error("The operation was aborted");
    controller?.error(reason);
    if (!settled) {
      settled = true;
      rejectResponse(reason);
    }
    completeFetchRequest(requestId);
  };
  request.signal?.addEventListener("abort", abortListener);

  fetchRequests.set(requestId, {
    onResponse(payload) {
      if (settled) {
        return;
      }
      settled = true;
      resolveResponse(
        new Response(bodyRecord, {
          status: payload.status,
          statusText: payload.statusText,
          headers: payload.headers,
          url: payload.url,
          redirected: payload.url !== request.url,
        }),
      );
    },
    onChunk(payload) {
      controller?.enqueue(new Uint8Array(payload.chunk));
    },
    onDone() {
      controller?.close();
      request.signal?.removeEventListener("abort", abortListener);
      completeFetchRequest(requestId);
    },
    onError(payload) {
      const error = new Error(payload.message);
      controller?.error(error);
      if (!settled) {
        settled = true;
        rejectResponse(error);
      }
      request.signal?.removeEventListener("abort", abortListener);
      completeFetchRequest(requestId);
    },
    onAborted() {
      const error = request.signal?.reason ?? new Error("The operation was aborted");
      controller?.error(error);
      if (!settled) {
        settled = true;
        rejectResponse(error);
      }
      request.signal?.removeEventListener("abort", abortListener);
      completeFetchRequest(requestId);
    },
  });

  if (hasStreamingBody) {
    Promise.resolve()
      .then(() => pumpRequestBody(requestId, request.body, request.signal))
      .catch((error) => {
        if (!settled) {
          settled = true;
          rejectResponse(error);
        }
      });
  }

  return responsePromise;
};

globalThis.__goldlightPumpFetch = function () {
  const events = Deno.core.ops.op_goldlight_fetch_drain_events();
  for (const payload of events) {
    const request = fetchRequests.get(payload.requestId);
    if (!request) {
      continue;
    }
    switch (payload.type) {
      case "response":
        request.onResponse(payload);
        break;
      case "chunk":
        request.onChunk(payload);
        break;
      case "done":
        request.onDone(payload);
        break;
      case "error":
        request.onError(payload);
        break;
      case "aborted":
        request.onAborted(payload);
        break;
      default:
        break;
    }
  }
};
