# Architecture

## Goal

`goldlight` is a WebGPU-only spatial runtime. It is not a gameplay engine and does not define a
behavior framework, physics system, or editor shell.

## Layers

The runtime is split into explicit data and execution stages:

1. `Asset`: external bytes or file-backed sources such as images, glTF blobs, OBJ text, STL text, or
   volume data.
2. `IR`: serializable spatial declarations defined by BDL and mirrored into TypeScript.
3. `Evaluated Scene`: CPU-side transform, animation, and inheritance results.
4. `Renderer Capability Preflight`: renderer support checks against evaluated scene features and
   material requirements.
5. `Runtime Residency`: device-specific GPU resources and caches.
6. `Render Execution`: forward/deferred/pathtraced pass orchestration.

## Packages

- `packages/ir`: schema and generated types for serializable scene IR.
- BDL schema files must declare an explicit standard. `goldlight` currently uses the `conventional`
  standard for scene IR modules.
- `packages/math`: low-level deterministic math and sampling helpers, including reusable noise
  functions.
- `packages/geometry`: shape definitions, mesh primitive generation, triangulation, and local
  SDF-to-mesh extraction helpers.
- `packages/spatial`: spatial indexing and broad-phase query helpers.
- `packages/core`: pure functions that evaluate IR into renderable CPU state.
- `packages/core` also owns evaluated-camera math helpers such as screen-to-world ray generation for
  interaction foundations.
- `packages/core` also owns reusable CPU-side transform and mesh helpers such as quaternion
  construction, mesh bounds, and generated mesh normals.
- `packages/gpu`: explicit WebGPU context and residency management helpers.
- `packages/renderer`: pass contracts, renderer descriptors, and frame planning.
- `packages/renderer` also owns renderer-side id-buffer picking for mesh-node selection and
  readback.
- `packages/renderer` also owns intermediate scene-color targets plus renderer-managed post-process
  pass execution.
- renderer descriptors also publish capability contracts for primitive/material compatibility before
  execution. See [`renderer-capabilities.md`](./renderer-capabilities.md).
- `packages/procedural`: deterministic CPU-side procedural texture, volume, and future field
  generation helpers.
- `packages/raytrace`: tracing acceleration and traversal helpers for ray or path-traced execution.
- `packages/importers`: format parsers that normalize input into Scene IR.
- `packages/react`: declarative scene authoring that feeds the same IR/core pipeline.
- `packages/exporters`: output encoders that serialize renderer results such as PNG.
- device-loss recovery remains a caller-visible workflow rather than an implicit runtime reset. See
  [`device-loss-recovery.md`](./device-loss-recovery.md).

## Utility Module Direction

Utility and generation modules that are still evolving should organize around roles before they are
split into new public packages.

- `math`: pure math and geometry fundamentals
- `geometry`: shape definitions, splines, triangulation, and mesh generation
- `spatial`: general-purpose spatial indexing and query helpers
- `procedural`: noise, fields, SDF composition, and procedural asset generation
- `raytrace`: tracing acceleration structures and traversal helpers

These role-oriented packages are the intended public surface for evolving utility code. See
[`../adr/0012-role-oriented-utility-package-layout.md`](../adr/0012-role-oriented-utility-package-layout.md).

## Current Runtime Surface

The current scaffold already includes:

- mesh GPU residency upload and caching
- texture GPU residency upload and caching
- forward frame encoding for mesh draws
- template-assembled built-in unlit/lit shaders with template-specific variants and binding-spec
  driven forward material pipeline layouts
- forward lit metallic-roughness shading with EXR-backed environment-map diffuse/specular IBL
- local-space SDF sphere/box extraction into `MeshPrimitive` geometry through marching-cubes and
  naive surface-nets helpers
- intermediate scene-color routing plus first renderer-owned fullscreen post-process blit pass
- built-in unlit base-color texture sampling, material parameter uploads, and custom WGSL pipeline
  registration
- headless snapshot readback and PNG encoding
- browser surface binding and a bundled browser example
- a Windows BYOW triangle example for native Deno surface presentation
- Windows-native forward/pathtraced Damaged Helmet demos for real imported material validation
- device-loss observation and residency rebuild helpers
- explicit device-loss recovery sequencing for device replacement and target rebinding
- benchmark coverage for key runtime paths, including material binding and renderer capability
  preflight costs
- screen-to-world ray construction from evaluated perspective and orthographic camera state
- offscreen mesh-node pick snapshots with stable node-to-mesh id decoding

## Design Constraints

- Public APIs are plain data + functions first.
- `class` is allowed only for performance-sensitive residency or lifetime concerns.
- Scene IR must remain platform-neutral and serializable.
- Renderer behavior must not leak into IR schema design.
