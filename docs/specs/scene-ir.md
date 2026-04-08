# Scene IR

## Source of Truth

The serializable scene model is defined in BDL at
[`engine/ir/schema/scene_ir.bdl`](../../engine/ir/schema/scene_ir.bdl). The TypeScript mirror in
`engine/ir/generated` is treated as generated output. The schema uses the BDL `conventional`
standard and declares that explicitly with `# standard - conventional`.

## Codegen Guardrails

- Keep generated IR mirrors aligned with the BDL schema before landing schema changes.
- There is no Deno task wrapper in the Bun/Electrobun runtime layout.
- Generated files in `engine/ir/generated` must be a pure function of the BDL schema.
- Stale generated files and schema/output drift are treated as check failures in CI.

## Core Concepts

- Assets describe external source data such as images, geometry files, or volume grids.
- Scene IR describes spatial declarations: nodes, primitives, materials, lights, textures,
  animations, and graph bindings.
- IR does not contain `GPUBuffer`, `GPUTexture`, pipelines, or frame scratch state.

## Spatial Primitives

- `mesh`: indexed or non-indexed polygonal geometry
- `light`: first-class scene lights attached to nodes; the initial renderer consumes directional
  lights through node transforms

## Cameras

- `SceneIr.cameras` stores camera declarations separately from nodes.
- `SceneIr.activeCameraId` selects the camera used for raster-space projection.
- Nodes can bind a camera with `node.cameraId`, which places that camera in the spatial graph and
  gives it an evaluated world transform.
- The schema currently models cameras as a tagged union rather than a shared enum-driven record:
  `perspective` and `orthographic` can carry different parameter sets without forcing unused fields.
- This keeps the IR open to future camera families such as fisheye or panoramic cameras that may
  need incompatible parameters.

## Evaluation

Core evaluation resolves local transforms into world transforms and advances animation tracks into
an evaluated scene. Evaluation may reuse scratch buffers internally, but the input IR remains
immutable-friendly.

Current evaluation also resolves the active camera into:

- the selected camera declaration
- the camera node world transform
- an affine `viewMatrix` derived from the camera world transform

Renderers consume that evaluated camera state to build projection-specific clip-space transforms
without mutating the underlying IR.
