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
- fractal helpers: fBm and turbulence built on top of value noise
- 2D generators: checkerboard, linear gradient, UV debug, and grayscale noise textures
- 3D generators: grayscale noise volumes

## Constraints

- generators return plain typed-array payloads plus explicit dimensions and channel counts
- deterministic seeds should produce byte-identical output across repeated calls in the same runtime
- the math layer must remain reusable without forcing callers through a baked texture API
- richer noise families such as Perlin, Simplex, Worley, and domain warping can extend the same
  shape later without breaking current callers
