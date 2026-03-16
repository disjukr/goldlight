# Scene IR

## Source of Truth

The serializable scene model is defined in BDL at
[`packages/ir/schema/scene_ir.bdl`](../../packages/ir/schema/scene_ir.bdl). The TypeScript mirror in
`packages/ir/src/generated` is treated as generated output. The schema uses the BDL `conventional`
standard and declares that explicitly with `# standard - conventional`.

## Core Concepts

- Assets describe external source data such as images, geometry files, or volume grids.
- Scene IR describes spatial declarations: nodes, primitives, materials, textures, animations, and
  graph bindings.
- IR does not contain `GPUBuffer`, `GPUTexture`, pipelines, or frame scratch state.

## Spatial Primitives

- `mesh`: indexed or non-indexed polygonal geometry
- `sdf`: signed distance field graphs or primitives for raymarching
- `volume`: voxel or density grid primitives

## Evaluation

Core evaluation resolves local transforms into world transforms and advances animation tracks into
an evaluated scene. Evaluation may reuse scratch buffers internally, but the input IR remains
immutable-friendly.
