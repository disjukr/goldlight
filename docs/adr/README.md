# ADR Index

Architectural decision records capture constraints that should stay stable unless a new decision
supersedes them.

## Accepted Decisions

- [`0001-webgpu-only.md`](./0001-webgpu-only.md): WebGPU is the only rendering backend
- [`0002-bdl-scene-ir.md`](./0002-bdl-scene-ir.md): Scene IR is authored through BDL and generated
  types
- [`0003-functional-first.md`](./0003-functional-first.md): public APIs stay data-oriented and
  functional-first

## Proposed Decisions

- [`0004-react-jsx-authoring.md`](./0004-react-jsx-authoring.md): React package owns JSX authoring
  while core runtime state stays outside React
- [`0005-react-scene-object-aliases.md`](./0005-react-scene-object-aliases.md): React authoring may
  add combined camera/light-style JSX aliases without changing core ownership
- [`0006-react-scene-root-bridge.md`](./0006-react-scene-root-bridge.md): React should publish
  committed scene snapshots through a scene-root bridge before it owns a full live reconciler
- [`0007-react-scene-root-diff-contract.md`](./0007-react-scene-root-diff-contract.md): decide
  whether React scene-root commits should stay snapshot-only or expose diff/apply data

## Related References

- [`../specs/architecture.md`](../specs/architecture.md): package and runtime layering
- [`../specs/scene-ir.md`](../specs/scene-ir.md): data schema expectations
- [`../README.md`](../README.md): docs landing page
