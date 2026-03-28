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

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(inputColorTexture, inputColorSampler, in.uv);
}
