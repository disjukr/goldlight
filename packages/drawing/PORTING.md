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
  - `Path2D`, fill rules, cubic verbs, and basic transform helpers exist in `geometry`.
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
  - Clear, direct fill/stroke replay, clip-stencil replay for complex clip paths, and first stroke command buffer translation exist.
- Queue submission
  - Status: `started`
  - Queue manager can submit encoded command buffers and track in-flight work counts.
- Path rendering
  - Status: `partial`
  - Flattened contours can be pushed through direct tessellated fills, convex clip-stack clipping, self-intersection fallback, and first stroke expansion.
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
  - What exists: simple resource allocation plus cached fill/stroke/clip pipelines, stencil attachment reuse, and multisample-aware pipelines
  - Missing: bind groups, wrapped resources, broader cache policy
- `Context` -> `src/context.ts`
  - Status: `started`
  - What exists: context factory and recorder creation
  - Missing: submit pipeline and global backend orchestration
- `Recorder` -> `src/recorder.ts`
  - Status: `started`
  - What exists: abstract command collection plus save/restore, per-draw transform, and clip-stack state
  - Missing: ordering rules and flush rules
- `DawnCaps` -> `src/caps.ts`
  - Status: `started`
  - What exists: initial feature, format, and limit policy
  - Missing: richer probing and backend-specific fallbacks
- `DawnCommandBuffer` -> `src/command_buffer.ts`
  - Status: `partial`
  - What exists: clear plus direct fill/stroke replay, convex-clip scissor replay, and stencil replay for complex clip paths
  - Missing: broader draw path and draw shape encoding, richer pass replay
- `DrawPass` -> `src/draw_pass.ts`
  - Status: `partial`
  - What exists: prepared pass partitioning plus pipeline-key, bounds, stencil, and clip-stack metadata for draw steps
  - Missing: pipeline/state/resource preparation comparable to Skia DrawPass
- `DawnQueueManager` -> `src/queue_manager.ts`
  - Status: `started`
  - What exists: queue submit, tick, and unfinished work tracking
  - Missing: real GPU completion fences and error handling
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
  - Role: adaptive curve flattening, triangulation, scanline fallback, convex clip-stack clipping, clip preparation, and stroke expansion strategy
- `tests/`
  - Status: `started`
  - Role: package-local tests for drawing, including snapshot regression
- `examples/`
  - Status: `started`
  - Role: package-local drawing examples and progress viewers
  - Note: prefer non-browser examples unless browser output is specifically needed
  - Current state: `examples/render_basic_paths` now exercises fill rule, cubic fill, clip rect, transform, and stroke output

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
  - Supports `moveTo`, `lineTo`, `quadTo`, `cubicTo`, `close`, fill rule state, and transform helpers
- Cubic curves in `@rieul3d/geometry/src/path2d.ts`
  - Status: `started`
  - `cubicTo` exists and is flattened in drawing path preparation
- Conics/arcs in `@rieul3d/geometry/src/path2d.ts`
  - Status: `pending`
  - No arc representation yet
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
  - Current state: recordable, fill uses stencil-and-cover or scanline fallback, and stroke has expanded geometry path
  - Missing: higher-quality rasterization and broader path feature coverage
- `drawShape`
  - Status: `started`
  - Current state: shape is converted to `Path2D` and uses the same fill/stroke execution path
  - Missing: broader primitive specialization
- Clip path
  - Status: `started`
  - Current state: clip stack is recorded explicitly, rect clips and convex path clips are intersected through prepared geometry, and a complex single clip path can still allocate a stencil clip pass
  - Missing: full nested arbitrary clip-path coverage and Skia-like clip stack semantics
- Transform stack
  - Status: `started`
  - Current state: recorder save/restore and per-draw transform state exist without mutating stored source geometry
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
  - Current state: pipeline multisample count follows target sample count, and the basic snapshot example now renders through a supersampled offscreen path before PNG export
  - Missing: coverage/analytic AA beyond MSAA and example-specific supersampling
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
  - Represented and first segment-expansion path exists
- Join/cap
  - Status: `started`
  - Modeled, with first join/cap geometry generation path
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
  - Current state: direct fill, clip stencil, clip-aware cover, and stroke cover pipelines are cached in the resource provider
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
  - Flattened contours can be emitted for direct fill meshes, convex clip-stack clipping, and first join/cap-aware stroke geometry
- Path tessellation
  - Status: `started`
  - Adaptive CPU contour flattening exists for line, quadratic, and cubic path segments, with scanline fallback for more complex fill input
- Vertex/index generation
  - Status: `started`
  - Vertex generation exists for direct fills, clip-aware fills, complex clip replay, and expanded strokes
- GPU upload
  - Status: `started`
  - Simple per-draw vertex buffer upload exists for stencil and cover passes
- Render pass setup
  - Status: `started`
  - Recording can be partitioned into prepared draw passes, and draw replay now covers direct fill/stroke plus clip stencil when needed
- Pipeline binding
  - Status: `started`
  - Basic fill, clip, and stroke pipelines exist for first path draws and are reused across command buffers
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
  - First implementation triangulates simple contours directly and falls back to scanline tessellation for problematic contours
- First stroke strategy
  - Status: `started`
  - First implementation now includes miter/bevel/round joins and butt/square/round caps
- Clip implementation
  - Status: `started`
  - First implementation uses recorded clip stacks, convex geometry clipping, scissor reduction, and stencil masking for a remaining complex clip path
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
  - `render_basic_paths_snapshot_test.ts` exercises live WebGPU rendering when available, including the supersampled PNG output path
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
- arcs and advanced curve/path features are still missing
- evenodd/nonzero fills now rely on prepared geometry plus scanline fallback rather than Skia-style path renderers, and coverage is still not Skia-grade
- no SVG parser or SVG-to-`Path2D` ingestion path yet
- no retained scene model
- no bind group cache
- `command_buffer` still does per-draw render pass replay for stencil clears instead of a richer DrawPass command stream
- `queue_manager` currently treats `tick()` as coarse completion rather than using explicit GPU fences

## Recommended Next Steps

1. Deepen `src/caps.ts`
   - Replace static format assumptions with richer backend policy
   - Add feature-gated fallbacks
2. Harden the first fill path
   - Improve scanline fallback quality and unify it more cleanly with stencil rendering
   - Add more winding and clip-path tests
3. Improve transform and paint replay
   - Move per-draw transform from CPU-prepared geometry toward uniform-driven replay
   - Start separating paint data from vertex payloads
4. Add pipeline/resource caching
   - Extend reuse toward bind groups, transient buffers, and richer pipeline keys
5. Add `src/queue_manager.ts`
   - Own submit and unfinished-work tracking
   - Integrate backend tick handling
6. Expand `Path2D`
   - Add arcs/conics
   - Add more utility helpers

## Update Rules

When work is added in this package, update this document with:

- the file that was added or changed
- the status transition
- the missing pieces that remain
- the test or check used to validate the change
