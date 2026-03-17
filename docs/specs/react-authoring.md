# React Authoring

## Position

React integration is a separate package. It must not become the source of truth for core scene data.

## Contract

- React trees are reconciled into scene-authoring nodes.
- Scene-authoring nodes are lowered into Scene IR or evaluated scene inputs.
- Core packages remain usable without React.

## Scope

The initial package focuses on describing scene content declaratively. It does not define a React
renderer or custom reconciler yet.

## Direction

The current helper-based API is only a staging shape. The package should evolve toward an interface
that feels closer to `react-three-fiber`, where scene content is authored as normal React elements
and reconciled directly into rieul3d-owned runtime objects.

That direction matters for a few reasons:

- it aligns the package name with user expectations of an actual React integration
- it removes the extra mental model of manually building authoring nodes with helper functions
- it enables composition patterns that React users expect, such as JSX trees, props, and component
  boundaries
- it creates a cleaner path toward live updates driven by React reconciliation instead of one-shot
  lowering helpers

Core scene/runtime packages must still remain usable without React. A React-facing renderer should be
an adapter layer over the existing IR, evaluation, and rendering systems, not a replacement for
them.

## Current Status

- The React package currently lowers declarative authoring structures into SceneIr-friendly data.
- Authoring nodes now lower core node metadata such as names, mesh bindings, and transforms into
  Scene IR.
- Rendering, residency preparation, and execution continue to live in the core/gpu/renderer layers.
- The browser example demonstrates the current helper-based authoring API, not a true React runtime
  integration.
- [`../../examples/browser_react_authoring/README.md`](../../examples/browser_react_authoring/README.md)
  shows the reference browser flow: author a tree with `@rieul3d/react`, lower node data into Scene
  IR, then hand the result to the existing runtime and renderer layers.
