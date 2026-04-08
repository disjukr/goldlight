# ADR 0005: React Scene-Object Convenience Components

## Status

Accepted

## Decision

`@disjukr/goldlight/react` may provide convenience React components for common scene-object
composition while keeping the underlying JSX primitives aligned with existing Scene IR concepts.

The proposed boundary is:

- JSX primitives stay resource/node separated and continue to lower directly into existing Scene IR
  concepts such as `<camera>`, `<light>`, and `<node>`
- convenience components may compose those primitives for common authored scene objects such as a
  perspective camera with its first bound node
- explicit resource ids and explicit node ids remain available as the lower-level escape hatch
- convenience components must not change the underlying IR semantics around rebinding, multiple node
  attachments, renderer ownership, or live scene ownership
- questions about how far convenience composition should extend stay in the component layer instead
  of expanding the primitive JSX contract

Mesh, material, rig, and other higher-level composition may evolve independently as React components
without forcing a new primitive decision for each combined object shape.

Related discussion: `#81`, "ADR 0005: React scene-object convenience components for
@disjukr/goldlight/react"

## Consequences

- TSX scene authoring can move closer to React scene-library ergonomics without changing core IR
  ownership or the primitive JSX contract
- common camera/light setup flows can be packaged as reusable React components instead of new
  built-in JSX tags
- the repository no longer needs a separate architecture decision each time a higher-level composed
  scene object becomes desirable
