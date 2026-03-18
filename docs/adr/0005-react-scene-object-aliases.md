# ADR 0005: React Scene-Object JSX Aliases

## Status

Proposed

## Decision

`@rieul3d/react` may grow JSX aliases that lower into both a scene resource and its bound node when
the mapping stays explicit and one-way.

The proposed boundary is:

- combined aliases stay as authoring sugar over existing Scene IR resources plus node bindings
- explicit resource ids and explicit node ids remain available as the lower-level escape hatch
- combined aliases may synthesize a default resource plus its first bound node for common authored
  scene objects when authors provide node-oriented props or children, but they must not change the
  existing resource-only meaning or narrow the underlying IR semantics around rebinding or multiple
  node attachments
- aliases must not hide renderer/runtime ownership or make React the source of truth for live scene
  state

Mesh and material composition are intentionally left unresolved for now because they introduce more
questions about ownership, sharing, and whether JSX should imply resource instancing or reuse.

Related discussion: `#81`, "ADR 0005: combined scene-object aliases for @rieul3d/react"

## Consequences

- TSX scene authoring can move closer to React scene-library ergonomics without changing core IR
  ownership
- additive aliases can reduce boilerplate for common authored camera/light setup flows while
  preserving explicit lower-level escape hatches for multi-bind scenes
- the package still needs a separate follow-up decision before mesh/material authoring is folded
  into the same combined-object surface
