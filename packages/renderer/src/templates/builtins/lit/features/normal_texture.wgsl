// @slot module_scope
fn sampleNormalTexture(in: VsOut) -> vec3<f32> {
  let uvDx = dpdx(in.texCoord);
  let uvDy = dpdy(in.texCoord);
  let positionDx = dpdx(in.worldPosition);
  let positionDy = dpdy(in.worldPosition);
  let normal = normalize(in.worldNormal);
  let determinant = (uvDx.x * uvDy.y) - (uvDx.y * uvDy.x);
  if (abs(determinant) <= 1e-5) {
    return normal;
  }
  let inverseDeterminant = 1.0 / determinant;
  let tangent = normalize((positionDx * uvDy.y - positionDy * uvDx.y) * inverseDeterminant);
  let bitangent = normalize((positionDy * uvDx.x - positionDx * uvDy.x) * inverseDeterminant);
  let sampledNormal = textureSample(normalTexture, normalSampler, in.texCoord).xyz;
  let tangentNormal = normalize(vec3<f32>(
    sampledNormal.x * 2.0 - 1.0,
    (sampledNormal.y * 2.0 - 1.0) * material.values[3].w,
    sampledNormal.z * 2.0 - 1.0,
  ));
  let tangentFrame = mat3x3<f32>(tangent, bitangent, normal);
  return normalize(tangentFrame * tangentNormal);
}

// @slot fragment_body
  surfaceNormal = sampleNormalTexture(in);
