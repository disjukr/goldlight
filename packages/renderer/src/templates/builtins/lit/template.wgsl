struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
  view: mat4x4<f32>,
  inverseView: mat4x4<f32>,
  normal: mat4x4<f32>,
};

struct MaterialUniforms {
  values: array<vec4<f32>, 16>,
};

struct LightingUniforms {
  directions: array<vec4<f32>, 4>,
  colors: array<vec4<f32>, 4>,
  settings: vec4<f32>,
  cameraPosition: vec4<f32>,
};

// @slot module_scope

const PI: f32 = 3.141592653589793;

fn saturate(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn fresnelSchlick(cosTheta: f32, f0: vec3<f32>) -> vec3<f32> {
  let factor = pow(1.0 - saturate(cosTheta), 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * factor;
}

fn fresnelSchlickRoughness(cosTheta: f32, f0: vec3<f32>, roughness: f32) -> vec3<f32> {
  let factor = pow(1.0 - saturate(cosTheta), 5.0);
  let grazing = max(vec3<f32>(1.0 - roughness), f0);
  return f0 + (grazing - f0) * factor;
}

fn distributionGgx(nDotH: f32, roughness: f32) -> f32 {
  let alpha = max(roughness * roughness, 0.001);
  let alphaSquared = alpha * alpha;
  let denominator = max((nDotH * nDotH) * (alphaSquared - 1.0) + 1.0, 1e-4);
  return alphaSquared / (PI * denominator * denominator);
}

fn geometrySchlickGgx(nDotValue: f32, roughness: f32) -> f32 {
  let remapped = roughness + 1.0;
  let k = (remapped * remapped) / 8.0;
  return nDotValue / max(nDotValue * (1.0 - k) + k, 1e-4);
}

fn geometrySmith(nDotV: f32, nDotL: f32, roughness: f32) -> f32 {
  return geometrySchlickGgx(nDotV, roughness) * geometrySchlickGgx(nDotL, roughness);
}

fn computeSpecularOcclusion(dotNV: f32, ambientOcclusion: f32, roughness: f32) -> f32 {
  return saturate(
    pow(dotNV + ambientOcclusion, exp2(-16.0 * roughness - 1.0)) - 1.0 + ambientOcclusion,
  );
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

fn sampleEnvironmentMap(direction: vec3<f32>) -> vec3<f32> {
  let uv = directionToEquirectUv(direction);
  return textureSampleLevel(environmentTexture, environmentSampler, uv, 0.0).rgb;
}

fn sampleEnvironmentDiffuse(normal: vec3<f32>) -> vec3<f32> {
  let maxMipLevel = max(f32(textureNumLevels(environmentTexture)) - 1.0, 0.0);
  let uv = directionToEquirectUv(normalize(normal));
  return textureSampleLevel(
    environmentTexture,
    environmentSampler,
    uv,
    maxMipLevel,
  ).rgb;
}

fn sampleEnvironmentSpecular(
  reflectionDirection: vec3<f32>,
  roughness: f32,
) -> vec3<f32> {
  let maxMipLevel = max(f32(textureNumLevels(environmentTexture)) - 1.0, 0.0);
  let lod = mix(0.0, maxMipLevel, clamp(roughness, 0.0, 1.0));
  return textureSampleLevel(
    environmentTexture,
    environmentSampler,
    directionToEquirectUv(normalize(reflectionDirection)),
    lod,
  ).rgb;
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) worldPosition: vec3<f32>,
  @location(2) viewPosition: vec3<f32>,
  @location(5) viewNormal: vec3<f32>,
  @location(6) mappedWorldNormal: vec3<f32>,
  @location(7) mappedViewNormal: vec3<f32>,
  @location(8) sampledTangentNormal: vec3<f32>,
  @location(9) debugWorldTangent: vec3<f32>,
  @location(10) debugWorldBitangent: vec3<f32>,
  @location(11) debugTangentHandedness: f32,
// @slot vs_out_fields
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
// @slot bindings

@vertex
fn vsMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
// @slot vertex_inputs
) -> VsOut {
  var out: VsOut;
  let worldPosition = meshTransform.model * vec4<f32>(position, 1.0);
  let viewPosition = meshTransform.view * worldPosition;
  out.position = meshTransform.viewProjection * worldPosition;
  out.worldNormal = normalize((meshTransform.normal * vec4<f32>(normal, 0.0)).xyz);
  out.worldPosition = worldPosition.xyz;
  out.viewPosition = viewPosition.xyz;
  out.viewNormal = normalize((meshTransform.view * vec4<f32>(out.worldNormal, 0.0)).xyz);
  out.mappedWorldNormal = out.worldNormal;
  out.mappedViewNormal = out.viewNormal;
  out.sampledTangentNormal = vec3<f32>(0.5, 0.5, 1.0);
  out.debugWorldTangent = vec3<f32>(1.0, 0.0, 0.0);
  out.debugWorldBitangent = vec3<f32>(0.0, 1.0, 0.0);
  out.debugTangentHandedness = 1.0;
// @slot vertex_body
  return out;
}

@fragment
fn fsMain(inValue: VsOut) -> @location(0) vec4<f32> {
  var in = inValue;
  var baseColor = material.values[0];
  var emissive = material.values[2].xyz;
  var metallic = clamp(material.values[3].x, 0.0, 1.0);
  var roughness = clamp(material.values[3].y, 0.0, 1.0);
  var occlusion = 1.0;
  var surfaceNormal = normalize(in.worldNormal);
// @slot fragment_body
  let lightCount = i32(lighting.settings.x);
  let ambient = lighting.settings.y;
  let surfaceColor = baseColor.rgb;
  let nonPerturbedNormal = normalize(in.worldNormal);
  let normalDxy = max(abs(dpdx(nonPerturbedNormal)), abs(dpdy(nonPerturbedNormal)));
  let geometryRoughness = max(max(normalDxy.x, normalDxy.y), normalDxy.z);
  roughness = max(roughness, 0.0525);
  roughness = min(roughness + geometryRoughness, 1.0);
  let viewDirection = normalize(lighting.cameraPosition.xyz - in.worldPosition);
  let nDotV = max(dot(surfaceNormal, viewDirection), 1e-4);
  let reflectedViewDirection = reflect(-viewDirection, surfaceNormal);
  let reflectionDirection = normalize(
    mix(reflectedViewDirection, surfaceNormal, roughness * roughness),
  );
  let dielectricF0 = vec3<f32>(0.04, 0.04, 0.04);
  let f0 = mix(dielectricF0, surfaceColor, metallic);
  let diffuseColor = surfaceColor * (1.0 - metallic);
  let kS = fresnelSchlickRoughness(nDotV, f0, roughness);
  let kD = (vec3<f32>(1.0) - kS) * (1.0 - metallic);
  let environmentIntensity = lighting.cameraPosition.w;
  let ambientDiffuseStrength = ambient;
  let environmentDiffuse = sampleEnvironmentDiffuse(surfaceNormal) * diffuseColor *
    ambientDiffuseStrength * environmentIntensity * occlusion;
  let prefilteredSpecular = sampleEnvironmentSpecular(reflectionDirection, roughness);
  let environmentBrdf = textureSampleLevel(
    brdfLutTexture,
    brdfLutSampler,
    vec2<f32>(saturate(nDotV), roughness),
    0.0,
  ).rg;
  let ambientSpecularOcclusion = computeSpecularOcclusion(nDotV, occlusion, roughness);
  let environmentSpecular = prefilteredSpecular *
    (kS * environmentBrdf.x + vec3<f32>(environmentBrdf.y)) * environmentIntensity *
    ambientSpecularOcclusion;
  var litColor = kD * environmentDiffuse + environmentSpecular;

  let debugView = i32(round(lighting.settings.z));
  if (debugView == 1) {
    return vec4<f32>(normalize(in.worldNormal) * 0.5 + 0.5, 1.0);
  }
  if (debugView == 2) {
    return vec4<f32>(normalize(in.sampledTangentNormal) * 0.5 + 0.5, 1.0);
  }
  if (debugView == 8) {
    return vec4<f32>(in.sampledTangentNormal * 0.5 + 0.5, 1.0);
  }
  if (debugView == 3) {
    return vec4<f32>(normalize(in.mappedWorldNormal) * 0.5 + 0.5, 1.0);
  }
  if (debugView == 4) {
    return vec4<f32>(normalize(in.mappedViewNormal) * 0.5 + 0.5, 1.0);
  }
  if (debugView == 5) {
    return vec4<f32>(normalize(in.debugWorldTangent) * 0.5 + 0.5, 1.0);
  }
  if (debugView == 6) {
    return vec4<f32>(normalize(in.debugWorldBitangent) * 0.5 + 0.5, 1.0);
  }
  if (debugView == 7) {
    let handedness = select(vec3<f32>(0.1, 0.1, 0.9), vec3<f32>(0.9, 0.1, 0.1), in.debugTangentHandedness > 0.0);
    return vec4<f32>(handedness, 1.0);
  }
  if (debugView == 9) {
    return vec4<f32>(fract(in.texCoord), 0.0, 1.0);
  }

  for (var index = 0; index < lightCount; index += 1) {
    let lightDirection = normalize(-lighting.directions[index].xyz);
    let halfVector = normalize(viewDirection + lightDirection);
    let nDotL = saturate(dot(surfaceNormal, lightDirection));
    let nDotH = saturate(dot(surfaceNormal, halfVector));
    let hDotV = saturate(dot(halfVector, viewDirection));
    let lightColor = lighting.colors[index].xyz * lighting.colors[index].w;
    let distribution = distributionGgx(nDotH, roughness);
    let geometry = geometrySmith(nDotV, nDotL, roughness);
    let fresnel = fresnelSchlick(hDotV, f0);
    let specular = (distribution * geometry) * fresnel /
      max(4.0 * max(nDotV, 1e-4) * max(nDotL, 1e-4), 1e-4);
    let diffuseWeight = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);
    let diffuse = diffuseWeight * diffuseColor / PI;
    litColor += (diffuse + specular) * lightColor * nDotL;
  }

  return vec4<f32>(litColor + emissive, baseColor.a);
}
