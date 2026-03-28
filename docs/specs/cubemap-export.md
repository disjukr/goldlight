# Cubemap Export

## Goal

`@disjukr/goldlight/renderer` exposes CPU-side export helpers that consume a captured cubemap
snapshot and produce common 2D environment-map layouts without coupling those layouts back into
scene capture.

## Current Scope

- the export API is `exportCubemapSnapshot(...)`
- exports currently consume `CubemapSnapshotResult` from `renderForwardCubemapSnapshot(...)`
- output bytes are always tightly packed RGBA8 rows suitable for PNG encoding or further CPU-side
  processing
- callers may override output dimensions while preserving each layout's fixed aspect ratio
- equirectangular and angular exports may opt into bilinear face sampling through
  `sampling: 'linear'`
- supported layouts are:
  - `equirectangular`
  - `angular`
  - `cross`
  - `strip`

## Output Dimensions

- `equirectangular`: defaults to `4 * size` by `2 * size`, or any caller-provided `2:1` dimensions
- `angular`: defaults to `2 * size` by `2 * size`, or any caller-provided square dimensions
- `cross`: defaults to `4 * size` by `3 * size`, or any caller-provided `4:3` dimensions that keep
  each face square
- `strip`: defaults to `6 * size` by `size`, or any caller-provided `6:1` dimensions that keep each
  face square

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
  - top center: `negative-y`
  - center row: `negative-x`, `positive-z`, `positive-x`, `negative-z`
  - bottom center: `positive-y`
- `equirectangular` reprojects longitudes across `[-pi, pi]` and latitudes across
  `[-pi / 2, pi / 2]`
- `angular` uses a mirror-ball-style full-sphere disk with transparent pixels outside the unit disk

## Sampling Rules

- exports validate that the cubemap contains exactly one snapshot for each of the six faces
- every face must match the declared square `size` and contain `width * height * 4` bytes
- `sampling: 'nearest'` preserves the original face texels and remains the default for every layout
- `sampling: 'linear'` bilinearly filters cubemap face lookups, which is most useful for
  equirectangular and angular reprojection when the requested output size differs from the face size
- downstream image encoding stays outside the renderer package; callers can feed the returned RGBA
  buffer into existing PNG helpers or custom exporters

## Options

`exportCubemapSnapshot(snapshot, options)` now accepts:

- `layout`: one of `equirectangular`, `angular`, `cross`, or `strip`
- `width` / `height`: optional export dimensions; when one side is omitted it is derived from the
  selected layout ratio
- `sampling`: optional `nearest` or `linear`; omitted defaults to `nearest`
