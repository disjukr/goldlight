struct SdfItem {
  centerOp: vec4<f32>,
  halfExtentsRadius: vec4<f32>,
  color: vec4<f32>,
  worldToLocalRow0: vec4<f32>,
  worldToLocalRow1: vec4<f32>,
  worldToLocalRow2: vec4<f32>,
};

struct SdfUniforms {
  itemCount: f32,
  frameIndex: f32,
  cameraOrigin: vec3<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  items: array<SdfItem, 16>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct SceneSample {
  albedo: vec3<f32>,
  emission: f32,
  distance: f32,
  itemIndex: i32,
  isBox: bool,
};

@group(0) @binding(0) var<uniform> sdf: SdfUniforms;

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

fn sampleSky(direction: vec3<f32>) -> vec3<f32> {
  let horizon = clamp((direction.y * 0.5) + 0.5, 0.0, 1.0);
  return mix(vec3<f32>(0.04, 0.05, 0.08), vec3<f32>(0.55, 0.72, 0.98), horizon);
}

fn random(seed: ptr<function, f32>) -> f32 {
  let value = fract(sin(*seed) * 43758.5453123);
  *seed = value + 0.61803398875;
  return value;
}

fn randomUnitVector(seed: ptr<function, f32>) -> vec3<f32> {
  let z = (random(seed) * 2.0) - 1.0;
  let angle = random(seed) * 6.28318530718;
  let radius = sqrt(max(1.0 - (z * z), 0.0));
  return vec3<f32>(radius * cos(angle), radius * sin(angle), z);
}

fn sampleHemisphere(normal: vec3<f32>, seed: ptr<function, f32>) -> vec3<f32> {
  let direction = randomUnitVector(seed);
  return normalize(select(-direction, direction, dot(direction, normal) >= 0.0));
}

fn sceneSdf(point: vec3<f32>) -> SceneSample {
  var minDistance = 1e9;
  var color = vec4<f32>(0.0);
  var itemIndex = -1;
  var isBox = false;
  let itemCount = u32(sdf.itemCount);

  for (var index: u32 = 0u; index < itemCount; index = index + 1u) {
    let item = sdf.items[index];
    let centeredPoint = point - item.centerOp.xyz;
    var distance = length(centeredPoint) - item.halfExtentsRadius.w;

    if (item.centerOp.w > 0.5) {
      let localPoint = vec3<f32>(
        dot(item.worldToLocalRow0.xyz, centeredPoint),
        dot(item.worldToLocalRow1.xyz, centeredPoint),
        dot(item.worldToLocalRow2.xyz, centeredPoint),
      );
      let q = abs(localPoint) - item.halfExtentsRadius.xyz;
      distance = length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
    }

    if (distance < minDistance) {
      minDistance = distance;
      color = item.color;
      itemIndex = i32(index);
      isBox = item.centerOp.w > 0.5;
    }
  }

  return SceneSample(color.xyz, color.w, minDistance, itemIndex, isBox);
}

fn estimateNormal(point: vec3<f32>) -> vec3<f32> {
  let epsilon = 0.001;
  let dx = sceneSdf(point + vec3<f32>(epsilon, 0.0, 0.0)).distance -
    sceneSdf(point - vec3<f32>(epsilon, 0.0, 0.0)).distance;
  let dy = sceneSdf(point + vec3<f32>(0.0, epsilon, 0.0)).distance -
    sceneSdf(point - vec3<f32>(0.0, epsilon, 0.0)).distance;
  let dz = sceneSdf(point + vec3<f32>(0.0, 0.0, epsilon)).distance -
    sceneSdf(point - vec3<f32>(0.0, 0.0, epsilon)).distance;
  return normalize(vec3<f32>(dx, dy, dz));
}

fn marchShadow(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> f32 {
  var travel = 0.03;

  for (var step: u32 = 0u; step < 64u; step = step + 1u) {
    let sample = sceneSdf(origin + (direction * travel));
    if (sample.distance < 0.002 && travel < (maxDistance - 0.04)) {
      return 0.0;
    }

    if (travel >= maxDistance - 0.03) {
      break;
    }

    travel = travel + clamp(sample.distance, 0.02, 0.2);
  }

  return 1.0;
}

fn sampleEmissiveBox(
  item: SdfItem,
  seed: ptr<function, f32>,
) -> vec4<f32> {
  let axisX = item.worldToLocalRow0.xyz;
  let axisY = item.worldToLocalRow1.xyz;
  let axisZ = item.worldToLocalRow2.xyz;
  let u = (random(seed) * 2.0) - 1.0;
  let v = (random(seed) * 2.0) - 1.0;
  let point = item.centerOp.xyz -
    (axisY * item.halfExtentsRadius.y) +
    (axisX * item.halfExtentsRadius.x * u) +
    (axisZ * item.halfExtentsRadius.z * v);
  return vec4<f32>(point, 1.0);
}

fn sampleDirectAreaLight(
  point: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  seed: ptr<function, f32>,
) -> vec3<f32> {
  let itemCount = u32(sdf.itemCount);
  var contribution = vec3<f32>(0.0);

  for (var index: u32 = 0u; index < itemCount; index = index + 1u) {
    let item = sdf.items[index];
    if (item.centerOp.w < 0.5 || item.color.w <= 0.0) {
      continue;
    }

    let sampledPoint = sampleEmissiveBox(item, seed).xyz;
    let lightNormal = -item.worldToLocalRow1.xyz;
    let toLight = sampledPoint - point;
    let distanceSquared = max(dot(toLight, toLight), 1e-4);
    let distance = sqrt(distanceSquared);
    let lightDirection = toLight / distance;
    let surfaceCosine = max(dot(normal, lightDirection), 0.0);
    let lightCosine = max(dot(lightNormal, -lightDirection), 0.0);
    if (surfaceCosine <= 0.0 || lightCosine <= 0.0) {
      continue;
    }

    let visibility = marchShadow(point + (normal * 0.03), lightDirection, distance);
    if (visibility <= 0.0) {
      continue;
    }

    let lightArea = (item.halfExtentsRadius.x * 2.0) * (item.halfExtentsRadius.z * 2.0);
    let emitted = item.color.xyz * item.color.w;
    contribution +=
      (albedo / 3.14159265) *
      emitted *
      surfaceCosine *
      lightCosine *
      visibility *
      (lightArea / distanceSquared);
  }

  return contribution;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  var seed = (in.position.x * 12.9898) + (in.position.y * 78.233) + (sdf.frameIndex * 37.719);
  let cameraOrigin = sdf.cameraOrigin;
  let rayDirection = normalize(
    sdf.cameraForward.xyz +
      (in.uv.x * sdf.cameraRight.xyz) +
      (in.uv.y * sdf.cameraUp.xyz),
  );
  var rayOrigin = cameraOrigin;
  var throughput = vec3<f32>(1.0);
  var radiance = vec3<f32>(0.0);
  var direction = rayDirection;

  for (var bounce: u32 = 0u; bounce < 3u; bounce = bounce + 1u) {
    var travel = 0.0;
    var hit = false;

    for (var step: u32 = 0u; step < 96u; step = step + 1u) {
      let point = rayOrigin + (direction * travel);
      let sample = sceneSdf(point);
      let distance = sample.distance;

      if (distance < 0.0015) {
        let normal = estimateNormal(point);
        let albedo = sample.albedo;
        let emission = sample.emission;
        if (emission > 0.0) {
          radiance += throughput * albedo * emission;
        }

        radiance += throughput * sampleDirectAreaLight(point, normal, albedo, &seed);

        throughput *= albedo * 0.85;
        rayOrigin = point + (normal * 0.03);
        direction = sampleHemisphere(normal, &seed);
        hit = true;
        break;
      }

      if (travel > 16.0) {
        break;
      }

      travel = travel + max(distance * 0.9, 0.008);
    }

    if (!hit) {
      radiance += throughput * sampleSky(direction);
      break;
    }
  }

  return vec4<f32>(radiance, 1.0);
}
