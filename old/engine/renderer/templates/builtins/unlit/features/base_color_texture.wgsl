// @slot vertex_inputs
  @location(1) texCoord: vec2<f32>,

// @slot vs_out_fields
  @location(0) texCoord: vec2<f32>,

// @slot vertex_body
  out.texCoord = texCoord;

// @slot fragment_body
  baseColor = material.values[0] * textureSample(baseColorTexture, baseColorSampler, in.texCoord);
