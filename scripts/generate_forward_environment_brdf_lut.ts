const outputPath = new URL(
  '../engine/renderer/images/forward_environment_brdf_lut_rg16f.bin',
  import.meta.url,
);

const encodeHalfFloat = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0x7e00;
  }
  if (value === Infinity) {
    return 0x7c00;
  }
  if (value === -Infinity) {
    return 0xfc00;
  }

  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const absolute = Math.abs(value);
  if (absolute === 0) {
    return sign;
  }
  if (absolute >= 65504) {
    return sign | 0x7bff;
  }

  const exponent = Math.floor(Math.log2(absolute));
  const mantissa = absolute / (2 ** exponent);
  let halfExponent = exponent + 15;
  let halfMantissa = Math.round((mantissa - 1) * 1024);

  if (halfExponent <= 0) {
    const subnormal = Math.round(absolute / (2 ** -24));
    return sign | Math.min(subnormal, 0x03ff);
  }

  if (halfMantissa === 1024) {
    halfExponent += 1;
    halfMantissa = 0;
  }

  if (halfExponent >= 0x1f) {
    return sign | 0x7bff;
  }

  return sign | (halfExponent << 10) | (halfMantissa & 0x03ff);
};

const radicalInverseVdc = (value: number): number => {
  let bits = value >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10;
};

const hammersley = (index: number, count: number): readonly [number, number] => [
  index / count,
  radicalInverseVdc(index),
];

const normalize = (
  vector: readonly [number, number, number],
): readonly [number, number, number] => {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= 1e-8) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

const dot = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);

const cross = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] => [
  (a[1] * b[2]) - (a[2] * b[1]),
  (a[2] * b[0]) - (a[0] * b[2]),
  (a[0] * b[1]) - (a[1] * b[0]),
];

const scaleVector = (
  vector: readonly [number, number, number],
  scalar: number,
): readonly [number, number, number] => [
  vector[0] * scalar,
  vector[1] * scalar,
  vector[2] * scalar,
];

const addVectors = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const reflect = (
  vector: readonly [number, number, number],
  normal: readonly [number, number, number],
): readonly [number, number, number] => {
  const factor = 2 * dot(normal, vector);
  return normalize([
    (factor * normal[0]) - vector[0],
    (factor * normal[1]) - vector[1],
    (factor * normal[2]) - vector[2],
  ]);
};

const buildBasis = (normal: readonly [number, number, number]) => {
  const up = Math.abs(normal[2]) < 0.999 ? [0, 0, 1] as const : [1, 0, 0] as const;
  const tangent = normalize(cross(up, normal));
  const bitangent = normalize(cross(normal, tangent));
  return { tangent, bitangent };
};

const importanceSampleGgx = (
  sample: readonly [number, number],
  roughness: number,
  normal: readonly [number, number, number],
): readonly [number, number, number] => {
  const alpha = roughness * roughness;
  const phi = 2 * Math.PI * sample[0];
  const cosTheta = Math.sqrt(
    (1 - sample[1]) / Math.max(1 + ((alpha * alpha) - 1) * sample[1], 1e-6),
  );
  const sinTheta = Math.sqrt(Math.max(0, 1 - (cosTheta * cosTheta)));
  const halfwayTangent = [
    Math.cos(phi) * sinTheta,
    Math.sin(phi) * sinTheta,
    cosTheta,
  ] as const;
  const basis = buildBasis(normal);
  return normalize(
    addVectors(
      addVectors(
        scaleVector(basis.tangent, halfwayTangent[0]),
        scaleVector(basis.bitangent, halfwayTangent[1]),
      ),
      scaleVector(normal, halfwayTangent[2]),
    ),
  );
};

const geometrySchlickGgxBrdf = (nDotValue: number, roughness: number): number => {
  const k = (roughness * roughness) / 2;
  return nDotValue / Math.max((nDotValue * (1 - k)) + k, 1e-6);
};

const geometrySmithBrdf = (nDotV: number, nDotL: number, roughness: number): number =>
  geometrySchlickGgxBrdf(nDotV, roughness) * geometrySchlickGgxBrdf(nDotL, roughness);

const createEnvironmentBrdfLutData = (
  size = 128,
  sampleCount = 256,
): Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}> => {
  const data = new Uint16Array(size * size * 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const roughness = (x + 0.5) / size;
      const nDotV = Math.max((y + 0.5) / size, 1e-4);
      const view = [Math.sqrt(Math.max(0, 1 - (nDotV * nDotV))), 0, nDotV] as const;
      const normal = [0, 0, 1] as const;
      let scale = 0;
      let bias = 0;

      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const halfVector = importanceSampleGgx(
          hammersley(sampleIndex, sampleCount),
          roughness,
          normal,
        );
        const light = reflect(view, halfVector);
        const nDotL = Math.max(light[2], 0);
        const nDotH = Math.max(halfVector[2], 0);
        const vDotH = Math.max(dot(view, halfVector), 0);
        if (nDotL <= 1e-4 || nDotH <= 1e-4 || vDotH <= 1e-4) {
          continue;
        }

        const geometry = geometrySmithBrdf(nDotV, nDotL, roughness);
        const visibility = (geometry * vDotH) / Math.max(nDotH * nDotV, 1e-6);
        const fresnel = Math.pow(1 - vDotH, 5);
        scale += (1 - fresnel) * visibility;
        bias += fresnel * visibility;
      }

      const offset = ((y * size) + x) * 2;
      data[offset] = encodeHalfFloat(scale / sampleCount);
      data[offset + 1] = encodeHalfFloat(bias / sampleCount);
    }
  }

  return {
    width: size,
    height: size,
    data,
  };
};

const lut = createEnvironmentBrdfLutData();
await Deno.mkdir(new URL('../engine/renderer/images/', import.meta.url), { recursive: true });
await Deno.writeFile(outputPath, new Uint8Array(lut.data.buffer));

console.log(
  `wrote ${lut.width}x${lut.height} RG16F BRDF LUT to ${outputPath.pathname} (${lut.data.byteLength} bytes)`,
);
