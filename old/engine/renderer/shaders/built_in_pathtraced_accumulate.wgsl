struct AccumulationUniforms {
  sampleCount: f32,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var previousAccumulation: texture_2d<f32>;
@group(0) @binding(1) var accumulationSampler: sampler;
@group(0) @binding(2) var currentSample: texture_2d<f32>;
@group(0) @binding(3) var currentSampleSampler: sampler;
@group(0) @binding(4) var<uniform> accumulation: AccumulationUniforms;

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

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let current = textureSample(currentSample, currentSampleSampler, in.uv);
  if (accumulation.sampleCount <= 0.5) {
    return current;
  }

  let previous = textureSample(previousAccumulation, accumulationSampler, in.uv);
  let alpha = 1.0 / (accumulation.sampleCount + 1.0);
  return mix(previous, current, alpha);
}
