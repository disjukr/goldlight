struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

struct FrameUniforms {
  timeMs: f32,
  deltaTimeMs: f32,
  frameIndex: f32,
  _padding: f32,
};

struct MaterialUniforms {
  values: array<vec4<f32>, 16>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(0) @binding(1) var<uniform> frameUniforms: FrameUniforms;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(2) var baseColorSampler: sampler;

@vertex
fn vsMain(@location(0) position: vec3<f32>, @location(1) texCoord: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
  out.texCoord = texCoord;
  return out;
}

fn unpremul(color: vec4<f32>) -> vec4<f32> {
  if (color.a <= 0.0) {
    return vec4<f32>(0.0);
  }
  return vec4<f32>(color.rgb / color.a, color.a);
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let sampledBaseColor = unpremul(textureSample(baseColorTexture, baseColorSampler, in.texCoord));
  let baseColor = material.values[0] * sampledBaseColor;
  let alphaPolicy = material.values[1];
  if (alphaPolicy.y > 0.5 && alphaPolicy.y < 1.5 && baseColor.a < alphaPolicy.x) {
    discard;
  }
  if (alphaPolicy.y < 1.5 && baseColor.a <= 0.0) {
    discard;
  }

  return baseColor;
}
