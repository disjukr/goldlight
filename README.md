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

## Documentation Map

- Start at [`docs/README.md`](./docs/README.md) for a guided index across architecture, runtime,
  schema, and contributor references.
- Browse [`docs/specs/README.md`](./docs/specs/README.md) for design and behavior specifications.
- Browse [`docs/adr/README.md`](./docs/adr/README.md) for accepted architectural decisions.
- Browse [`examples/README.md`](./examples/README.md) for runnable example entry points.

## Status

This is an initial scaffold that establishes package boundaries, Scene IR, residency separation,
loader entry points, and frame-planning contracts. It is intentionally functional-first and avoids
object-oriented API design.

Implemented today:

- BDL-driven `SceneIr` generation with drift checks in CI
- mesh, texture, and first volume residency upload paths
- forward rendering, first SDF raymarch execution, and headless snapshot readback
- built-in unlit material registration, material parameter uploads, and custom WGSL registration
- browser canvas example, Windows BYOW triangle example, and PNG snapshot encoding
- device-loss observation and residency rebuild helpers
- renderer capability preflight for primitive and material compatibility

## Documentation

- Architecture overview: [`docs/specs/architecture.md`](./docs/specs/architecture.md)
- Rendering contracts: [`docs/specs/rendering.md`](./docs/specs/rendering.md)
- Renderer capability model: [`docs/specs/renderer-capabilities.md`](./docs/specs/renderer-capabilities.md)
- Runtime residency and rebuild rules: [`docs/specs/runtime-residency.md`](./docs/specs/runtime-residency.md)

## Quick Start

Read in this order when onboarding:

1. [`docs/specs/architecture.md`](./docs/specs/architecture.md)
2. [`docs/specs/scene-ir.md`](./docs/specs/scene-ir.md)
3. [`docs/specs/runtime-residency.md`](./docs/specs/runtime-residency.md)
4. [`docs/specs/rendering.md`](./docs/specs/rendering.md)
5. [`examples/browser_forward/README.md`](./examples/browser_forward/README.md)

## Tasks

- `deno task check`: format, codegen drift check, lint, test, and bench preflight
- `deno task docs:check`: format-check docs, packages, tests, benches, and examples content
- `deno task generate:ir`: regenerate TypeScript from BDL IR
- `deno task generate:ir:check`: fail when generated IR files are stale
- `deno task setup:sdl2:windows`: download the official SDL2 Windows runtime for BYOW examples
- `deno task example:browser:build`: bundle the browser forward-rendering example
- `deno task example:browser:serve`: serve the repository for local browser testing
- `deno task example:byow:check`: type-check the BYOW SDL2 triangle example
- `deno task example:byow:run`: open the Windows BYOW triangle example
