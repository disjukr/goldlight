# Scene IR

## Source of Truth

The serializable scene model is defined in BDL at
[`packages/ir/schema/scene_ir.bdl`](../../packages/ir/schema/scene_ir.bdl). The TypeScript mirror in
`packages/ir/src/generated` is treated as generated output. The schema uses the BDL `conventional`
standard and declares that explicitly with `# standard - conventional`.

## Codegen Guardrails

- Regenerate IR mirrors with `deno task generate:ir`.
- Verify generated files are current with `deno task generate:ir:check`.
- Generated files in `packages/ir/src/generated` must be a pure function of the BDL schema.
- Stale generated files and schema/output drift are treated as check failures in CI.

## Core Concepts

- Assets describe external source data such as images, geometry files, or volume grids.
- Scene IR describes spatial declarations: nodes, primitives, materials, lights, textures,
  animations, and graph bindings.
- IR does not contain `GPUBuffer`, `GPUTexture`, pipelines, or frame scratch state.

## Spatial Primitives

- `mesh`: indexed or non-indexed polygonal geometry
- `sdf`: signed distance field graphs or primitives for raymarching
- `volume`: voxel or density grid primitives
- `light`: first-class scene lights attached to nodes; the initial renderer consumes directional
  lights through node transforms

## Evaluation

Core evaluation resolves local transforms into world transforms and advances animation tracks into
an evaluated scene. Evaluation may reuse scratch buffers internally, but the input IR remains
immutable-friendly.
