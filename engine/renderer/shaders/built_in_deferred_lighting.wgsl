struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct LightingUniforms {
  directions: array<vec4<f32>, 4>,
  colors: array<vec4<f32>, 4>,
  settings: vec4<f32>,
};

@group(0) @binding(0) var gbufferAlbedo: texture_2d<f32>;
@group(0) @binding(1) var gbufferSampler: sampler;
@group(0) @binding(2) var gbufferNormal: texture_2d<f32>;
@group(1) @binding(0) var<uniform> lighting: LightingUniforms;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  var texCoords = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 2.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(2.0, 0.0),
  );

  var out: VsOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  out.texCoord = texCoords[vertexIndex];
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let albedo = textureSample(gbufferAlbedo, gbufferSampler, in.texCoord);
  if (albedo.a <= 0.0) {
    discard;
  }

  let encodedNormal = textureSample(gbufferNormal, gbufferSampler, in.texCoord);
  if (encodedNormal.w <= 0.0) {
    return albedo;
  }

  let lightCount = i32(lighting.settings.x);
  let ambient = lighting.settings.y;
  let normal = normalize((encodedNormal.xyz * 2.0) - vec3<f32>(1.0));
  var litColor = albedo.rgb * ambient;

  for (var index = 0; index < lightCount; index += 1) {
    let lightDirection = normalize(-lighting.directions[index].xyz);
    let diffuse = max(dot(normal, lightDirection), 0.0);
    litColor += albedo.rgb * lighting.colors[index].xyz * lighting.colors[index].w * diffuse;
  }

  return vec4<f32>(litColor, albedo.a);
}
