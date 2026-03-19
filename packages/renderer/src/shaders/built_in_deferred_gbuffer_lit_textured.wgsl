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
  @location(1) texCoord: vec2<f32>,
};

struct GbufferOut {
  @location(0) albedo: vec4<f32>,
  @location(1) normal: vec4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(2) var baseColorSampler: sampler;

@vertex
fn vsMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) texCoord: vec2<f32>,
) -> VsOut {
  var out: VsOut;
  let worldNormal = normalize((meshTransform.normalMatrix * vec4<f32>(normal, 0.0)).xyz);
  out.position = meshTransform.world * vec4<f32>(position, 1.0);
  out.normal = worldNormal;
  out.texCoord = texCoord;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> GbufferOut {
  var out: GbufferOut;
  out.albedo = material.values[0] * textureSample(baseColorTexture, baseColorSampler, in.texCoord);
  out.normal = vec4<f32>((normalize(in.normal) * 0.5) + vec3<f32>(0.5), 1.0);
  return out;
}
