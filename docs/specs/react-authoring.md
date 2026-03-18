# React Authoring

## Position

React integration is a separate package. It must not become the source of truth for core scene data.

## Contract

- JSX authoring trees are built through `@rieul3d/react` primitives such as `<scene>` and `<node>`.
- Authored trees may also declare scene resources such as `<camera>`, `<mesh>`, `<material>`,
  `<light>`, `<texture>`, and `<asset>`.
- Node-like authoring elements may expose React-style shorthands such as `<group>` plus transform
  props such as `position`, `rotation`, and `scale` when they still lower cleanly into the same
  node-oriented Scene IR structure.
- Higher-level camera/light composition should prefer React convenience components built from
  `<camera>`, `<light>`, and `<node>` instead of expanding the primitive JSX surface with more
  built-in combined object tags; the package now exports `PerspectiveCamera`, `OrthographicCamera`,
  and `DirectionalLight` as the first shared examples of that pattern.
- Node-like authoring elements may use transform shorthands such as `position`, `rotation`, and
  `scale`; these fold into the existing Scene IR transform object during lowering.
- Authored trees are lowered into complete Scene IR or evaluated scene inputs.
- Core packages remain usable without React.

## Scope

The current package owns JSX authoring, lowering, and a first `createSceneRoot()` implementation
that publishes committed `SceneIr` snapshots. It does not define a live React renderer or custom
reconciler yet.

## Direction

The current package now supports normal TSX scene authoring and component composition, but it still
stops at lowering. The remaining direction is to evolve that surface toward a `react-three-fiber`
style adapter where reconciliation can drive rieul3d-owned runtime objects over time.

That direction matters for a few reasons:

- it aligns the package name with user expectations of an actual React integration
- it removes the extra mental model of manually building authoring nodes with helper functions for
  the common path
- it enables composition patterns that React users expect, such as JSX trees, props, and component
  boundaries
- it creates a cleaner path toward live updates driven by React reconciliation instead of one-shot
  lowering helpers

Core scene/runtime packages must still remain usable without React. A React-facing renderer should
be an adapter layer over the existing IR, evaluation, and rendering systems, not a replacement for
them.

The current repository still exposes some built-in combined camera/light aliases, but the proposed
boundary in [`../adr/0005-react-scene-object-aliases.md`](../adr/0005-react-scene-object-aliases.md)
now prefers moving that convenience into React components while keeping primitive JSX authoring
aligned with explicit `<camera>`, `<light>`, and `<node>` concepts. That avoids turning each new
combined scene object into another primitive-surface decision.

The next proposed step for issue `#64` is now captured in
[`../adr/0006-react-scene-root-bridge.md`](../adr/0006-react-scene-root-bridge.md): move from the
current provisional snapshot bridge toward a scene update boundary that can apply high-frequency
node changes without whole-scene residency rebuilds, while still keeping residency, rendering,
offscreen targets, and multi-scene orchestration outside the React package. The repository currently
has a first implementation waypoint in `createSceneRoot()`, but ADR 0006 does not treat that
full-snapshot publication shape as the final contract.

The next unresolved step for issue `#112` is now captured in
[`../adr/0008-react-reconciler-scene-document.md`](../adr/0008-react-reconciler-scene-document.md):
add a React-owned internal scene document that a real `react-reconciler` host can update
incrementally before those changes cross into the existing runtime/residency boundary. Issue `#117`
tracks the first implementation slice for that scene-document layer.

## Current Status

- The React package currently lowers declarative authoring structures into SceneIr-friendly data.
- The package now exposes a JSX runtime so TSX can author scene trees directly.
- Authoring nodes lower core node metadata such as names, mesh/camera/light bindings, and transforms
  into Scene IR, including React-style `position`/`rotation`/`scale` shorthands.
- The JSX surface currently includes group-style node aliases, while common camera/light composition
  can now be authored through exported convenience components instead of relying on built-in
  combined intrinsics.
- Root scene trees can now also declare cameras, meshes, materials, lights, textures, and assets in
  the same TSX surface before lowering.
- The preferred long-term direction is to move camera/light convenience toward reusable React
  components while keeping primitive JSX authoring tied to explicit IR concepts.
- `PerspectiveCamera`, `OrthographicCamera`, and `DirectionalLight` now compose those explicit
  primitives into reusable React-facing scene objects without changing the underlying IR semantics.
- `createSceneRoot()` now provides a data-only commit bridge that publishes full `SceneIr` snapshots
  plus previous-scene/revision metadata to caller-owned subscribers as a current implementation
  waypoint.
- `summarizeSceneRootCommit()` can derive resource-level added/removed/updated/unchanged ID sets
  from snapshot commits so integrations can make selective invalidation decisions while a finer
  runtime-facing partial-apply contract is designed.
- `planSceneRootCommitUpdates()` now derives a data-only update plan from snapshot commits that
  separates node transform-only changes from parenting, resource-binding, and metadata changes so
  integrations can avoid full residency resets for high-frequency transform updates without pulling
  GPU ownership into `@rieul3d/react`; descendant nodes whose world transforms move because an
  ancestor changed are included in the transform buckets even when their local node data is
  otherwise unchanged.
- `@rieul3d/gpu` now exposes ID-keyed targeted invalidation helpers, so snapshot consumers can drop
  changed mesh/material/texture/volume residency entries before falling back to a full reset for
  scene-topology changes.
- `commitSummaryNeedsResidencyReset()` captures the current safe residency-reset boundary for
  snapshot consumers: resource changes plus node/topology changes still require a full reset until
  finer-grained residency pruning exists.
- Integrations that cache GPU residency against scene/resource IDs must invalidate or rebuild that
  residency when a new committed snapshot replaces resource contents under stable IDs; commit
  summaries now let them scope that rebuild without missing node-only changes that can remap which
  stable resources remain live.
- Rendering, residency preparation, and execution continue to live in the core/gpu/renderer layers.
- The browser example now demonstrates full-scene JSX authoring plus the current snapshot-based
  `createSceneRoot()` flow, not a live React reconciler.
- The next unresolved architecture question is how React-authored changes should cross into runtime
  update planning so frequent node changes can avoid whole-scene resets while multi-scene
  composition remains outside React ownership.
- The next unresolved implementation question for a real reconciler host is what internal scene
  document shape should absorb React mount/update/unmount operations before publishing data-only
  scene updates outward.
- Issue `#89` now tracks follow-up implementation work around the next runtime-facing update
  contract.
- Issue `#117` now tracks the first scene-document implementation slice needed before a true React
  reconciler host can land.
- [`../../examples/browser_react_authoring/README.md`](../../examples/browser_react_authoring/README.md)
  shows the reference browser flow: author a tree with `@rieul3d/react` TSX, commit it through
  `createSceneRoot()`, derive an update plan plus summary from that commit, drop targeted residency
  entries where stable resource IDs changed, avoid resets for transform-only node updates, fall back
  to a full reset for scene-topology or binding changes, then hand the published scene snapshot to
  the existing runtime and renderer layers.
