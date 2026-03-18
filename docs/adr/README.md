# ADR Index

Architectural decision records capture constraints that should stay stable unless a new decision
supersedes them. Proposed ADRs are listed separately until they are accepted.

## Proposed Decisions

- [`0007-post-processing-execution-model.md`](./0007-post-processing-execution-model.md): introduce
  an explicit scene-color to post-process to present execution boundary

## Accepted Decisions

- [`0001-webgpu-only.md`](./0001-webgpu-only.md): WebGPU is the only rendering backend
- [`0002-bdl-scene-ir.md`](./0002-bdl-scene-ir.md): Scene IR is authored through BDL and generated
  types
- [`0003-functional-first.md`](./0003-functional-first.md): public APIs stay data-oriented and
  functional-first
- [`0004-react-jsx-authoring.md`](./0004-react-jsx-authoring.md): React package owns JSX authoring
  while core runtime state stays outside React
- [`0005-react-scene-object-aliases.md`](./0005-react-scene-object-aliases.md): React authoring may
  provide convenience scene-object components without changing primitive IR ownership
- [`0006-react-scene-root-bridge.md`](./0006-react-scene-root-bridge.md): React should publish scene
  updates through a partial-apply boundary without taking renderer ownership

## Related References

- [`../specs/architecture.md`](../specs/architecture.md): package and runtime layering
- [`../specs/rendering.md`](../specs/rendering.md): renderer execution surface and pass model
- [`../specs/scene-ir.md`](../specs/scene-ir.md): data schema expectations
- [`../README.md`](../README.md): docs landing page
