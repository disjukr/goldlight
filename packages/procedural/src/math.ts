const defaultOctaves = 4;
const defaultLacunarity = 2;
const defaultGain = 0.5;
const defaultFrequency = 1;
const sqrt2 = Math.sqrt(2);
const sqrt3 = Math.sqrt(3);

export type NoiseOptions = Readonly<{
  seed?: number;
}>;

export type FractalNoiseOptions =
  & NoiseOptions
  & Readonly<{
    octaves?: number;
    lacunarity?: number;
    gain?: number;
    frequency?: number;
  }>;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const lerp = (a: number, b: number, t: number): number => a + ((b - a) * t);

const smoothstep = (value: number): number => value * value * (3 - (2 * value));

const assertFiniteNumber = (name: string, value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`"${name}" must be a finite number`);
  }

  return value;
};

const assertNonNegativeInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`"${name}" must be a non-negative integer`);
  }

  return value;
};

const hash = (seed: number, x: number, y: number, z: number): number => {
  const sineInput = (x * 127.1) + (y * 311.7) + (z * 74.7) + (seed * 101.3);
  const hashed = Math.sin(sineInput) * 43758.5453123;
  return hashed - Math.floor(hashed);
};

const sampleLattice2d = (x: number, y: number, seed: number): number => hash(seed, x, y, 0);

const sampleLattice3d = (x: number, y: number, z: number, seed: number): number =>
  hash(seed, x, y, z);

const sampleFeaturePoint2d = (
  x: number,
  y: number,
  seed: number,
): readonly [number, number] => [
  x + sampleLattice2d(x, y, seed),
  y + sampleLattice2d(x, y, seed + 1),
];

const sampleFeaturePoint3d = (
  x: number,
  y: number,
  z: number,
  seed: number,
): readonly [number, number, number] => [
  x + sampleLattice3d(x, y, z, seed),
  y + sampleLattice3d(x, y, z, seed + 1),
  z + sampleLattice3d(x, y, z, seed + 2),
];

const noiseSeed = (options: NoiseOptions): number => assertFiniteNumber('seed', options.seed ?? 0);

const fractalWeights = (options: FractalNoiseOptions) => ({
  octaves: assertNonNegativeInteger('octaves', options.octaves ?? defaultOctaves),
  lacunarity: assertFiniteNumber('lacunarity', options.lacunarity ?? defaultLacunarity),
  gain: assertFiniteNumber('gain', options.gain ?? defaultGain),
  frequency: assertFiniteNumber('frequency', options.frequency ?? defaultFrequency),
  seed: noiseSeed(options),
});

export const sampleValueNoise2d = (
  x: number,
  y: number,
  options: NoiseOptions = {},
): number => {
  const seed = noiseSeed(options);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);

  const a = sampleLattice2d(x0, y0, seed);
  const b = sampleLattice2d(x1, y0, seed);
  const c = sampleLattice2d(x0, y1, seed);
  const d = sampleLattice2d(x1, y1, seed);

  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
};

export const sampleValueNoise3d = (
  x: number,
  y: number,
  z: number,
  options: NoiseOptions = {},
): number => {
  const seed = noiseSeed(options);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const tz = smoothstep(z - z0);

  const c000 = sampleLattice3d(x0, y0, z0, seed);
  const c100 = sampleLattice3d(x1, y0, z0, seed);
  const c010 = sampleLattice3d(x0, y1, z0, seed);
  const c110 = sampleLattice3d(x1, y1, z0, seed);
  const c001 = sampleLattice3d(x0, y0, z1, seed);
  const c101 = sampleLattice3d(x1, y0, z1, seed);
  const c011 = sampleLattice3d(x0, y1, z1, seed);
  const c111 = sampleLattice3d(x1, y1, z1, seed);

  const nearPlane = lerp(
    lerp(c000, c100, tx),
    lerp(c010, c110, tx),
    ty,
  );
  const farPlane = lerp(
    lerp(c001, c101, tx),
    lerp(c011, c111, tx),
    ty,
  );

  return lerp(nearPlane, farPlane, tz);
};

export const sampleFbm2d = (x: number, y: number, options: FractalNoiseOptions = {}): number => {
  const { octaves, lacunarity, gain, frequency, seed } = fractalWeights(options);
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  let currentFrequency = frequency;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += sampleValueNoise2d(x * currentFrequency, y * currentFrequency, {
      seed: seed + octave,
    }) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    currentFrequency *= lacunarity;
  }

  return weight === 0 ? 0 : clamp01(total / weight);
};

export const sampleFbm3d = (
  x: number,
  y: number,
  z: number,
  options: FractalNoiseOptions = {},
): number => {
  const { octaves, lacunarity, gain, frequency, seed } = fractalWeights(options);
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  let currentFrequency = frequency;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += sampleValueNoise3d(x * currentFrequency, y * currentFrequency, z * currentFrequency, {
      seed: seed + octave,
    }) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    currentFrequency *= lacunarity;
  }

  return weight === 0 ? 0 : clamp01(total / weight);
};

export const sampleTurbulence2d = (
  x: number,
  y: number,
  options: FractalNoiseOptions = {},
): number => {
  const { octaves, lacunarity, gain, frequency, seed } = fractalWeights(options);
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  let currentFrequency = frequency;

  for (let octave = 0; octave < octaves; octave += 1) {
    const centered = (sampleValueNoise2d(x * currentFrequency, y * currentFrequency, {
      seed: seed + octave,
    }) * 2) - 1;
    total += Math.abs(centered) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    currentFrequency *= lacunarity;
  }

  return weight === 0 ? 0 : clamp01(total / weight);
};

export const sampleTurbulence3d = (
  x: number,
  y: number,
  z: number,
  options: FractalNoiseOptions = {},
): number => {
  const { octaves, lacunarity, gain, frequency, seed } = fractalWeights(options);
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  let currentFrequency = frequency;

  for (let octave = 0; octave < octaves; octave += 1) {
    const centered =
      (sampleValueNoise3d(x * currentFrequency, y * currentFrequency, z * currentFrequency, {
        seed: seed + octave,
      }) * 2) - 1;
    total += Math.abs(centered) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    currentFrequency *= lacunarity;
  }

  return weight === 0 ? 0 : clamp01(total / weight);
};

export const sampleRidgedNoise2d = (
  x: number,
  y: number,
  options: FractalNoiseOptions = {},
): number => {
  const { octaves, lacunarity, gain, frequency, seed } = fractalWeights(options);
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  let currentFrequency = frequency;

  for (let octave = 0; octave < octaves; octave += 1) {
    const centered = (sampleValueNoise2d(x * currentFrequency, y * currentFrequency, {
      seed: seed + octave,
    }) * 2) - 1;
    total += (1 - Math.abs(centered)) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    currentFrequency *= lacunarity;
  }

  return weight === 0 ? 0 : clamp01(total / weight);
};

export const sampleRidgedNoise3d = (
  x: number,
  y: number,
  z: number,
  options: FractalNoiseOptions = {},
): number => {
  const { octaves, lacunarity, gain, frequency, seed } = fractalWeights(options);
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  let currentFrequency = frequency;

  for (let octave = 0; octave < octaves; octave += 1) {
    const centered =
      (sampleValueNoise3d(x * currentFrequency, y * currentFrequency, z * currentFrequency, {
        seed: seed + octave,
      }) * 2) - 1;
    total += (1 - Math.abs(centered)) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    currentFrequency *= lacunarity;
  }

  return weight === 0 ? 0 : clamp01(total / weight);
};

export const sampleWorleyNoise2d = (
  x: number,
  y: number,
  options: NoiseOptions = {},
): number => {
  const seed = noiseSeed(options);
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const [featureX, featureY] = sampleFeaturePoint2d(cellX + offsetX, cellY + offsetY, seed);
      const dx = featureX - x;
      const dy = featureY - y;
      nearestDistance = Math.min(nearestDistance, Math.hypot(dx, dy));
    }
  }

  return clamp01(nearestDistance / sqrt2);
};

export const sampleWorleyNoise3d = (
  x: number,
  y: number,
  z: number,
  options: NoiseOptions = {},
): number => {
  const seed = noiseSeed(options);
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const cellZ = Math.floor(z);
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const [featureX, featureY, featureZ] = sampleFeaturePoint3d(
          cellX + offsetX,
          cellY + offsetY,
          cellZ + offsetZ,
          seed,
        );
        const dx = featureX - x;
        const dy = featureY - y;
        const dz = featureZ - z;
        nearestDistance = Math.min(nearestDistance, Math.hypot(dx, dy, dz));
      }
    }
  }

  return clamp01(nearestDistance / sqrt3);
};

export const sampleDomainWarpedFbm2d = (
  x: number,
  y: number,
  options: FractalNoiseOptions & Readonly<{ warpAmplitude?: number }> = {},
): number => {
  const warpAmplitude = assertFiniteNumber('warpAmplitude', options.warpAmplitude ?? 0.35);
  const seed = noiseSeed(options);
  const warpX = (sampleValueNoise2d(x + 17.13, y - 9.41, { seed: seed + 101 }) * 2) - 1;
  const warpY = (sampleValueNoise2d(x - 5.27, y + 13.73, { seed: seed + 211 }) * 2) - 1;

  return sampleFbm2d(x + (warpX * warpAmplitude), y + (warpY * warpAmplitude), options);
};

export const sampleDomainWarpedFbm3d = (
  x: number,
  y: number,
  z: number,
  options: FractalNoiseOptions & Readonly<{ warpAmplitude?: number }> = {},
): number => {
  const warpAmplitude = assertFiniteNumber('warpAmplitude', options.warpAmplitude ?? 0.35);
  const seed = noiseSeed(options);
  const warpX = (sampleValueNoise3d(x + 17.13, y - 9.41, z + 4.2, { seed: seed + 101 }) * 2) - 1;
  const warpY = (sampleValueNoise3d(x - 5.27, y + 13.73, z - 8.6, { seed: seed + 211 }) * 2) - 1;
  const warpZ = (sampleValueNoise3d(x + 2.91, y - 7.11, z + 19.4, { seed: seed + 307 }) * 2) - 1;

  return sampleFbm3d(
    x + (warpX * warpAmplitude),
    y + (warpY * warpAmplitude),
    z + (warpZ * warpAmplitude),
    options,
  );
};
