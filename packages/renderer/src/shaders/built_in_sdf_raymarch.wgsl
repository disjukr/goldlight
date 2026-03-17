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
  _padding0: vec3<f32>,
  items: array<SdfItem, 16>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
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

fn sceneSdf(point: vec3<f32>) -> vec4<f32> {
  var minDistance = 1e9;
  var color = vec4<f32>(0.0);
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
    }
  }

  return vec4<f32>(color.xyz, minDistance);
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let cameraOrigin = vec3<f32>(0.0, 0.0, 2.5);
  let rayDirection = normalize(vec3<f32>(in.uv.x, -in.uv.y, -1.75));
  var travel = 0.0;

  for (var step: u32 = 0u; step < 48u; step = step + 1u) {
    let point = cameraOrigin + (rayDirection * travel);
    let sample = sceneSdf(point);
    let distance = sample.w;

    if (distance < 0.001) {
      let shade = 1.0 - (travel / 8.0);
      return vec4<f32>(sample.xyz * max(shade, 0.2), 1.0);
    }

    if (travel > 8.0) {
      break;
    }

    travel = travel + distance;
  }

  return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}
