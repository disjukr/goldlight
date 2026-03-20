# ADR 0012: Role-Oriented Utility Package Layout

## Status

Accepted

## Decision

The utility and generation surface uses role-oriented package boundaries instead of broad or
ambiguous buckets such as `primitives`.

The target roles are:

- `math`: pure math and geometry fundamentals such as vectors, matrices, rays, and low-level noise
  math helpers
- `geometry`: shape definition, spline work, triangulation, mesh generation, and mesh primitive
  builders
- `spatial`: general-purpose spatial indexing and broad-phase query helpers such as quadtrees,
  octrees, grids, and culling helpers
- `procedural`: procedural content and field generation such as noise, fields, SDF composition,
  volume generation, and procedural scene or asset generation
- `raytrace`: ray or path tracing acceleration structures and traversal helpers such as BVH, BLAS,
  TLAS, triangle intersection helpers, and flattened traversal layouts

These roles are exposed through explicit public packages in the workspace.

## Rationale

The previous boundaries around `primitives`, procedural generation, and tracing helpers were too
blurred to scale cleanly.

- mesh primitives belong to geometry, not to a top-level catch-all package name
- SDF primitives and field composition belong to procedural work, even when they later feed mesh
  extraction
- spatial indexing structures are general-purpose query tools, not renderer-owned utilities
- tracing acceleration structures are related to space partitioning, but operationally they belong
  to the tracing execution stack

Using role-based boundaries makes it easier to grow these areas without forcing unrelated concerns
into the same package or namespace, and the current workspace already reflects that split.

## Consequences

- stable runtime packages remain separate from generation/tooling packages: `ir`, `core`, `gpu`,
  `renderer`, `react`, and `desktop` stay distinct from utility roles
- role-oriented utilities publish through dedicated packages: `@rieul3d/math`, `@rieul3d/geometry`,
  `@rieul3d/spatial`, `@rieul3d/procedural`, and `@rieul3d/raytrace`
- legacy catch-all package names such as `primitives` are no longer the primary public boundary
- mesh primitives live under geometry-oriented modules
- SDF and field-generation helpers live under procedural-oriented modules
- scene declarations remain owned by `ir`, not by utility packages

## Alternatives Considered

- keep ambiguous package names and internal buckets indefinitely: lowest churn, but it preserves
  unclear ownership as the feature set grows
- move everything under `core`: simpler workspace count, but it blurs runtime evaluation concerns
  with generation and tooling roles
- split even more aggressively into finer packages now: possible later, but premature until usage
  pressure justifies narrower boundaries

Related issues: `#149`
