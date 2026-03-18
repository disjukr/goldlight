import { assert, assertEquals, assertNotEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import {
  createCheckerboardTexture,
  createColorNoiseTexture,
  createDomainWarpedNoiseVolume,
  createGradientTexture,
  createNoiseTexture,
  createNoiseVolume,
  createPerlinTexture,
  createPerlinVolume,
  createUvDebugTexture,
  createWorleyTexture,
  createWorleyVolume,
  sampleDomainWarpedFbm2d,
  sampleDomainWarpedFbm3d,
  sampleFbm2d,
  sampleFbm3d,
  samplePerlinNoise2d,
  samplePerlinNoise3d,
  sampleRidgedNoise2d,
  sampleRidgedNoise3d,
  sampleTurbulence2d,
  sampleTurbulence3d,
  sampleValueNoise2d,
  sampleValueNoise3d,
  sampleWorleyNoise2d,
  sampleWorleyNoise3d,
} from '@rieul3d/procedural';

const assertByteRange = (values: Uint8Array): void => {
  for (const value of values) {
    assert(value >= 0 && value <= 255);
  }
};

Deno.test('value noise samplers are deterministic and seed-sensitive', () => {
  const sample2d = sampleValueNoise2d(1.25, 2.5, { seed: 7 });
  const sample2dRepeat = sampleValueNoise2d(1.25, 2.5, { seed: 7 });
  const sample2dDifferentSeed = sampleValueNoise2d(1.25, 2.5, { seed: 8 });
  const sample3d = sampleValueNoise3d(1.25, 2.5, 3.75, { seed: 7 });
  const sample3dRepeat = sampleValueNoise3d(1.25, 2.5, 3.75, { seed: 7 });
  const sample3dDifferentSeed = sampleValueNoise3d(1.25, 2.5, 3.75, { seed: 8 });

  assertEquals(sample2d, sample2dRepeat);
  assertEquals(sample3d, sample3dRepeat);
  assert(sample2d >= 0 && sample2d <= 1);
  assert(sample3d >= 0 && sample3d <= 1);
  assertNotEquals(sample2d, sample2dDifferentSeed);
  assertNotEquals(sample3d, sample3dDifferentSeed);
});

Deno.test('fractal samplers stay normalized', () => {
  const samples = [
    sampleFbm2d(0.1, 0.2, { seed: 2, octaves: 5 }),
    sampleTurbulence2d(0.3, 0.4, { seed: 2, octaves: 5 }),
    sampleFbm3d(0.1, 0.2, 0.3, { seed: 2, octaves: 5 }),
    sampleTurbulence3d(0.3, 0.4, 0.5, { seed: 2, octaves: 5 }),
    samplePerlinNoise2d(0.45, 0.85, { seed: 6 }),
    samplePerlinNoise3d(0.45, 0.85, 0.25, { seed: 6 }),
    sampleRidgedNoise2d(0.15, 0.25, { seed: 3, octaves: 4 }),
    sampleRidgedNoise3d(0.15, 0.25, 0.35, { seed: 3, octaves: 4 }),
    sampleWorleyNoise2d(1.1, 2.2, { seed: 4 }),
    sampleWorleyNoise3d(1.1, 2.2, 3.3, { seed: 4 }),
    sampleDomainWarpedFbm2d(0.2, 0.6, { seed: 5, octaves: 3, warpAmplitude: 0.4 }),
    sampleDomainWarpedFbm3d(0.2, 0.6, 0.8, { seed: 5, octaves: 3, warpAmplitude: 0.4 }),
  ];

  for (const sample of samples) {
    assert(sample >= 0 && sample <= 1);
  }
});

Deno.test('extended procedural samplers stay deterministic and react to seeds', () => {
  assertEquals(
    samplePerlinNoise2d(0.4, 0.8, { seed: 12 }),
    samplePerlinNoise2d(0.4, 0.8, { seed: 12 }),
  );
  assertEquals(
    samplePerlinNoise3d(0.4, 0.8, 1.2, { seed: 12 }),
    samplePerlinNoise3d(0.4, 0.8, 1.2, { seed: 12 }),
  );
  assertEquals(
    sampleRidgedNoise2d(0.4, 0.8, { seed: 12 }),
    sampleRidgedNoise2d(0.4, 0.8, { seed: 12 }),
  );
  assertEquals(
    sampleWorleyNoise3d(1.5, 2.5, 3.5, { seed: 9 }),
    sampleWorleyNoise3d(1.5, 2.5, 3.5, { seed: 9 }),
  );
  assertEquals(
    sampleDomainWarpedFbm2d(0.25, 0.75, { seed: 2, warpAmplitude: 0.5 }),
    sampleDomainWarpedFbm2d(0.25, 0.75, { seed: 2, warpAmplitude: 0.5 }),
  );

  assertNotEquals(
    samplePerlinNoise2d(0.4, 0.8, { seed: 12 }),
    samplePerlinNoise2d(0.4, 0.8, { seed: 13 }),
  );
  assertNotEquals(
    sampleRidgedNoise3d(0.4, 0.8, 1.2, { seed: 12 }),
    sampleRidgedNoise3d(0.4, 0.8, 1.2, { seed: 13 }),
  );
  assertNotEquals(
    sampleWorleyNoise2d(1.5, 2.5, { seed: 9 }),
    sampleWorleyNoise2d(1.5, 2.5, { seed: 10 }),
  );
  assertNotEquals(
    sampleDomainWarpedFbm3d(0.25, 0.75, 0.5, { seed: 2, warpAmplitude: 0.5 }),
    sampleDomainWarpedFbm3d(0.25, 0.75, 0.5, { seed: 3, warpAmplitude: 0.5 }),
  );
});

Deno.test('checkerboard, gradient, and uv textures expose stable dimensions and pixels', () => {
  const checker = createCheckerboardTexture({
    width: 4,
    height: 4,
    cellWidth: 2,
    cellHeight: 2,
    colorA: [0, 0, 0, 255],
    colorB: [255, 255, 255, 255],
  });
  const gradient = createGradientTexture({
    width: 3,
    height: 1,
    startColor: [0, 0, 0, 255],
    endColor: [255, 128, 64, 255],
  });
  const uv = createUvDebugTexture({ width: 2, height: 2 });

  assertEquals(checker.channels, 4);
  assertEquals(checker.data.length, 4 * 4 * 4);
  assertEquals([...checker.data.slice(0, 4)], [0, 0, 0, 255]);
  assertEquals([...checker.data.slice(8, 12)], [255, 255, 255, 255]);

  assertEquals([...gradient.data.slice(0, 4)], [0, 0, 0, 255]);
  assertEquals([...gradient.data.slice(4, 8)], [128, 64, 32, 255]);
  assertEquals([...gradient.data.slice(8, 12)], [255, 128, 64, 255]);

  assertEquals([...uv.data.slice(0, 4)], [0, 0, 255, 255]);
  assertEquals([...uv.data.slice(12, 16)], [255, 255, 0, 255]);
  assertEquals([...uv.data.slice(8, 12)], [0, 255, 127, 255]);
});

Deno.test('noise texture and volume stay deterministic with valid ranges', () => {
  const texture = createNoiseTexture({ width: 8, height: 8, seed: 11, octaves: 3, frequency: 5 });
  const textureRepeat = createNoiseTexture({
    width: 8,
    height: 8,
    seed: 11,
    octaves: 3,
    frequency: 5,
  });
  const volume = createNoiseVolume({
    width: 4,
    height: 3,
    depth: 2,
    seed: 11,
    octaves: 3,
    frequency: 4,
  });

  assertEquals(texture.channels, 4);
  assertEquals(volume.channels, 1);
  assertEquals(texture.data, textureRepeat.data);
  assertEquals(volume.data.length, 4 * 3 * 2);
  assertByteRange(texture.data);
  assertByteRange(volume.data);
});

Deno.test('extended procedural generators expose stable output ranges', () => {
  const worleyTexture = createWorleyTexture({
    width: 8,
    height: 8,
    seed: 6,
    frequency: 5,
  });
  const perlinTexture = createPerlinTexture({
    width: 8,
    height: 8,
    seed: 5,
    frequency: 4,
  });
  const colorTexture = createColorNoiseTexture({
    width: 4,
    height: 4,
    seed: 7,
    octaves: 4,
    frequency: 3,
    warpAmplitude: 0.45,
    lowColor: [10, 20, 30, 255],
    highColor: [200, 210, 220, 255],
  });
  const worleyVolume = createWorleyVolume({
    width: 4,
    height: 4,
    depth: 3,
    seed: 6,
    frequency: 4,
  });
  const perlinVolume = createPerlinVolume({
    width: 4,
    height: 4,
    depth: 3,
    seed: 5,
    frequency: 3,
  });
  const warpedVolume = createDomainWarpedNoiseVolume({
    width: 4,
    height: 4,
    depth: 3,
    seed: 7,
    octaves: 4,
    frequency: 3,
    warpAmplitude: 0.45,
  });

  assertEquals(worleyTexture.channels, 4);
  assertEquals(perlinTexture.channels, 4);
  assertEquals(colorTexture.channels, 4);
  assertEquals(worleyVolume.channels, 1);
  assertEquals(perlinVolume.channels, 1);
  assertEquals(warpedVolume.channels, 1);
  assertEquals(
    worleyTexture.data,
    createWorleyTexture({ width: 8, height: 8, seed: 6, frequency: 5 }).data,
  );
  assertEquals(
    perlinTexture.data,
    createPerlinTexture({ width: 8, height: 8, seed: 5, frequency: 4 }).data,
  );
  assertEquals(
    perlinVolume.data,
    createPerlinVolume({ width: 4, height: 4, depth: 3, seed: 5, frequency: 3 }).data,
  );
  assertEquals(
    warpedVolume.data,
    createDomainWarpedNoiseVolume({
      width: 4,
      height: 4,
      depth: 3,
      seed: 7,
      octaves: 4,
      frequency: 3,
      warpAmplitude: 0.45,
    }).data,
  );
  assertByteRange(worleyTexture.data);
  assertByteRange(perlinTexture.data);
  assertByteRange(colorTexture.data);
  assertByteRange(worleyVolume.data);
  assertByteRange(perlinVolume.data);
  assertByteRange(warpedVolume.data);
});

Deno.test('procedural generators reject invalid dimensions', () => {
  assertThrows(() => createCheckerboardTexture({ width: 0, height: 4 }));
  assertThrows(() =>
    createGradientTexture({
      width: 1,
      height: 0,
      startColor: [0, 0, 0, 255],
      endColor: [255, 255, 255, 255],
    })
  );
  assertThrows(() => createUvDebugTexture({ width: -1, height: 2 }));
  assertThrows(() => createNoiseTexture({ width: 2, height: 0 }));
  assertThrows(() => createPerlinTexture({ width: 0, height: 2 }));
  assertThrows(() => createNoiseVolume({ width: 1, height: 1, depth: 0 }));
  assertThrows(() => createWorleyTexture({ width: 0, height: 2 }));
  assertThrows(() => createColorNoiseTexture({ width: 2, height: 0 }));
  assertThrows(() => createPerlinVolume({ width: 1, height: 1, depth: 0 }));
  assertThrows(() => createWorleyVolume({ width: 1, height: 1, depth: -1 }));
  assertThrows(() => createDomainWarpedNoiseVolume({ width: 1, height: 1, depth: 0 }));
});

Deno.test('procedural noise rejects non-finite fractal parameters', () => {
  assertThrows(() => sampleValueNoise2d(0.1, 0.2, { seed: Number.NaN }));
  assertThrows(() => sampleFbm2d(0.1, 0.2, { octaves: Number.POSITIVE_INFINITY }));
  assertThrows(() => sampleFbm3d(0.1, 0.2, 0.3, { frequency: Number.POSITIVE_INFINITY }));
  assertThrows(() => sampleTurbulence2d(0.1, 0.2, { gain: Number.NaN }));
  assertThrows(() => sampleTurbulence3d(0.1, 0.2, 0.3, { lacunarity: Number.NEGATIVE_INFINITY }));
  assertThrows(() => samplePerlinNoise2d(0.1, 0.2, { seed: Number.NaN }));
  assertThrows(() => samplePerlinNoise3d(0.1, 0.2, 0.3, { seed: Number.POSITIVE_INFINITY }));
  assertThrows(() => sampleRidgedNoise2d(0.1, 0.2, { gain: Number.NaN }));
  assertThrows(() => sampleWorleyNoise3d(0.1, 0.2, 0.3, { seed: Number.POSITIVE_INFINITY }));
  assertThrows(() => sampleDomainWarpedFbm2d(0.1, 0.2, { warpAmplitude: Number.NaN }));
  assertThrows(() => createNoiseTexture({ width: 2, height: 2, frequency: Number.NaN }));
  assertThrows(() => createPerlinTexture({ width: 2, height: 2, frequency: Number.NaN }));
  assertThrows(() => createWorleyTexture({ width: 2, height: 2, frequency: Number.NaN }));
  assertThrows(() => createColorNoiseTexture({ width: 2, height: 2, warpAmplitude: Number.NaN }));
  assertThrows(() =>
    createNoiseVolume({ width: 2, height: 2, depth: 2, octaves: Number.POSITIVE_INFINITY })
  );
  assertThrows(() => createPerlinVolume({ width: 2, height: 2, depth: 2, frequency: Number.NaN }));
  assertThrows(() =>
    createDomainWarpedNoiseVolume({
      width: 2,
      height: 2,
      depth: 2,
      warpAmplitude: Number.NaN,
    })
  );
});
