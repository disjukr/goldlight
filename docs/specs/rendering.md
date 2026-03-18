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
- Forward rendering now also consumes first-class directional light nodes for built-in Lambert mesh
  shading.
- Deferred rendering now executes a minimal mesh-only path with a depth prepass, built-in unlit/lit
  albedo-normal G-buffer passes, registered custom WGSL G-buffer programs, a fullscreen
  directional-light lighting resolve, and post-lighting SDF/volume raymarch composition.
- Forward rendering also encodes a dedicated SDF raymarch pass for supported sphere and box
  primitives.
- Forward rendering also encodes a first volume raymarch pass for volume primitives with residency.
- Built-in unlit WGSL is stored as a standalone shader file and imported as text.
- Built-in forward lit WGSL is stored as a standalone shader file and consumes directional-light
  uniform data extracted from evaluated light nodes.
- Built-in unlit shading supports color-only meshes plus optional base-color texture sampling when
  UVs and texture residency are available.
- Built-in forward mesh draws upload each evaluated node `worldMatrix` plus the active camera
  `viewProjection` matrix and apply both in the vertex stage before rasterization.
- Forward mesh draws now allocate a depth attachment per render target and use depth-tested
  triangle-list rasterization with back-face culling.
- Built-in lit shading currently supports color-only Lambert materials that require mesh normals and
  at least one directional light.
- Built-in deferred unlit shading supports the same optional base-color texture sampling when
  `NORMAL` and `TEXCOORD_0` data plus texture residency are available, and bypasses the lighting
  resolve so color-only materials stay unlit.
- Built-in deferred lit shading consumes the same material color uniform plus first-class
  directional light nodes during the fullscreen lighting resolve.
- Deferred custom WGSL programs may also target the G-buffer path when they write the same two
  render targets and match the deferred transform/material binding contract.
- Deferred frames now reuse the existing SDF sphere/box and volume raymarch passes after lighting,
  so hybrid scenes can keep mesh shading in deferred while compositing raymarched primitives into
  the same output target.
- Built-in forward lit mesh draws also upload an inverse-transpose normal matrix plus a compact
  directional-light uniform block.
- Material parameter uploads and bind group creation are implemented for built-in unlit shading.
- The minimal deferred path currently requires `NORMAL` vertex data and supports built-in `unlit`
  plus non-textured built-in `lit` materials, with optional base-color textures on `unlit`.
- Custom WGSL programs can be registered and cached through the material registry.
- Headless/offscreen rendering supports compact byte readback for snapshot testing.
- Headless/offscreen rendering also supports a dedicated mesh-node id-buffer pick pass with stable
  node-to-mesh metadata and screen-pixel decode helpers.
- Node-pick snapshots use an internal linear `rgba8unorm` attachment for readback and currently
  support built-in mesh materials only.
- Snapshot bytes can also be encoded into PNG for local inspection and regression workflows.
- Browser examples cover the minimal mesh-only path, a texture-backed built-in unlit path, and a
  custom WGSL path that samples texture residency through declared material bindings.
- The native BYOW demo uses the same forward renderer/runtime residency path on an SDL2-backed
  surface target instead of a browser canvas.
- Fixture-backed golden snapshot tests cover clear-only, mesh, sphere/box SDF, volume, and
  recovery-rebuild headless frames.
- Raymarch golden tests also assert that SDF/volume snapshots differ from the clear-only frame so
  unresolved shader or uniform regressions do not silently lock in blank fixtures.
- Golden fixtures can be refreshed intentionally with
  `deno run -A --unstable-raw-imports scripts/refresh_golden_snapshots.ts`.

## Built-in Binding Contract

- Built-in forward mesh shaders reserve `@group(0) @binding(0)` for a `MeshTransform` uniform with
  two matrices:
  - `model`: the evaluated node world matrix
  - `viewProjection`: the active camera projection multiplied by the evaluated camera view matrix
- Built-in deferred G-buffer mesh shaders reserve `@group(0) @binding(0)` for a transform uniform
  containing the evaluated node world matrix plus an inverse-transpose normal matrix.
- Built-in forward lit mesh shaders extend the same transform bind group with an inverse-transpose
  normal matrix for Lambert shading.
- Material programs can declare `materialBindings` entries for uniform buffers, texture views, and
  samplers that are assembled into a single material bind group.
- Built-in unlit material uniforms live at `@group(1) @binding(0)`.
- Built-in textured unlit shading also binds base-color texture/view pairs at
  `@group(1) @binding(1)` and `@group(1) @binding(2)`.
- Built-in deferred textured unlit shading uses the same `@group(1)` base-color texture/sampler
  contract during G-buffer writes.
- Built-in node picking reserves `@group(0) @binding(0)` for a uniform containing the evaluated node
  world matrix, active camera `viewProjection`, and RGBA-encoded pick id color.
- Deferred custom WGSL programs that register with `usesTransformBindings: true` should match the
  deferred `@group(0)` transform contract: evaluated node world matrix plus inverse-transpose normal
  matrix.
- Custom WGSL programs that want the same evaluated mesh transform upload should register with
  `usesTransformBindings: true` and match the same `@group(0)` transform contract.
- Custom WGSL programs that need sampled textures should declare matching texture/sampler bindings
  plus the texture semantic they expect from `Material.textures`.
- Capability preflight validates declared texture semantics, mesh UV requirements, and texture
  residency before the renderer starts encoding bind groups.

## Headless PNG Workflow

- `deno task example:headless:png` renders an offscreen forward frame and writes a PNG to
  `examples/headless_snapshot/out/forward.png`.
- The workflow reuses `requestGpuContext`, `rebuildRuntimeResidency`, `renderForwardSnapshot`, and
  `encodePngRgba` instead of adding a separate renderer path.
- The command accepts optional output path, width, and height arguments for ad hoc captures.

## Known Gaps

- Deferred rendering does not yet support textures on built-in lit materials.
- Renderer-side picking currently targets mesh nodes only; SDF, volume, and per-triangle picking are
  still pending.
- SDF execution currently supports sphere and box primitives only; broader graph/operator coverage
  is still pending.
