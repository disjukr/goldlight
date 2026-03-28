// @slot vertex_inputs
  @location(3) tangent: vec4<f32>,

// @slot vs_out_fields
  @location(4) worldTangent: vec4<f32>,

// @slot vertex_body
  out.worldTangent = vec4<f32>(
    normalize((meshTransform.model * vec4<f32>(tangent.xyz, 0.0)).xyz),
    tangent.w,
  );

// @slot module_scope
fn sampleNormalTexture(in: ptr<function, VsOut>) -> vec3<f32> {
  let normal = normalize((*in).worldNormal);
  let tangent = normalize((*in).worldTangent.xyz - normal * dot(normal, (*in).worldTangent.xyz));
  let bitangent = normalize(cross(normal, tangent) * (*in).worldTangent.w);
  (*in).debugWorldTangent = tangent;
  (*in).debugWorldBitangent = bitangent;
  (*in).debugTangentHandedness = (*in).worldTangent.w;
  let sampledNormal = textureSample(normalTexture, normalSampler, (*in).texCoord).xyz;
  let normalScale = material.values[3].w;
  let tangentNormal = vec3<f32>(
    (sampledNormal.x * 2.0 - 1.0) * normalScale,
    -((sampledNormal.y * 2.0 - 1.0) * normalScale),
    sampledNormal.z * 2.0 - 1.0,
  );
  (*in).sampledTangentNormal = tangentNormal;
  let tangentFrame = mat3x3<f32>(tangent, bitangent, normal);
  let mappedWorldNormal = normalize(tangentFrame * tangentNormal);
  (*in).mappedWorldNormal = mappedWorldNormal;
  (*in).mappedViewNormal = normalize((meshTransform.view * vec4<f32>(mappedWorldNormal, 0.0)).xyz);
  return mappedWorldNormal;
}

// @slot fragment_body
  surfaceNormal = sampleNormalTexture(&in);
