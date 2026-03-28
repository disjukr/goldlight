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
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(0) @binding(1) var<uniform> frameUniforms: FrameUniforms;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  let baseColor = material.values[0];
  let alphaPolicy = material.values[1];
  if (alphaPolicy.y > 0.5 && alphaPolicy.y < 1.5 && baseColor.a < alphaPolicy.x) {
    discard;
  }
  if (alphaPolicy.y < 1.5 && baseColor.a <= 0.0) {
    discard;
  }

  return baseColor;
}
