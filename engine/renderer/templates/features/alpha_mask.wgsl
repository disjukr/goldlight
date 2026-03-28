// @slot fragment_body
  let alphaPolicy = material.values[1];
  if (alphaPolicy.y > 0.5 && alphaPolicy.y < 1.5 && baseColor.a < alphaPolicy.x) {
    discard;
  }
  if (alphaPolicy.y < 1.5 && baseColor.a <= 0.0) {
    discard;
  }
