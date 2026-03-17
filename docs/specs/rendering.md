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
- Built-in forward mesh draws upload each evaluated node `worldMatrix` and apply it in the vertex
  stage before rasterization.
- Material parameter uploads and bind group creation are implemented for built-in unlit shading.
- Custom WGSL programs can be registered and cached through the material registry.
- Headless/offscreen rendering supports compact byte readback for snapshot testing.
- Snapshot bytes can also be encoded into PNG for local inspection and regression workflows.
- The native BYOW demo uses the same forward renderer/runtime residency path on an SDL2-backed
  surface target instead of a browser canvas.
- Fixture-backed golden snapshot tests cover a clear-only frame and a full-frame unlit mesh draw.
- Golden fixtures can be refreshed intentionally with
  `deno run -A --unstable-raw-imports scripts/refresh_golden_snapshots.ts`.

## Built-in Binding Contract

- Built-in forward mesh shaders reserve `@group(0) @binding(0)` for a `mat4x4<f32>` mesh transform
  uniform derived from the evaluated node world matrix.
- Built-in unlit material uniforms live at `@group(1) @binding(0)`.
- Built-in textured unlit shading also binds base-color texture/view pairs at
  `@group(1) @binding(1)` and `@group(1) @binding(2)`.
- Custom WGSL programs that want the same evaluated mesh transform upload should register with
  `usesTransformBindings: true` and match the same `@group(0)` transform contract.

## Headless PNG Workflow

- `deno task example:headless:png` renders an offscreen forward frame and writes a PNG to
  `examples/headless_snapshot/out/forward.png`.
- The workflow reuses `requestGpuContext`, `rebuildRuntimeResidency`, `renderForwardSnapshot`, and
  `encodePngRgba` instead of adding a separate renderer path.
- The command accepts optional output path, width, and height arguments for ad hoc captures.

## Known Gaps

- Deferred rendering is still at the planning-contract stage.
- Generalized texture-backed material binding for arbitrary custom programs is not implemented yet.
- Volume rendering passes are not encoded yet; only their residency/extraction scaffolding exists.
- SDF execution currently supports sphere primitives only; broader graph/operator coverage is still
  pending.
