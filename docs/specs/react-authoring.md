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

## Current Status

- The React package currently lowers declarative authoring structures into SceneIr-friendly data.
- Rendering, residency preparation, and execution continue to live in the core/gpu/renderer layers.
- Browser examples currently use the imperative pipeline directly; React rendering examples are not
  implemented yet.
