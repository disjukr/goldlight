struct VsOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.95, 0.95, 0.95, 1.0);
}
