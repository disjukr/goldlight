# Cubemap Export

## Goal

`@rieul3d/renderer` exposes CPU-side export helpers that consume a captured cubemap snapshot and
produce common 2D environment-map layouts without coupling those layouts back into scene capture.

## Current Scope

- the export API is `exportCubemapSnapshot(...)`
- exports currently consume `CubemapSnapshotResult` from `renderForwardCubemapSnapshot(...)`
- output bytes are always tightly packed RGBA8 rows suitable for PNG encoding or further CPU-side
  processing
- supported layouts are:
  - `equirectangular`
  - `angular`
  - `cross`
  - `strip`

## Output Dimensions

- `equirectangular`: `4 * size` by `2 * size`
- `angular`: `2 * size` by `2 * size`
- `cross`: `4 * size` by `3 * size`
- `strip`: `6 * size` by `size`

`size` is the face edge length from the input cubemap snapshot.

## Layout Conventions

- `strip` preserves the cubemap face order from capture:
  - `positive-x`
  - `negative-x`
  - `positive-y`
  - `negative-y`
  - `positive-z`
  - `negative-z`
- `cross` uses a horizontal cross layout:
  - top center: `positive-y`
  - center row: `negative-x`, `positive-z`, `positive-x`, `negative-z`
  - bottom center: `negative-y`
- `equirectangular` reprojects longitudes across `[-pi, pi]` and latitudes across
  `[-pi / 2, pi / 2]`
- `angular` uses a mirror-ball-style full-sphere disk with transparent pixels outside the unit disk

## Sampling Rules

- exports validate that the cubemap contains exactly one snapshot for each of the six faces
- every face must match the declared square `size` and contain `width * height * 4` bytes
- reprojection currently uses nearest-neighbor face sampling from the CPU-readable cubemap bytes
- downstream image encoding stays outside the renderer package; callers can feed the returned RGBA
  buffer into existing PNG helpers or custom exporters

## Follow-Up Direction

- add filtered reprojection to reduce visible seams at low face resolutions
- evaluate caller-controlled export dimensions for non-debugging workflows
