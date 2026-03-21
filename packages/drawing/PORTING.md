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
  - Abstract commands, clip-stack state with first intersect/difference op tracking, and immutable
    recordings exist.
- Capability probing
  - Status: `started`
  - Initial caps and limits layer exists.
- GPU encoding
  - Status: `partial`
  - Clear, direct fill replay, patch-instance fill/stroke replay, clip-stencil replay for complex
    intersect clip paths, chained stencil replay for multiple complex intersect clips, convex
    clip-geometry replay for intersect/difference stacks, first stroke command buffer translation,
    and Wang-style per-patch resolve levels for curve, wedge, and stroke patch instances exist.
- Queue submission
  - Status: `started`
  - Queue manager can submit encoded command buffers, track in-flight work counts, and now keep
    unresolved submissions in flight until Dawn/WebGPU queue completion signals arrive.
- Path rendering
  - Status: `partial`
  - Flattened contours can be pushed through direct tessellated fills, convex clip-stack clipping,
    convex difference subtraction, clipped AA fringe replay, self-intersection fallback, adaptive
    curve flattening, patch preparation, and stroke expansion.
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
  - What exists: shared backend state, caps, resource provider creation, and shared ownership of
    intrinsic uniform / single-texture-sampler bind group layouts plus the path pipeline layout
  - Missing: broader bind group layout families and multi-pass pipeline helpers
- `DawnResourceProvider` -> `src/resource_provider.ts`
  - Status: `partial`
  - What exists: simple resource allocation plus cached fill/stroke/clip pipelines, first
    patch-instance pipelines, stencil attachment reuse, multisample-aware pipelines, and a first
    shared intrinsic uniform bind group and pipeline layout for viewport transforms, including
    target-resize invalidation for intrinsic bind-group state, plus WGSL patch shaders that adapt
    tessellation density from stored resolve levels, and a first cached single-texture/sampler bind
    group path wired through shared-context-owned layouts
  - Missing: wrapped resources and broader cache policy
- `Context` -> `src/context.ts`
  - Status: `started`
  - What exists: context factory and recorder creation
  - Missing: submit pipeline and global backend orchestration
- `Recorder` -> `src/recorder.ts`
  - Status: `started`
  - What exists: abstract command collection plus save/restore, per-draw transform, and clip-stack
    state with first clip-op recording
  - Missing: ordering rules and flush rules
- `DawnCaps` -> `src/caps.ts`
  - Status: `started`
  - What exists: initial feature, format, and limit policy
  - Missing: richer probing and backend-specific fallbacks
- `DawnCommandBuffer` -> `src/command_buffer.ts`
  - Status: `partial`
  - What exists: clear plus direct fill replay, first patch-instance fill/stroke replay, convex-clip
    scissor replay, stencil replay for complex clip paths, intrinsic-uniform bind group replay
    instead of CPU clip-space baking, dynamic curve/wedge/stroke patch instance encoding keyed by
    per-patch resolve level, and draw calls sized to the highest resolve level in the batch
  - Missing: broader draw path and draw shape encoding, richer pass replay, and pass-level state
    reuse closer to Skia
- `DrawPass` -> `src/draw_pass.ts`
  - Status: `partial`
  - What exists: prepared pass partitioning plus pipeline-key, bounds, stencil, clip-stack metadata,
    and patch-carrying draw steps
  - Missing: pipeline/state/resource preparation comparable to Skia DrawPass
- `DawnQueueManager` -> `src/queue_manager.ts`
  - Status: `partial`
  - What exists: queue submit, tick, unfinished work tracking, and first
    `queue.onSubmittedWorkDone()`-based completion tracking when the runtime exposes it, plus
    explicit pending submission objects with ids/recorder metadata and a tracked tick-fallback mode
    when queue completion callbacks are unavailable, along with last-completed recorder/submission
    bookkeeping
  - Missing: richer fence/error integration and backend-specific wait modes
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
  - Role: low-level resource creation
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
    triangulation, scanline fallback, convex clip-stack intersect/difference clipping, clipped AA
    fringe preparation, single-pass preparation for multiple complex intersect stencil clips, clip
    preparation, and stroke expansion strategy
- `src/renderer_provider.ts`
  - Status: `started`
  - Role: first renderer selection layer for middle-out fan, tessellated wedges, tessellated curves,
    and tessellated strokes
- `tests/`
  - Status: `started`
  - Role: package-local tests for drawing, including snapshot regression
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
    tessellated curve preparation paths, path verbs include conic/arc flattening and cusp-aware
    splitting, and stroke has tessellated geometry preparation
  - Missing: higher-quality rasterization and broader path feature coverage
- `drawShape`
  - Status: `started`
  - Current state: shape is converted to `Path2D` and uses the same fill/stroke execution path
  - Missing: broader primitive specialization
- Clip path
  - Status: `started`
  - Current state: clip stack is recorded explicitly, rect and convex path clips carry
    intersect/difference ops through recording, convex clips are applied directly to fill/stroke
    geometry and AA fringe data, and nested complex intersect clip paths now accumulate through
    ordered stencil references instead of collapsing to one payload
  - Missing: arbitrary non-convex difference clips, inverse clip semantics, clip-atlas-style
    masking, and more of Skia's clip-shape collapsing rules
- Transform stack
  - Status: `started`
  - Current state: recorder save/restore and per-draw transform state exist without mutating stored
    source geometry, and viewport-to-clip conversion now runs through a shared intrinsic uniform
    bind group
  - Missing: per-draw local transform matrices in GPU uniforms instead of CPU-prepared geometry
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
  - Missing: coverage/analytic AA beyond geometry fringe and example-specific supersampling
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
  - Validation: zero-length stroke contours now emit visible round/square caps instead of being
    dropped, matching Skia Graphite stroke semantics more closely
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
  - Status: `started`
  - Current state: shared intrinsic uniform and single-texture/sampler bind groups now exist, with
    shared-context-owned layouts and resource-provider-side reuse for identical texture/sampler
    pairs
  - Missing: generalized caching for larger bind group families and dynamic uniform payloads
- Shader modules
  - Status: `pending`
  - Missing: shader lifecycle
- Pipelines
  - Status: `started`
  - Current state: direct fill, clip stencil, clip-aware cover, and stroke cover pipelines are
    cached in the resource provider
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
    fill/stroke plus convex clip replay and accumulated clip stencil replay when needed
- Pipeline binding
  - Status: `started`
  - Basic fill, clip, and stroke pipelines exist for first path draws and are reused across command
    buffers, with a shared explicit pipeline layout for intrinsic uniforms
- Draw submission
  - Status: `started`
  - Command buffer submission helper exists for encoded clears and first fill draws
- Async work completion
  - Status: `started`
  - Tick and in-flight submission tracking exist, and queue-work-done completion can now keep
    unresolved submissions in flight instead of treating every tick as a full fence
  - Current state: pending submissions now retain explicit ids, recorder ids, and completion modes
    instead of being reduced to counters only, and completion now records the last finished
    recorder/submission ids for downstream tracking

## Rendering Strategy Decisions

These decisions directly affect the remaining work and are not settled yet.

- First fill strategy
  - Status: `started`
  - First implementation triangulates simple contours directly, carries curve/wedge patch metadata,
    and falls back to scanline tessellation for problematic contours
- First stroke strategy
  - Status: `started`
  - First implementation now includes miter/bevel/round joins, butt/square/round caps, dash slicing,
    and hairline alpha scaling
- Clip implementation
  - Status: `started`
  - First implementation uses recorded clip stacks, convex intersect/difference geometry clipping,
    clipped AA fringe replay, exact scissor reduction when representable, and chained stencil
    masking for remaining complex intersect clip paths
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
- only viewport intrinsics are GPU-uniform driven; per-draw transform and paint data are still baked
  into prepared geometry or vertex payloads
- no Skia-like draw-list or draw-pass preparation layer yet
- broader advanced curve/path features are still missing
- curve patch preparation is closer to Skia Graphite terminology now, but it is still CPU-generated
  geometry instead of true GPU patch tessellation
- patch-instance replay now exists for wedges, curves, and strokes, but it still uses simplified
  fixed-count WGSL subdivision instead of Skia-style Wang's-formula tessellation
- evenodd/nonzero fills now rely on prepared geometry plus scanline fallback rather than Skia-style
  path renderers, and coverage is still not Skia-grade
- clip ops now carry intersect/difference for convex clips, but non-convex difference and inverse
  semantics still diverge from Skia ClipStack
- complex intersect clip stacks can now compose through stencil reference chaining, but they still
  lack Skia's broader analytic/atlas clip selection and deferred clip draw model
- no SVG parser or SVG-to-`Path2D` ingestion path yet
- no retained scene model
- no bind group cache
- bind group caching currently only covers intrinsic uniforms and single texture/sampler pairs, not
  the broader uniform/texture families Skia's DawnResourceProvider manages
- `command_buffer` still does per-draw render pass replay for stencil clears instead of a richer
  DrawPass command stream
- `queue_manager` still relies on coarse fallback completion when `queue.onSubmittedWorkDone()` is
  unavailable
- `queue_manager` now has explicit per-submission objects, but it still lacks full Graphite-style
  backend-specific wait modes and richer completion/error propagation
- clip stack handling still diverges from Skia Graphite for inverse clips, atlas-backed masking, and
  clip-shape simplification beyond plain intersect accumulation
- clip geometry clipping is still incomplete for AA fringe geometry, so coverage edges can diverge
  from Graphite under complex clips
- stroke tessellation still uses simplified fixed-count subdivision instead of Wang's-formula-driven
  segment counts from Graphite tessellation render steps

## Skia Graphite/Dawn Comparison Notes

- `ClipStack.cpp`
  - Current local gap: Graphite accumulates and simplifies full clip stack state, while local
    `prepareClipStack()` now preserves intersecting complex clip payloads but still lacks inverse
    clips and Graphite's deeper shape simplification rules
  - To match Skia behavior:
    1. add inverse/difference clip semantics and atlas-backed masking
    2. add clip stack simplification rules closer to Graphite's geometric intersection path
  - Completed in local port:
    1. convex clip stacks now clip AA fringe/coverage geometry as well as base fill/stroke triangles
    2. multiple complex clip paths now accumulate through ordered stencil references during replay
  - Validation: `packages/drawing/tests/drawing_graphite_dawn_test.ts`
- `DrawPass.cpp`
  - Current local gap: Graphite prepares reusable pipeline/resource state per draw pass; local code
    still opens render passes per step and uploads per-draw transient buffers
  - To match Skia behavior:
    1. batch multiple prepared steps into a single replayable pass
    2. separate resource preparation from replay
    3. reuse transient uploads and pipeline state across pass steps
- `render/TessellateCurvesRenderStep.cpp`
  - Current local gap: Graphite patch tessellation derives subdivision from transform-aware Wang's
    formula on GPU-style patch data; local code still pre-flattens/fixes subdivision on CPU
  - To match Skia behavior:
    1. carry transform-aware tessellation inputs instead of only CPU-flattened triangles
    2. replace fixed subdivision with Wang's-formula-driven patch evaluation
    3. align winding/even-odd stencil handling with Graphite render-step semantics
  - Completed in local port:
    1. convex clip stacks now force direct clipped geometry replay instead of leaving patch replay
       to escape polygon clips
  - Validation: `packages/drawing/tests/drawing_graphite_dawn_test.ts`
- `render/TessellateStrokesRenderStep.cpp`
  - Current local change: zero-length stroke contours with `round` or `square` caps now emit visible
    cap geometry instead of being discarded
  - Remaining gap:
    1. align full deferred contour/cap handling with Graphite stroke patch writer
    2. align cusp/circle emission and transform-aware stroke tessellation counts
  - Validation: `packages/drawing/tests/drawing_graphite_dawn_test.ts`
- `dawn/DawnQueueManager.cpp`
  - Current local gap: Graphite keeps explicit outstanding submission objects and backend-specific
    wait paths; local queue tracking now has explicit submission objects but is still lighter weight
  - Completed in local port:
    1. `tick()` now preserves unresolved submissions until `queue.onSubmittedWorkDone()` settles
    2. queue manager now tracks explicit pending submission objects with ids, recorder ids, and
       completion modes instead of counters only
    3. completion bookkeeping now retains the last finished recorder/submission ids
  - Remaining gap:
    1. add broader backend error/completion propagation
    2. define stronger fallback completion fences when `queue.onSubmittedWorkDone()` is unavailable
    3. add backend-specific wait behavior closer to Dawn future/async-wait paths
  - Validation: `packages/drawing/tests/drawing_graphite_dawn_test.ts`

## Recommended Next Steps

1. Deepen `src/caps.ts`
   - Replace static format assumptions with richer backend policy
   - Add feature-gated fallbacks
2. Move per-draw transform/painters toward bind groups
   - Add local-to-device transform uniforms instead of CPU-baked vertex positions
   - Separate shared intrinsic uniforms from per-draw paint/state buffers
3. Deepen clip-stack parity
   - Add inverse and non-convex difference semantics comparable to Skia ClipStack
   - Extend the current stacked complex-intersect stencil path toward Graphite-style clip
     simplification and atlas-backed masking
4. Harden the first fill path
   - Improve scanline fallback quality and unify it more cleanly with stencil rendering
   - Add more winding, nested clip-path, and clip-op tests
5. Add pipeline/resource caching
   - Extend reuse toward bind groups, transient buffers, and richer pipeline keys
6. Add `src/queue_manager.ts`
   - Own submit and unfinished-work tracking
   - Integrate backend tick handling
7. Expand `Path2D`
   - Add arcs/conics
   - Add more utility helpers

## Skia Divergence Audit

- `src/command_buffer.ts`
  - Status: `partial`
  - Difference from Skia: local vertices and patch instances were converted to clip space on the CPU
    before upload, while Skia Graphite/Dawn binds intrinsic uniforms and lets shaders derive
    clip-space positions during replay
  - To match Skia more closely: keep geometry in device/local space, bind shared viewport
    intrinsics, and move per-draw transforms into uniform or storage-backed state
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`
- `src/resource_provider.ts`
  - Status: `partial`
  - Difference from Skia: shared bind group layout ownership and cached bind groups now exist for
    intrinsic uniforms and the single-texture/sampler fast path, but broader uniform/texture
    families are still missing
  - To match Skia more closely: add larger uniform-buffer bind groups, broader texture/sampler bind
    groups, and stronger cache policy/eviction
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`

- `src/shared_context.ts`
  - Status: `started`
  - Difference from Skia: shared layout ownership now mirrors DawnSharedContext more closely for
    intrinsic uniforms and single-texture/sampler bindings, but it still lacks the broader layout
    families Skia creates for full Graphite pipeline binding
  - To match Skia more closely: expand layout families alongside paint, transform, and texture
    resource groups
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`
- `src/draw_pass.ts`
  - Status: `partial`
  - Difference from Skia: prepared steps only choose coarse pipeline keys, without the richer
    pipeline/state/resource payloads Skia bakes into `DrawPass`
  - To match Skia more closely: attach bind-group compatible draw state and batch-compatible replay
    metadata to prepared steps
  - Validation: non-stencil prepared steps now batch into a single render pass during replay; richer
    prepared state is still pending
- `src/caps.ts`
  - Status: `started`
  - Difference from Skia: format/sample/storage policy is still mostly static, while Skia DawnCaps
    derives backend workarounds and format behavior from actual adapter/device capabilities
  - To match Skia more closely: probe required features and encode fallback policies centrally
  - Validation: storage support and default sample-count policy are now feature gated in unit tests

## Latest Update

- 2026-03-22
  - Files: `src/path_renderer.ts`, `src/command_buffer.ts`, `src/resource_provider.ts`,
    `tests/drawing_graphite_dawn_test.ts`, `tests/render_basic_paths_snapshot_test.ts`
  - Status transition: patch-instance tessellation fidelity improved within the existing
    `DawnResourceProvider` / `DawnCommandBuffer` partial state
  - Change: wedge patches now retain original curve metadata; curve, wedge, and stroke patches now
    carry Wang-style resolve levels; oversized quadratic/cubic patches pre-chop instead of silently
    clamping; patch draw calls size themselves from the batch's max resolve level; the basic path
    snapshot hash was refreshed to the new output
  - Remaining: per-draw transform uniforms, Graphite-style stencil/cover fill-rule parity, and
    shared static tessellation buffers / indirect patch draws
  - Validation: `deno task check`
- 2026-03-22
  - Files: `src/resource_provider.ts`, `src/command_buffer.ts`, `src/caps.ts`,
    `src/queue_manager.ts`, `tests/drawing_graphite_dawn_test.ts`
  - Status transition: resource binding `pending` -> `started`; `DawnResourceProvider` `started` ->
    `partial`; `DawnQueueManager` `started` -> `partial`
  - Change: ported the first Skia-like intrinsic uniform path so viewport-to-clip conversion now
    uses a shared bind group and explicit pipeline layout instead of CPU clip-space baking, and
    non-stencil draws now replay through a shared render pass instead of one pass per step; caps
    policy now gates BGRA storage and default sample count on actual enabled device features; queue
    completion now uses `queue.onSubmittedWorkDone()` when available instead of always completing
    everything on `tick()`; intrinsic bind groups now refresh when the render target size changes
  - Remaining: per-draw transform uniforms, paint/state buffers, broader bind group caches, and
    richer `DrawPass` metadata
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`
- 2026-03-22
  - Files: `src/shared_context.ts`, `src/resource_provider.ts`,
    `tests/drawing_graphite_dawn_test.ts`
  - Status transition: `DawnSharedContext` layout ownership `started` -> deeper `started`;
    bind-group parity remains `started` but now covers the first texture/sampler cache path
  - Change: moved intrinsic uniform layout ownership into `DawnSharedContext`, added a shared
    single-texture/sampler bind group layout plus cached bind group creation in
    `DawnResourceProvider`, and made the path pipelines reuse shared-context-owned layouts instead
    of recreating local layout state
  - Remaining: per-draw transform/state bind groups, larger uniform-buffer families, and broader
    bind-group cache eviction/policy
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`
- 2026-03-22
  - Files: `src/queue_manager.ts`, `tests/drawing_graphite_dawn_test.ts`
  - Status transition: `DawnQueueManager` remains `partial`, but submission lifecycle tracking is
    now closer to Skia Graphite/Dawn
  - Change: queue manager now stores explicit pending submission objects with ids, recorder ids,
    completion modes, and last-completed recorder/submission ids; `queue.onSubmittedWorkDone()` and
    tick-fallback completions both settle through that shared model instead of mutating counters
    alone
  - Remaining: backend-specific wait paths, stronger fallback fences, and richer error/completion
    propagation
  - Validation: `deno test packages/drawing/tests/drawing_graphite_dawn_test.ts`
- 2026-03-22
  - Files: `src/path_renderer.ts`, `src/command_buffer.ts`, `tests/drawing_graphite_dawn_test.ts`,
    `tests/render_basic_paths_snapshot_test.ts`
  - Status transition: clip replay remains `partial`, but convex/complex clip interaction is now
    closer to Graphite
  - Change: convex clip stacks now trim fill AA fringe and pre-clip prepared complex stencil masks;
    command-buffer scissor setup now intersects clip state with prepared draw bounds; the basic path
    snapshot hash was refreshed to the new replay output
  - Remaining: inverse clips, non-convex difference clips, atlas-backed masking, and richer
    clip-stack simplification are still missing
  - Validation: `deno task check`

## Update Rules

When work is added in this package, update this document with:

- the file that was added or changed
- the status transition
- the missing pieces that remain
- the test or check used to validate the change
