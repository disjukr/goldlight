# ADR 0010: Material Alpha Policy For Deferred, Uber, And Dithered Coverage

## Status

Accepted

## Decision

`@rieul3d` should model material alpha behavior as first-class Scene IR policy instead of inferring
render intent from whether a material happens to sample a texture.

The renderer boundary should classify materials by explicit alpha policy:

- `alphaMode: 'opaque'` remains deferred-eligible and forward-eligible
- `alphaMode: 'mask'` remains deferred-eligible and forward-eligible
- `alphaMode: 'blend'` is forward-only and should participate in the transparent pass ordering
- renderers may support `mask` either through hard alpha cutoff or through dithered coverage, but
  dithered coverage is still a masked/coverage path rather than a true transparent blend path

The material contract should explicitly carry the policy the renderer needs to make those decisions,
including:

- `alphaMode: 'opaque' | 'mask' | 'blend'`
- `alphaCutoff?: number`
- `depthWrite?: boolean`
- `doubleSided?: boolean`
- `renderQueue?: 'opaque' | 'transparent'`
- an optional mask-coverage mode for non-blended alpha presentation, such as no dithering, ordered
  dithering, blue-noise dithering, or alpha-to-coverage where supported

Deferred rendering should stay an opaque-and-mask architecture:

- `opaque` materials may render through deferred passes
- `mask` materials may render through deferred passes when depth, shadow, and G-buffer stages all
  evaluate the same coverage rule
- `blend` materials should not be forced into deferred passes and should compose in the forward
  transparent pass over deferred scene color while reusing opaque depth

Dithered alpha belongs to the `mask` family, not the `blend` family:

- ordered/blue-noise dithering can approximate partial coverage in deferred-compatible passes
- alpha-to-coverage can provide a higher-quality mask path when multisampling is available
- these techniques should never redefine a blended material as deferred-eligible transparency

## Rationale

Issue `#141` exposed a correctness gap in the first attempt to broaden deferred textured lit
support. Simply routing any alpha-bearing textured material through the unconditional deferred depth
prepass allows texels that should not contribute visible coverage to still write depth before later
stages can decide how alpha should behave.

Issue `#143` generalized the problem: uber deferred-plus-forward rendering is not just an
implementation detail, it depends on a stable material policy boundary the renderer can use to
partition evaluated draws.

Without a first-class alpha contract in `SceneIr.Material`, the renderer cannot reliably decide:

- whether a textured material is fully opaque
- whether sampled alpha should be treated as a cutout mask
- whether masked coverage should use a hard cutoff or dithered coverage
- what cutoff threshold should apply for masked materials
- whether partially transparent output belongs in a blend pass instead of an opaque pass

If the system encodes those choices explicitly, the renderer can make stable decisions that survive
across loaders, React authoring helpers, built-in materials, and future custom material contracts.
That also keeps deferred support honest: deferred can support opaque and masked coverage, but true
blended transparency still requires forward composition.

## Consequences

- deferred rendering keeps a clear opaque/mask boundary instead of silently absorbing blended
  materials
- uber rendering becomes the standard execution path for scenes that mix deferred-eligible opaque
  or masked content with blended transparent content
- dithered alpha has a principled home as a deferred-compatible masked coverage mode
- prepass, shadow, G-buffer, and lighting-related passes must share one alpha-evaluation contract
  for masked materials so coverage and depth remain consistent
- importer and authoring layers must preserve semantic alpha intent instead of reducing everything
  to texture presence
- custom WGSL materials need a compatible alpha-policy surface if they want to participate cleanly
  in renderer partitioning
- renderer capability docs and validation need to distinguish masked coverage support from blended
  transparency support

## Alternatives Considered

- keep treating textured lit materials as the main policy boundary: smaller short-term patch, but it
  confuses texturing with alpha semantics and does not scale to other material models
- force all alpha-bearing materials into forward rendering: simpler partitioning, but it gives up
  valid deferred-compatible masked cases such as cutouts, foliage, or dithered coverage materials
- add only a fixed alpha cutoff and stop there: addresses some cutout cases, but it leaves no room
  for dithered coverage or future alpha-to-coverage without another policy redesign
- push blended materials through deferred with ad hoc discard rules: preserves incorrect semantics
  because blended transparency is not equivalent to masked coverage

Related issues: `#141`, `#143`
