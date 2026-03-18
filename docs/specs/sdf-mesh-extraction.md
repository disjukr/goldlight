# SDF Mesh Extraction

## Goal

`@rieul3d/primitives` exposes CPU-side helpers that convert supported signed distance field
primitives into `MeshPrimitive` geometry for baking, inspection, and mesh-pipeline reuse.

## Current Scope

- extraction currently supports `sphere` and `box` SDF primitives only
- extraction runs over a caller-provided or inferred bounded regular grid
- outputs are local-space `MeshPrimitive` values so callers can reuse the original node transform
- two extraction modes are available:
  - `marching-cubes`: per-cell edge intersection contouring with centroid fan triangulation
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

- `marching-cubes` currently emits per-cell contour polygons and triangulates them around the local
  centroid. This is straightforward and stable for the current primitive set, but it duplicates
  vertices across cells and does not yet implement the canonical ambiguous-case lookup tables.
- `surface-nets` emits fewer vertices and shared indexed faces, which makes it a better fit for
  compact baked meshes. The first pass is intentionally naive and prioritizes deterministic output
  over feature-complete topology repair.

## Validation

- unsupported SDF operators throw instead of silently returning empty meshes
- extraction rejects non-positive primitive dimensions, non-finite scalar inputs, and non-positive
  grid resolutions
- surface-nets stitches boundary-touching contours instead of dropping cap faces when tight bounds
  place the iso-surface directly on the sampling box
- regression tests cover deterministic output, mesh validity, and basic sphere/box shape fidelity

## Follow-Up Direction

- broaden primitive coverage when runtime SDF execution supports more operators
- add canonical marching-cubes case-table handling for ambiguous cube configurations
- evaluate optional world-space extraction helpers that consume evaluated node transforms directly
