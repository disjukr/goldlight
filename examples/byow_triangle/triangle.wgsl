struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.7),
    vec2<f32>(-0.7, -0.6),
    vec2<f32>(0.7, -0.6),
  );
  var colors = array<vec4<f32>, 3>(
    vec4<f32>(1.0, 0.25, 0.2, 1.0),
    vec4<f32>(0.2, 0.85, 1.0, 1.0),
    vec4<f32>(1.0, 0.85, 0.2, 1.0),
  );

  var out: VsOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  out.color = colors[vertexIndex];
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  return in.color;
}
