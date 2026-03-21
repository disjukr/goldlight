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
  - Status: `partial`
  - Basic `Path2D` and shape types exist in `geometry`.
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
  - Abstract commands exist and can be frozen into immutable recordings.
- Capability probing
  - Status: `started`
  - Initial caps and limits layer exists.
- GPU encoding
  - Status: `started`
  - Clear-only command buffer translation exists.
- Queue submission
  - Status: `started`
  - Queue manager can submit encoded command buffers and track in-flight work counts.
- Path rendering
  - Status: `pending`
  - No tessellation or rasterization strategy implemented.
- Paint system
  - Status: `started`
  - Minimal paint shape exists, not executable.
- Testing
  - Status: `partial`
  - Structural tests exist, no real GPU rendering tests yet.

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
  - What exists: simple resource allocation methods
  - Missing: caching, bind groups, wrapped resources
- `Context` -> `src/context.ts`
  - Status: `started`
  - What exists: context factory and recorder creation
  - Missing: submit pipeline and global backend orchestration
- `Recorder` -> `src/recorder.ts`
  - Status: `started`
  - What exists: abstract command collection
  - Missing: ordering rules and flush rules
- `DawnCaps` -> `src/caps.ts`
  - Status: `started`
  - What exists: initial feature, format, and limit policy
  - Missing: richer probing and backend-specific fallbacks
- `DawnCommandBuffer` -> `src/command_buffer.ts`
  - Status: `started`
  - What exists: clear-only WebGPU render-pass encoding
  - Missing: draw path and draw shape encoding
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
  - Status: `started`
  - Role: command recording API
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
- `src/queue_manager.ts`
  - Status: `started`
  - Role: queue submission and completion
- `src/recording.ts`
  - Status: `started`
  - Role: immutable recorded command package
- `src/path_renderer.ts`
  - Status: `pending`
  - Role: path rendering strategy
- `tests/`
  - Status: `started`
  - Role: package-local tests for drawing
- `assets/`
  - Status: `started`
  - Role: package-local drawing reference assets and generated outputs
- `examples/`
  - Status: `started`
  - Role: package-local drawing examples and progress viewers
  - Note: prefer non-browser examples unless browser output is specifically needed
  - Current state: `examples/render_tiger_png` writes a PNG via `@rieul3d/exporters`, but it is still a progress scaffold rather than a true tiger render

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
  - Supports `moveTo`, `lineTo`, `quadTo`, `close`
- Cubic curves in `@rieul3d/geometry/src/path2d.ts`
  - Status: `pending`
  - No `cubicTo` yet
- Conics/arcs in `@rieul3d/geometry/src/path2d.ts`
  - Status: `pending`
  - No arc representation yet
- Path fill rules in `@rieul3d/geometry/src/path2d.ts`
  - Status: `pending`
  - No winding/even-odd state yet
- Path transforms/utilities in `@rieul3d/geometry/src/path2d.ts`
  - Status: `pending`
  - No utility layer yet

## Drawing Command Progress

- `clear`
  - Status: `started`
  - Current state: recordable
  - Missing: executable GPU path
- `drawPath`
  - Status: `started`
  - Current state: recordable with paint
  - Missing: rasterization or tessellation
- `drawShape`
  - Status: `started`
  - Current state: shape is converted to `Path2D`
  - Missing: GPU execution
- Clip path
  - Status: `pending`
  - Missing: clip stack and pass integration
- Transform stack
  - Status: `pending`
  - Missing: per-draw transform model
- Save/restore
  - Status: `pending`
  - Missing: state stack model
- Paint blending
  - Status: `pending`
  - Missing: blend mode model
- Anti-aliasing
  - Status: `pending`
  - Missing: AA strategy
- Text/glyph drawing
  - Status: `pending`
  - Out of scope for now

## Paint System Progress

- RGBA color
  - Status: `started`
  - Exists in `DrawingPaint`
- Fill vs stroke
  - Status: `started`
  - Represented, not executed
- Stroke width
  - Status: `started`
  - Represented, not executed
- Join/cap
  - Status: `pending`
  - Not modeled
- Miter limit
  - Status: `pending`
  - Not modeled
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
  - Status: `pending`
  - Missing: render pipeline creation
- Global cache
  - Status: `pending`
  - Missing: shared backend caches
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
  - Status: `pending`
  - No geometry generation yet
- Path tessellation
  - Status: `pending`
  - No CPU or GPU tessellator
- Vertex/index generation
  - Status: `pending`
  - None
- GPU upload
  - Status: `pending`
  - Not connected to drawing commands
- Render pass setup
  - Status: `started`
  - Clear-only render pass encoding exists
- Pipeline binding
  - Status: `pending`
  - None
- Draw submission
  - Status: `started`
  - Command buffer submission helper exists for encoded clears
- Async work completion
  - Status: `started`
  - Tick and in-flight submission tracking exist, but completion is still coarse

## Rendering Strategy Decisions

These decisions directly affect the remaining work and are not settled yet.

- First fill strategy
  - Status: `blocked`
  - Choose CPU tessellation vs stencil-and-cover vs analytic
- First stroke strategy
  - Status: `blocked`
  - Depends on paint and path expansion model
- Clip implementation
  - Status: `blocked`
  - Depends on render pass and coverage strategy
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
  - Status: `partial`
  - Indirect coverage only
- Real WebGPU integration test
  - Status: `pending`
  - No draw execution yet
- Image snapshot regression
  - Status: `pending`
  - No rendered output yet
  - Note: `examples/render_tiger_png` currently exports a placeholder PNG because SVG ingestion and path rendering are not ready
- Backend capability tests
  - Status: `started`
  - Basic caps tests exist

## Known Gaps

- `Path2D` is still very small compared to Skia `SkPath`
- recording snapshots exist, but they still do not partition work into backend-executable passes
- no separation yet between frontend drawing commands and backend executable passes
- no renderer for fills or strokes
- no SVG parser or SVG-to-`Path2D` ingestion path yet
- no clipping, transforms, or retained state model
- no pipeline or bind group cache
- `command_buffer` currently skips draw commands and only encodes `clear`
- `queue_manager` currently treats `tick()` as coarse completion rather than using explicit GPU fences

## Recommended Next Steps

1. Deepen `src/caps.ts`
   - Replace static format assumptions with richer backend policy
   - Add feature-gated fallbacks
2. Add `src/command_buffer.ts`
   - Define the backend execution layer that consumes recording output
   - Start with `clear` and one simple filled path
3. Decide and implement the first fill path
   - Prefer a simple CPU tessellation route first for momentum
4. Add `src/queue_manager.ts`
   - Own submit and unfinished-work tracking
   - Integrate backend tick handling
5. Expand `Path2D`
   - Add `cubicTo`
   - Add fill rule
   - Add basic transform helpers

## Update Rules

When work is added in this package, update this document with:

- the file that was added or changed
- the status transition
- the missing pieces that remain
- the test or check used to validate the change
