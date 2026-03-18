import { sampleFbm3d } from './math.ts';

export type ProceduralVolume3d = Readonly<{
  width: number;
  height: number;
  depth: number;
  channels: 1;
  data: Uint8Array;
}>;

export type NoiseVolumeOptions = Readonly<{
  width: number;
  height: number;
  depth: number;
  seed?: number;
  frequency?: number;
  octaves?: number;
}>;

const assertDimension = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`"${name}" must be a positive integer`);
  }

  return value;
};

export const createNoiseVolume = (options: NoiseVolumeOptions): ProceduralVolume3d => {
  const width = assertDimension('width', options.width);
  const height = assertDimension('height', options.height);
  const depth = assertDimension('depth', options.depth);
  const frequency = options.frequency ?? 3;
  const data = new Uint8Array(width * height * depth);

  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const u = width === 1 ? 0 : x / (width - 1);
        const v = height === 1 ? 0 : y / (height - 1);
        const w = depth === 1 ? 0 : z / (depth - 1);
        const sample = sampleFbm3d(u, v, w, {
          seed: options.seed,
          octaves: options.octaves,
          frequency,
        });
        data[(z * width * height) + (y * width) + x] = Math.round(sample * 255);
      }
    }
  }

  return { width, height, depth, channels: 1, data };
};
