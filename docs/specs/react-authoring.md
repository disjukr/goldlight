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

The current package owns JSX authoring, lowering, the snapshot-style `createSceneRoot()`
implementation, and an experimental `@rieul3d/react/reconciler` entrypoint that mounts normal React
components into the package-local scene document before publishing committed `SceneIr` snapshots.

## Direction

The current package now supports normal TSX scene authoring and component composition, plus an
experimental reconciler host that can drive rieul3d-owned scene data from normal React state and
lifecycle updates. The remaining direction is to evolve that surface toward a fuller
`react-three-fiber` style adapter with a smoother React-runtime JSX experience.

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

Issue `#112` has now reached its first experimental reconciler milestone through
[`@rieul3d/react/reconciler`](../../packages/react/reconciler.ts), which mounts a real
`react-reconciler` host onto the internal scene document described by
[`../adr/0008-react-reconciler-scene-document.md`](../adr/0008-react-reconciler-scene-document.md).
Issue `#117` provided the first scene-document implementation slice that this host now targets.

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
- `createSceneRoot()` now keeps an internal React-owned scene document so stable resource and node
  host instances can survive repeated commits even though the published subscriber payload is still
  a data-only `SceneIr` snapshot.
- `@rieul3d/react/reconciler` now provides an experimental real React renderer that accepts normal
  React components, applies mount/update/unmount work to the internal scene document, and publishes
  live `SceneIr` snapshots through `createReactSceneRoot()`.
- that live reconciler JSX surface now accepts the same lower-case `group`, `perspectiveCamera`,
  `orthographicCamera`, and `directionalLight` aliases that the snapshot authoring path already
  exposes, so React-runtime TSX no longer has to fall back to manual `React.createElement()` calls
  for those common scene shapes
- `createReactSceneRoot()` now publishes a terminal empty-scene snapshot on unmount before clearing
  its retained `getScene()` value, so subscriber-driven integrations can explicitly clear any
  previously rendered scene state.
- The reconciler entrypoint now also augments the normal React JSX runtime so `<scene>`, `<node>`,
  `<camera>`, `<light>`, `<mesh>`, `<material>`, `<texture>`, and `<asset>` can be authored in plain
  TSX on the live path.
- `@rieul3d/react/reconciler` now exports React-runtime `PerspectiveCamera`, `OrthographicCamera`,
  and `DirectionalLight` convenience components so live reconciler scenes can keep the same
  high-level camera/light composition style as the snapshot authoring surface.
- `flushReactSceneUpdates()` now exists as a small helper for tests or deterministic integrations
  that need to force scheduled React work through the reconciler host; it now also rethrows pending
  reconciler errors captured during those later React-driven updates.
- The scene document currently supports stable node/resource identity, parent-child reordering, and
  subtree/resource removal as the first package-local waypoint before a real reconciler host lands.
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
- The browser example still demonstrates full-scene JSX authoring plus the current snapshot-based
  `createSceneRoot()` flow, while the BYOW React Bunny demo now exercises the experimental
  reconciler-driven path.
- The next unresolved architecture question is how React-authored changes should cross into runtime
  update planning so frequent node changes can avoid whole-scene resets while multi-scene
  composition remains outside React ownership.
- The next unresolved implementation question for a real reconciler host is what internal scene
  document shape should absorb React mount/update/unmount operations before publishing data-only
  scene updates outward.
- Issue `#89` now tracks follow-up implementation work around the next runtime-facing update
  contract.
- The next follow-up after the first reconciler landing is improving the React-runtime JSX surface
  so the live path can expand beyond the current primitive and convenience-component set without
  falling back to lower-level `React.createElement()` calls.
- [`../../examples/browser_react_authoring/README.md`](../../examples/browser_react_authoring/README.md)
  shows the reference browser flow: author a tree with `@rieul3d/react` TSX, commit it through
  `createSceneRoot()`, derive an update plan plus summary from that commit, drop targeted residency
  entries where stable resource IDs changed, avoid resets for transform-only node updates, fall back
  to a full reset for scene-topology or binding changes, then hand the published scene snapshot to
  the existing runtime and renderer layers.
