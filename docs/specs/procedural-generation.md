# Procedural Generation

`@rieul3d/procedural` provides deterministic CPU-side helpers for generating reusable sampling
patterns, 2D textures, and 3D volumes without depending on checked-in source assets.

## Package Role

- keep reusable sampling math separate from baked output resource creation
- provide deterministic output for tests, examples, and debug assets
- stay platform-neutral and CPU-first so generated outputs can feed existing texture or volume
  upload paths

## Current Coverage

- scalar sampling: value noise in 2D and 3D
- cellular sampling: Worley noise in 2D and 3D
- fractal helpers: fBm, turbulence, ridged noise, and domain-warped fBm built on top of the reusable
  scalar samplers
- 2D generators: checkerboard, linear gradient, UV debug, grayscale noise, Worley, and color
  domain-warped noise textures
- 3D generators: grayscale noise, Worley, and domain-warped noise volumes

## Constraints

- generators return plain typed-array payloads plus explicit dimensions and channel counts
- deterministic seeds should produce byte-identical output across repeated calls in the same runtime
- the math layer must remain reusable without forcing callers through a baked texture API
- richer gradient-noise families such as Perlin and Simplex can extend the same shape later without
  breaking current callers
