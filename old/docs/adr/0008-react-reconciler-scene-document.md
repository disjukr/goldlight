# ADR 0008: React Reconciler Scene Document Boundary

## Status

Accepted

## Decision

`@disjukr/goldlight/react` should introduce a real `react-reconciler` host on top of a package-owned
scene document instead of driving live updates by rebuilding whole `SceneIr` snapshots directly from
each React commit.

This scene document should be a React-adjacent but renderer-independent object graph that:

- owns stable host instances for scene resources and nodes created by reconciler
  mount/update/unmount operations
- preserves explicit parent/child relationships and resource bindings in a form that can be updated
  incrementally across React commits
- can derive published data snapshots or update payloads for non-React runtime adapters
- stays inside `@disjukr/goldlight/react` rather than becoming the new public source of truth for
  core packages

The proposed execution boundary is:

- React components reconcile against host instances owned by `@disjukr/goldlight/react`
- host operations update an internal scene document instead of mutating GPU/runtime state directly
- the scene document publishes data-only scene snapshots and/or partial-apply update payloads across
  the boundary preferred by ADR 0006
- runtime residency, renderer execution, offscreen targets, and multi-scene orchestration remain
  outside the React package

The first implementation milestone should stay narrow:

- add an internal scene document for authored resources and nodes
- define stable host-instance identity and update rules for mount, update, insert, and remove
  operations
- keep the published output data-oriented so the existing scene-root bridge can coexist during
  migration
- avoid public APIs that imply React owns renderer lifecycle or GPU resources

## Rationale

ADR 0004 accepted JSX authoring as React's initial role, and ADR 0006 accepted that the long-term
boundary should support partial application of scene changes without pulling renderer ownership into
React. Issue `#112` is the next step in that direction, but a direct jump from today's
snapshot-lowering helpers to a full reconciler host would leave an important ownership gap.

Without a package-owned scene document:

- reconciler commits would either keep regenerating full `SceneIr` snapshots, which hardens the
  provisional bridge that ADR 0006 explicitly avoids
- or host instances would need to mutate residency/renderer state directly, which would violate the
  existing package layering

An internal scene document gives the reconciler a stable object model to target while preserving the
current architectural constraint that core runtime packages remain React-independent.

## Consequences

- `@disjukr/goldlight/react` gains an internal mutable document/host-instance layer even though its
  published APIs should remain data-oriented
- the current `createG3dSceneRoot()` snapshot bridge becomes an implementation waypoint instead of
  the only viable React integration path
- reconciler work can be split into bounded slices: scene document first, host config second,
  runtime adapter integration third
- React-driven live updates can evolve without making render targets, portals, or multi-scene
  composition React-only concepts
- future public APIs should describe scene data changes and subscriptions, not direct GPU object
  handles

## Alternatives Considered

- keep whole-scene snapshot regeneration as the reconciler backend: simplest short-term path, but it
  would formalize the coarse update boundary that ADR 0006 treats as provisional
- let the reconciler host mutate renderer/runtime state directly: would reduce one layer, but it
  would collapse the package boundary and make non-React orchestration second-class
- introduce a public frame-graph or renderer-owned scene document first: too execution-specific for
  the current React problem, and it would front-load decisions outside issue `#112`'s core scope

Related issues: `#112`, `#117`
