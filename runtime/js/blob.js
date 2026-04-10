const blobCore = Deno.core;

function blobEncodeUtf8(value) {
  if (typeof blobCore.encode === "function") {
    return blobCore.encode(value);
  }
  return new TextEncoder().encode(value);
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

globalThis.__goldlightConcatUint8Arrays = concatUint8Arrays;

class Blob {
  #bytes;

  constructor(parts = [], options = {}) {
    const chunks = parts.map((part) => {
      if (part instanceof Blob) {
        return part._bytes();
      }
      if (typeof part === "string") {
        return blobEncodeUtf8(part);
      }
      if (part instanceof Uint8Array) {
        return part;
      }
      if (part instanceof ArrayBuffer) {
        return new Uint8Array(part);
      }
      if (ArrayBuffer.isView(part)) {
        return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      }
      throw new TypeError("Unsupported Blob part");
    });
    this.#bytes = concatUint8Arrays(chunks);
    this.size = this.#bytes.length;
    this.type = options.type ? String(options.type).toLowerCase() : "";
  }

  _bytes() {
    return this.#bytes.slice();
  }

  async arrayBuffer() {
    return this.#bytes.slice().buffer;
  }

  async text() {
    if (typeof blobCore.decode === "function") {
      return blobCore.decode(this.#bytes);
    }
    return new TextDecoder().decode(this.#bytes);
  }
}

globalThis.Blob = Blob;
