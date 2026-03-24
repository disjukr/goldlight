# Procedural Generation

`@goldlight/procedural` provides deterministic CPU-side helpers for generating 2D textures and 3D
volumes without depending on checked-in source assets.

Low-level deterministic samplers live in `@goldlight/math`, while `@goldlight/procedural` owns baked
resource generation on top of those samplers and no longer re-exports the math layer.

## Package Role

- keep reusable sampling math separate from baked output resource creation
- provide deterministic output for tests, examples, and debug assets
- stay platform-neutral and CPU-first so generated outputs can feed existing texture or volume
  upload paths

## Current Coverage

- scalar sampling: value noise in 2D and 3D
- gradient sampling: Perlin noise in 2D and 3D
- cellular sampling: Worley noise in 2D and 3D
- fractal helpers: fBm, turbulence, ridged noise, and domain-warped fBm built on top of the reusable
  scalar samplers
- 2D generators: checkerboard, linear gradient, UV debug, grayscale value noise, grayscale Perlin,
  Worley, and color domain-warped noise textures
- 3D generators: grayscale value noise, grayscale Perlin, Worley, and domain-warped noise volumes

## Constraints

- generators return plain typed-array payloads plus explicit dimensions and channel counts
- deterministic seeds should produce byte-identical output across repeated calls in the same runtime
- the math layer must remain reusable without forcing callers through a baked texture API
- gradient-noise samplers should preserve the same deterministic seed and normalized `[0, 1]`
  contract as the existing scalar helpers so textures and volumes can swap between families without
  changing their upload path
- richer gradient-noise families such as Simplex can extend the same shape later without breaking
  current callers
