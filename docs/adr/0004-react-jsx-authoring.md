# ADR 0004: JSX-First React Authoring Boundary

## Status

Proposed

## Decision

`@rieul3d/react` exposes a JSX authoring surface that lowers into rieul3d-owned scene data. JSX is
the package's public authoring boundary, but React does not become the source of truth for core
runtime state.

The package now owns:

- TSX/JSX scene authoring primitives such as `<scene>` and `<node>`
- component composition over authoring trees
- lowering authored trees into Scene IR inputs for the existing runtime packages

The package still does not own:

- a live reconciler that mutates residency or renderer state directly
- renderer execution, GPU ownership, or Scene IR schema definition
- a requirement that core packages depend on React or JSX

## Consequences

- users can author scene trees in a React-shaped TSX surface without replacing the functional core
- the package can grow toward a reconciler later without changing the core runtime ownership model
- helper-first authoring APIs remain valid as lower-level escape hatches during the transition
