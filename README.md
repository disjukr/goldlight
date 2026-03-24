# goldlight

`goldlight` is a functional WebGPU spatial runtime for Deno and browsers.

The repository is organized as a Deno workspace with packages for:

- `@goldlight/ir`: BDL-backed scene IR definitions
- `@goldlight/core`: scene evaluation and animation helpers
- `@goldlight/math`: low-level deterministic sampling and reusable math helpers
- `@goldlight/geometry`: shape definition, mesh primitive generation, and local SDF-to-mesh helpers
- `@goldlight/spatial`: spatial indexing and broad-phase query helpers
- `@goldlight/procedural`: deterministic procedural texture and volume generators
- `@goldlight/raytrace`: tracing acceleration and traversal helpers
- `@goldlight/gpu`: WebGPU context and runtime residency helpers
- `@goldlight/renderer`: forward/deferred frame planning and execution contracts
- `@goldlight/importers`: OBJ/STL/PLY/glTF ingestion into scene IR
- `@goldlight/react`: declarative authoring adapter
- `@goldlight/react/reconciler`: experimental React reconciler host over the package-local scene
  document
- `@goldlight/exporters`: output encoders such as PNG
- `@goldlight/desktop`: single-process desktop shell bootstrap over a Rust `winit` FFI host

The design source of truth lives in [`docs/specs`](./docs/specs) and [`docs/adr`](./docs/adr).

Utility and generation modules are organized around role-oriented boundaries such as `geometry`,
`spatial`, `procedural`, and `raytrace`. See
[`docs/adr/0012-role-oriented-utility-package-layout.md`](./docs/adr/0012-role-oriented-utility-package-layout.md).

## Documentation Map

- Start at [`docs/README.md`](./docs/README.md) for a guided index across architecture, runtime,
  schema, and contributor references.
- Browse [`docs/specs/README.md`](./docs/specs/README.md) for design and behavior specifications.
- Browse [`docs/adr/README.md`](./docs/adr/README.md) for accepted architectural decisions.
- Browse [`docs/adr/proposals.md`](./docs/adr/proposals.md) for proposed architectural decisions.
- Browse [`examples/README.md`](./examples/README.md) for runnable example entry points.

## Status

This is an initial scaffold that establishes package boundaries, Scene IR, residency separation,
importer entry points, and frame-planning contracts. It is intentionally functional-first and avoids
object-oriented API design.

Implemented today:

- BDL-driven `SceneIr` generation with drift checks in CI
- camera declarations in Scene IR plus evaluated active-camera view/projection support
- screen-to-world mouse ray generation from evaluated camera state for interaction foundations
- reusable core helpers for quaternion-from-Euler rotation authoring, mesh bounds, and generated
  mesh normals
- mesh and texture residency upload paths
- forward rendering, minimal deferred mesh execution with built-in unlit/lit plus custom WGSL
  G-buffer paths, deferred directional-light resolve support, optional scene-color post-process blit
  passes, first-class directional light nodes with built-in forward metallic-roughness shading,
  EXR-backed environment-map diffuse/specular IBL in the forward lit path, template-assembled built-
  in unlit/lit shader variants with binding-spec-driven forward material pipeline layouts, triangle-
  BVH mesh path tracing plus caller-owned pathtraced scene extensions, and headless snapshot
  readback
- forward-renderer cubemap capture for mesh, SDF, and volume scenes as six ordered offscreen face
  snapshots, plus CPU-side export helpers for equirectangular, angular-map, cross, and strip layouts
  with optional filtered reprojection and caller-controlled output dimensions
- Perlin gradient-noise samplers in `@goldlight/math` plus grayscale texture/volume generators in
  `@goldlight/procedural` that share the existing deterministic seed model
- triangle BVH construction in `@goldlight/raytrace` plus a mesh pathtraced renderer slice for static
  mesh scenes
- local-space SDF-to-mesh extraction for supported sphere and box primitives, including
  canonical-table marching-cubes and naive surface-nets contouring helpers for baking or inspection
  workflows
- mesh node id-buffer picking snapshots with stable node-to-mesh id mapping and screen-pixel
  readback helpers
- built-in unlit material registration, evaluated mesh transform uploads, base-color texture
  sampling, material parameter uploads, custom WGSL registration, declared material texture
  bindings, explicit alpha-policy bindings, and residency-aware custom texture binding validation
- first-class material alpha policy fields (`alphaMode`, `alphaCutoff`, `renderQueue`, `depthWrite`,
  and `doubleSided`) plus uber forward/deferred mesh partitioning
- depth-tested forward mesh rendering with per-target depth attachments and back-face culling
- glTF JSON, GLB, data-URI buffers, and caller-provided external glTF resource ingestion
- ASCII PLY ingestion for in-repo meshes such as the Stanford Bunny reconstruction asset
- browser/Deno helpers for resolving external glTF buffers and images into the existing importer
  contract
- direct surface/offscreen target literals at the call site instead of a dedicated target-helper
  package
- browser canvas examples, Windows BYOW native textured demo, headless PNG snapshot workflow, and
  PNG snapshot encoding
- Windows BYOW Damaged Helmet pathtraced demo using the vendored GLB asset and triangle-BVH mesh
  path tracing
- Windows BYOW Cornell Helmet pathtraced demo combining the Damaged Helmet mesh with Cornell-box SDF
  walls and light
- Windows BYOW primitives demo using `@goldlight/geometry`, a reusable BYOW runner script, built-in
  `lit` materials, and directional-light shading
- Windows BYOW Stanford Bunny demo authored through `@goldlight/react`, loading the vendored ASCII PLY
  mesh, generating runtime normals for built-in lit shading, and publishing live bunny rotation
  updates through the experimental React reconciler host
- a browser React authoring example plus the current `createSceneRoot()` snapshot path that commits
  JSX-authored trees into `SceneIr` snapshots before rendering, including JSX-authored scene
  resources such as meshes, materials, cameras, textures, assets, and animation clips, exported
  convenience components for common camera/light composition, an internal React-owned scene document
  that preserves stable resource and node host instances across commits before publishing data-only
  snapshots, and commit-summary, update-plan, plus `updatePayload` helpers for targeted residency
  invalidation without forcing resets for transform-only node changes
- an experimental `@goldlight/react/reconciler` entrypoint that mounts normal React components into
  the package-local scene document so hooks, state updates, and layout effects can publish live
  `SceneIr` snapshots without rebuilding authored trees by hand
- that live reconciler path now supports typed TSX scene/resource intrinsics plus React-runtime
  camera/light convenience components built from the primitive `<camera>`, `<light>`, and `<node>`
  surface, and the BYOW Stanford Bunny demo now uses that normal TSX authoring flow
- `createSceneRootForwardRenderer()` and `createSceneRootUberRenderer()` convenience adapters that
  bundle scene flushing, evaluation, residency upload, and renderer invocation
- proposed ADR/discussion tracking for the next React live-update boundary decision around
  partial-apply scene updates without renderer ownership, plus the next proposed reconciler
  scene-document boundary for issue #112
- fixture-backed golden snapshot regression tests for clear, mesh, sphere/box SDF, volume, and
  recovery rebuild renders, including guards against raymarch fixtures collapsing back to clear-only
  output
- device-loss observation and residency rebuild helpers plus end-to-end offscreen recovery coverage
- benchmark coverage for residency, material binding, and renderer capability preflight paths
- renderer capability preflight for primitive and material compatibility, including deferred-path
  NORMAL, TEXCOORD_0, and baseColor residency gating

## Documentation

- Architecture overview: [`docs/specs/architecture.md`](./docs/specs/architecture.md)
- Procedural generation contracts:
  [`docs/specs/procedural-generation.md`](./docs/specs/procedural-generation.md)
- SDF-to-mesh extraction contracts:
  [`docs/specs/sdf-mesh-extraction.md`](./docs/specs/sdf-mesh-extraction.md)
- Cubemap capture contracts: [`docs/specs/cubemap-capture.md`](./docs/specs/cubemap-capture.md)
- Cubemap export contracts: [`docs/specs/cubemap-export.md`](./docs/specs/cubemap-export.md)
- Rendering contracts: [`docs/specs/rendering.md`](./docs/specs/rendering.md)
- Renderer capability model:
  [`docs/specs/renderer-capabilities.md`](./docs/specs/renderer-capabilities.md)
- Device-loss recovery contract:
  [`docs/specs/device-loss-recovery.md`](./docs/specs/device-loss-recovery.md)
- Runtime residency and rebuild rules:
  [`docs/specs/runtime-residency.md`](./docs/specs/runtime-residency.md)
- Interaction utilities: [`docs/specs/interaction.md`](./docs/specs/interaction.md)
- Desktop shell contracts: [`docs/specs/desktop-shell.md`](./docs/specs/desktop-shell.md)

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
- `deno task asset:examples`: refresh the in-repo example assets (`Stanford Bunny` and
  `DamagedHelmet`)
- `deno task asset:stanford-bunny`: refresh the Stanford Bunny source archive and extracted PLY
- `deno task asset:damaged-helmet`: refresh the Khronos `DamagedHelmet.glb` sample
- `deno task asset:sponza`: download the ignored Khronos `Sponza` sample under
  `examples/assets/sponza`
- `deno task desktop:host:build`: compile the Rust `winit` FFI host for `@goldlight/desktop`
- `deno task desktop:host:check`: type-check the Rust `winit` host crate without producing a DLL
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
- `deno task example:byow:cornell-helmet:check`: type-check the Windows BYOW Cornell Helmet
  pathtraced demo
- `deno task example:byow:cornell-helmet:run`: open the Windows BYOW Cornell Helmet pathtraced demo
- `deno task example:byow:pathtraced:check`: type-check the default Windows BYOW mesh pathtraced
  demo
- `deno task example:byow:pathtraced:run`: open the default Windows BYOW mesh pathtraced demo
- `deno task example:byow:helmet-pathtraced:check`: type-check the Windows BYOW Damaged Helmet
  pathtraced demo
- `deno task example:byow:helmet-pathtraced:run`: open the Windows BYOW Damaged Helmet pathtraced
  demo
- `deno task example:byow:react-bunny:check`: type-check the Windows BYOW React Stanford Bunny demo
- `deno task example:byow:react-bunny:run`: open the Windows BYOW React Stanford Bunny demo Golden
  snapshot fixtures live in [`tests/fixtures/golden-snapshots`](./tests/fixtures/golden-snapshots).
  Refresh them intentionally with
  `deno run -A --unstable-raw-imports ./scripts/refresh_golden_snapshots.ts`.

## Benchmarks

- Run `deno task bench` before and after runtime-facing changes.
- Compare the `runtime_paths` benchmark names directly across runs so residency upload, material
  binding, capability preflight, and frame encoding regressions stay visible in review.
- When a style or architecture exception is performance-motivated, include the benchmark delta in
  the PR summary.
