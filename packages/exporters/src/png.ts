export type RgbaSnapshot = Readonly<{
  width: number;
  height: number;
  bytes: Uint8Array;
}>;

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const chunkTypeLength = 4;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const writeUint32 = (target: Uint8Array, offset: number, value: number): void => {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const createChunk = (type: string, data: Uint8Array): Uint8Array => {
  const chunk = new Uint8Array(4 + chunkTypeLength + data.length + 4);
  const typeBytes = new TextEncoder().encode(type);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(chunk.slice(4, 8 + data.length)));
  return chunk;
};

const createRawScanlines = (snapshot: RgbaSnapshot): Uint8Array => {
  const stride = snapshot.width * 4;
  const expectedLength = stride * snapshot.height;
  if (snapshot.bytes.length !== expectedLength) {
    throw new Error(
      `snapshot byte length ${snapshot.bytes.length} does not match ${expectedLength}`,
    );
  }

  const raw = new Uint8Array(snapshot.height * (stride + 1));
  for (let row = 0; row < snapshot.height; row += 1) {
    const sourceStart = row * stride;
    const targetStart = row * (stride + 1);
    raw[targetStart] = 0;
    raw.set(snapshot.bytes.slice(sourceStart, sourceStart + stride), targetStart + 1);
  }
  return raw;
};

const encodeStoredDeflate = (raw: Uint8Array): Uint8Array => {
  const maxBlockLength = 65_535;
  const chunks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];

  for (let offset = 0; offset < raw.length; offset += maxBlockLength) {
    const isFinal = offset + maxBlockLength >= raw.length;
    const block = raw.slice(offset, Math.min(offset + maxBlockLength, raw.length));
    const header = new Uint8Array(5);
    header[0] = isFinal ? 0x01 : 0x00;
    header[1] = block.length & 0xff;
    header[2] = (block.length >>> 8) & 0xff;
    const invertedLength = (~block.length) & 0xffff;
    header[3] = invertedLength & 0xff;
    header[4] = (invertedLength >>> 8) & 0xff;
    chunks.push(header, block);
  }

  const checksum = new Uint8Array(4);
  writeUint32(checksum, 0, adler32(raw));
  chunks.push(checksum);

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  return compressed;
};

export const encodePngRgba = (snapshot: RgbaSnapshot): Uint8Array => {
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, snapshot.width);
  writeUint32(ihdr, 4, snapshot.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = createRawScanlines(snapshot);
  const idat = encodeStoredDeflate(raw);
  const chunks = [
    pngSignature,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', idat),
    createChunk('IEND', new Uint8Array()),
  ];

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const png = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
};
