struct PresentUniforms {
  exposure: f32,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var accumulatedRadiance: texture_2d<f32>;
@group(0) @binding(1) var accumulatedRadianceSampler: sampler;
@group(0) @binding(2) var<uniform> present: PresentUniforms;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );

  var out: VsOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

fn toneMapAces(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp(
    (color * ((a * color) + vec3<f32>(b))) /
      (color * ((c * color) + vec3<f32>(d)) + vec3<f32>(e)),
    vec3<f32>(0.0),
    vec3<f32>(1.0),
  );
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let color = textureSample(accumulatedRadiance, accumulatedRadianceSampler, in.uv).xyz * present.exposure;
  let mapped = toneMapAces(color);
  let gammaCorrected = pow(mapped, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(gammaCorrected, 1.0);
}
