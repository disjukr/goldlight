struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

struct MaterialUniforms {
  color: vec4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;

@vertex
fn vsMain(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> VsOut {
  var out: VsOut;
  let world3x3 = mat3x3<f32>(
    meshTransform.model[0].xyz,
    meshTransform.model[1].xyz,
    meshTransform.model[2].xyz,
  );
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
  out.normal = normalize(world3x3 * normal);
  return out;
}

@fragment
fn fsMain(input: VsOut) -> @location(0) vec4<f32> {
  let lightDirection = normalize(vec3<f32>(-0.45, 0.7, 0.55));
  let ambient = 0.28;
  let diffuse = max(dot(normalize(input.normal), lightDirection), 0.0);
  let lighting = ambient + (diffuse * 0.72);
  return vec4<f32>(material.color.rgb * lighting, material.color.a);
}
