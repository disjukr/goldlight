# Proposed ADR Index

Proposed architectural decisions live here until they are reviewed and promoted into the accepted
ADR index.

## Proposed Decisions

- [`0007-post-processing-execution-model.md`](./0007-post-processing-execution-model.md): introduce
  an explicit scene-color to post-process to present execution boundary
- [`0008-react-reconciler-scene-document.md`](./0008-react-reconciler-scene-document.md): introduce
  an internal React-owned scene document before a real reconciler host mutates live scene state
- [`0009-cubemap-capture-boundary.md`](./0009-cubemap-capture-boundary.md): introduce cubemap
  capture as a renderer output before reprojection/export layouts

## Related References

- [`README.md`](./README.md): accepted ADR index
- [`../specs/rendering.md`](../specs/rendering.md): renderer execution surface and pass model
- [`../specs/cubemap-capture.md`](../specs/cubemap-capture.md): cubemap face capture contract
- [`../README.md`](../README.md): docs landing page
