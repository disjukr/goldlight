# Architecture

## Goal

`rieul3d` is a WebGPU-only spatial runtime. It is not a gameplay engine and does not define a
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
6. `Render Execution`: forward/deferred/raymarch pass orchestration.

## Packages

- `packages/ir`: schema and generated types for serializable scene IR.
- BDL schema files must declare an explicit standard. `rieul3d` currently uses the `conventional`
  standard for scene IR modules.
- `packages/core`: pure functions that evaluate IR into renderable CPU state.
- `packages/gpu`: explicit WebGPU context and residency management helpers.
- `packages/renderer`: pass contracts, renderer descriptors, and frame planning.
- renderer descriptors also publish capability contracts for primitive/material compatibility before
  execution. See [`renderer-capabilities.md`](./renderer-capabilities.md).
- `packages/loaders`: format parsers that normalize input into Scene IR.
- `packages/react`: declarative scene authoring that feeds the same IR/core pipeline.
- `packages/platform`: target descriptors for browser, Deno, and headless execution.

## Current Runtime Surface

The current scaffold already includes:

- mesh GPU residency upload and caching
- texture GPU residency upload and caching
- first volume GPU residency upload and extraction
- forward frame encoding for mesh draws plus first SDF raymarch execution
- material parameter uploads and custom WGSL pipeline registration
- headless snapshot readback and PNG encoding
- browser surface binding and a bundled browser example
- a Windows BYOW triangle example for native Deno surface presentation
- device-loss observation and residency rebuild helpers
- benchmark coverage for key runtime paths

## Design Constraints

- Public APIs are plain data + functions first.
- `class` is allowed only for performance-sensitive residency or lifetime concerns.
- Scene IR must remain platform-neutral and serializable.
- Renderer behavior must not leak into IR schema design.
