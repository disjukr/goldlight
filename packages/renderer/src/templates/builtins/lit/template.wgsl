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

fn computeMultiscattering(
  specularColor: vec3<f32>,
  specularF90: f32,
  environmentBrdf: vec2<f32>,
) -> mat2x3<f32> {
  let singleScatter =
    specularColor * environmentBrdf.x + vec3<f32>(specularF90 * environmentBrdf.y);
  let singleScatterEnergy = environmentBrdf.x + environmentBrdf.y;
  let multiScatterEnergy = 1.0 - singleScatterEnergy;
  let averageFresnel = specularColor + (vec3<f32>(1.0) - specularColor) * 0.047619;
  let multiScatterFresnel = singleScatter * averageFresnel /
    max(vec3<f32>(1.0) - vec3<f32>(multiScatterEnergy) * averageFresnel, vec3<f32>(1e-4));
  let multiScatter = multiScatterFresnel * multiScatterEnergy;
  return mat2x3<f32>(singleScatter, multiScatter);
}

fn directBrdfGgxMultiscatter(
  lightDirection: vec3<f32>,
  viewDirection: vec3<f32>,
  normal: vec3<f32>,
  roughness: f32,
  specularColor: vec3<f32>,
  specularF90: f32,
  diffuseColor: vec3<f32>,
  metallic: f32,
  environmentBrdfView: vec2<f32>,
  environmentBrdfLight: vec2<f32>,
) -> vec3<f32> {
  let halfVector = normalize(viewDirection + lightDirection);
  let nDotL = saturate(dot(normal, lightDirection));
  let nDotV = saturate(dot(normal, viewDirection));
  let nDotH = saturate(dot(normal, halfVector));
  let hDotV = saturate(dot(halfVector, viewDirection));
  let distribution = distributionGgx(nDotH, roughness);
  let geometry = geometrySmith(nDotV, nDotL, roughness);
  let fresnel = fresnelSchlick(hDotV, specularColor);
  let singleScatter = (distribution * geometry) * fresnel /
    max(4.0 * max(nDotV, 1e-4) * max(nDotL, 1e-4), 1e-4);

  let singleScatterEnergyView =
    specularColor * environmentBrdfView.x + vec3<f32>(specularF90 * environmentBrdfView.y);
  let singleScatterEnergyLight =
    specularColor * environmentBrdfLight.x + vec3<f32>(specularF90 * environmentBrdfLight.y);
  let energyView = environmentBrdfView.x + environmentBrdfView.y;
  let energyLight = environmentBrdfLight.x + environmentBrdfLight.y;
  let lostEnergyView = 1.0 - energyView;
  let lostEnergyLight = 1.0 - energyLight;
  let averageFresnel = specularColor + (vec3<f32>(1.0) - specularColor) * 0.047619;
  let multiScatterFresnel = singleScatterEnergyView * singleScatterEnergyLight * averageFresnel /
    max(vec3<f32>(1.0) - vec3<f32>(lostEnergyView * lostEnergyLight) * averageFresnel, vec3<f32>(1e-4));
  let multiScatter = multiScatterFresnel * (lostEnergyView * lostEnergyLight);
  let diffuseWeight = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);
  let diffuse = diffuseWeight * diffuseColor / PI;
  return diffuse + singleScatter + multiScatter;
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
    mix(reflectedViewDirection, surfaceNormal, pow(roughness, 4.0)),
  );
  let dielectricF0 = vec3<f32>(0.04, 0.04, 0.04);
  let f0 = mix(dielectricF0, surfaceColor, metallic);
  let diffuseColor = surfaceColor * (1.0 - metallic);
  let specularF90 = 1.0;
  let kS = fresnelSchlickRoughness(nDotV, f0, roughness);
  let kD = (vec3<f32>(1.0) - kS) * (1.0 - metallic);
  let environmentIntensity = lighting.cameraPosition.w;
  let ambientDiffuseStrength = ambient;
  let cosineWeightedIrradiance = sampleEnvironmentDiffuse(surfaceNormal) *
    ambientDiffuseStrength * environmentIntensity * occlusion;
  let prefilteredSpecular = sampleEnvironmentSpecular(reflectionDirection, roughness);
  let environmentBrdf = textureSampleLevel(
    brdfLutTexture,
    brdfLutSampler,
    vec2<f32>(roughness, saturate(nDotV)),
    0.0,
  ).rg;
  let ambientSpecularOcclusion = computeSpecularOcclusion(nDotV, occlusion, roughness);
  let multiscatteringDielectric = computeMultiscattering(
    dielectricF0,
    specularF90,
    environmentBrdf,
  );
  let multiscatteringMetallic = computeMultiscattering(
    surfaceColor,
    specularF90,
    environmentBrdf,
  );
  let singleScatter = mix(
    multiscatteringDielectric[0],
    multiscatteringMetallic[0],
    metallic,
  );
  let multiScatter = mix(
    multiscatteringDielectric[1],
    multiscatteringMetallic[1],
    metallic,
  );
  let totalScatteringDielectric =
    multiscatteringDielectric[0] + multiscatteringDielectric[1];
  let indirectDiffuse = diffuseColor *
    max(vec3<f32>(1.0) - totalScatteringDielectric, vec3<f32>(0.0)) *
    cosineWeightedIrradiance;
  let indirectSpecular = (
    prefilteredSpecular * singleScatter +
    multiScatter * cosineWeightedIrradiance
  ) * ambientSpecularOcclusion;
  var litColor = indirectDiffuse + indirectSpecular;

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
    let nDotL = saturate(dot(surfaceNormal, lightDirection));
    let lightColor = lighting.colors[index].xyz * lighting.colors[index].w;
    let directBrdf = directBrdfGgxMultiscatter(
      lightDirection,
      viewDirection,
      surfaceNormal,
      roughness,
      f0,
      specularF90,
      diffuseColor,
      metallic,
      environmentBrdf,
      textureSampleLevel(
        brdfLutTexture,
        brdfLutSampler,
        vec2<f32>(roughness, nDotL),
        0.0,
      ).rg,
    );
    litColor += directBrdf * lightColor * nDotL;
  }

  return vec4<f32>(litColor + emissive, baseColor.a);
}
