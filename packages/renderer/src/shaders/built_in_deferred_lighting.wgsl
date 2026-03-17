struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

@group(0) @binding(0) var gbufferAlbedo: texture_2d<f32>;
@group(0) @binding(1) var gbufferSampler: sampler;
@group(0) @binding(2) var gbufferNormal: texture_2d<f32>;

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

  let encodedNormal = textureSample(gbufferNormal, gbufferSampler, in.texCoord).xyz;
  let normal = normalize((encodedNormal * 2.0) - vec3<f32>(1.0));
  let lightDirection = normalize(vec3<f32>(0.45, 0.7, 0.55));
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let lighting = 0.25 + (0.75 * diffuse);
  return vec4<f32>(albedo.rgb * lighting, albedo.a);
}
