# SDF Mesh Extraction

## Goal

`@goldlight/geometry` exposes CPU-side helpers that convert supported signed distance field
primitives into `MeshPrimitive` geometry for baking, inspection, and mesh-pipeline reuse.

## Current Scope

- extraction currently supports `sphere` and `box` SDF primitives only
- extraction runs over a caller-provided or inferred bounded regular grid
- outputs are local-space `MeshPrimitive` values so callers can reuse the original node transform
- two extraction modes are available:
  - `marching-cubes`: canonical edge/case-table contouring over each active cell
  - `surface-nets`: one vertex per active cell with shared indexed quads stitched across crossing
    edges

## API Surface

- `inferSdfExtractionBounds(primitive, padding?)`: infer a local sampling AABB for supported SDF
  primitives
- `extractMarchingCubesMesh(primitive, options?)`: build a triangle mesh using the marching-cubes
  contouring path
- `extractSurfaceNetMesh(primitive, options?)`: build a shared-vertex mesh using the surface-nets
  path
- `extractSdfMesh(primitive, options?)`: dispatch to either algorithm via `options.algorithm`

`ExtractSdfMeshOptions` currently includes:

- `id` / `materialId`: target `MeshPrimitive` identity and optional material binding
- `bounds`: local-space sampling bounds; defaults to inferred bounds for the primitive
- `resolution`: grid cell counts along `x`, `y`, and `z`
- `isoLevel`: iso threshold, defaulting to `0`
- `padding`: inferred-bounds padding for supported primitive types

## Algorithm Tradeoffs

- `marching-cubes` now follows the standard 256-case lookup tables, which removes the previous
  centroid-fan over-triangulation and gives deterministic edge wiring for face-saddle and other
  ambiguous active-cell configurations. It still duplicates vertices across cells because the helper
  prioritizes simple baking output over shared-vertex stitching.
- `surface-nets` emits fewer vertices and shared indexed faces, which makes it a better fit for
  compact baked meshes. The first pass is intentionally naive and prioritizes deterministic output
  over feature-complete topology repair.

## Validation

- unsupported SDF operators throw instead of silently returning empty meshes
- extraction rejects non-positive primitive dimensions, non-finite scalar inputs, and non-positive
  grid resolutions
- marching-cubes regression tests cover direct case-table wiring and guard against regressing back
  to centroid-fan triangulation on multi-edge cells
- marching-cubes drops zero-area triangles when exact iso-level hits collapse multiple active edges
  onto the same endpoint
- surface-nets stitches boundary-touching contours instead of dropping cap faces when tight bounds
  place the iso-surface directly on the sampling box
- regression tests cover deterministic output, mesh validity, and basic sphere/box shape fidelity

## Follow-Up Direction

- broaden primitive coverage when runtime SDF execution supports more operators
- evaluate optional world-space extraction helpers that consume evaluated node transforms directly
