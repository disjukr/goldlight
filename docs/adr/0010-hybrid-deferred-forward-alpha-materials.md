# ADR 0010: Hybrid Deferred And Forward Alpha Materials

## Status

Proposed

## Decision

`@rieul3d/renderer` should treat textured built-in lit materials as a hybrid rendering concern
instead of extending the deferred depth prepass to cover every alpha-bearing texture case.

The current proposed boundary is:

- opaque deferred-eligible meshes continue through deferred depth, G-buffer, and lighting passes
- textured built-in lit meshes may fall back to a forward lit pass after deferred lighting while
  reusing the deferred depth buffer
- fully transparent sampled texels may be discarded in that forward fallback path so zero-alpha
  cutouts do not occlude later geometry through the deferred prepass
- broader transparent material policy should be modeled explicitly in scene/material data before
  blend-mode or mask-cutoff behavior is generalized

The next architectural step should add first-class material render policy, such as:

- `alphaMode: 'opaque' | 'mask' | 'blend'`
- `alphaCutoff?: number`
- optional depth/blend policy fields only if they remain data-oriented and renderer-independent

## Rationale

Issue `#141` exposed a correctness gap in the first attempt to add deferred textured lit materials.
Sending textured lit meshes through the unconditional deferred depth prepass allows texels that are
visually transparent to still write depth before the later lighting/fullscreen stages can discard
them.

Without a first-class alpha contract in `SceneIr.Material`, the renderer cannot reliably decide:

- whether a textured material is fully opaque
- whether zero-alpha texels should be treated as cutouts
- what cutoff threshold should apply for masked materials
- whether partially transparent output belongs in a blend pass instead of an opaque pass

Routing textured lit meshes through a forward pass after deferred lighting preserves correct depth
testing against opaque deferred content and unblocks the current milestone without hard-coding a
fake general transparency model.

## Consequences

- deferred rendering keeps an opaque-first architecture for built-in G-buffer passes
- textured built-in lit meshes can ship now without incorrect deferred prepass occlusion through
  zero-alpha cutouts
- forward and deferred rendering share more lit-material shader/binding behavior
- full transparent-material support still needs explicit material policy in IR before the renderer
  can classify opaque, masked, and blended draws cleanly

## Alternatives Considered

- keep textured lit meshes in the deferred G-buffer path: smaller short-term patch, but it preserves
  incorrect occlusion for alpha-masked textures
- add an implicit fixed alpha cutoff right now: would hide the immediate bug, but it would invent a
  material policy that the scene format does not actually encode
- reject all lit textures in deferred until full alpha policy lands: safest behavior, but it blocks
  an otherwise workable hybrid fallback that already aligns with issue `#143`

Related issues: `#141`, `#143`
