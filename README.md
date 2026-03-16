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

Implemented today:

- BDL-driven `SceneIr` generation with drift checks in CI
- mesh, texture, and first volume residency upload paths
- forward rendering and headless snapshot readback
- built-in unlit material registration and custom WGSL registration
- browser canvas example and PNG snapshot encoding
- device-loss observation and residency rebuild helpers

## Tasks

- `deno task check`: format, codegen drift check, lint, test, and bench preflight
- `deno task generate:ir`: regenerate TypeScript from BDL IR
- `deno task generate:ir:check`: fail when generated IR files are stale
- `deno task example:browser:build`: bundle the browser forward-rendering example
- `deno task example:browser:serve`: serve the repository for local browser testing
