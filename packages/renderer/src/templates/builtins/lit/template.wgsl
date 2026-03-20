struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
  normal: mat4x4<f32>,
};

struct MaterialUniforms {
  values: array<vec4<f32>, 16>,
};

struct LightingUniforms {
  directions: array<vec4<f32>, 4>,
  colors: array<vec4<f32>, 4>,
  settings: vec4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
// @slot vs_out_fields
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
// @slot bindings
@group(2) @binding(0) var<uniform> lighting: LightingUniforms;

@vertex
fn vsMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
// @slot vertex_inputs
) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
  out.worldNormal = normalize((meshTransform.normal * vec4<f32>(normal, 0.0)).xyz);
// @slot vertex_body
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  var baseColor = material.values[0];
// @slot fragment_body
  let lightCount = i32(lighting.settings.x);
  let ambient = lighting.settings.y;
  let surfaceNormal = normalize(in.worldNormal);
  var litColor = baseColor.rgb * ambient;

  for (var index = 0; index < lightCount; index += 1) {
    let lightDirection = normalize(-lighting.directions[index].xyz);
    let diffuse = max(dot(surfaceNormal, lightDirection), 0.0);
    litColor += baseColor.rgb * lighting.colors[index].xyz * lighting.colors[index].w * diffuse;
  }

  return vec4<f32>(litColor, baseColor.a);
}
