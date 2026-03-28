struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 2.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(2.0, 0.0),
  );
  let position = positions[vertexIndex];
  var out: VsOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

@group(0) @binding(0) var inputColorTexture: texture_2d<f32>;
@group(0) @binding(1) var inputColorSampler: sampler;

struct FxaaUniforms {
  contrastThreshold: f32,
  relativeThreshold: f32,
  subpixelBlending: f32,
  maxSpan: f32,
};

@group(0) @binding(2) var<uniform> fxaaUniforms: FxaaUniforms;

fn rgbToLuma(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(inputColorTexture));
  let inverseDimensions = 1.0 / max(dimensions, vec2<f32>(1.0, 1.0));

  let rgbM = textureSample(inputColorTexture, inputColorSampler, in.uv).rgb;
  let rgbNW = textureSample(inputColorTexture, inputColorSampler, in.uv + (vec2<f32>(-1.0, -1.0) * inverseDimensions)).rgb;
  let rgbNE = textureSample(inputColorTexture, inputColorSampler, in.uv + (vec2<f32>(1.0, -1.0) * inverseDimensions)).rgb;
  let rgbSW = textureSample(inputColorTexture, inputColorSampler, in.uv + (vec2<f32>(-1.0, 1.0) * inverseDimensions)).rgb;
  let rgbSE = textureSample(inputColorTexture, inputColorSampler, in.uv + (vec2<f32>(1.0, 1.0) * inverseDimensions)).rgb;

  let lumaNW = rgbToLuma(rgbNW);
  let lumaNE = rgbToLuma(rgbNE);
  let lumaSW = rgbToLuma(rgbSW);
  let lumaSE = rgbToLuma(rgbSE);
  let lumaM = rgbToLuma(rgbM);

  let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  let lumaRange = lumaMax - lumaMin;
  let threshold = max(
    fxaaUniforms.contrastThreshold,
    lumaMax * fxaaUniforms.relativeThreshold,
  );

  if (lumaRange < threshold) {
    return vec4<f32>(rgbM, 1.0);
  }

  let dir = vec2<f32>(
    -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
    (lumaNW + lumaSW) - (lumaNE + lumaSE),
  );

  let dirReduce = max(
    ((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25) * fxaaUniforms.subpixelBlending,
    1.0 / 128.0,
  );
  let inverseDirAdjustment = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  let maxSpan = max(fxaaUniforms.maxSpan, 0.0);
  let dirClamped = clamp(
    dir * inverseDirAdjustment,
    vec2<f32>(-maxSpan, -maxSpan),
    vec2<f32>(maxSpan, maxSpan),
  ) * inverseDimensions;

  let rgbA = 0.5 * (
    textureSample(inputColorTexture, inputColorSampler, in.uv + (dirClamped * ((1.0 / 3.0) - 0.5))).rgb +
    textureSample(inputColorTexture, inputColorSampler, in.uv + (dirClamped * ((2.0 / 3.0) - 0.5))).rgb
  );
  let rgbB = (rgbA * 0.5) + 0.25 * (
    textureSample(inputColorTexture, inputColorSampler, in.uv + (dirClamped * -0.5)).rgb +
    textureSample(inputColorTexture, inputColorSampler, in.uv + (dirClamped * 0.5)).rgb
  );

  let lumaB = rgbToLuma(rgbB);
  let finalRgb = select(rgbB, rgbA, lumaB < lumaMin || lumaB > lumaMax);
  return vec4<f32>(finalRgb, 1.0);
}
