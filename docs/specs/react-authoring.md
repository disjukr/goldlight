# React Authoring

## Position

React integration is a separate package. It must not become the source of truth for core scene data.

## Contract

- JSX authoring trees are built through `@rieul3d/react` primitives such as `<scene>` and `<node>`.
- Authored trees may also declare scene resources such as `<camera>`, `<mesh>`, `<material>`,
  `<light>`, `<texture>`, and `<asset>`.
- Authored trees are lowered into complete Scene IR or evaluated scene inputs.
- Core packages remain usable without React.

## Scope

The current package owns JSX authoring and lowering. It does not define a live React renderer or
custom reconciler yet.

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

## Current Status

- The React package currently lowers declarative authoring structures into SceneIr-friendly data.
- The package now exposes a JSX runtime so TSX can author scene trees directly.
- Authoring nodes lower core node metadata such as names, mesh/camera/light bindings, and transforms
  into Scene IR.
- Root scene trees can now also declare cameras, meshes, materials, lights, textures, and assets in
  the same TSX surface before lowering.
- Rendering, residency preparation, and execution continue to live in the core/gpu/renderer layers.
- The browser example now demonstrates full-scene JSX authoring plus lowering, not a live React
  reconciler.
- [`../../examples/browser_react_authoring/README.md`](../../examples/browser_react_authoring/README.md)
  shows the reference browser flow: author a tree with `@rieul3d/react` TSX, lower node data into
  Scene IR, then hand the result to the existing runtime and renderer layers.
