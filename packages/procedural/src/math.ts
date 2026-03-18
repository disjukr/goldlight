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
const fade = (value: number): number => value * value * value * ((value * ((value * 6) - 15)) + 10);

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

const sampleGradient2d = (x: number, y: number, seed: number): readonly [number, number] => {
  const angle = sampleLattice2d(x, y, seed) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
};

const sampleGradient3d = (
  x: number,
  y: number,
  z: number,
  seed: number,
): readonly [number, number, number] => {
  const gx = (sampleLattice3d(x, y, z, seed) * 2) - 1;
  const gy = (sampleLattice3d(x, y, z, seed + 1) * 2) - 1;
  const gz = (sampleLattice3d(x, y, z, seed + 2) * 2) - 1;
  const length = Math.hypot(gx, gy, gz);

  if (length <= Number.EPSILON) {
    return [1, 0, 0];
  }

  return [gx / length, gy / length, gz / length];
};

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

export const samplePerlinNoise2d = (
  x: number,
  y: number,
  options: NoiseOptions = {},
): number => {
  const seed = noiseSeed(options);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const fx = fade(tx);
  const fy = fade(ty);

  const [g00x, g00y] = sampleGradient2d(x0, y0, seed);
  const [g10x, g10y] = sampleGradient2d(x1, y0, seed);
  const [g01x, g01y] = sampleGradient2d(x0, y1, seed);
  const [g11x, g11y] = sampleGradient2d(x1, y1, seed);

  const n00 = (g00x * tx) + (g00y * ty);
  const n10 = (g10x * (tx - 1)) + (g10y * ty);
  const n01 = (g01x * tx) + (g01y * (ty - 1));
  const n11 = (g11x * (tx - 1)) + (g11y * (ty - 1));
  const interpolated = lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);

  return clamp01((interpolated / sqrt2) + 0.5);
};

export const samplePerlinNoise3d = (
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
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const fx = fade(tx);
  const fy = fade(ty);
  const fz = fade(tz);

  const [g000x, g000y, g000z] = sampleGradient3d(x0, y0, z0, seed);
  const [g100x, g100y, g100z] = sampleGradient3d(x1, y0, z0, seed);
  const [g010x, g010y, g010z] = sampleGradient3d(x0, y1, z0, seed);
  const [g110x, g110y, g110z] = sampleGradient3d(x1, y1, z0, seed);
  const [g001x, g001y, g001z] = sampleGradient3d(x0, y0, z1, seed);
  const [g101x, g101y, g101z] = sampleGradient3d(x1, y0, z1, seed);
  const [g011x, g011y, g011z] = sampleGradient3d(x0, y1, z1, seed);
  const [g111x, g111y, g111z] = sampleGradient3d(x1, y1, z1, seed);

  const n000 = (g000x * tx) + (g000y * ty) + (g000z * tz);
  const n100 = (g100x * (tx - 1)) + (g100y * ty) + (g100z * tz);
  const n010 = (g010x * tx) + (g010y * (ty - 1)) + (g010z * tz);
  const n110 = (g110x * (tx - 1)) + (g110y * (ty - 1)) + (g110z * tz);
  const n001 = (g001x * tx) + (g001y * ty) + (g001z * (tz - 1));
  const n101 = (g101x * (tx - 1)) + (g101y * ty) + (g101z * (tz - 1));
  const n011 = (g011x * tx) + (g011y * (ty - 1)) + (g011z * (tz - 1));
  const n111 = (g111x * (tx - 1)) + (g111y * (ty - 1)) + (g111z * (tz - 1));

  const nearPlane = lerp(lerp(n000, n100, fx), lerp(n010, n110, fx), fy);
  const farPlane = lerp(lerp(n001, n101, fx), lerp(n011, n111, fx), fy);

  return clamp01((lerp(nearPlane, farPlane, fz) / sqrt3) + 0.5);
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
