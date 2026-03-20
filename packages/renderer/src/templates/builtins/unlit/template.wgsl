struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

struct MaterialUniforms {
  values: array<vec4<f32>, 16>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
// @slot vs_out_fields
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
// @slot bindings

@vertex
fn vsMain(
  @location(0) position: vec3<f32>,
// @slot vertex_inputs
) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
// @slot vertex_body
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  var baseColor = material.values[0];
// @slot fragment_body
  return baseColor;
}
