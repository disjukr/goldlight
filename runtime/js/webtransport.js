function normalizeWebTransportBytes(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Blob) {
    return data._bytes();
  }
  throw new TypeError("WebTransport payload must be BufferSource or Blob");
}

function resolveWebTransportUrl(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol !== "https:") {
    throw new TypeError("WebTransport URL must use https:");
  }
  return parsed.toString();
}

const GOLDLIGHT_WEBTRANSPORT_ERROR_MARKER = "\n[goldlight-webtransport-error]";

class WebTransportError extends DOMException {
  constructor(message = "", init = {}) {
    super(message, "WebTransportError");
    this.source = init.source ?? "stream";
    this.streamErrorCode = init.streamErrorCode ?? null;
  }
}

function toWebTransportError(error, source = "session", streamErrorCode = null) {
  if (error instanceof WebTransportError) {
    return error;
  }
  let message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const markerIndex = message.lastIndexOf(GOLDLIGHT_WEBTRANSPORT_ERROR_MARKER);
  if (markerIndex !== -1) {
    const payloadText = message.slice(
      markerIndex + GOLDLIGHT_WEBTRANSPORT_ERROR_MARKER.length,
    );
    const userMessage = message.slice(0, markerIndex);
    try {
      const payload = JSON.parse(payloadText);
      return new WebTransportError(payload.message ?? userMessage, {
        source: payload.source ?? source,
        streamErrorCode: payload.streamErrorCode ?? streamErrorCode,
      });
    } catch {
      message = userMessage;
    }
  }
  return new WebTransportError(message, { source, streamErrorCode });
}

class WebTransportSendGroup {
  getStats() {
    return Promise.resolve({
      bytesWritten: 0,
      bytesSent: 0,
      bytesAcknowledged: 0,
    });
  }
}

class WebTransportWriter extends WritableStreamDefaultWriter {
  async atomicWrite(chunk) {
    await this.write(chunk);
  }
}

class WebTransportSendStream extends WritableStream {
  #inner;
  #sendOrder = null;
  #sendGroup = undefined;

  constructor(inner) {
    super({
      write(chunk) {
        return inner.write(chunk);
      },
      close() {
        return inner.close();
      },
      abort(reason) {
        return inner.abort(reason);
      },
    });
    this.#inner = inner;
  }

  get sendOrder() {
    return this.#sendOrder;
  }

  set sendOrder(value) {
    this.#sendOrder = value == null ? null : Number(value);
  }

  get sendGroup() {
    return this.#sendGroup;
  }

  set sendGroup(value) {
    this.#sendGroup = value;
  }

  getStats() {
    return Promise.resolve({
      bytesWritten: 0,
      bytesSent: 0,
      bytesAcknowledged: 0,
    });
  }

  getWriter() {
    return new WebTransportWriter(this);
  }
}

class WebTransportReceiveStream extends ReadableStream {
  constructor(source) {
    super(source);
  }

  getStats() {
    return Promise.resolve({
      bytesReceived: 0,
      bytesRead: 0,
    });
  }
}

class WebTransportBidirectionalStream {
  constructor(readable, writable) {
    this.readable = readable;
    this.writable = writable;
  }
}

function createReceiveStream(receiveStreamId) {
  return new WebTransportReceiveStream({
    async pull(controller) {
      const chunk =
        await Deno.core.ops.op_goldlight_webtransport_receive_stream_read(
          receiveStreamId,
        ).catch((error) => {
          throw toWebTransportError(error, "stream");
        });
      if (chunk == null) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunk));
    },
    async cancel() {
      await Deno.core.ops.op_goldlight_webtransport_receive_stream_cancel(receiveStreamId).catch(
        (error) => {
          throw toWebTransportError(error, "stream");
        },
      );
    },
  });
}

function createSendStream(sendStreamId) {
  return new WebTransportSendStream({
    async write(chunk) {
      await Deno.core.ops.op_goldlight_webtransport_send_stream_write(
        sendStreamId,
        normalizeWebTransportBytes(chunk),
      ).catch((error) => {
        throw toWebTransportError(error, "stream");
      });
    },
    async close() {
      await Deno.core.ops.op_goldlight_webtransport_send_stream_close(sendStreamId).catch(
        (error) => {
          throw toWebTransportError(error, "stream");
        },
      );
    },
    async abort() {
      await Deno.core.ops.op_goldlight_webtransport_send_stream_close(sendStreamId).catch(
        (error) => {
          throw toWebTransportError(error, "stream");
        },
      );
    },
  });
}

function createBidirectionalStream(pair) {
  return new WebTransportBidirectionalStream(
    createReceiveStream(pair.receiveStreamId),
    createSendStream(pair.sendStreamId),
  );
}

class WebTransportDatagramDuplexStream {
  #transport;

  constructor(transport) {
    this.#transport = transport;
    this.incomingHighWaterMark = 1;
    this.incomingMaxAge = null;
    this.outgoingHighWaterMark = 1;
    this.outgoingMaxAge = null;
    this.readable = new WebTransportReceiveStream({
      pull: async (controller) => {
        await this.#transport.ready;
        const chunk = await Deno.core.ops.op_goldlight_webtransport_read_datagram(
          this.#transport._transportId(),
        ).catch((error) => {
          throw toWebTransportError(error, "session");
        });
        if (chunk == null) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    this.writable = new WebTransportSendStream({
      write: async (chunk) => {
        await this.#transport.ready;
        await Deno.core.ops.op_goldlight_webtransport_send_datagram(
          this.#transport._transportId(),
          normalizeWebTransportBytes(chunk),
        ).catch((error) => {
          throw toWebTransportError(error, "session");
        });
      },
      close: async () => {},
      abort: async () => {},
    });
  }

  get maxDatagramSize() {
    return this.#transport._maxDatagramSize();
  }
}

class WebTransport {
  #transportId = null;
  #maxDatagramSize = 0;
  #reliability = "pending";

  constructor(url, options = {}) {
    this.url = resolveWebTransportUrl(url);
    this.protocol = "h3";
    this.congestionControl = options.congestionControl ?? "default";
    this.anticipatedConcurrentIncomingBidirectionalStreams =
      options.anticipatedConcurrentIncomingBidirectionalStreams ?? null;
    this.anticipatedConcurrentIncomingUnidirectionalStreams =
      options.anticipatedConcurrentIncomingUnidirectionalStreams ?? null;
    this.datagrams = new WebTransportDatagramDuplexStream(this);
    this.incomingBidirectionalStreams = new ReadableStream({
      pull: async (controller) => {
        await this.ready;
        const pair =
          await Deno.core.ops.op_goldlight_webtransport_accept_bidirectional_stream(
            this.#transportId,
          ).catch((error) => {
            throw toWebTransportError(error, "stream");
          });
        if (pair == null) {
          controller.close();
          return;
        }
        controller.enqueue(createBidirectionalStream(pair));
      },
    });
    this.incomingUnidirectionalStreams = new ReadableStream({
      pull: async (controller) => {
        await this.ready;
        const receiveStreamId =
          await Deno.core.ops.op_goldlight_webtransport_accept_unidirectional_stream(
            this.#transportId,
          ).catch((error) => {
            throw toWebTransportError(error, "stream");
          });
        if (receiveStreamId == null) {
          controller.close();
          return;
        }
        controller.enqueue(createReceiveStream(receiveStreamId));
      },
    });

    const connectPromise = Deno.core.ops.op_goldlight_webtransport_connect(
      this.url,
      {
        serverCertificateHashes: options.serverCertificateHashes ?? [],
        congestionControl: options.congestionControl ?? null,
      },
    )
      .catch((error) => {
        throw toWebTransportError(error, "session");
      })
      .then((result) => {
        this.#transportId = result.transportId;
        this.#maxDatagramSize = result.maxDatagramSize;
        this.#reliability = "supports-unreliable";
        return result;
      });

    this.ready = connectPromise.then(() => {});
    this.closed = connectPromise.then(() =>
      Deno.core.ops.op_goldlight_webtransport_closed(this.#transportId).catch((error) => {
        throw toWebTransportError(error, "session");
      })
    );
    this.draining = connectPromise.then(() =>
      Deno.core.ops.op_goldlight_webtransport_draining(this.#transportId).catch((error) => {
        throw toWebTransportError(error, "session");
      })
    );
  }

  static get supportsReliableOnly() {
    return false;
  }

  get reliability() {
    return this.#reliability;
  }

  getStats() {
    return Promise.resolve({
      bytesSent: 0,
      packetsSent: 0,
      bytesLost: 0,
      packetsLost: 0,
      bytesReceived: 0,
      packetsReceived: 0,
      smoothedRtt: 0,
      rttVariation: 0,
      minRtt: 0,
      estimatedSendRate: null,
      atSendCapacity: false,
    });
  }

  _transportId() {
    if (this.#transportId == null) {
      throw new TypeError("WebTransport is not ready");
    }
    return this.#transportId;
  }

  _maxDatagramSize() {
    if (this.#transportId == null) {
      return this.#maxDatagramSize;
    }
    return Deno.core.ops.op_goldlight_webtransport_get_max_datagram_size(this.#transportId);
  }

  close(closeInfo = {}) {
    const closeCode = closeInfo.closeCode ?? 0;
    const reason = closeInfo.reason ?? "";
    const close = () => {
      if (this.#transportId != null) {
        Deno.core.ops.op_goldlight_webtransport_close(this.#transportId, closeCode, reason);
      }
    };
    if (this.#transportId == null) {
      this.ready.then(close, () => {});
    } else {
      close();
    }
  }

  async createBidirectionalStream(_options = {}) {
    await this.ready;
    const pair = await Deno.core.ops.op_goldlight_webtransport_create_bidirectional_stream(
      this.#transportId,
    ).catch((error) => {
      throw toWebTransportError(error, "stream");
    });
    return createBidirectionalStream(pair);
  }

  async createUnidirectionalStream(_options = {}) {
    await this.ready;
    const sendStreamId =
      await Deno.core.ops.op_goldlight_webtransport_create_unidirectional_stream(
        this.#transportId,
      ).catch((error) => {
        throw toWebTransportError(error, "stream");
      });
    return createSendStream(sendStreamId);
  }
}

globalThis.WebTransport = WebTransport;
globalThis.WebTransportBidirectionalStream = WebTransportBidirectionalStream;
globalThis.WebTransportDatagramDuplexStream = WebTransportDatagramDuplexStream;
globalThis.WebTransportError = WebTransportError;
globalThis.WebTransportSendStream = WebTransportSendStream;
globalThis.WebTransportReceiveStream = WebTransportReceiveStream;
globalThis.WebTransportSendGroup = WebTransportSendGroup;
globalThis.WebTransportWriter = WebTransportWriter;
