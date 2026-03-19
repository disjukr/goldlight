# ADR 0012: Role-Oriented Utility Package Layout

## Status

Proposed

## Decision

The unstable utility and generation surface should move toward role-oriented boundaries instead of
broad or ambiguous buckets such as `primitives`.

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

The utility surface should be exposed through explicit role-oriented public packages.

## Rationale

The current boundaries around `primitives`, procedural generation, and future tracing helpers are
starting to blur.

- mesh primitives belong to geometry, not to a top-level catch-all package name
- SDF primitives and field composition belong to procedural work, even when they later feed mesh
  extraction
- spatial indexing structures are general-purpose query tools, not renderer-owned utilities
- tracing acceleration structures are related to space partitioning, but operationally they belong
  to the tracing execution stack

Using role-based boundaries makes it easier to grow these areas without forcing unrelated concerns
into the same package or namespace.

## Consequences

- stable runtime packages remain unchanged: `ir`, `core`, `gpu`, `renderer`, and `react`
- role-oriented utilities should publish through dedicated packages such as `@rieul3d/math`,
  `@rieul3d/geometry`, `@rieul3d/spatial`, `@rieul3d/procedural`, and `@rieul3d/raytrace`
- legacy catch-all package names such as `primitives` should be removed once callers migrate
- mesh primitives should live under geometry-oriented modules
- SDF primitives should live under procedural SDF modules
- scene primitive declarations remain owned by `ir`

## Alternatives Considered

- keep the existing package names and internal buckets indefinitely: lowest churn, but it preserves
  ambiguous ownership as the feature set grows
- split into many new packages immediately: cleaner names, but too much public churn before the
  internal seams are proven useful
- move everything under `core`: simpler workspace count, but it blurs runtime evaluation concerns
  with generation and tooling roles

Related issues: `#149`
