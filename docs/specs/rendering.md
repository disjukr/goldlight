# Rendering

## Renderer Families

`rieul3d` exposes renderer descriptors in v1:

- `forward`
- `deferred`
- `uber`
- `pathtraced`

Both share common pass contracts and evaluated scene extraction.

## Pass Model

The initial renderer uses a lightweight pass graph:

- explicit pass ordering
- explicit resource names
- explicit dependencies
- no full frame-graph aliasing or aggressive optimization yet
- optional post-process passes that run after scene-color rendering and before final present

## Primitive Mapping

- mesh primitives are expected to use raster-oriented passes
- sdf and volume primitives are expected to use raymarch or compute-oriented passes
- uber frames may mix raster and raymarch passes

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
- Uber rendering now executes deferred opaque mesh passes, forward opaque fallback passes, and a
  second forward transparent pass before post-process/present.
- Forward rendering also encodes a dedicated SDF raymarch pass for supported sphere and box
  primitives.
- Forward rendering also encodes a first volume raymarch pass for volume primitives with residency.
- Pathtraced rendering now ships with two fullscreen slices: the original SDF path and a
  triangle-BVH mesh path for static mesh scenes, including mixed mesh+SDF pathtraced composition. It
  does not yet support custom materials, resident volumes, or scene light nodes.
- Built-in unlit WGSL is stored as a standalone shader file and imported as text.
- Built-in forward lit WGSL is stored as a standalone shader file and consumes directional-light
  uniform data extracted from evaluated light nodes.
- Built-in unlit shading supports color-only meshes plus optional base-color texture sampling when
  UVs and texture residency are available.
- Built-in forward mesh draws upload each evaluated node `worldMatrix` plus the active camera
  `viewProjection` matrix and apply both in the vertex stage before rasterization.
- Forward mesh draws now allocate a depth attachment per render target, render opaque meshes before
  transparent meshes, and use depth-tested triangle-list rasterization with per-material blend and
  double-sided policy where requested.
- Built-in lit shading supports color-only Lambert materials plus optional base-color texture
  sampling when UVs and texture residency are available, and still requires mesh normals plus at
  least one directional light.
- Built-in deferred unlit shading supports the same optional base-color texture sampling when
  `NORMAL` and `TEXCOORD_0` data plus texture residency are available, and bypasses the lighting
  resolve so color-only materials stay unlit.
- Built-in deferred lit shading consumes the same material color uniform and uses first-class
  directional light nodes during the fullscreen lighting resolve.
- Deferred frames route textured built-in lit meshes through a forward lit pass after deferred
  lighting while reusing the deferred depth buffer, so textured lit meshes can sample `baseColor`
  without writing incorrect prepass depth through zero-alpha cutouts.
- Deferred custom WGSL programs may also target the G-buffer path when they write the same two
  render targets and match the deferred transform/material binding contract.
- Deferred frames now reuse the existing SDF sphere/box and volume raymarch passes after lighting,
  so mixed scenes can keep mesh shading in deferred while compositing raymarched primitives into the
  same output target.
- Forward and deferred rendering can now route scene output through an explicit intermediate
  scene-color texture when ordered post-process passes are requested.
- The first post-process milestone ships a built-in fullscreen blit pass plus a minimal post-process
  program contract for renderer-owned fullscreen passes.
- Built-in forward lit mesh draws also upload an inverse-transpose normal matrix plus a compact
  directional-light uniform block.
- Material parameter uploads and bind group creation are implemented for built-in unlit shading.
- The minimal deferred path currently requires `NORMAL` vertex data and supports built-in `unlit`
  plus built-in `lit` materials; built-in `unlit` textures stay in the G-buffer path, while textured
  built-in `lit` meshes fall back to a depth-tested forward pass after deferred lighting when
  residency and `TEXCOORD_0` data are available.
- Custom WGSL programs can be registered and cached through the material registry.
- Headless/offscreen rendering supports compact byte readback for snapshot testing.
- Headless/offscreen rendering also supports forward-renderer cubemap capture as six ordered
  offscreen face snapshots for mesh, SDF, and volume scenes, decoupled from later
  reprojection/export layouts.
- Headless/offscreen rendering also supports a dedicated mesh-node id-buffer pick pass with stable
  node-to-mesh metadata and screen-pixel decode helpers.
- Node-pick snapshots use an internal linear `rgba8unorm` attachment for readback and currently
  support built-in mesh materials only.
- Snapshot bytes can also be encoded into PNG for local inspection and regression workflows.
- Cubemap capture returns per-face bytes plus view/projection metadata instead of committing to one
  2D environment-map layout in the renderer itself.
- Browser examples cover the minimal mesh-only path, a texture-backed built-in unlit path, and a
  custom WGSL path that samples texture residency through declared material bindings.
- The native BYOW demos use the same forward renderer/runtime residency path on a `winit`-hosted
  `Deno.UnsafeWindowSurface` target instead of a browser canvas.
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
- Material programs can declare `materialBindings` entries for uniform buffers, renderer-owned
  alpha-policy uniforms, texture views, and samplers that are assembled into a single material bind
  group.
- Built-in unlit material uniforms live at `@group(1) @binding(0)`.
- Built-in material slot `values[1]` now reserves alpha-policy data:
  - `x`: `alphaCutoff`
  - `y`: alpha mode enum (`0 = opaque`, `1 = mask`, `2 = blend`)
  - `z`: requested depth-write flag
  - `w`: requested double-sided flag
- Built-in textured unlit shading also binds base-color texture/view pairs at
  `@group(1) @binding(1)` and `@group(1) @binding(2)`.
- Built-in textured lit shading uses the same `@group(1)` base-color texture/sampler contract and a
  `@group(2) @binding(0)` directional-light uniform block.
- Built-in deferred textured unlit shading uses the same `@group(1)` base-color texture/sampler
  contract during G-buffer writes.
- Built-in node picking reserves `@group(0) @binding(0)` for a uniform containing the evaluated node
  world matrix, active camera `viewProjection`, and RGBA-encoded pick id color.
- Post-process programs reserve `@group(0) @binding(0)` for the input color texture and
  `@group(0) @binding(1)` for the input sampler; programs that opt into uniforms also reserve
  `@group(0) @binding(2)` for a uniform buffer.
- Post-process pipeline residency is keyed by effective program identity, including WGSL, fragment
  entry point, and uniform-buffer usage, so shader swaps do not silently reuse stale pipelines.
- Deferred custom WGSL programs that register with `usesTransformBindings: true` should match the
  deferred `@group(0)` transform contract: evaluated node world matrix plus inverse-transpose normal
  matrix.
- Custom WGSL programs that want the same evaluated mesh transform upload should register with
  `usesTransformBindings: true` and match the same `@group(0)` transform contract.
- Custom WGSL programs that need renderer-owned alpha policy can declare an `alpha-policy`
  `materialBindings` entry and bind a `vec4<f32>`/equivalent uniform at the requested binding with
  the same payload used by built-in materials:
  - `x`: `alphaCutoff`
  - `y`: alpha mode enum (`0 = opaque`, `1 = mask`, `2 = blend`)
  - `z`: resolved depth-write flag after applying renderer defaults
  - `w`: resolved double-sided flag
- Custom WGSL programs that need sampled textures should declare matching texture/sampler bindings
  plus the texture semantic they expect from `Material.textures`.
- The current renderer shape follows the proposed custom WGSL alpha-policy contract in
  [`../adr/0011-custom-wgsl-alpha-policy-binding.md`](../adr/0011-custom-wgsl-alpha-policy-binding.md),
  which remains in proposal status until reviewed; hybrid rendering still routes non-opaque custom
  WGSL materials through the forward fallback instead of deferred G-buffer execution.
- Capability preflight validates declared texture semantics, mesh UV requirements, and texture
  residency before the renderer starts encoding bind groups.

## Headless PNG Workflow

- `deno task example:headless:png` renders an offscreen forward frame and writes a PNG to
  `examples/headless_snapshot/out/forward.png`.
- The workflow reuses `requestGpuContext`, `rebuildRuntimeResidency`, `renderForwardSnapshot`, and
  `@rieul3d/exporters` `exportPngRgba` instead of adding a separate renderer path.
- The command accepts optional output path, width, and height arguments for ad hoc captures.

## Known Gaps

- Post-processing currently exposes a renderer-owned fullscreen pass contract only; scene IR does
  not declare effect graphs yet.
- The current pathtraced renderer slices support sphere/box SDF scenes and static triangle-mesh
  scenes with BVHs derived from mesh geometry, but should still be treated as a renderer-boundary
  milestone rather than the final path-tracing feature set.
- Custom WGSL materials do not yet receive a first-class shared alpha-policy binding, so uber
  partitioning currently treats non-opaque custom materials as forward-only.
- Renderer-side picking currently targets mesh nodes only; SDF, volume, and per-triangle picking are
  still pending.
- SDF execution currently supports sphere and box primitives only; broader graph/operator coverage
  is still pending.
