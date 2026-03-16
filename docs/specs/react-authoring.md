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
