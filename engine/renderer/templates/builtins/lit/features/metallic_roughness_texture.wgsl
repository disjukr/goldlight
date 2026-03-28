// @slot fragment_body
  let metallicRoughnessSample = textureSample(
    metallicRoughnessTexture,
    metallicRoughnessSampler,
    in.texCoord,
  );
  roughness *= metallicRoughnessSample.y;
  metallic *= metallicRoughnessSample.z;
