# ADR 0006: React Scene Root Bridge

## Status

Proposed

## Decision

`@rieul3d/react` should add a scene-root bridge before it attempts a full renderer-coupled
reconciler.

That bridge would let React own commit-time scene authoring updates while rieul3d core packages keep
owning Scene IR, evaluation, residency, and rendering. The first live-update step is therefore a
React-facing root that publishes committed scene snapshots through an explicit adapter boundary.

The proposed boundary is:

- React commits authoring trees into `SceneIr` snapshots, not GPU/runtime objects
- a scene-root bridge may notify caller-owned integrations when the authored scene changes
- renderer, residency, and frame execution stay outside the React package
- direct mutation of renderer-owned resources is deferred until a later decision
- snapshot publication is the first target; fine-grained diffing is a follow-up optimization, not
  the initial contract

This keeps the first live-update step aligned with ADR 0004's ownership model while creating a path
toward a more `react-three-fiber`-like user experience.

Related discussion: `#85`, "ADR 0006: React scene-root bridge for @rieul3d/react"

## Consequences

- `@rieul3d/react` can move beyond one-shot lowering without pulling GPU/runtime ownership into
  React
- browser integrations gain a stable place to subscribe to committed scene updates
- the repository can validate a React scene-root surface before committing to a lower-level host
  config or renderer mutation model
- full reconciler internals, host object granularity, and diff/application strategy remain open
  follow-up decisions
- the first implementation may stay data-only by publishing full `SceneIr` snapshots with revision
  metadata before any finer-grained diff contract is introduced
