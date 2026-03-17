struct MeshTransform {
  world: mat4x4<f32>,
};

struct MaterialUniforms {
  values: array<vec4<f32>, 16>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(2) var baseColorSampler: sampler;

@vertex
fn vsMain(@location(0) position: vec3<f32>, @location(1) texCoord: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.world * vec4<f32>(position, 1.0);
  out.texCoord = texCoord;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  return material.values[0] * textureSample(baseColorTexture, baseColorSampler, in.texCoord);
}
