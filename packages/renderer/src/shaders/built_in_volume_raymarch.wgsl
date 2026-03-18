struct VolumeUniforms {
  worldToLocal: mat4x4<f32>,
  cameraOrigin: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> volume: VolumeUniforms;
@group(0) @binding(1) var volumeTexture: texture_3d<f32>;
@group(0) @binding(2) var volumeSampler: sampler;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );

  let position = positions[vertexIndex];
  var out: VsOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.uv = position;
  return out;
}

fn intersectBox(
  rayOrigin: vec3<f32>,
  rayDirection: vec3<f32>,
  boxMin: vec3<f32>,
  boxMax: vec3<f32>,
) -> vec2<f32> {
  let inverseDirection = 1.0 / rayDirection;
  let t0 = (boxMin - rayOrigin) * inverseDirection;
  let t1 = (boxMax - rayOrigin) * inverseDirection;
  let tMin = min(t0, t1);
  let tMax = max(t0, t1);
  let enter = max(max(tMin.x, tMin.y), max(tMin.z, 0.0));
  let exit = min(tMax.x, min(tMax.y, tMax.z));
  return vec2<f32>(enter, exit);
}

fn transformPoint(matrix: mat4x4<f32>, point: vec3<f32>) -> vec3<f32> {
  return (matrix * vec4<f32>(point, 1.0)).xyz;
}

fn transformVector(matrix: mat4x4<f32>, vector: vec3<f32>) -> vec3<f32> {
  return (matrix * vec4<f32>(vector, 0.0)).xyz;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let rayDirection = normalize(
    volume.cameraForward.xyz +
      (in.uv.x * volume.cameraRight.xyz) -
      (in.uv.y * volume.cameraUp.xyz),
  );
  let localOrigin = transformPoint(volume.worldToLocal, volume.cameraOrigin.xyz);
  let localDirection = transformVector(volume.worldToLocal, rayDirection);
  let boxMin = vec3<f32>(-0.5, -0.5, -0.5);
  let boxMax = vec3<f32>(0.5, 0.5, 0.5);
  let hit = intersectBox(localOrigin, localDirection, boxMin, boxMax);

  if (hit.x >= hit.y) {
    return vec4<f32>(0.0);
  }

  var accumulated = vec4<f32>(0.0);
  let steps = 24.0;
  let stepSize = (hit.y - hit.x) / steps;

  for (var step: u32 = 0u; step < 24u; step = step + 1u) {
    let travel = hit.x + (stepSize * (f32(step) + 0.5));
    let point = localOrigin + (localDirection * travel);
    let uvw = point + vec3<f32>(0.5, 0.5, 0.5);
    let density = textureSampleLevel(volumeTexture, volumeSampler, uvw, 0.0).r;
    let opacity = density * 0.2;
    let color = vec3<f32>(density * 0.35, density * 0.75, density);
    let remaining = 1.0 - accumulated.a;
    accumulated = vec4<f32>(
      accumulated.rgb + (remaining * color * opacity),
      accumulated.a + (remaining * opacity),
    );

    if (accumulated.a > 0.98) {
      break;
    }
  }

  return accumulated;
}
