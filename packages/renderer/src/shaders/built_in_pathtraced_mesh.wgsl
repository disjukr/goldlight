struct PathtracedMeshUniforms {
  counts: vec4<f32>,
  cameraOrigin: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
};

struct MeshTriangle {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  na: vec4<f32>,
  nb: vec4<f32>,
  nc: vec4<f32>,
};

struct BvhNode {
  boundsMin: vec4<f32>,
  boundsMax: vec4<f32>,
  payload: vec4<f32>,
};

struct MeshInstance {
  localToWorld0: vec4<f32>,
  localToWorld1: vec4<f32>,
  localToWorld2: vec4<f32>,
  localToWorld3: vec4<f32>,
  worldToLocal0: vec4<f32>,
  worldToLocal1: vec4<f32>,
  worldToLocal2: vec4<f32>,
  worldToLocal3: vec4<f32>,
  payload: vec4<f32>,
  albedoEmission: vec4<f32>,
};

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

struct LightingUniforms {
  directions: array<vec4<f32>, 4>,
  colors: array<vec4<f32>, 4>,
  settings: vec4<f32>,
};

struct TriangleBuffer {
  values: array<MeshTriangle>,
};

struct BvhBuffer {
  values: array<BvhNode>,
};

struct InstanceBuffer {
  values: array<MeshInstance>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct LocalHitRecord {
  hit: bool,
  localDistance: f32,
  triangleIndex: i32,
  localPosition: vec3<f32>,
  shadingNormal: vec3<f32>,
  geometricNormal: vec3<f32>,
};

struct WorldHitRecord {
  hit: bool,
  isSdf: bool,
  distance: f32,
  position: vec3<f32>,
  shadingNormal: vec3<f32>,
  geometricNormal: vec3<f32>,
  albedo: vec3<f32>,
  emission: f32,
};

struct SdfSample {
  albedo: vec3<f32>,
  emission: f32,
  distance: f32,
  itemIndex: i32,
  isBox: bool,
};

const triangleHitEpsilon = 1e-5;
const rayOriginEpsilon = 1e-3;
const sdfRayOriginEpsilon = 0.03;
const sdfHitEpsilon = 0.0015;
const sdfTravelClampMin = 0.008;
const maxSdfTravel = 16.0;
const fireflyClampLuminance = 12.0;
const minRussianRouletteProbability = 0.1;

@group(0) @binding(0) var<uniform> uniforms: PathtracedMeshUniforms;
@group(0) @binding(1) var<storage, read> triangles: TriangleBuffer;
@group(0) @binding(2) var<storage, read> bvh: BvhBuffer;
@group(0) @binding(3) var<storage, read> instances: InstanceBuffer;
@group(0) @binding(4) var<uniform> sdf: SdfUniforms;
@group(0) @binding(5) var<uniform> lighting: LightingUniforms;

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

fn initRandomState(pixel: vec2<f32>, frameIndex: f32) -> vec2<f32> {
  return vec2<f32>(
    fract(sin(dot(pixel + vec2<f32>(frameIndex * 0.37, frameIndex * 1.13), vec2<f32>(127.1, 311.7))) * 43758.5453123),
    fract(sin(dot(pixel + vec2<f32>(frameIndex * 1.79, frameIndex * 0.53), vec2<f32>(269.5, 183.3))) * 43758.5453123),
  );
}

fn random(state: ptr<function, vec2<f32>>) -> f32 {
  let value = fract(52.9829189 * fract(dot(*state, vec2<f32>(0.06711056, 0.00583715))));
  *state = fract(vec2<f32>(value, value + 0.38196601125) + (*state * 1.61803398875));
  return value;
}

fn orthonormalBasis(normal: vec3<f32>) -> mat3x3<f32> {
  let signValue = select(-1.0, 1.0, normal.z >= 0.0);
  let a = -1.0 / (signValue + normal.z);
  let b = normal.x * normal.y * a;
  let tangent = vec3<f32>(1.0 + (signValue * normal.x * normal.x * a), signValue * b, -signValue * normal.x);
  let bitangent = vec3<f32>(b, signValue + (normal.y * normal.y * a), -normal.y);
  return mat3x3<f32>(normalize(tangent), normalize(bitangent), normal);
}

fn sampleCosineHemisphere(normal: vec3<f32>, state: ptr<function, vec2<f32>>) -> vec3<f32> {
  let u1 = random(state);
  let u2 = random(state);
  let radius = sqrt(u1);
  let angle = 6.28318530718 * u2;
  let localDirection = vec3<f32>(
    radius * cos(angle),
    radius * sin(angle),
    sqrt(max(1.0 - u1, 0.0)),
  );
  return normalize(orthonormalBasis(normal) * localDirection);
}

fn sampleSky(direction: vec3<f32>) -> vec3<f32> {
  let horizon = clamp((direction.y * 0.5) + 0.5, 0.0, 1.0);
  return mix(vec3<f32>(0.025, 0.03, 0.05), vec3<f32>(0.38, 0.5, 0.68), horizon);
}

fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn clampFireflies(color: vec3<f32>) -> vec3<f32> {
  let value = luminance(color);
  if (value <= fireflyClampLuminance) {
    return color;
  }
  return color * (fireflyClampLuminance / max(value, 1e-4));
}

fn transformPoint(
  row0: vec4<f32>,
  row1: vec4<f32>,
  row2: vec4<f32>,
  row3: vec4<f32>,
  point: vec3<f32>,
) -> vec3<f32> {
  return (row0.xyz * point.x) + (row1.xyz * point.y) + (row2.xyz * point.z) + row3.xyz;
}

fn transformVector(row0: vec4<f32>, row1: vec4<f32>, row2: vec4<f32>, vector: vec3<f32>) -> vec3<f32> {
  return (row0.xyz * vector.x) + (row1.xyz * vector.y) + (row2.xyz * vector.z);
}

fn safeReciprocal(direction: vec3<f32>) -> vec3<f32> {
  let epsilon = 1e-6;
  let reciprocalX = select(
    1.0 / direction.x,
    select(-1.0 / epsilon, 1.0 / epsilon, direction.x >= 0.0),
    abs(direction.x) < epsilon,
  );
  let reciprocalY = select(
    1.0 / direction.y,
    select(-1.0 / epsilon, 1.0 / epsilon, direction.y >= 0.0),
    abs(direction.y) < epsilon,
  );
  let reciprocalZ = select(
    1.0 / direction.z,
    select(-1.0 / epsilon, 1.0 / epsilon, direction.z >= 0.0),
    abs(direction.z) < epsilon,
  );
  return vec3<f32>(reciprocalX, reciprocalY, reciprocalZ);
}

fn intersectAabb(
  origin: vec3<f32>,
  inverseDirection: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  maxDistance: f32,
) -> f32 {
  let t0 = (boundsMin - origin) * inverseDirection;
  let t1 = (boundsMax - origin) * inverseDirection;
  let tMin = min(t0, t1);
  let tMax = max(t0, t1);
  let nearDistance = max(max(tMin.x, tMin.y), max(tMin.z, 0.0));
  let farDistance = min(min(tMax.x, tMax.y), min(tMax.z, maxDistance));
  return select(-1.0, nearDistance, farDistance >= nearDistance);
}

fn intersectTriangle(
  origin: vec3<f32>,
  direction: vec3<f32>,
  triangle: MeshTriangle,
  maxDistance: f32,
  allowBackface: bool,
) -> vec3<f32> {
  let edge1 = triangle.b.xyz - triangle.a.xyz;
  let edge2 = triangle.c.xyz - triangle.a.xyz;
  let p = cross(direction, edge2);
  let determinant = dot(edge1, p);
  if (allowBackface) {
    if (abs(determinant) < 1e-6) {
      return vec3<f32>(-1.0);
    }
  } else if (determinant <= 1e-6) {
    return vec3<f32>(-1.0);
  }

  let inverseDeterminant = 1.0 / determinant;
  let tvec = origin - triangle.a.xyz;
  let u = dot(tvec, p) * inverseDeterminant;
  if (u < 0.0 || u > 1.0) {
    return vec3<f32>(-1.0);
  }

  let q = cross(tvec, edge1);
  let v = dot(direction, q) * inverseDeterminant;
  if (v < 0.0 || (u + v) > 1.0) {
    return vec3<f32>(-1.0);
  }

  let distance = dot(edge2, q) * inverseDeterminant;
  if (distance <= triangleHitEpsilon || distance >= maxDistance) {
    return vec3<f32>(-1.0);
  }
  return vec3<f32>(distance, u, v);
}

fn traceInstance(
  instance: MeshInstance,
  worldOrigin: vec3<f32>,
  worldDirection: vec3<f32>,
  allowBackface: bool,
) -> LocalHitRecord {
  let localOrigin = transformPoint(
    instance.worldToLocal0,
    instance.worldToLocal1,
    instance.worldToLocal2,
    instance.worldToLocal3,
    worldOrigin,
  );
  let localDirection = normalize(
    transformVector(instance.worldToLocal0, instance.worldToLocal1, instance.worldToLocal2, worldDirection),
  );
  let inverseDirection = safeReciprocal(localDirection);
  let rootNodeIndex = i32(instance.payload.x);
  if (rootNodeIndex < 0) {
    return LocalHitRecord(false, 1e9, -1, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
  }

  var stack = array<i32, 64>();
  var stackSize = 1;
  stack[0] = rootNodeIndex;
  var bestDistance = 1e9;
  var bestTriangleIndex = -1;
  var bestShadingNormal = vec3<f32>(0.0);
  var bestGeometricNormal = vec3<f32>(0.0);

  loop {
    if (stackSize <= 0) {
      break;
    }

    stackSize = stackSize - 1;
    let nodeIndex = stack[stackSize];
    let node = bvh.values[u32(nodeIndex)];
    let nodeHitDistance = intersectAabb(
      localOrigin,
      inverseDirection,
      node.boundsMin.xyz,
      node.boundsMax.xyz,
      bestDistance,
    );
    if (nodeHitDistance < 0.0) {
      continue;
    }

    let triangleCount = i32(node.payload.w);
    if (triangleCount > 0) {
      let triangleOffset = i32(node.payload.z);
      for (var index: i32 = 0; index < triangleCount; index = index + 1) {
        let triangleIndex = triangleOffset + index;
        let triangle = triangles.values[u32(triangleIndex)];
        let hit = intersectTriangle(
          localOrigin,
          localDirection,
          triangle,
          bestDistance,
          allowBackface,
        );
        if (hit.x > 0.0 && hit.x < bestDistance) {
          bestDistance = hit.x;
          bestTriangleIndex = triangleIndex;
          let geometricNormal = normalize(cross(triangle.b.xyz - triangle.a.xyz, triangle.c.xyz - triangle.a.xyz));
          let w = 1.0 - hit.y - hit.z;
          let smoothedNormal = (triangle.na.xyz * w) + (triangle.nb.xyz * hit.y) + (triangle.nc.xyz * hit.z);
          bestShadingNormal = normalize(select(
            geometricNormal,
            smoothedNormal,
            length(smoothedNormal) > 1e-5,
          ));
          bestGeometricNormal = geometricNormal;
        }
      }
      continue;
    }

    let leftChild = i32(node.payload.x);
    let rightChild = i32(node.payload.y);
    if (leftChild >= 0 && stackSize < 64) {
      stack[stackSize] = leftChild;
      stackSize = stackSize + 1;
    }
    if (rightChild >= 0 && stackSize < 64) {
      stack[stackSize] = rightChild;
      stackSize = stackSize + 1;
    }
  }

  if (bestTriangleIndex < 0) {
    return LocalHitRecord(false, 1e9, -1, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
  }

  return LocalHitRecord(
    true,
    bestDistance,
    bestTriangleIndex,
    localOrigin + (localDirection * bestDistance),
    bestShadingNormal,
    bestGeometricNormal,
  );
}

fn traceMeshScene(origin: vec3<f32>, direction: vec3<f32>, allowBackface: bool) -> WorldHitRecord {
  let instanceCount = i32(uniforms.counts.x);
  var bestDistance = 1e9;
  var result = WorldHitRecord(
    false,
    false,
    bestDistance,
    vec3<f32>(0.0),
    vec3<f32>(0.0),
    vec3<f32>(0.0),
    vec3<f32>(0.0),
    0.0,
  );

  for (var index: i32 = 0; index < instanceCount; index = index + 1) {
    let instance = instances.values[u32(index)];
    let localHit = traceInstance(instance, origin, direction, allowBackface);
    if (!localHit.hit) {
      continue;
    }

    let triangle = triangles.values[u32(localHit.triangleIndex)];
    let worldPosition = transformPoint(
      instance.localToWorld0,
      instance.localToWorld1,
      instance.localToWorld2,
      instance.localToWorld3,
      localHit.localPosition,
    );
    let worldEdge1 = transformVector(
      instance.localToWorld0,
      instance.localToWorld1,
      instance.localToWorld2,
      triangle.b.xyz - triangle.a.xyz,
    );
    let worldEdge2 = transformVector(
      instance.localToWorld0,
      instance.localToWorld1,
      instance.localToWorld2,
      triangle.c.xyz - triangle.a.xyz,
    );
    var worldGeometricNormal = normalize(cross(worldEdge1, worldEdge2));
    var worldShadingNormal = normalize(
      transformVector(
        instance.localToWorld0,
        instance.localToWorld1,
        instance.localToWorld2,
        localHit.shadingNormal,
      ),
    );
    let worldDistance = distance(origin, worldPosition);
    if (worldDistance >= bestDistance) {
      continue;
    }

    if (dot(worldGeometricNormal, direction) > 0.0) {
      worldGeometricNormal = -worldGeometricNormal;
    }
    if (dot(worldShadingNormal, worldGeometricNormal) < 0.0) {
      worldShadingNormal = -worldShadingNormal;
    }

    bestDistance = worldDistance;
    result = WorldHitRecord(
      true,
      false,
      worldDistance,
      worldPosition,
      worldShadingNormal,
      worldGeometricNormal,
      instance.albedoEmission.xyz,
      instance.albedoEmission.w,
    );
  }

  return result;
}

fn sceneSdf(point: vec3<f32>) -> SdfSample {
  var minDistance = 1e9;
  var color = vec4<f32>(0.0);
  var itemIndex = -1;
  var isBox = false;
  let itemCount = u32(sdf.itemCount);

  for (var index: u32 = 0u; index < itemCount; index = index + 1u) {
    let item = sdf.items[index];
    let centeredPoint = point - item.centerOp.xyz;
    let opCode = item.centerOp.w;
    var distance = length(centeredPoint) - item.halfExtentsRadius.w;

    if (opCode > 0.5) {
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
      isBox = opCode > 0.5;
    }
  }

  return SdfSample(color.xyz, color.w, minDistance, itemIndex, isBox);
}

fn estimateSdfNormal(point: vec3<f32>) -> vec3<f32> {
  let epsilon = 0.001;
  let dx = sceneSdf(point + vec3<f32>(epsilon, 0.0, 0.0)).distance -
    sceneSdf(point - vec3<f32>(epsilon, 0.0, 0.0)).distance;
  let dy = sceneSdf(point + vec3<f32>(0.0, epsilon, 0.0)).distance -
    sceneSdf(point - vec3<f32>(0.0, epsilon, 0.0)).distance;
  let dz = sceneSdf(point + vec3<f32>(0.0, 0.0, epsilon)).distance -
    sceneSdf(point - vec3<f32>(0.0, 0.0, epsilon)).distance;
  return normalize(vec3<f32>(dx, dy, dz));
}

fn traceSdfScene(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> WorldHitRecord {
  if (sdf.itemCount < 0.5) {
    return WorldHitRecord(
      false,
      true,
      maxDistance,
      vec3<f32>(0.0),
      vec3<f32>(0.0),
      vec3<f32>(0.0),
      vec3<f32>(0.0),
      0.0,
    );
  }

  var travel = 0.0;

  for (var step: u32 = 0u; step < 96u; step = step + 1u) {
    if (travel >= maxDistance || travel > maxSdfTravel) {
      break;
    }

    let point = origin + (direction * travel);
    let sample = sceneSdf(point);
    if (sample.distance < sdfHitEpsilon) {
      var normal = estimateSdfNormal(point);
      if (dot(normal, direction) > 0.0) {
        normal = -normal;
      }
      return WorldHitRecord(
        true,
        true,
        travel,
        point,
        normal,
        normal,
        sample.albedo,
        sample.emission,
      );
    }

    travel = travel + max(sample.distance * 0.9, sdfTravelClampMin);
  }

  return WorldHitRecord(
    false,
    true,
    maxDistance,
    vec3<f32>(0.0),
    vec3<f32>(0.0),
    vec3<f32>(0.0),
    vec3<f32>(0.0),
    0.0,
  );
}

fn traceScene(origin: vec3<f32>, direction: vec3<f32>, allowBackface: bool) -> WorldHitRecord {
  let meshHit = traceMeshScene(origin, direction, allowBackface);
  let sdfHit = traceSdfScene(origin, direction, meshHit.distance);
  if (sdfHit.hit && (!meshHit.hit || sdfHit.distance < meshHit.distance)) {
    return sdfHit;
  }
  return meshHit;
}

fn marchSdfShadow(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> f32 {
  if (sdf.itemCount < 0.5) {
    return 1.0;
  }

  var travel = sdfRayOriginEpsilon;

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

fn traceShadow(origin: vec3<f32>, direction: vec3<f32>, minDistance: f32, maxDistance: f32) -> f32 {
  let meshHit = traceMeshScene(origin, direction, false);
  if (meshHit.hit && meshHit.distance > minDistance && meshHit.distance < maxDistance) {
    return 0.0;
  }
  return marchSdfShadow(origin, direction, maxDistance);
}

fn hitOffset(hit: WorldHitRecord) -> f32 {
  return select(rayOriginEpsilon, sdfRayOriginEpsilon, hit.isSdf);
}

fn sampleEmissiveBox(item: SdfItem, state: ptr<function, vec2<f32>>) -> vec4<f32> {
  let axisX = item.worldToLocalRow0.xyz;
  let axisY = item.worldToLocalRow1.xyz;
  let axisZ = item.worldToLocalRow2.xyz;
  let u = (random(state) * 2.0) - 1.0;
  let v = (random(state) * 2.0) - 1.0;
  let point = item.centerOp.xyz -
    (axisY * item.halfExtentsRadius.y) +
    (axisX * item.halfExtentsRadius.x * u) +
    (axisZ * item.halfExtentsRadius.z * v);
  return vec4<f32>(point, 1.0);
}

fn sampleDirectAreaLight(
  point: vec3<f32>,
  normal: vec3<f32>,
  geometricNormal: vec3<f32>,
  isSdf: bool,
  albedo: vec3<f32>,
  state: ptr<function, vec2<f32>>,
) -> vec3<f32> {
  let itemCount = u32(sdf.itemCount);
  var contribution = vec3<f32>(0.0);

  for (var index: u32 = 0u; index < itemCount; index = index + 1u) {
    let item = sdf.items[index];
    if (item.centerOp.w < 0.5 || item.color.w <= 0.0) {
      continue;
    }

    let sampledPoint = sampleEmissiveBox(item, state).xyz;
    let lightNormal = -item.worldToLocalRow1.xyz;
    let toLight = sampledPoint - point;
    let distanceSquared = max(dot(toLight, toLight), 1e-4);
    let distance = sqrt(distanceSquared);
    let lightDirection = toLight / distance;
    let surfaceCosine = max(dot(normal, lightDirection), 0.0);
    let lightCosine = max(dot(lightNormal, -lightDirection), 0.0);
    let geometricCosine = dot(geometricNormal, lightDirection);
    if (surfaceCosine <= 0.0 || lightCosine <= 0.0 || geometricCosine <= 0.0) {
      continue;
    }

    let offset = select(rayOriginEpsilon, sdfRayOriginEpsilon, isSdf);
    let visibility = traceShadow(
      point + (geometricNormal * offset),
      lightDirection,
      select(0.005, 0.05, isSdf),
      distance,
    );
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

  return clampFireflies(contribution);
}

fn sampleDirectDirectionalLights(
  point: vec3<f32>,
  shadingNormal: vec3<f32>,
  geometricNormal: vec3<f32>,
  isSdf: bool,
  albedo: vec3<f32>,
) -> vec3<f32> {
  let lightCount = i32(lighting.settings.x);
  if (lightCount <= 0) {
    return vec3<f32>(0.0);
  }

  var contribution = vec3<f32>(0.0);
  let offset = select(rayOriginEpsilon, sdfRayOriginEpsilon, isSdf);
  let minDistance = select(0.005, 0.05, isSdf);

  for (var index: i32 = 0; index < lightCount; index = index + 1) {
    let lightDirection = normalize(-lighting.directions[index].xyz);
    let geometricCosine = dot(geometricNormal, lightDirection);
    if (geometricCosine <= 0.0) {
      continue;
    }

    let cosine = max(dot(shadingNormal, lightDirection), 0.0);
    if (cosine <= 0.0) {
      continue;
    }

    let visibility = traceShadow(
      point + (geometricNormal * offset),
      lightDirection,
      minDistance,
      1000.0,
    );
    contribution += albedo * lighting.colors[index].xyz * lighting.colors[index].w * cosine * visibility;
  }

  return clampFireflies(contribution);
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  var randomState = initRandomState(in.position.xy, uniforms.counts.y);
  let isOrthographic = uniforms.cameraForward.w > 0.5;
  var rayOrigin = uniforms.cameraOrigin.xyz;
  var rayDirection = normalize(
    uniforms.cameraForward.xyz +
      (in.uv.x * uniforms.cameraRight.xyz) +
      (in.uv.y * uniforms.cameraUp.xyz),
  );
  if (isOrthographic) {
    rayOrigin = uniforms.cameraOrigin.xyz +
      (in.uv.x * uniforms.cameraRight.xyz) +
      (in.uv.y * uniforms.cameraUp.xyz);
    rayDirection = normalize(uniforms.cameraForward.xyz);
  }

  var throughput = vec3<f32>(1.0);
  var radiance = vec3<f32>(0.0);
  var origin = rayOrigin;
  var direction = rayDirection;

  for (var bounce: u32 = 0u; bounce < 6u; bounce = bounce + 1u) {
    let hit = traceScene(origin, direction, bounce == 0u);
    if (!hit.hit) {
      radiance += clampFireflies(throughput * sampleSky(direction));
      break;
    }

    if (hit.emission > 0.0) {
      radiance += clampFireflies(throughput * hit.albedo * hit.emission);
    }

    let shadingNormal = normalize(select(
      hit.geometricNormal,
      hit.shadingNormal,
      dot(hit.shadingNormal, hit.geometricNormal) >= 0.0,
    ));
    radiance += throughput *
      sampleDirectDirectionalLights(
        hit.position,
        shadingNormal,
        hit.geometricNormal,
        hit.isSdf,
        hit.albedo,
      );
    radiance += throughput *
      sampleDirectAreaLight(
        hit.position,
        shadingNormal,
        hit.geometricNormal,
        hit.isSdf,
        hit.albedo,
        &randomState,
      );

    throughput *= hit.albedo;
    if (bounce >= 2u) {
      let survivalProbability = clamp(
        max(throughput.x, max(throughput.y, throughput.z)),
        minRussianRouletteProbability,
        0.95,
      );
      if (random(&randomState) > survivalProbability) {
        break;
      }
      throughput = throughput / survivalProbability;
    }

    origin = hit.position + (hit.geometricNormal * hitOffset(hit));
    direction = sampleCosineHemisphere(hit.geometricNormal, &randomState);
  }

  return vec4<f32>(clampFireflies(radiance), 1.0);
}
