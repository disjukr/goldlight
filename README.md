# rieul3d

`rieul3d` is a functional WebGPU spatial runtime for Deno and browsers.

The repository is organized as a Deno workspace with packages for:

- `@rieul3d/ir`: BDL-backed scene IR definitions
- `@rieul3d/core`: scene evaluation and animation helpers
- `@rieul3d/gpu`: WebGPU context and runtime residency helpers
- `@rieul3d/renderer`: forward/deferred frame planning and execution contracts
- `@rieul3d/primitives`: procedural polygon mesh generators for common shapes; separate from SDF
  primitives
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
- camera declarations in Scene IR plus evaluated active-camera view/projection support
- mesh, texture, first volume residency upload paths, and first volume raymarch execution
- forward rendering, minimal deferred mesh execution with built-in unlit/lit plus custom WGSL
  G-buffer paths, deferred directional-light resolve support, optional baseColor texture sampling,
  post-lighting deferred SDF/volume composition, first-class directional light nodes with built-in
  forward Lambert shading, first SDF raymarch execution, and headless snapshot readback
- forward SDF sphere and box raymarch execution with capability preflight alignment
- built-in unlit material registration, evaluated mesh transform uploads, base-color texture
  sampling, material parameter uploads, custom WGSL registration, declared material texture
  bindings, and residency-aware custom texture binding validation
- depth-tested forward mesh rendering with per-target depth attachments and back-face culling
- glTF JSON, GLB, data-URI buffers, and caller-provided external glTF resource ingestion
- browser/Deno helpers for resolving external glTF buffers and images into the existing loader
  contract
- browser canvas examples, Windows BYOW native textured demo, headless PNG snapshot workflow, and
  PNG snapshot encoding
- Windows BYOW primitives demo using `@rieul3d/primitives`, a reusable BYOW runner script, and a
  custom lit shader for mesh normals
- a browser React authoring example plus scene-root bridge that commits JSX-authored trees into
  `SceneIr` snapshots before rendering, including JSX-authored scene resources such as meshes,
  materials, and cameras
- proposed ADR/discussion tracking for the next React live-update boundary decision: whether
  scene-root commits should stay snapshot-only or expose diff/apply metadata
- fixture-backed golden snapshot regression tests for clear, mesh, sphere/box SDF, volume, and
  recovery rebuild renders, including guards against raymarch fixtures collapsing back to clear-only
  output
- device-loss observation and residency rebuild helpers plus end-to-end offscreen recovery coverage
- benchmark coverage for residency, material binding, and renderer capability preflight paths
- renderer capability preflight for primitive and material compatibility, including deferred-path
  NORMAL, TEXCOORD_0, and baseColor residency gating

## Documentation

- Architecture overview: [`docs/specs/architecture.md`](./docs/specs/architecture.md)
- Rendering contracts: [`docs/specs/rendering.md`](./docs/specs/rendering.md)
- Renderer capability model:
  [`docs/specs/renderer-capabilities.md`](./docs/specs/renderer-capabilities.md)
- Device-loss recovery contract:
  [`docs/specs/device-loss-recovery.md`](./docs/specs/device-loss-recovery.md)
- Runtime residency and rebuild rules:
  [`docs/specs/runtime-residency.md`](./docs/specs/runtime-residency.md)

## Quick Start

Read in this order when onboarding:

1. [`docs/specs/architecture.md`](./docs/specs/architecture.md)
2. [`docs/specs/scene-ir.md`](./docs/specs/scene-ir.md)
3. [`docs/specs/runtime-residency.md`](./docs/specs/runtime-residency.md)
4. [`docs/specs/rendering.md`](./docs/specs/rendering.md)
5. [`examples/browser_forward/README.md`](./examples/browser_forward/README.md)
6. [`examples/browser_textured_forward/README.md`](./examples/browser_textured_forward/README.md)
7. [`examples/browser_react_authoring/README.md`](./examples/browser_react_authoring/README.md)
8. [`examples/byow_primitives_demo/README.md`](./examples/byow_primitives_demo/README.md)
9. [`examples/byow_native_demo/README.md`](./examples/byow_native_demo/README.md)
10. [`examples/headless_snapshot/README.md`](./examples/headless_snapshot/README.md)

## Tasks

- `deno task check`: format, codegen drift check, lint, test, and bench preflight
- `deno task docs:check`: format-check docs, packages, tests, benches, and examples content
- `deno task generate:ir`: regenerate TypeScript from BDL IR
- `deno task generate:ir:check`: fail when generated IR files are stale
- `deno task setup:sdl2:windows`: download the official SDL2 Windows runtime for BYOW examples
- `deno task example:headless:check`: type-check the headless snapshot PNG workflow
- `deno task example:headless:png`: render a headless frame and write
  `examples/headless_snapshot/out/forward.png`
- `deno task example:browser:build`: bundle the browser forward-rendering example
- `deno task example:browser:react:build`: bundle the React authoring browser example
- `deno task example:browser:textured:build`: bundle the textured browser forward example
- `deno task example:browser:custom-textured:build`: bundle the custom textured browser example
- `deno task example:browser:serve`: serve the repository for local browser testing
- `deno task example:byow:check`: type-check the Windows BYOW native demo
- `deno task example:byow:run`: open the Windows BYOW native demo
- `deno task example:byow:triangle:check`: type-check the Windows BYOW triangle smoke test
- `deno task example:byow:triangle:run`: open the Windows BYOW triangle smoke test
- `deno task example:byow:primitives:check`: type-check the Windows BYOW primitives demo
- `deno task example:byow:primitives:run`: open the Windows BYOW primitives demo

Golden snapshot fixtures live in
[`tests/fixtures/golden-snapshots`](./tests/fixtures/golden-snapshots). Refresh them intentionally
with `deno run -A --unstable-raw-imports ./scripts/refresh_golden_snapshots.ts`.

## Benchmarks

- Run `deno task bench` before and after runtime-facing changes.
- Compare the `runtime_paths` benchmark names directly across runs so residency upload, material
  binding, capability preflight, and frame encoding regressions stay visible in review.
- When a style or architecture exception is performance-motivated, include the benchmark delta in
  the PR summary.
