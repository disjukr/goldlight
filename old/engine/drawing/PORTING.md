# Drawing Porting Status

This document tracks the staged port of Skia Graphite/Dawn concepts into `engine/drawing`.

The target is not a literal source translation. The target is a structurally similar 2D drawing
stack that fits this repository's TypeScript and WebGPU architecture.

## Goal

- Source reference: Skia Graphite with the Dawn backend
- Local target: `engine/drawing`
- Shared geometry package: `@disjukr/goldlight/geometry`
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
  - `Path2d`, fill rules, cubic/conic/arc verbs, and basic transform helpers exist in `geometry`.
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
  - Queue manager can submit encoded command buffers, track in-flight work counts, keep
    submission-scoped outstanding work objects, and follow submission completion through
    `queue.onSubmittedWorkDone()` when available.
  - Current state: command-buffer submission routes through the queue manager, each submit now owns
    an explicit outstanding submission object until completion, callback-based completion now drains
    submissions through a `checkForFinishedWork`-style path, ordinary ticks only retire submissions
    that have already completed asynchronously, explicit sync-to-last-submission waits exist for the
    Graphite-like blocking path, and coarse fallback still exists when callbacks are unavailable.
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
  - Missing: richer backend validation, adapter-selection policy, and explicit device-loss recovery
- `DawnSharedContext` -> `src/shared_context.ts`
  - Status: `partial`
  - What exists: shared backend state, caps, noop fragment shader, resource provider creation,
    backend-global bind group layouts, and a context-owned renderer provider with a fixed path
    rendering strategy
  - Missing: Skia-style global cache/shader dictionary plumbing, broader bind-group families, and a
    real threaded resource-provider split beyond the shared provider alias
- `DawnResourceProvider` -> `src/resource_provider.ts`
  - Status: `partial`
  - What exists: simple resource allocation plus cached fill/stroke/clip pipelines, first
    patch-instance pipelines, dedicated evenodd/nonzero stencil pipelines for patch fills,
    stencil-cover separation, stencil attachment reuse, multisample-aware pipelines, sampler
    canonicalization/reuse, cached uniform/texture bind groups, cached viewport bind-group layout,
    and shared viewport pipeline layout
  - Missing: wrapped/backend resources, intrinsic-constant style upload management, broader cache
    policy, and more generalized pipeline/bind-group keys
- `Context` -> `src/context.ts`
  - Status: `partial`
  - What exists: context factory, shared-context creation, recorder creation, and queue-manager
    ticking
  - Missing: Skia-style submit/insert orchestration, internal recorder paths, and broader context
    lifecycle APIs
- `Recorder` -> `src/recorder.ts`
  - Status: `started`
  - What exists: abstract command collection plus save/restore, per-draw transform, and clip-stack
    state
  - Missing: ordering rules and flush rules
- `DawnCaps` -> `src/caps.ts`
  - Status: `partial`
  - What exists: device feature collection, limit probing, storage-buffer gating, row-alignment
    policy, richer format/sample policy, and runtime capability policy derived from actual device
    and queue surface
  - Missing: multiplanar/external-format nuance and deeper backend-specific workaround policy
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
  - What exists: queue submit, tick, unfinished work tracking, explicit outstanding submission
    ownership for each submitted command buffer, submission-scoped completion via
    `queue.onSubmittedWorkDone()`, coarse fallback when callbacks are unavailable, and cleanup when
    callbacks reject
  - Missing: richer GPU fence/error handling, `WaitAny`-style batching, finish-proc ownership, async
    resource ownership, and per-resource completion tracking
- `GraphicsPipeline` / caches -> `src/pipeline*.ts`
  - Status: `partial`
  - What exists: render-pipeline creation and reuse currently live inside `src/resource_provider.ts`
  - Missing: a separate Graphite-like pipeline/cache layer and broader key specialization
- `Recording` -> `src/recording.ts`
  - Status: `partial`
  - What exists: immutable recorded work snapshot that now feeds prepared pass/task generation
  - Missing: richer backend execution metadata comparable to Graphite recording internals

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
  - Role: queue submission plus Graphite-like outstanding submission ownership and completion
    draining
- `src/recording.ts`
  - Status: `started`
  - Role: immutable recorded command package
- `src/path_renderer.ts`
  - Status: `partial`
  - Role: adaptive curve flattening, conic/arc flattening, cusp splitting, patch preparation,
    triangulation, scanline fallback, convex clip-stack clipping, clip preparation, and stroke
    expansion strategy
- `src/renderer_provider.ts`
  - Status: `started`
  - Role: context-wide renderer set and Graphite-like fill/stroke selection for convex tessellated
    wedges, tessellated wedges, tessellated curves, and tessellated strokes
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

Geometry that is reusable across packages should live in `@disjukr/goldlight/geometry`, not in
`drawing`.

- `Point2d` in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `done`
  - Shared 2D point type
- `Size2d` in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `done`
  - Shared 2D size type
- `Rect` in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `done`
  - Basic rectangle type
- `RRect` in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `started`
  - Shape model exists
- `Circle` in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `done`
  - Basic circle type
- `Polygon` in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `done`
  - General polygon input
- `Path2d` in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `started`
  - Supports `moveTo`, `lineTo`, `quadTo`, `conicTo`, `cubicTo`, `arcTo`, `close`, fill rule state,
    and transform helpers
- Cubic curves in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `started`
  - `cubicTo` exists and is flattened in drawing path preparation
- Conics/arcs in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `started`
  - `conicTo` and `arcTo` are modeled and flattened in drawing path preparation
- Path fill rules in `@disjukr/goldlight/geometry/src/path2d.ts`
  - Status: `started`
  - Fill rule metadata exists, and first stencil-based evenodd/nonzero execution path now exists
- Path transforms/utilities in `@disjukr/goldlight/geometry/src/path2d.ts`
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
  - Current state: shape is converted to `Path2d` and uses the same fill/stroke execution path
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
  - Status: `started`
  - Current state: `DrawingBlendMode`, arithmetic custom blender coefficients, dst-read fallback
    routing, and first WGSL/manual advanced blend execution now exist
  - Missing: Graphite-style paint-param keying, backend-native advanced-blend integration, and
    tighter blend/pipeline specialization
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
  - Status: `partial`
  - Current state: shared-context layouts plus viewport/step/clip bind-group allocation are wired
    into draw encoding, with some provider-side reuse
  - Missing: broader bind-group caching and resource-key specialization
- Shader modules
  - Status: `started`
  - Current state: path/fill/stroke WGSL shader modules are created and cached in the resource
    provider
  - Missing: broader shader lifecycle management and specialization comparable to Graphite
- Pipelines
  - Status: `partial`
  - Current state: direct fill, clip stencil, clip-aware cover, evenodd/nonzero fill stencil,
    stencil-cover, stroke cover, and viewport-layout-backed patch pipelines are cached in the
    resource provider
  - Missing: generalized render pipeline creation and keying beyond viewport-only bindings
- Global cache
  - Status: `partial`
  - Current state: path pipelines, samplers, shader modules, and stencil attachments are reused in
    the resource provider
  - Missing: a true shared-context global cache and broader backend cache ownership
- Resource budget
  - Status: `started`
  - Current state: number is stored
  - Missing: enforcement
- Resource destruction
  - Status: `started`
  - Current state: submission-owned transient buffers are explicitly destroyed on completion; most
    longer-lived resources still rely on implicit device lifetime
  - Missing: broader lifecycle and purge policy for cached resources

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
  - Status: `partial`
  - Simple per-draw vertex/instance/uniform buffer upload exists for stencil, cover, patch, and
    viewport payloads
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
  - Status: `partial`
  - Command buffer submission helpers exist for prepared recordings, path fills/strokes, and queue
    manager tracked completion
- Async work completion
  - Status: `partial`
  - Tick and in-flight submission tracking exist, and completion now follows submission-owned GPU
    queue promises when the backend exposes them, with non-blocking front-of-queue draining on
    ordinary ticks and explicit sync-to-last-submission waits only on the blocking path

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
  - Status: `partial`
  - Save-record clip stacks, deferred save materialization, clip invalidation, deferred clip draw
    metadata, clip shader payloads, analytic rect clips, and atlas-backed complex clips now exist
- Atlas/text approach
  - Status: `started`
  - Clip atlasing now exists through a shared clip atlas manager; general path/text atlas strategy
    is still pending
- Pipeline cache shape
  - Status: `started`
  - First cache shape exists in `src/resource_provider.ts` for shader modules, samplers, and render
    pipelines
  - Missing: Graphite-style cross-context/global cache ownership and richer keys

## Tests And Verification

- Unit tests for package wiring
  - Status: `done`
  - `engine/drawing/tests/drawing_graphite_dawn_test.ts`
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
  - Status: `partial`
  - Caps tests now cover format tables, resolve/transient policy, and provider-side usage validation

## Current Structural Delta

The remaining work should be judged against Skia Graphite/Dawn structure, not just current output.

- `TaskList` / `RenderPassTask` layer is still missing
  - Local state: `src/task.ts`, `src/render_pass_task.ts`, and `src/prepare_resources.ts` now form a
    first
    `Recording -> TaskList -> RenderPassTask -> DrawPass -> prepareResources ->
    CommandBuffer`
    flow
  - Remaining delta: no child-task graph or upload-task ownership
- `DrawPass::prepareResources()` is still narrower than Skia
  - Local state: prepared passes now own pipeline handles, resolved pipelines, sampled textures, and
    step payloads before encode
  - Remaining delta: payload families are still narrower than Graphite's recorder/task resource
    model
- `ClipStack` is structurally closer but still incomplete
  - Local state: save records, deferred save materialization, oldest-valid tracking, and
    rect-intersect invalidation/restore exist in `src/clip_stack.ts`
  - Remaining delta: clip shaders are reduced to a solid-color modulation, deferred clip draws are
    metadata instead of full clip task objects, and the atlas path is a minimal clip-atlas manager
- `RendererProvider` is still a small selector
  - Local state: `src/renderer_provider.ts` now creates a context-owned provider with a fixed
    tessellation strategy and a stable renderer set, `src/shared_context.ts` / `src/recording.ts`
    thread that provider through recording and draw preparation instead of doing free functions at
    callsites, and convex fills now map to a dedicated `convex-tessellated-wedges` renderer instead
    of exposing `middle-out-fan` as a standalone renderer kind; fill selection now also follows
    `Device::chooseMSAARenderer()`-style wedge-vs-curve heuristics from path verb count and draw
    bounds area
  - Remaining delta: still only the tessellation family is modeled; there is no atlas/compute
    strategy selection, shared RenderStep graph, or renderer-wide precompile iteration comparable to
    Graphite
- `Stroke tessellation` is structurally close but still not 1:1
  - Local state: `src/path_renderer.ts` now has iterator-like contour events, deferred first-patch
    rewrite, open-cap patch emission, Graphite-style replicated line patches,
    `FindCubicConvex180Chops`-style cubic chop detection, `StrokeIterator`-like contour finishing
    with explicit move barriers, explicit close-only contours that now emit Skia-style zero-length
    cap geometry, post-`close` current-point preservation for subsequent verbs, and open-contour
    patch chaining that now keeps split curves connected to their true predecessor join control
    points; dashed and line-only stroke patches now route through the same synthetic-path writer
    flow; `src/resource_provider.ts` now uses triangle-strip stroke patch replay with Skia-like
    `edgeID` / `combinedEdgeID` sorting, binary-search parametric edge solve, `unchecked_mix`
    duplicated join-edge restriction, and a leaner instance payload that drops unused contour/cap
    flags from the GPU patch layout, CPU-provided `maxScale` stroke tolerances instead of a
    shader-local approximation, hairline pre-transforming before tessellation, and Skia-like
    quadratic/conic cusp mid-tangent solves instead of midpoint/sampling fallbacks
  - Remaining delta: some `StrokeIterator` semantics are still event-driven rather than a
    verb-for-verb port, cusp handling is still a reduced version of Skia's full writer path in a few
    places, and translucent round cap/join coverage still needs Graphite-like analytic evaluation
    instead of flat color fill
- `QueueManager` submission model is still simplified
  - Local state: queue submission, ordered outstanding submission ownership, completion draining, a
    `checkForFinishedWork`-style sync path, submission-owned transient buffer cleanup, and
    Graphite-like finish callback attachment on the latest outstanding work now exist in
    `src/queue_manager.ts`, `src/command_buffer.ts`, and `src/prepare_resources.ts`
  - Remaining delta: no command-buffer reuse, `WaitAny`-style batching, async mapped-resource
    ownership, or resource/fence correlation
- `SharedContext` is still missing major Graphite shared infrastructure
  - Local state: `src/shared_context.ts` owns caps, a renderer provider, a queue manager, one
    resource provider instance, the noop fragment shader, and the backend-global bind-group layouts
    needed by current 2D replay
  - Remaining delta: no `SharedContext`-level global cache, shader-code dictionary, pipeline
    callback plumbing, distinct thread-safe resource-provider object, or `deviceTick(Context*)` path
    that couples backend ticking to async completion draining the way Skia `DawnSharedContext` does
- `Context` is still far narrower than Skia Graphite `Context`
  - Local state: `src/context.ts` creates a shared context, exposes recorder creation, and forwards
    `tick()` to the queue manager
  - Remaining delta: no context-owned resource provider, no finish-initialization path for static
    GPU setup, no public `insertRecording()` / `submit()` orchestration split, no internal recorder
    path, and no cleanup/readback/backend-texture management APIs comparable to Skia `Context.cpp`
- `DawnResourceProvider` still lacks several backend-specific Graphite facilities
  - Local state: `src/resource_provider.ts` can allocate buffers/textures/samplers, reuse graphics
    pipelines, reuse canonical samplers, create bind groups needed by draw replay, and provide the
    stencil attachment used by current passes
  - Remaining delta: no wrapped/backend texture import or deletion path, no intrinsic-constant
    buffer manager, no uniform/texture bind-group LRU keyed by bound resources, no discardable MSAA
    load texture path, and no blit-with-draw helper like Skia `DawnResourceProvider`
- `QueueManager` is still command-buffer centric instead of task/finish-info centric
  - Local state: `src/queue_manager.ts` stages one encoded command buffer, submits it, tracks
    ordered outstanding submissions, and exposes latest-submission finish callbacks
  - Remaining delta: no `addTask()` / `addRecording()` / `addFinishInfo()` layering, no backend
    command-buffer factory ownership, and no native `WaitAny` / `AsyncWait` polling split like Skia
    `DawnQueueManager`
- `Caps` still trails DawnCaps depth
  - Local state: `src/caps.ts` now owns a richer format table, color-type metadata,
    resolve/transient/MSRTSS policy, resource-binding requirements, provider-facing usage checks,
    and runtime policy that now follows actual queue/device capability surface instead of only the
    presence of a backend tick hook
  - Remaining delta: no multiplanar view/aspect model; native-Dawn backend-type workarounds are
    intentionally out of scope for the WebGPU-only target

## Work Order

1. `P1` Finish stroke tessellation parity
   - Finish the remaining `StrokeIterator` verb semantics and analytic cap/join coverage so the
     current stroke implementation is no longer a reduced Graphite variant
   - Target files: `src/path_renderer.ts`, `src/resource_provider.ts`
2. `P2` Finish `Caps`
   - Port remaining DawnCaps workaround logic, multiplanar/external format coverage, and binding
     requirement policy
   - Target files: `src/caps.ts`, `src/resource_provider.ts`

## Update Rules

When work is added in this package, update this document with:

- the file that was added or changed
- the status transition
- the missing pieces that remain
- the test or check used to validate the change
