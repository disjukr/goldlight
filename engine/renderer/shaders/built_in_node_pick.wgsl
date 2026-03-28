struct PickUniform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
  pickColor: vec4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) pickColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> pickUniform: PickUniform;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = pickUniform.viewProjection * pickUniform.model * vec4<f32>(position, 1.0);
  out.pickColor = pickUniform.pickColor;
  return out;
}

@fragment
fn fsMain(input: VsOut) -> @location(0) vec4<f32> {
  return input.pickColor;
}
