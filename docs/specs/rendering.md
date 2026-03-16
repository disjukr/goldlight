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
- renderer capability descriptors gate scene compatibility before pass encoding; see
  [`renderer-capabilities.md`](./renderer-capabilities.md)

## Current Execution Surface

- Forward rendering is the first concrete execution path and currently draws mesh residency items.
- Forward rendering also encodes a dedicated SDF raymarch pass for supported sphere primitives.
- Built-in unlit WGSL is stored as a standalone shader file and imported as text.
- Built-in unlit shading supports color-only meshes plus optional base-color texture sampling when
  UVs and texture residency are available.
- Material parameter uploads and bind group creation are implemented for built-in unlit shading.
- Custom WGSL programs can be registered and cached through the material registry.
- Headless/offscreen rendering supports compact byte readback for snapshot testing.
- Snapshot bytes can also be encoded into PNG for local inspection and regression workflows.

## Known Gaps

- Deferred rendering is still at the planning-contract stage.
- Generalized texture-backed material binding for arbitrary custom programs is not implemented yet.
- Volume rendering passes are not encoded yet; only their residency/extraction scaffolding exists.
- SDF execution currently supports sphere primitives only; broader graph/operator coverage is still
  pending.
