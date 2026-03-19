# ADR 0009: Cubemap Capture Before Reprojection

## Status

Accepted

## Decision

`@rieul3d/renderer` should expose cubemap capture as a first-class offscreen renderer output before
adding any 2D reprojection or export layouts.

The first capture boundary should:

- return six ordered cubemap face snapshots instead of a single equirectangular or cross image
- live in the renderer layer because it depends on camera orientation and render-pass execution
- keep reprojection/export as a downstream concern that consumes captured faces
- stay offscreen-first and data-oriented so PNG or future encoders can layer on top

The first implementation milestone should stay narrow:

- ship a forward-renderer cubemap snapshot API for mesh scenes
- define one stable face ordering and orientation convention
- include per-face view/projection metadata in the returned result
- reject scene content that cannot yet respect face-specific cameras instead of silently returning
  incorrect captures

## Rationale

Issue `#103` is the prerequisite for issue `#102`. If reprojection formats land before a reusable
capture boundary exists, the export layer would either need to own scene rendering itself or
duplicate renderer-specific cubemap logic per output format.

Keeping cubemap capture separate gives the repository one reusable scene-to-cubemap primitive that:

- unblocks later equirectangular, angular-map, cross, and strip outputs
- supports debugging and inspection without committing to one layout
- preserves the functional, data-oriented API boundary already used by snapshot workflows

The current runtime can already render mesh scenes per face, but SDF and volume raymarch shaders
still assume a fixed camera. The correct short-term behavior is to expose a mesh-safe cubemap API
and explicitly reject unsupported raymarched content until that camera model is generalized.

## Consequences

- issue `#103` can land independently from issue `#102`
- future reprojection/export helpers should consume captured cubemap faces, not renderer internals
- cubemap capture remains useful for environment probes, debugging, and offline tooling even before
  2D exports exist
- hybrid cubemap capture for SDF/volume scenes remains a tracked follow-up instead of a silent
  correctness gap

## Alternatives Considered

- add equirectangular export directly in the renderer: simpler one-off path, but it would entangle
  capture with one presentation format and make other layouts harder to add cleanly
- wait until all primitive types support cubemap cameras: would keep the API narrower initially, but
  it would block issue `#102` and postpone a useful mesh capture capability that is already
  implementable
- expose raw GPU cubemap textures only: too execution-specific for the current offscreen/testing
  workflows and harder to reuse from non-GPU tooling

Related issues: `#102`, `#103`
