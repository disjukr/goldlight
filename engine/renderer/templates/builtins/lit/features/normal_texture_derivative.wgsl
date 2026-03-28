// @slot module_scope
fn computeCotangentFrame(
  normal: vec3<f32>,
  viewPosition: vec3<f32>,
  uv: vec2<f32>,
) -> mat3x3<f32> {
  let dp1 = dpdx(viewPosition);
  let dp2 = dpdy(viewPosition);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let dp2Perp = cross(dp2, normal);
  let dp1Perp = cross(normal, dp1);
  let tangent = dp2Perp * duv1.x + dp1Perp * duv2.x;
  let bitangent = dp2Perp * duv1.y + dp1Perp * duv2.y;
  let invScale = inverseSqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  return mat3x3<f32>(tangent * invScale, bitangent * invScale, normal);
}

fn sampleNormalTexture(in: ptr<function, VsOut>) -> vec3<f32> {
  let viewNormal = normalize((*in).viewNormal);
  let sampledNormal = textureSample(normalTexture, normalSampler, (*in).texCoord).xyz;
  let normalScale = material.values[3].w;
  let tangentNormal = vec3<f32>(
    (sampledNormal.x * 2.0 - 1.0) * normalScale,
    -((sampledNormal.y * 2.0 - 1.0) * normalScale),
    sampledNormal.z * 2.0 - 1.0,
  );
  (*in).sampledTangentNormal = tangentNormal;
  let tangentFrame = computeCotangentFrame(viewNormal, (*in).viewPosition, (*in).texCoord);
  let rawViewTangent = tangentFrame[0];
  let rawViewBitangent = tangentFrame[1];
  let orthogonalViewTangent = rawViewTangent - (viewNormal * dot(viewNormal, rawViewTangent));
  let viewTangent = normalize(orthogonalViewTangent);
  let handedness = select(-1.0, 1.0, dot(cross(viewNormal, viewTangent), rawViewBitangent) >= 0.0);
  let viewBitangent = normalize(cross(viewNormal, viewTangent)) * handedness;
  (*in).debugWorldTangent = normalize((meshTransform.inverseView * vec4<f32>(viewTangent, 0.0)).xyz);
  (*in).debugWorldBitangent = normalize((meshTransform.inverseView * vec4<f32>(viewBitangent, 0.0)).xyz);
  (*in).debugTangentHandedness = handedness;
  let orthonormalTangentFrame = mat3x3<f32>(viewTangent, viewBitangent, viewNormal);
  let perturbedViewNormal = normalize(orthonormalTangentFrame * tangentNormal);
  (*in).mappedViewNormal = perturbedViewNormal;
  let mappedWorldNormal = normalize((meshTransform.inverseView * vec4<f32>(perturbedViewNormal, 0.0)).xyz);
  (*in).mappedWorldNormal = mappedWorldNormal;
  return mappedWorldNormal;
}

// @slot fragment_body
  surfaceNormal = sampleNormalTexture(&in);
