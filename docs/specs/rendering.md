# Rendering

## Renderer Families

`rieul3d` exposes two renderer descriptors in v1:

- `forward`
- `deferred`

Both share common pass contracts and evaluated scene extraction.

## Pass Model

The initial renderer uses a lightweight pass graph:

- explicit pass ordering
- explicit resource names
- explicit dependencies
- no full frame-graph aliasing or aggressive optimization yet

## Primitive Mapping

- mesh primitives are expected to use raster-oriented passes
- sdf and volume primitives are expected to use raymarch or compute-oriented passes
- hybrid frames may mix raster and raymarch passes

## Shader Model

- WGSL only
- built-in material descriptors for common cases
- custom material contracts that register shader source and binding expectations

## Current Execution Surface

- Forward rendering is the first concrete execution path and currently draws mesh residency items.
- Built-in unlit WGSL is stored as a standalone shader file and imported as text.
- Headless/offscreen rendering supports compact byte readback for snapshot testing.
- Snapshot bytes can also be encoded into PNG for local inspection and regression workflows.

## Known Gaps

- Deferred rendering is still at the planning-contract stage.
- Material bind groups and parameter uploads are not implemented yet.
- SDF and volume rendering passes are not encoded yet; only their residency/extraction scaffolding
  exists.
