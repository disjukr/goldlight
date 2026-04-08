struct EnvironmentBackgroundUniforms {
  right: vec4<f32>,
  up: vec4<f32>,
  forward: vec4<f32>,
  settings: vec4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

const PI: f32 = 3.141592653589793;

@group(0) @binding(0) var environmentTexture: texture_2d<f32>;
@group(0) @binding(1) var environmentSampler: sampler;
@group(0) @binding(2) var<uniform> cameraData: EnvironmentBackgroundUniforms;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 2.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(2.0, 0.0),
  );
  let position = positions[vertexIndex];
  var out: VsOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

fn wrap01(value: f32) -> f32 {
  return value - floor(value);
}

fn directionToEquirectUv(direction: vec3<f32>) -> vec2<f32> {
  let unitDirection = normalize(direction);
  let longitude = atan2(unitDirection.z, unitDirection.x);
  let latitude = asin(clamp(unitDirection.y, -1.0, 1.0));
  return vec2<f32>(
    wrap01(longitude / (2.0 * PI) + 0.5),
    clamp(0.5 + latitude / PI, 0.0, 1.0),
  );
}

fn toneMapAcesApprox(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn sampleEnvironmentBackground(uv: vec2<f32>) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let aspect = cameraData.settings.x;
  let tanHalfFov = cameraData.settings.y;
  let direction = normalize(
    cameraData.forward.xyz +
      cameraData.right.xyz * (ndc.x * aspect * tanHalfFov) +
      cameraData.up.xyz * (ndc.y * tanHalfFov),
  );
  return textureSampleLevel(
    environmentTexture,
    environmentSampler,
    directionToEquirectUv(direction),
    0.0,
  ).rgb;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let exposure = max(cameraData.settings.z, 1e-4);
  let hdrColor = sampleEnvironmentBackground(in.uv);
  let color = toneMapAcesApprox(hdrColor * exposure);
  return vec4<f32>(color, 1.0);
}
