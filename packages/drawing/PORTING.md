# Drawing Porting Status

This document tracks the staged port of Skia Graphite/Dawn concepts into `packages/drawing`.

The target is not a literal source translation. The target is a structurally similar 2D drawing
stack that fits this repository's TypeScript and WebGPU architecture.

## Goal

- Source reference: Skia Graphite with the Dawn backend
- Local target: `packages/drawing`
- Shared geometry package: `@rieul3d/geometry`
- Primary scope: 2D drawing only

## Status Legend

- `pending`
  - not started
- `started`
  - initial file or API shape exists
- `partial`
  - significant pieces exist but execution is incomplete
- `done`
  - implemented and verified
- `blocked`
  - cannot proceed until a design or dependency is resolved

## Overall Summary

- Package setup
  - Status: `done`
  - `drawing` package exists and is wired into the workspace.
- Shared 2D geometry model
  - Status: `started`
  - `Path2D`, fill rules, cubic/conic/arc verbs, and basic transform helpers exist in `geometry`.
- Backend context
  - Status: `started`
  - Dawn/WebGPU device lifecycle wrapper exists.
- Shared context
  - Status: `partial`
  - Shared backend state, caps, noop fragment shader, bind group layouts, and resource provider are
    present.
- Resource allocation
  - Status: `partial`
  - Thin buffer/texture/sampler allocation layer exists, and samplers now canonicalize and reuse
    like a first backend cache.
- Recording
  - Status: `partial`
  - Abstract commands, clip-stack state, and immutable recordings exist.
- Capability probing
  - Status: `partial`
  - Caps now derive more policy from actual device features and limits instead of a mostly static
    table.
- GPU encoding
  - Status: `partial`
  - Clear, direct fill replay, patch-instance fill/stroke replay, clip-stencil replay for complex
    clip paths, multi-path stencil clip-stack replay, non-stencil draw batching within a render
    pass, first Skia-like stencil-then-cover replay for patch fills without stencil clips,
    viewport-uniform-driven device-to-NDC replay, and first stroke command buffer translation exist.
- Queue submission
  - Status: `partial`
  - Queue manager can submit encoded command buffers, track in-flight work counts, and follow
    submission completion through `queue.onSubmittedWorkDone()` when available.
  - Current state: command-buffer submission routes through the queue manager, with callback-based
    completion when available and coarse fallback when it is not.
- Path rendering
  - Status: `partial`
  - Flattened contours can be pushed through direct tessellated fills, convex clip-stack clipping,
    self-intersection fallback, adaptive curve flattening, patch preparation, and stroke expansion.
- Paint system
  - Status: `started`
  - Minimal fill/stroke paint exists and first execution path is active.
- Testing
  - Status: `partial`
  - Structural tests and first rendered PNG snapshot regression exist.

## Architecture Mapping

- `DawnBackendContext` -> `src/dawn_backend_context.ts`
  - Status: `started`
  - What exists: wraps adapter/device/queue/tick
  - Missing: device feature negotiation policy
- `DawnSharedContext` -> `src/shared_context.ts`
  - Status: `partial`
  - What exists: shared backend state, caps, noop fragment shader, resource provider creation, and
    backend-global bind group layouts
  - Missing: graphics pipeline factory/helpers, broader bind-group families, and threaded
    resource-provider split
- `DawnResourceProvider` -> `src/resource_provider.ts`
  - Status: `partial`
  - What exists: simple resource allocation plus cached fill/stroke/clip pipelines, first
    patch-instance pipelines, dedicated evenodd/nonzero stencil pipelines for patch fills,
    stencil-cover separation, stencil attachment reuse, multisample-aware pipelines, sampler
    canonicalization/reuse, cached uniform/texture bind groups, cached viewport bind-group layout,
    and shared viewport pipeline layout
  - Missing: wrapped resources, broader cache policy, intrinsic/uniform data upload plumbing, and
    generalized pipeline keys
- `Context` -> `src/context.ts`
  - Status: `started`
  - What exists: context factory and recorder creation
  - Missing: submit pipeline and global backend orchestration
- `Recorder` -> `src/recorder.ts`
  - Status: `started`
  - What exists: abstract command collection plus save/restore, per-draw transform, and clip-stack
    state
  - Missing: ordering rules and flush rules
- `DawnCaps` -> `src/caps.ts`
  - Status: `partial`
  - What exists: device feature collection, limit probing, storage-buffer gating, row-alignment
    policy, and initial format/sample policy
  - Missing: richer format table coverage and backend-specific fallback/workaround policy
- `DawnCommandBuffer` -> `src/command_buffer.ts`
  - Status: `partial`
  - What exists: clear plus direct fill replay, first patch-instance fill/stroke replay, convex-clip
    scissor replay, stencil replay for stacked complex clip paths, batching for consecutive
    non-stencil steps, first stencil-then-cover replay for patch-rendered fills, and viewport
    uniform replay for direct and patch draws
  - Missing: local-space replay, broader draw path and draw shape encoding, richer pass replay, and
    clip/fill stencil composition across arbitrary clip stacks
- `DrawPass` -> `src/draw_pass.ts`
  - Status: `partial`
  - What exists: prepared pass partitioning plus pipeline-key, bounds, stencil, clip-stack metadata,
    and patch-carrying draw steps
  - Missing: pipeline/state/resource preparation comparable to Skia DrawPass
- `DawnQueueManager` -> `src/queue_manager.ts`
  - Status: `partial`
  - What exists: queue submit, tick, unfinished work tracking, submission-scoped completion via
    `queue.onSubmittedWorkDone()`, coarse fallback when callbacks are unavailable, and cleanup when
    callbacks reject
  - Missing: richer GPU fence/error handling, wait-any style batching, and per-resource completion
    tracking
- `GraphicsPipeline` / caches -> `src/pipeline*.ts`
  - Status: `pending`
  - Missing: pipeline creation and reuse
- `Recording` -> `src/recording.ts`
  - Status: `started`
  - What exists: immutable recorded work snapshot
  - Missing: pass partitioning and backend execution metadata

## Local Files

- `src/context.ts`
  - Status: `started`
  - Role: high-level drawing context factory
- `src/dawn_backend_context.ts`
  - Status: `started`
  - Role: Dawn/WebGPU backend handles
- `src/shared_context.ts`
  - Status: `partial`
  - Role: shared backend objects, noop shader, and backend-global bind group layouts
- `src/resource_provider.ts`
  - Status: `partial`
  - Role: low-level resource creation, cached render pipelines, fill stencil/cover pipeline
    selection, stencil attachment reuse, canonical sampler reuse, and bind-group reuse
- `src/recorder.ts`
  - Status: `partial`
  - Role: command recording API with transform and clip-stack state
- `src/geometry.ts`
  - Status: `started`
  - Role: bridge from drawing to geometry
- `src/types.ts`
  - Status: `started`
  - Role: shared drawing command and paint types
- `src/caps.ts`
  - Status: `partial`
  - Role: backend capability model derived from actual device features and limits
- `src/command_buffer.ts`
  - Status: `started`
  - Role: command encoder translation
- `src/draw_pass.ts`
  - Status: `started`
  - Role: prepared render-pass partitioning between recording and backend encoding
- `src/queue_manager.ts`
  - Status: `partial`
  - Role: queue submission and submission-scoped completion tracking
- `src/recording.ts`
  - Status: `started`
  - Role: immutable recorded command package
- `src/path_renderer.ts`
  - Status: `partial`
  - Role: adaptive curve flattening, conic/arc flattening, cusp splitting, patch preparation,
    triangulation, scanline fallback, convex clip-stack clipping, clip preparation, and stroke
    expansion strategy
  - Update 2026-03-22: fill/stroke patches now carry Skia-style per-patch resolve levels derived
    from Wang-like formulas, and fill patches preserve contour fan points instead of degrading
    curved wedges into line-only triangles
- `src/renderer_provider.ts`
  - Status: `started`
  - Role: first renderer selection layer for middle-out fan, tessellated wedges, tessellated curves,
    and tessellated strokes
- `tests/`
  - Status: `started`
  - Role: package-local tests for drawing, including snapshot regression
  - Current state: prepared-recording and command-buffer tests now cover multi-path stencil clip
    accumulation
- `examples/`
  - Status: `started`
  - Role: package-local drawing examples and progress viewers
  - Note: prefer non-browser examples unless browser output is specifically needed
  - Current state: `examples/render_basic_paths` now exercises fill rule, cubic fill, clip rect,
    transform, and stroke output

## Geometry Model Progress

Geometry that is reusable across packages should live in `@rieul3d/geometry`, not in `drawing`.

- `Point2D` in `@rieul3d/geometry/src/path2d.ts`
  - Status: `done`
  - Shared 2D point type
- `Size2D` in `@rieul3d/geometry/src/path2d.ts`
  - Status: `done`
  - Shared 2D size type
- `Rect` in `@rieul3d/geometry/src/path2d.ts`
  - Status: `done`
  - Basic rectangle type
- `RRect` in `@rieul3d/geometry/src/path2d.ts`
  - Status: `started`
  - Shape model exists
- `Circle` in `@rieul3d/geometry/src/path2d.ts`
  - Status: `done`
  - Basic circle type
- `Polygon` in `@rieul3d/geometry/src/path2d.ts`
  - Status: `done`
  - General polygon input
- `Path2D` in `@rieul3d/geometry/src/path2d.ts`
  - Status: `started`
  - Supports `moveTo`, `lineTo`, `quadTo`, `conicTo`, `cubicTo`, `arcTo`, `close`, fill rule state,
    and transform helpers
- Cubic curves in `@rieul3d/geometry/src/path2d.ts`
  - Status: `started`
  - `cubicTo` exists and is flattened in drawing path preparation
- Conics/arcs in `@rieul3d/geometry/src/path2d.ts`
  - Status: `started`
  - `conicTo` and `arcTo` are modeled and flattened in drawing path preparation
- Path fill rules in `@rieul3d/geometry/src/path2d.ts`
  - Status: `started`
  - Fill rule metadata exists, and first stencil-based evenodd/nonzero execution path now exists
- Path transforms/utilities in `@rieul3d/geometry/src/path2d.ts`
  - Status: `started`
  - Matrix helpers and path transforms exist

## Drawing Command Progress

- `clear`
  - Status: `started`
  - Current state: recordable and executable on GPU
  - Missing: better integration with richer draw-pass replay
- `drawPath`
  - Status: `started`
  - Current state: recordable, fill now selects between middle-out fan, tessellated wedge, and
    tessellated curve preparation paths, patch-rendered fills now use first stencil-then-cover
    execution for evenodd/nonzero parity, path verbs include conic/arc flattening and cusp-aware
    splitting, and stroke has tessellated geometry preparation
  - Missing: higher-quality rasterization, broader path feature coverage, and full clip-stack
    interaction with fill stenciling
- `drawShape`
  - Status: `started`
  - Current state: shape is converted to `Path2D` and uses the same fill/stroke execution path
  - Missing: broader primitive specialization
- Clip path
  - Status: `started`
  - Current state: clip stack is recorded explicitly, rect clips and convex path clips are
    intersected through prepared geometry, patch-rendered fills and strokes now fall back to direct
    clipped triangles when convex clips would bypass exact clipping, and multiple complex path clips
    now accumulate through stencil replay before the color pass
  - Missing: full nested arbitrary clip-path coverage beyond intersect-only semantics and Skia-like
    clip stack ordering rules
- Transform stack
  - Status: `started`
  - Current state: recorder save/restore and per-draw transform state exist without mutating stored
    source geometry
  - Missing: uniform-driven transform replay
- Save/restore
  - Status: `started`
  - Current state: recorder state stack exists for transform and clip stack
  - Missing: broader paint and clip state capture
- Paint blending
  - Status: `pending`
  - Missing: blend mode model
- Anti-aliasing
  - Status: `started`
  - Current state: pipeline multisample count follows target sample count, the basic snapshot
    example renders through a supersampled offscreen path before PNG export, and fill/stroke draws
    now emit a first geometry-fringe AA pass
  - Missing: coverage/analytic AA beyond geometry fringe, clip-aware AA for patch paths, and
    example-specific supersampling
- Text/glyph drawing
  - Status: `pending`
  - Out of scope for now

## Paint System Progress

- RGBA color
  - Status: `started`
  - Exists in `DrawingPaint`
- Fill vs stroke
  - Status: `started`
  - Represented and first execution path exists
- Stroke width
  - Status: `started`
  - Represented, with segment-expansion, hairline alpha scaling, and dash slicing
- Join/cap
  - Status: `started`
  - Modeled, with first join/cap geometry generation path and AA fringe expansion
- Miter limit
  - Status: `started`
  - Modeled, with first miter fallback path
- Shader/gradient
  - Status: `pending`
  - Not modeled
- Image pattern
  - Status: `pending`
  - Not modeled
- Blend mode
  - Status: `pending`
  - Not modeled
- Color filter
  - Status: `pending`
  - Not modeled

## Backend Capability Progress

- Device availability
  - Status: `started`
  - Backend context requests a device
- Feature negotiation
  - Status: `partial`
  - Adapter/device features are collected and now drive storage-buffer/f16/transient/MSAA policy
- Limits tracking
  - Status: `partial`
  - Key device limits are exposed in caps and now include shader-stage binding counts
- Format support
  - Status: `started`
  - Initial static format policy exists
- Sample count policy
  - Status: `started`
  - Simple `1` / `4` sample policy exists
- Storage buffer support
  - Status: `partial`
  - Capability is surfaced in caps and now gated by available shader-stage storage-buffer limits
- Fallback/workaround policy
  - Status: `pending`
  - No centralized backend policy

## Resource System Progress

- Buffer creation
  - Status: `started`
  - Current state: direct wrapper exists
  - Missing: pooling/caching
- Texture creation
  - Status: `started`
  - Current state: direct wrapper exists
  - Missing: reuse strategy
- Sampler creation
  - Status: `partial`
  - Current state: canonical descriptor reuse now caches identical samplers
  - Missing: broader backend cache eviction/purge policy
- Bind groups
  - Status: `started`
  - Current state: shared-context bind group layouts now exist to match Skia's backend-global setup
  - Missing: actual bind group allocation/cache wired into draw encoding
- Shader modules
  - Status: `pending`
  - Missing: shader lifecycle
- Pipelines
  - Status: `partial`
  - Current state: direct fill, clip stencil, clip-aware cover, evenodd/nonzero fill stencil,
    stencil-cover, stroke cover, and viewport-layout-backed patch pipelines are cached in the
    resource provider
  - Missing: generalized render pipeline creation and keying beyond viewport-only bindings
- Global cache
  - Status: `started`
  - Current state: path pipelines and stencil attachments are reused through the resource provider
  - Missing: broader shared backend caches
- Resource budget
  - Status: `started`
  - Current state: number is stored
  - Missing: enforcement
- Resource destruction
  - Status: `pending`
  - Current state: implicit only
  - Missing: lifecycle policy

## Rendering Pipeline Progress

- Abstract draw recording
  - Status: `started`
  - Recorder collects draw commands
- Path normalization
  - Status: `started`
  - Shape to path conversion exists
- Fill/stroke expansion
  - Status: `started`
  - Flattened contours can be emitted for direct fill meshes, first patch-instance fill/stroke
    inputs, convex clip-stack clipping, join/cap-aware stroke geometry, first AA fringe geometry,
    and patch metadata
- Path tessellation
  - Status: `started`
  - Adaptive CPU contour flattening exists for line, quadratic, conic, cubic, and arc path segments,
    with scanline fallback for more complex fill input
- Vertex/index generation
  - Status: `started`
  - Vertex generation exists for direct fills, patch-instance wedges/curves/strokes, clip-aware
    fills, complex clip replay, and expanded strokes
- GPU upload
  - Status: `started`
  - Simple per-draw vertex buffer upload exists for stencil and cover passes
- Render pass setup
  - Status: `started`
  - Recording can be partitioned into prepared draw passes, and draw replay now covers direct
    fill/stroke plus clip stencil when needed, with patch fills using a first stencil-then-cover
    pass shape closer to Graphite and convex clips forcing a safer direct-geometry fallback when
    patch replay would diverge
- Pipeline binding
  - Status: `partial`
  - Basic fill, clip, and stroke pipelines exist for first path draws, are reused across command
    buffers, and now bind viewport uniforms explicitly instead of baking clip-space vertices on CPU
- Draw submission
  - Status: `started`
  - Command buffer submission helper exists for encoded clears and first fill draws
- Async work completion
  - Status: `partial`
  - Tick and in-flight submission tracking exist, and completion now follows GPU queue submission
    promises when the backend exposes them

## Rendering Strategy Decisions

These decisions directly affect the remaining work and are not settled yet.

- First fill strategy
  - Status: `started`
  - First implementation triangulates simple contours directly, carries curve/wedge patch metadata,
    and falls back to scanline tessellation for problematic contours
  - Update 2026-03-22: wedge and curve patch metadata now preserve enough control-point data for
    GPU-side curve evaluation with per-patch resolve levels, closer to Skia
- First stroke strategy
  - Status: `started`
  - First implementation now includes miter/bevel/round joins, butt/square/round caps, dash slicing,
    and hairline alpha scaling
- Clip implementation
  - Status: `started`
  - First implementation uses recorded clip stacks, convex geometry clipping, scissor reduction, and
    stencil masking for a remaining complex clip path
- Atlas/text approach
  - Status: `pending`
  - Deferred until shapes are rendering
- Pipeline cache shape
  - Status: `pending`
  - Depends on command buffer and shader layout

## Tests And Verification

- Unit tests for package wiring
  - Status: `done`
  - `packages/drawing/tests/drawing_graphite_dawn_test.ts`
- Type checking
  - Status: `done`
  - Package APIs type-check
- Geometry path tests
  - Status: `started`
  - Covered indirectly through cubic/fill/stroke preparation tests
- Real WebGPU integration test
  - Status: `started`
  - `render_basic_paths_snapshot_test.ts` exercises live WebGPU rendering when available, including
    the supersampled PNG output path
- Image snapshot regression
  - Status: `started`
  - PNG hash regression exists for `examples/render_basic_paths`
- Backend capability tests
  - Status: `started`
  - Basic caps tests exist

## Known Gaps

- Skia Graphite/Dawn behavior deltas that still matter most
  - arbitrary clip-path stacks are not composited into the same stencil domain as fill stenciling,
    so multi-path clip behavior can still diverge from Graphite
  - tessellated wedge/curve/stroke patches still use fixed WGSL subdivision instead of
    Wang's-formula-driven resolve levels and patch attributes
  - transforms are still baked into CPU-prepared geometry instead of using Skia-like per-draw
    uniform replay
  - paint is still packed into vertex/instance payloads instead of being separated into paint
    uniforms and bind groups
  - convex clip handling is now correct through direct-geometry fallback, but it is still a fallback
    rather than native clip-aware patch replay
- `Path2D` is still very small compared to Skia `SkPath`
- recording snapshots can be partitioned into coarse draw passes, but they do not yet carry
  Skia-like pipeline/state/resource data
- no Skia-like draw-list or draw-pass preparation layer yet
- broader advanced curve/path features are still missing
- curve patch preparation is closer to Skia Graphite terminology now, but it is still CPU-generated
  geometry instead of true GPU patch tessellation
- patch-instance replay now exists for wedges, curves, and strokes, and patch fills now shade
  through a first stencil-then-cover path and now carry per-patch Wang-style resolve levels, but
  they still use a bounded fixed-count WGSL topology instead of Skia's static vertex/index buffers
  plus full Graphite patch writer behavior
- evenodd/nonzero fills now rely on prepared geometry plus scanline fallback rather than Skia-style
  path renderers, and coverage is still not Skia-grade
- fill stenciling and complex clip-path stenciling still cannot be composed like Skia's clip stack,
  so multiple arbitrary clip paths can still diverge
- convex clips now force exact direct-geometry fallbacks for patch-rendered fills and strokes, but
  this is still a correctness fallback rather than Skia's native clip-aware patch rendering
- convex clip fallbacks currently disable fringe AA instead of clipping it analytically, so clipped
  edges remain correct but can look harsher than Skia
- convex stroke fallbacks now also switch back to direct-cover pipelines so the Dawn vertex layout
  matches the emitted geometry, but this is still separate from true clip-aware patch stroking
- convex clips now force exact direct-geometry fallbacks for patch-rendered fills and strokes, but
  this is still a correctness fallback rather than Skia's native clip-aware patch rendering
- no SVG parser or SVG-to-`Path2D` ingestion path yet
- no retained scene model
- bind group layouts exist now, but there is still no bind group cache
- `command_buffer` still does per-draw render pass replay for stencil clears instead of a richer
  DrawPass command stream
- non-stencil steps can now batch, but stencil-heavy recordings still fragment replay more than Skia
  Graphite
- draw-pass preparation still does not batch or pre-resolve resource/pipeline state like Skia
  `DrawPass::prepareResources()`
- `queue_manager` still lacks Skia-style outstanding submission objects and explicit error scopes,
  even though it now follows `queue.onSubmittedWorkDone()` when available

## Skia Parity Review (2026-03-22)

Compared with Skia Graphite/Dawn `TessellateWedgesRenderStep`, `TessellateCurvesRenderStep`, and
`TessellateStrokesRenderStep`, the main remaining behavior differences are:

1. Patch topology and static buffers
   - Status: `partial`
   - Current state: instance data now carries fan points, curve type, and Wang-style resolve level
   - Missing: Graphite-style shared static vertex/index buffers and exact patch-writer attribute
     layout
2. Transform handling
   - Status: `partial`
   - Current state: resolve levels are computed from already-transformed control points
   - Missing: uniform-driven transform replay and shader-side vector-xform parity with Skia
3. Stroke patch semantics
   - Status: `partial`
   - Current state: strokes now use per-patch resolve levels
   - Missing: deferred stroke patch closure, join control point tracking, and Skia's exact cap/join
     patch emission rules
4. Fill/stencil semantics
   - Status: `partial`
   - Current state: wedge/curve patches now preserve curved boundaries better
   - Missing: Skia-like winding/even-odd stencil passes and richer draw-pass ordering
5. Resource/pipeline plumbing
   - Status: `started`
   - Current state: cached WebGPU pipelines exist for the current patch formats
   - Missing: bind groups, static buffers, and DrawPass-owned pipeline/resource preparation

## Latest Work Log

- 2026-03-22
  - Files changed: `src/command_buffer.ts`, `src/resource_provider.ts`,
    `tests/drawing_graphite_dawn_test.ts`
  - Status transition: pipeline binding `started` -> `partial`, pipelines `started` -> `partial`,
    and GPU replay `partial` -> `partial` with viewport-uniform-driven device-to-NDC mapping
  - Remaining gaps: draw preparation still bakes `localToDevice` into CPU geometry, and paint or
    sampled-resource bind groups are still missing
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`;
    `deno test packages/drawing/tests/render_basic_paths_snapshot_test.ts`
- 2026-03-22
  - Files changed: `src/path_renderer.ts`, `src/command_buffer.ts`, `src/resource_provider.ts`,
    `tests/drawing_graphite_dawn_test.ts`
  - Status transition: patch-instance tessellation `partial` -> `partial` with Wang-style resolve
    metadata and curved wedge preservation
  - Validation: `deno check packages/drawing/mod.ts`,
    `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`
- 2026-03-22
  - Files changed: `tests/render_basic_paths_snapshot_test.ts`
  - Status transition: snapshot baseline updated to match Wang-style patch replay output
  - Validation: `deno test packages/drawing/tests/render_basic_paths_snapshot_test.ts`

## Recommended Next Steps

1. Move from viewport-only uniforms to Skia-like local-space replay
   - Keep draw geometry in local space through preparation and apply `localToDevice` in uniforms
   - Separate transform and paint payloads from transient vertex uploads
2. Compose fill and clip stenciling
   - Allow arbitrary clip-path stacks to intersect with the new patch-fill stencil path
   - Stop falling back to correctness-only paths for convex and multi-path clips
3. Improve patch tessellation fidelity
   - Replace fixed-count WGSL subdivision with Wang's-formula-like resolve levels
   - Move more patch metadata toward Skia's instance layout
4. Port draw-pass style replay closer to Skia
   - Batch multiple prepared steps into fewer render passes
   - Separate clip, pipeline, and geometry state preparation from command encoding
5. Add pipeline/resource caching
   - Extend reuse toward transient buffers and richer pipeline keys
6. Deepen `src/caps.ts`
   - Replace static format assumptions with richer backend policy
   - Add feature-gated fallbacks

## Current Porting Delta Vs Skia Graphite/Dawn

To align behavior more closely with Skia Graphite/Dawn, the package still needs:

1. Real graphics-pipeline objects and keys separate from `resource_provider`
   - Skia keys pipelines from render-pass and pipeline descriptors, while the local code still
     hardcodes a small switch over draw-step keys.
2. Bind-group allocation and cache in real draw execution
   - Skia owns uniform/texture bind group layouts and caches bind groups in the resource provider;
     this package now has the layouts and viewport bind groups, but draw encoding still uploads
     per-draw geometry and lacks paint/resource bind-group reuse.
3. Uniform/storage-buffer driven transform and paint replay
   - Skia does not bake draw transforms into prepared geometry; this package only moved the
     device-to-NDC step into uniforms and still needs real `localToDevice` replay.
4. Richer format table and backend workaround policy in `caps`
   - Skia probes texture usage, resolve policy, and backend quirks much more deeply.
5. Command-buffer owned completion objects in `queue_manager`
   - The queue manager now tracks real submission completion promises, but it still lacks Skia-style
     outstanding submission objects, error scopes, and batching semantics.

## Latest Work

- 2026-03-22
  - Updated `src/caps.ts`, `src/shared_context.ts`, `src/resource_provider.ts`,
    `src/queue_manager.ts`, and `tests/drawing_graphite_dawn_test.ts`
  - Status transitions:
    - `Shared context`: `started` -> `partial`
    - `Resource allocation`: `started` -> `partial`
    - `Capability probing`: `started` -> `partial`
    - `Queue submission`: `started` -> `partial`
  - Validation:
    - `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`

## Update Rules

When work is added in this package, update this document with:

- the file that was added or changed
- the status transition
- the missing pieces that remain
- the test or check used to validate the change

## Skia Graphite/Dawn Delta Checklist

- `Recorder` / recording lifecycle
  - Current delta: no ordered-recording policy, no task graph, no upload or device flush model
  - To match Skia better: introduce recording ordering/flush rules and explicit per-recording
    resource preparation boundaries
- `DrawPass` resource preparation
  - Current delta: prepared steps only carry pipeline keys and bounds; they do not pre-resolve
    resource handles or pass-local state
  - To match Skia better: prepare pipeline/resource references before encode and keep replay closer
    to a pass command stream
- `CommandBuffer` replay
  - Current delta: one draw step still maps closely to one render pass
  - To match Skia better: batch compatible draws into fewer passes and support richer replay state
- Clip stack semantics
  - Current delta: intersect-only clip accumulation is implemented; non-intersect clip ops and full
    ordering semantics are still absent
  - To match Skia better: carry full clip op/state through preparation and replay
- Transform/pipeline data
  - Current delta: transforms are baked into CPU-generated geometry and paint is still vertex-local
  - To match Skia better: move to uniform/bind-group driven replay and broader pipeline metadata
- Queue completion
  - Current delta: submitted-work completion now uses WebGPU queue callbacks when available, but it
    still lacks Graphite-style fence/resource correlation
  - To match Skia better: add completion callbacks/fences comparable to Graphite queue tracking

## Recent Updates

- 2026-03-22
  - Files changed: `src/path_renderer.ts`, `src/draw_pass.ts`, `src/command_buffer.ts`,
    `src/resource_provider.ts`, `src/queue_manager.ts`, `tests/drawing_graphite_dawn_test.ts`,
    `tests/render_basic_paths_snapshot_test.ts`
  - Status transition: clip path replay from `single complex stencil clip` to
    `stacked complex
    stencil clips`, non-stencil replay from `per-step render pass` to
    `batched render pass`, and queue completion from `tick-only coarse completion` to
    `submitted-work callback with fallback`, with command-buffer submit now routed through queue
    tracking and rejected callbacks cleaned up
  - Remaining gaps: clip ops are still intersect-only, and stencil-heavy replay is still more
    granular than Skia Graphite
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`;
    `deno test
    packages/drawing/tests/render_basic_paths_snapshot_test.ts`
