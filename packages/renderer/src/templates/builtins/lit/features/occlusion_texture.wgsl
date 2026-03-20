// @slot fragment_body
  let occlusionSample = textureSample(occlusionTexture, occlusionSampler, in.texCoord).x;
  occlusion = mix(1.0, occlusionSample, clamp(material.values[3].z, 0.0, 1.0));
