struct MeshTransform {
  world: mat4x4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.world * vec4<f32>(position, 1.0);
  return out;
}
