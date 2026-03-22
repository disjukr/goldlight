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
  - Status: `started`
  - Shared backend state, caps, and resource provider are present.
- Resource allocation
  - Status: `started`
  - Thin buffer/texture/sampler allocation layer exists.
- Recording
  - Status: `partial`
  - Abstract commands, clip-stack state, and immutable recordings exist.
- Capability probing
  - Status: `started`
  - Initial caps and limits layer exists.
- GPU encoding
  - Status: `partial`
  - Clear, direct fill replay, patch-instance fill/stroke replay, clip-stencil replay for complex
    clip paths, multi-path stencil clip-stack replay, non-stencil draw batching within a render
    pass, first Skia-like stencil-then-cover replay for patch fills without stencil clips, and first
    stroke command buffer translation exist.
- Queue submission
  - Status: `started`
  - Queue manager can submit encoded command buffers, track in-flight work counts, and use
    `queue.onSubmittedWorkDone()` when available.
  - Current state: command-buffer submission now routes through the queue manager instead of
    bypassing tracking.
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
  - Status: `started`
  - What exists: shared backend state, caps, and resource provider creation
  - Missing: bind group layouts and pipeline helpers
- `DawnResourceProvider` -> `src/resource_provider.ts`
  - Status: `started`
  - What exists: simple resource allocation plus cached fill/stroke/clip pipelines, first
    patch-instance pipelines, dedicated evenodd/nonzero stencil pipelines for patch fills,
    stencil-cover separation, stencil attachment reuse, and multisample-aware pipelines
  - Missing: bind groups, wrapped resources, broader cache policy, and generalized pipeline keys
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
  - Status: `started`
  - What exists: initial feature, format, and limit policy
  - Missing: richer probing and backend-specific fallbacks
- `DawnCommandBuffer` -> `src/command_buffer.ts`
  - Status: `partial`
  - What exists: clear plus direct fill replay, first patch-instance fill/stroke replay, convex-clip
    scissor replay, stencil replay for stacked complex clip paths, batching for consecutive
    non-stencil steps, and first stencil-then-cover replay for patch-rendered fills
  - Missing: broader draw path and draw shape encoding, richer pass replay, and clip/fill stencil
    composition across arbitrary clip stacks
- `DrawPass` -> `src/draw_pass.ts`
  - Status: `partial`
  - What exists: prepared pass partitioning plus pipeline-key, bounds, stencil, clip-stack metadata,
    and patch-carrying draw steps
  - Missing: pipeline/state/resource preparation comparable to Skia DrawPass
- `DawnQueueManager` -> `src/queue_manager.ts`
  - Status: `started`
  - What exists: queue submit, tick, unfinished work tracking, explicit submitted-work completion
    when WebGPU exposes it, coarse fallback when it does not, and settle cleanup when completion
    callbacks reject
  - Missing: richer GPU fence/error handling and per-resource completion tracking
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
  - Status: `started`
  - Role: shared backend objects
- `src/resource_provider.ts`
  - Status: `started`
  - Role: low-level resource creation, cached fill/stroke/clip pipelines, and fill stencil/cover
    pipeline selection
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
  - Status: `started`
  - Role: backend capability model
- `src/command_buffer.ts`
  - Status: `started`
  - Role: command encoder translation
- `src/draw_pass.ts`
  - Status: `started`
  - Role: prepared render-pass partitioning between recording and backend encoding
- `src/queue_manager.ts`
  - Status: `started`
  - Role: queue submission and completion
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
  - Status: `started`
  - Adapter/device features are collected
- Limits tracking
  - Status: `started`
  - Key device limits are exposed in caps
- Format support
  - Status: `started`
  - Initial static format policy exists
- Sample count policy
  - Status: `started`
  - Simple `1` / `4` sample policy exists
- Storage buffer support
  - Status: `started`
  - Capability is surfaced in caps
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
  - Status: `started`
  - Current state: direct wrapper exists
  - Missing: canonicalization/cache
- Bind groups
  - Status: `pending`
  - Missing: required for real draw execution
- Shader modules
  - Status: `pending`
  - Missing: shader lifecycle
- Pipelines
  - Status: `started`
  - Current state: direct fill, clip stencil, clip-aware cover, evenodd/nonzero fill stencil,
    stencil-cover, and stroke cover pipelines are cached in the resource provider
  - Missing: generalized render pipeline creation and keying
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
  - Status: `started`
  - Basic fill, clip, and stroke pipelines exist for first path draws and are reused across command
    buffers
- Draw submission
  - Status: `started`
  - Command buffer submission helper exists for encoded clears and first fill draws
- Async work completion
  - Status: `started`
  - Tick and in-flight submission tracking exist, but completion is still coarse

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
- no bind group cache
- `command_buffer` still does per-draw render pass replay for stencil clears instead of a richer
  DrawPass command stream
- non-stencil steps can now batch, but stencil-heavy recordings still fragment replay more than Skia
  Graphite
- draw-pass preparation still does not batch or pre-resolve resource/pipeline state like Skia
  `DrawPass::prepareResources()`
- `queue_manager` currently treats `tick()` as coarse completion rather than using explicit GPU
  fences

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

1. Compose fill and clip stenciling
   - Allow arbitrary clip-path stacks to intersect with the new patch-fill stencil path
   - Stop falling back to correctness-only paths for convex and multi-path clips
2. Improve patch tessellation fidelity
   - Replace fixed-count WGSL subdivision with Wang's-formula-like resolve levels
   - Move more patch metadata toward Skia's instance layout
3. Improve transform and paint replay
   - Move per-draw transform from CPU-prepared geometry toward uniform-driven replay
   - Start separating paint data from vertex payloads
4. Port draw-pass style replay closer to Skia
   - Batch multiple prepared steps into fewer render passes
   - Separate clip, pipeline, and geometry state preparation from command encoding
5. Add pipeline/resource caching
   - Extend reuse toward bind groups, transient buffers, and richer pipeline keys
6. Deepen `src/caps.ts`
   - Replace static format assumptions with richer backend policy
   - Add feature-gated fallbacks

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
