// @ts-nocheck
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

type PrefilterRequestMessage = Readonly<{
  type: 'prefilter';
  cacheId: string;
  image: Readonly<{
    id: string;
    mimeType: string;
    bytes: ArrayBuffer;
  }>;
}>;

type PrefilterResponseMessage =
  | Readonly<{
    type: 'prefiltered';
    cacheId: string;
    width: number;
    height: number;
    levels: readonly Readonly<{
      width: number;
      height: number;
      data: ArrayBuffer;
    }>[];
  }>
  | Readonly<{
    type: 'error';
    cacheId: string;
    error: string;
  }>;

const exrLoader = new EXRLoader();

const halfFloatScratchBuffer = new ArrayBuffer(4);
const halfFloatScratchView = new DataView(halfFloatScratchBuffer);

const decodeHalfFloat = (value: number): number => {
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  const sign = (value & 0x8000) << 16;

  if (exponent === 0) {
    if (fraction === 0) {
      halfFloatScratchView.setUint32(0, sign);
      return halfFloatScratchView.getFloat32(0);
    }

    let mantissa = fraction;
    let adjustedExponent = -14;
    while ((mantissa & 0x0400) === 0) {
      mantissa <<= 1;
      adjustedExponent -= 1;
    }
    mantissa &= 0x03ff;
    const bits = sign | (((adjustedExponent + 127) & 0xff) << 23) | (mantissa << 13);
    halfFloatScratchView.setUint32(0, bits);
    return halfFloatScratchView.getFloat32(0);
  }

  if (exponent === 0x1f) {
    const bits = sign | 0x7f800000 | (fraction << 13);
    halfFloatScratchView.setUint32(0, bits);
    return halfFloatScratchView.getFloat32(0);
  }

  const bits = sign | (((exponent - 15 + 127) & 0xff) << 23) | (fraction << 13);
  halfFloatScratchView.setUint32(0, bits);
  return halfFloatScratchView.getFloat32(0);
};

const encodeHalfFloat = (value: number): number => {
  const floatView = new Float32Array([value]);
  const intView = new Uint32Array(floatView.buffer);
  const x = intView[0] ?? 0;
  const sign = (x >> 16) & 0x8000;
  const mantissa = x & 0x007fffff;
  const exponent = (x >> 23) & 0xff;

  if (exponent === 0xff) {
    return sign | (mantissa !== 0 ? 0x7e00 : 0x7c00);
  }
  if (exponent > 142) {
    return sign | 0x7c00;
  }
  if (exponent < 113) {
    if (exponent < 103) {
      return sign;
    }
    const shiftedMantissa = mantissa | 0x00800000;
    const shift = 125 - exponent;
    const rounded = (shiftedMantissa >> shift) + ((shiftedMantissa >> (shift - 1)) & 1);
    return sign | rounded;
  }

  const halfExponent = exponent - 112;
  const halfMantissa = mantissa >> 13;
  const roundedMantissa = halfMantissa + ((mantissa >> 12) & 1);
  return sign | (halfExponent << 10) | (roundedMantissa & 0x03ff);
};

const normalizeEnvironmentVector = (
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] => {
  const length = Math.sqrt((x * x) + (y * y) + (z * z));
  if (length <= 1e-8) {
    return [0, 0, 1];
  }
  return [x / length, y / length, z / length];
};

const dotEnvironment = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number => (left[0] * right[0]) + (left[1] * right[1]) + (left[2] * right[2]);

const reflectEnvironment = (
  vector: readonly [number, number, number],
  normal: readonly [number, number, number],
): readonly [number, number, number] => {
  const scale = 2 * dotEnvironment(normal, vector);
  return normalizeEnvironmentVector(
    (scale * normal[0]) - vector[0],
    (scale * normal[1]) - vector[1],
    (scale * normal[2]) - vector[2],
  );
};

const buildEnvironmentBasis = (
  x: number,
  y: number,
  z: number,
): Readonly<{
  tangent: readonly [number, number, number];
  bitangent: readonly [number, number, number];
  normal: readonly [number, number, number];
}> => {
  const normal = normalizeEnvironmentVector(x, y, z);
  const up = Math.abs(normal[1]) > 0.999 ? [1, 0, 0] as const : [0, 1, 0] as const;
  const tangent = normalizeEnvironmentVector(
    (up[1] * normal[2]) - (up[2] * normal[1]),
    (up[2] * normal[0]) - (up[0] * normal[2]),
    (up[0] * normal[1]) - (up[1] * normal[0]),
  );
  const bitangent = normalizeEnvironmentVector(
    (normal[1] * tangent[2]) - (normal[2] * tangent[1]),
    (normal[2] * tangent[0]) - (normal[0] * tangent[2]),
    (normal[0] * tangent[1]) - (normal[1] * tangent[0]),
  );
  return { tangent, bitangent, normal };
};

const hammersley = (index: number, sampleCount: number): readonly [number, number] => {
  let bits = index;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return [index / sampleCount, bits * 2.3283064365386963e-10];
};

const importanceSampleGgxVndf = (
  xi: readonly [number, number],
  roughness: number,
  normal: readonly [number, number, number],
): readonly [number, number, number] => {
  const alpha = roughness * roughness;
  const r = Math.sqrt(xi[0]);
  const phi = 2 * Math.PI * xi[1];
  const t1 = r * Math.cos(phi);
  const t2 = r * Math.sin(phi);
  const nhZ = Math.sqrt(Math.max(0, 1 - (t1 * t1) - (t2 * t2)));
  const halfVectorTangent = normalizeEnvironmentVector(alpha * t1, alpha * t2, Math.max(0, nhZ));
  const basis = buildEnvironmentBasis(normal[0], normal[1], normal[2]);
  return normalizeEnvironmentVector(
    (basis.tangent[0] * halfVectorTangent[0]) +
      (basis.bitangent[0] * halfVectorTangent[1]) +
      (basis.normal[0] * halfVectorTangent[2]),
    (basis.tangent[1] * halfVectorTangent[0]) +
      (basis.bitangent[1] * halfVectorTangent[1]) +
      (basis.normal[1] * halfVectorTangent[2]),
    (basis.tangent[2] * halfVectorTangent[0]) +
      (basis.bitangent[2] * halfVectorTangent[1]) +
      (basis.normal[2] * halfVectorTangent[2]),
  );
};

const createFloatEnvironmentData = (decoded: Uint16Array): Float32Array => {
  const floatData = new Float32Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    floatData[index] = decodeHalfFloat(decoded[index] ?? 0);
  }
  return floatData;
};

const wrap01 = (value: number): number => value - Math.floor(value);

const sampleEnvironmentBilinear = (
  width: number,
  height: number,
  data: Float32Array,
  direction: readonly [number, number, number],
): readonly [number, number, number] => {
  const unitDirection = normalizeEnvironmentVector(direction[0], direction[1], direction[2]);
  const longitude = Math.atan2(unitDirection[2], unitDirection[0]);
  const latitude = Math.asin(Math.max(-1, Math.min(1, unitDirection[1])));
  const u = wrap01((longitude / (2 * Math.PI)) + 0.5);
  const v = Math.max(0, Math.min(1, 0.5 + (latitude / Math.PI)));
  const x = u * width - 0.5;
  const y = v * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const samplePixel = (sampleX: number, sampleY: number): readonly [number, number, number] => {
    const wrappedX = ((sampleX % width) + width) % width;
    const clampedY = Math.max(0, Math.min(height - 1, sampleY));
    const offset = ((clampedY * width) + wrappedX) * 4;
    return [
      data[offset] ?? 0,
      data[offset + 1] ?? 0,
      data[offset + 2] ?? 0,
    ];
  };
  const c00 = samplePixel(x0, y0);
  const c10 = samplePixel(x1, y0);
  const c01 = samplePixel(x0, y1);
  const c11 = samplePixel(x1, y1);
  return [
    (((c00[0] * (1 - tx)) + (c10[0] * tx)) * (1 - ty)) +
    (((c01[0] * (1 - tx)) + (c11[0] * tx)) * ty),
    (((c00[1] * (1 - tx)) + (c10[1] * tx)) * (1 - ty)) +
    (((c01[1] * (1 - tx)) + (c11[1] * tx)) * ty),
    (((c00[2] * (1 - tx)) + (c10[2] * tx)) * (1 - ty)) +
    (((c01[2] * (1 - tx)) + (c11[2] * tx)) * ty),
  ];
};

const environmentPrefilterRoughnessForMip = (
  mipLevel: number,
  maxMipLevel: number,
): number => {
  if (maxMipLevel <= 0) {
    return 0;
  }
  const normalizedLod = Math.max(0, Math.min(1, mipLevel / maxMipLevel));
  return normalizedLod * normalizedLod;
};

const createPrefilteredEnvironmentMipChain = (
  width: number,
  height: number,
  data: Uint16Array,
): readonly Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}>[] => {
  const source = createFloatEnvironmentData(data);
  const levels: Array<Readonly<{ width: number; height: number; data: Uint16Array }>> = [{
    width,
    height,
    data,
  }];
  const maxMipLevel = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const maxPrefilterMip = Math.max(maxMipLevel - 1, 1);

  for (let mipLevel = 1; mipLevel < maxMipLevel; mipLevel += 1) {
    const levelWidth = Math.max(1, width >> mipLevel);
    const levelHeight = Math.max(1, height >> mipLevel);
    const levelData = new Uint16Array(levelWidth * levelHeight * 4);
    const roughness = environmentPrefilterRoughnessForMip(mipLevel, maxPrefilterMip);
    const sampleCount = Math.max(16, 64 - (mipLevel * 4));

    for (let y = 0; y < levelHeight; y += 1) {
      for (let x = 0; x < levelWidth; x += 1) {
        const u = (x + 0.5) / levelWidth;
        const v = (y + 0.5) / levelHeight;
        const longitude = (u - 0.5) * 2 * Math.PI;
        const latitude = (v - 0.5) * Math.PI;
        const normal = normalizeEnvironmentVector(
          Math.cos(latitude) * Math.cos(longitude),
          Math.sin(latitude),
          Math.cos(latitude) * Math.sin(longitude),
        );
        const view = normal;
        const offset = ((y * levelWidth) + x) * 4;
        if (roughness < 0.001) {
          const sample = sampleEnvironmentBilinear(width, height, source, normal);
          levelData[offset] = encodeHalfFloat(sample[0]);
          levelData[offset + 1] = encodeHalfFloat(sample[1]);
          levelData[offset + 2] = encodeHalfFloat(sample[2]);
          levelData[offset + 3] = encodeHalfFloat(1);
          continue;
        }
        let red = 0;
        let green = 0;
        let blue = 0;
        let weight = 0;

        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
          const halfVector = importanceSampleGgxVndf(
            hammersley(sampleIndex, sampleCount),
            roughness,
            normal,
          );
          const light = reflectEnvironment(view, halfVector);
          const nDotL = Math.max(dotEnvironment(normal, light), 0);
          if (nDotL <= 1e-4) {
            continue;
          }
          const sample = sampleEnvironmentBilinear(width, height, source, light);
          red += sample[0] * nDotL;
          green += sample[1] * nDotL;
          blue += sample[2] * nDotL;
          weight += nDotL;
        }

        levelData[offset] = encodeHalfFloat(red / Math.max(weight, 1e-4));
        levelData[offset + 1] = encodeHalfFloat(green / Math.max(weight, 1e-4));
        levelData[offset + 2] = encodeHalfFloat(blue / Math.max(weight, 1e-4));
        levelData[offset + 3] = encodeHalfFloat(1);
      }
    }

    levels.push({
      width: levelWidth,
      height: levelHeight,
      data: levelData,
    });
  }

  return levels;
};

const decodeEnvironmentImageAsset = (
  image: Readonly<{
    id: string;
    mimeType: string;
    bytes: ArrayBuffer;
  }>,
): Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}> => {
  if (
    image.mimeType !== 'image/exr' &&
    image.mimeType !== 'image/x-exr' &&
    image.mimeType !== 'application/x-exr'
  ) {
    throw new Error(`environment map "${image.id}" must be EXR, received "${image.mimeType}"`);
  }

  const parsed = exrLoader.parse(image.bytes) as {
    width: number;
    height: number;
    data: Uint16Array;
  };

  return {
    width: parsed.width,
    height: parsed.height,
    data: parsed.data,
  };
};

self.onmessage = (event: MessageEvent<PrefilterRequestMessage>) => {
  const message = event.data;
  if (message?.type !== 'prefilter') {
    return;
  }

  try {
    const decoded = decodeEnvironmentImageAsset(message.image);
    const levels = createPrefilteredEnvironmentMipChain(
      decoded.width,
      decoded.height,
      decoded.data,
    );
    const response: PrefilterResponseMessage = {
      type: 'prefiltered',
      cacheId: message.cacheId,
      width: decoded.width,
      height: decoded.height,
      levels: levels.map((level) => ({
        width: level.width,
        height: level.height,
        data: level.data.buffer.slice(
          level.data.byteOffset,
          level.data.byteOffset + level.data.byteLength,
        ),
      })),
    };
    const transfers = response.levels.map((level) => level.data);
    self.postMessage(response, transfers);
  } catch (error) {
    const response: PrefilterResponseMessage = {
      type: 'error',
      cacheId: message.cacheId,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};


