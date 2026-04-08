# ADR 0006: React Scene Update Planning Boundary

## Status

Accepted

## Decision

`@disjukr/goldlight/react` should evolve toward a scene update boundary that supports partial
application of authored changes instead of treating full-scene snapshot publication as the long-term
live-update contract.

React state should be able to drive frequent scene changes such as node transform updates without
forcing full residency rebuilds for the whole scene. At the same time, goldlight still needs to keep
scene evaluation, residency, rendering, offscreen targets, and multi-scene composition available
outside React so features such as portals, minimaps, portraits, and scene-to-texture workflows do
not become React-only concepts.

The proposed boundary is:

- React-facing authoring may still commit trees through a root object such as
  `createG3dSceneRoot()`, but full-scene `SceneIr` snapshots are a provisional implementation path,
  not the desired final public update contract
- the long-term live-update boundary should admit partial node/resource application so
  high-frequency React state changes can avoid whole-scene residency rebuilds
- scene evaluation, residency ownership, frame execution, render targets, and multi-scene
  orchestration stay outside the React package
- any update-planning layer should stay data-oriented enough to connect to React shallowly while
  remaining usable by non-React orchestration code
- scene-to-texture and multi-scene composition remain first-class runtime/orchestration concerns and
  must not be constrained by a single-scene React commit model

The update contract should be concrete about mutation classes:

- node transform, parenting, and binding changes should be representable without implying that all
  scene residency must be rebuilt
- mesh, material, texture, light, camera, and asset changes should be distinguishable from node-only
  updates so runtime adapters can choose between partial apply and broader invalidation
- render-target, offscreen-pass, and scene-composition relationships must stay expressible above any
  single-scene React adapter boundary
- update plans should describe data changes, not GPU object mutations, so runtime layers remain free
  to choose caching and application strategy

The repository's current implementation waypoint is:

- `createG3dSceneRoot()` publishes full `SceneIr` snapshots with previous-scene and revision
  metadata
- `summarizeSceneRootCommit()` derives collection-level change summaries from snapshot pairs
- `commitSummaryNeedsResidencyReset()` marks the current conservative reset boundary for
  integrations

That waypoint is acceptable for low-frequency authored scene changes, but it is intentionally too
coarse for high-frequency React-driven node animation.

This keeps ADR 0004's ownership model intact while avoiding a path where React commit-time updates
either stay trapped behind full-scene snapshots or pull all render-graph concerns into the React
package.

Related discussion: `#85`, "ADR 0006: React scene update planning boundary for
@disjukr/goldlight/react"

## Consequences

- `@disjukr/goldlight/react` can move beyond one-shot lowering without forcing frequent transform
  updates through whole-scene snapshot replacement
- the current `createG3dSceneRoot()` snapshot bridge remains useful as an implementation waypoint,
  but it should not harden into the final live-update contract
- finer-grained node/resource application becomes an explicit design goal instead of an optional
  optimization
- multi-scene orchestration and scene-to-texture workflows keep a clear home outside React package
  ownership
- future implementation work can focus on change planning, partial apply semantics, and runtime
  adapter boundaries without needing a separate ADR just to restate snapshot-vs-diff payload shape
