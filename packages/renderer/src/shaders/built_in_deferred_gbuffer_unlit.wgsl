struct MeshTransform {
  world: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
};

struct MaterialUniforms {
  values: array<vec4<f32>, 16>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

struct GbufferOut {
  @location(0) albedo: vec4<f32>,
  @location(1) normal: vec4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;

@vertex
fn vsMain(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> VsOut {
  var out: VsOut;
  let worldNormal = normalize((meshTransform.normalMatrix * vec4<f32>(normal, 0.0)).xyz);
  out.position = meshTransform.world * vec4<f32>(position, 1.0);
  out.normal = worldNormal;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> GbufferOut {
  var out: GbufferOut;
  out.albedo = material.values[0];
  out.normal = vec4<f32>((normalize(in.normal) * 0.5) + vec3<f32>(0.5), 0.0);
  return out;
}
