struct BlurUniforms {
  direction: vec4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var inputColorTexture: texture_2d<f32>;
@group(0) @binding(1) var inputColorSampler: sampler;
@group(0) @binding(2) var<uniform> blur: BlurUniforms;

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

fn gaussianWeight(distance: f32, sigma: f32) -> f32 {
  return exp(-(distance * distance) / max(2.0 * sigma * sigma, 1e-4));
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let texelStep = blur.direction.xy;
  let radius = max(blur.direction.z, 0.0);
  let sigma = max(blur.direction.w, 1e-4);
  var color = vec3<f32>(0.0);
  var totalWeight = 0.0;
  for (var index = -5; index <= 5; index += 1) {
    let distance = min(abs(f32(index)), radius);
    let weight = gaussianWeight(distance, sigma);
    let sampleUv = in.uv + (texelStep * f32(index));
    color += textureSample(inputColorTexture, inputColorSampler, sampleUv).rgb * weight;
    totalWeight += weight;
  }
  return vec4<f32>(color / max(totalWeight, 1e-4), 1.0);
}
