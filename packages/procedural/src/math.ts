const defaultOctaves = 4;
const defaultLacunarity = 2;
const defaultGain = 0.5;
const defaultFrequency = 1;

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
