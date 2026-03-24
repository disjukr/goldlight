import {
  sampleDomainWarpedFbm2d,
  sampleFbm2d,
  samplePerlinNoise2d,
  sampleWorleyNoise2d,
} from '@goldlight/math';

export type ColorRgba = readonly [number, number, number, number];

export type ProceduralTexture2d = Readonly<{
  width: number;
  height: number;
  channels: 4;
  data: Uint8Array;
}>;

export type CheckerboardTextureOptions = Readonly<{
  width: number;
  height: number;
  cellWidth?: number;
  cellHeight?: number;
  colorA?: ColorRgba;
  colorB?: ColorRgba;
}>;

export type GradientTextureOptions = Readonly<{
  width: number;
  height: number;
  startColor: ColorRgba;
  endColor: ColorRgba;
  axis?: 'x' | 'y' | 'diagonal';
}>;

export type NoiseTextureOptions = Readonly<{
  width: number;
  height: number;
  seed?: number;
  frequency?: number;
  octaves?: number;
}>;

export type WorleyTextureOptions = NoiseTextureOptions;
export type PerlinTextureOptions = NoiseTextureOptions;

export type ColorNoiseTextureOptions = Readonly<{
  width: number;
  height: number;
  seed?: number;
  frequency?: number;
  octaves?: number;
  warpAmplitude?: number;
  lowColor?: ColorRgba;
  highColor?: ColorRgba;
}>;

const defaultColorA: ColorRgba = [32, 32, 32, 255];
const defaultColorB: ColorRgba = [224, 224, 224, 255];

const assertDimension = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`"${name}" must be a positive integer`);
  }

  return value;
};

const assertFiniteNumber = (name: string, value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`"${name}" must be a finite number`);
  }

  return value;
};

const createTextureData = (width: number, height: number): Uint8Array =>
  new Uint8Array(width * height * 4);

const sampleTextureAxisCenter = (index: number, size: number, frequency: number): number => {
  if (size === 1) {
    return 0.5 * frequency;
  }

  return ((index + 0.5) / size) * frequency;
};

const writePixel = (data: Uint8Array, offset: number, color: ColorRgba): void => {
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = color[3];
};

const lerpColor = (a: ColorRgba, b: ColorRgba, t: number): ColorRgba => [
  Math.round(a[0] + ((b[0] - a[0]) * t)),
  Math.round(a[1] + ((b[1] - a[1]) * t)),
  Math.round(a[2] + ((b[2] - a[2]) * t)),
  Math.round(a[3] + ((b[3] - a[3]) * t)),
];

export const createCheckerboardTexture = (
  options: CheckerboardTextureOptions,
): ProceduralTexture2d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const cellWidth = assertDimension('cellWidth', options.cellWidth ?? 8);
  const cellHeight = assertDimension('cellHeight', options.cellHeight ?? 8);
  const colorA = options.colorA ?? defaultColorA;
  const colorB = options.colorB ?? defaultColorB;
  const data = createTextureData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const parity = (Math.floor(x / cellWidth) + Math.floor(y / cellHeight)) % 2;
      writePixel(data, offset, parity === 0 ? colorA : colorB);
    }
  }

  return { width, height, channels: 4, data };
};

export const createGradientTexture = (options: GradientTextureOptions): ProceduralTexture2d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const axis = options.axis ?? 'x';
  const data = createTextureData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const u = width === 1 ? 0 : x / (width - 1);
      const v = height === 1 ? 0 : y / (height - 1);
      const t = axis === 'y' ? v : axis === 'diagonal' ? (u + v) / 2 : u;
      writePixel(data, offset, lerpColor(options.startColor, options.endColor, t));
    }
  }

  return { width, height, channels: 4, data };
};

export const createUvDebugTexture = (
  options: Readonly<{ width: number; height: number }>,
): ProceduralTexture2d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const data = createTextureData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const u = width === 1 ? 0 : x / (width - 1);
      const v = height === 1 ? 0 : y / (height - 1);
      writePixel(data, offset, [
        Math.round(u * 255),
        Math.round(v * 255),
        255 - Math.round(((u + v) / 2) * 255),
        255,
      ]);
    }
  }

  return { width, height, channels: 4, data };
};

export const createNoiseTexture = (options: NoiseTextureOptions): ProceduralTexture2d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const data = createTextureData(width, height);
  const frequency = assertFiniteNumber('frequency', options.frequency ?? 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const u = width === 1 ? 0 : x / (width - 1);
      const v = height === 1 ? 0 : y / (height - 1);
      const sample = sampleFbm2d(u, v, {
        seed: options.seed,
        octaves: options.octaves,
        frequency,
      });
      const value = Math.round(sample * 255);
      writePixel(data, offset, [value, value, value, 255]);
    }
  }

  return { width, height, channels: 4, data };
};

export const createWorleyTexture = (options: WorleyTextureOptions): ProceduralTexture2d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const data = createTextureData(width, height);
  const frequency = assertFiniteNumber('frequency', options.frequency ?? 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const u = width === 1 ? 0 : x / (width - 1);
      const v = height === 1 ? 0 : y / (height - 1);
      const sample = sampleWorleyNoise2d(u * frequency, v * frequency, {
        seed: options.seed,
      });
      const value = Math.round((1 - sample) * 255);
      writePixel(data, offset, [value, value, value, 255]);
    }
  }

  return { width, height, channels: 4, data };
};

export const createPerlinTexture = (options: PerlinTextureOptions): ProceduralTexture2d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const data = createTextureData(width, height);
  const frequency = assertFiniteNumber('frequency', options.frequency ?? 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const sample = samplePerlinNoise2d(
        sampleTextureAxisCenter(x, width, frequency),
        sampleTextureAxisCenter(y, height, frequency),
        {
          seed: options.seed,
        },
      );
      const value = Math.round(sample * 255);
      writePixel(data, offset, [value, value, value, 255]);
    }
  }

  return { width, height, channels: 4, data };
};

export const createColorNoiseTexture = (
  options: ColorNoiseTextureOptions,
): ProceduralTexture2d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const data = createTextureData(width, height);
  const frequency = assertFiniteNumber('frequency', options.frequency ?? 4);
  const lowColor = options.lowColor ?? [24, 52, 96, 255];
  const highColor = options.highColor ?? [236, 246, 255, 255];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const u = width === 1 ? 0 : x / (width - 1);
      const v = height === 1 ? 0 : y / (height - 1);
      const sample = sampleDomainWarpedFbm2d(u * frequency, v * frequency, {
        seed: options.seed,
        octaves: options.octaves,
        frequency,
        warpAmplitude: options.warpAmplitude,
      });
      writePixel(data, offset, lerpColor(lowColor, highColor, sample));
    }
  }

  return { width, height, channels: 4, data };
};
