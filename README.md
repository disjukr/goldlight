# rieul3d

`rieul3d` is a functional WebGPU spatial runtime for Deno and browsers.

The repository is organized as a Deno workspace with packages for:

- `@rieul3d/ir`: BDL-backed scene IR definitions
- `@rieul3d/core`: scene evaluation and animation helpers
- `@rieul3d/gpu`: WebGPU context and runtime residency helpers
- `@rieul3d/renderer`: forward/deferred frame planning and execution contracts
- `@rieul3d/loaders`: OBJ/STL/glTF ingestion into scene IR
- `@rieul3d/react`: declarative authoring adapter
- `@rieul3d/platform`: browser, Deno, and headless targets

The design source of truth lives in [`docs/specs`](./docs/specs) and [`docs/adr`](./docs/adr).

## Status

This is an initial scaffold that establishes package boundaries, Scene IR, residency separation,
loader entry points, and frame-planning contracts. It is intentionally functional-first and avoids
object-oriented API design.
