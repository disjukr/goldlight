# ADR Index

Architectural decision records capture constraints that should stay stable unless a new decision
supersedes them.

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
- [`0007-post-processing-execution-model.md`](./0007-post-processing-execution-model.md):
  post-processing is an explicit scene-color to post-process to present execution stage
- [`0008-react-reconciler-scene-document.md`](./0008-react-reconciler-scene-document.md): React
  reconciler should target an internal scene document before publishing scene data updates
- [`0009-cubemap-capture-boundary.md`](./0009-cubemap-capture-boundary.md): cubemap capture should
  be a renderer output boundary before reprojection or export layouts
- [`0010-hybrid-deferred-forward-alpha-materials.md`](./0010-hybrid-deferred-forward-alpha-materials.md):
  material alpha policy should explicitly separate deferred opaque or masked coverage from forward
  blended transparency

## Related References

- [`proposals.md`](./proposals.md): proposed architectural decisions awaiting acceptance
- [`../specs/architecture.md`](../specs/architecture.md): package and runtime layering
- [`../specs/rendering.md`](../specs/rendering.md): renderer execution surface and pass model
- [`../specs/scene-ir.md`](../specs/scene-ir.md): data schema expectations
- [`../README.md`](../README.md): docs landing page
