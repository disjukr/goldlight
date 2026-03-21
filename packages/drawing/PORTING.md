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

- `pending`: not started
- `started`: initial file or API shape exists
- `partial`: significant pieces exist but execution is incomplete
- `done`: implemented and verified
- `blocked`: cannot proceed until a design or dependency is resolved

## Overall Summary

| Area | Status | Summary |
| --- | --- | --- |
| Package setup | `done` | `drawing` package exists and is wired into the workspace |
| Shared 2D geometry model | `partial` | Basic `Path2D` and shape types exist in `geometry` |
| Backend context | `started` | Dawn/WebGPU device lifecycle wrapper exists |
| Shared context | `started` | Shared backend state and resource provider are present |
| Resource allocation | `started` | Thin buffer/texture/sampler allocation layer exists |
| Recording | `started` | Abstract commands for `clear`, `drawPath`, `drawShape` exist |
| Capability probing | `pending` | No caps or limits layer yet |
| GPU encoding | `pending` | No command buffer translation yet |
| Queue submission | `pending` | No queue manager or GPU work tracking yet |
| Path rendering | `pending` | No tessellation or rasterization strategy implemented |
| Paint system | `started` | Minimal paint shape exists, not executable |
| Testing | `partial` | Structural tests exist, no real GPU rendering tests yet |

## Architecture Mapping

| Skia Graphite/Dawn | Local target | Status | What exists | What is missing |
| --- | --- | --- | --- | --- |
| `DawnBackendContext` | `src/dawn_backend_context.ts` | `started` | wraps adapter/device/queue/tick | no device feature negotiation policy |
| `DawnSharedContext` | `src/shared_context.ts` | `started` | shared backend state and resource provider creation | no bind group layouts, no pipeline helpers |
| `DawnResourceProvider` | `src/resource_provider.ts` | `started` | simple resource allocation methods | no caching, no bind groups, no wrapped resources |
| `Context` | `src/context.ts` | `started` | context factory and recorder creation | no submit pipeline, no global backend orchestration |
| `Recorder` | `src/recorder.ts` | `started` | abstract command collection | no recording object, no ordering or flush rules |
| `DawnCaps` | `src/caps.ts` | `pending` | none | feature probing, format support, limits, fallbacks |
| `DawnCommandBuffer` | `src/command_buffer.ts` | `pending` | none | WebGPU encoder translation |
| `DawnQueueManager` | `src/queue_manager.ts` | `pending` | none | queue submit, tick, unfinished work tracking |
| `GraphicsPipeline` / caches | `src/pipeline*.ts` | `pending` | none | pipeline creation and reuse |
| `Recording` | `src/recording.ts` | `pending` | none | immutable recorded work unit |

## Local Files

| File | Role | Status |
| --- | --- | --- |
| `src/context.ts` | high-level drawing context factory | `started` |
| `src/dawn_backend_context.ts` | Dawn/WebGPU backend handles | `started` |
| `src/shared_context.ts` | shared backend objects | `started` |
| `src/resource_provider.ts` | low-level resource creation | `started` |
| `src/recorder.ts` | command recording API | `started` |
| `src/geometry.ts` | bridge from drawing to geometry | `started` |
| `src/types.ts` | shared drawing command and paint types | `started` |
| `src/caps.ts` | backend capability model | `pending` |
| `src/command_buffer.ts` | command encoder translation | `pending` |
| `src/queue_manager.ts` | queue submission and completion | `pending` |
| `src/recording.ts` | immutable recorded command package | `pending` |
| `src/path_renderer.ts` | path rendering strategy | `pending` |

## Geometry Model Progress

Geometry that is reusable across packages should live in `@rieul3d/geometry`, not in `drawing`.

| Item | Location | Status | Notes |
| --- | --- | --- | --- |
| `Point2D` | `@rieul3d/geometry/src/path2d.ts` | `done` | shared 2D point type |
| `Size2D` | `@rieul3d/geometry/src/path2d.ts` | `done` | shared 2D size type |
| `Rect` | `@rieul3d/geometry/src/path2d.ts` | `done` | basic rectangle type |
| `RRect` | `@rieul3d/geometry/src/path2d.ts` | `started` | shape model exists |
| `Circle` | `@rieul3d/geometry/src/path2d.ts` | `done` | basic circle type |
| `Polygon` | `@rieul3d/geometry/src/path2d.ts` | `done` | general polygon input |
| `Path2D` | `@rieul3d/geometry/src/path2d.ts` | `started` | `moveTo`, `lineTo`, `quadTo`, `close` |
| cubic curves | `@rieul3d/geometry/src/path2d.ts` | `pending` | no `cubicTo` yet |
| conics/arcs | `@rieul3d/geometry/src/path2d.ts` | `pending` | no arc representation yet |
| path fill rules | `@rieul3d/geometry/src/path2d.ts` | `pending` | no winding/even-odd state yet |
| path transforms/utilities | `@rieul3d/geometry/src/path2d.ts` | `pending` | no utility layer yet |

## Drawing Command Progress

| Command / concept | Status | Current state | Missing |
| --- | --- | --- | --- |
| `clear` | `started` | recordable | not executable on GPU |
| `drawPath` | `started` | recordable with paint | no rasterization or tessellation |
| `drawShape` | `started` | shape is converted to `Path2D` | no GPU execution |
| clip path | `pending` | none | clip stack and pass integration |
| transform stack | `pending` | none | per-draw transform model |
| save/restore | `pending` | none | state stack model |
| paint blending | `pending` | none | blend modes not modeled |
| anti-aliasing | `pending` | none | no AA strategy yet |
| text/glyph drawing | `pending` | none | out of scope for now |

## Paint System Progress

| Paint feature | Status | Notes |
| --- | --- | --- |
| RGBA color | `started` | exists in `DrawingPaint` |
| fill vs stroke | `started` | represented, not executed |
| stroke width | `started` | represented, not executed |
| join/cap | `pending` | not modeled |
| miter limit | `pending` | not modeled |
| shader/gradient | `pending` | not modeled |
| image pattern | `pending` | not modeled |
| blend mode | `pending` | not modeled |
| color filter | `pending` | not modeled |

## Backend Capability Progress

| Capability area | Status | Notes |
| --- | --- | --- |
| device availability | `started` | backend context requests a device |
| feature negotiation | `pending` | no central policy |
| limits tracking | `pending` | not exposed or cached |
| format support | `pending` | no caps table |
| sample count policy | `pending` | no MSAA strategy |
| storage buffer support | `pending` | no capability model |
| fallback/workaround policy | `pending` | no centralized backend policy |

## Resource System Progress

| Resource area | Status | Current state | Missing |
| --- | --- | --- | --- |
| buffer creation | `started` | direct wrapper exists | no pooling/caching |
| texture creation | `started` | direct wrapper exists | no reuse strategy |
| sampler creation | `started` | direct wrapper exists | no canonicalization/cache |
| bind groups | `pending` | none | required for real draw execution |
| shader modules | `pending` | none | no shader lifecycle |
| pipelines | `pending` | none | no render pipeline creation |
| global cache | `pending` | none | no shared backend caches |
| resource budget | `started` | number is stored | not enforced |
| resource destruction | `pending` | implicit only | no lifecycle policy |

## Rendering Pipeline Progress

| Stage | Status | Notes |
| --- | --- | --- |
| abstract draw recording | `started` | recorder collects draw commands |
| path normalization | `started` | shape to path conversion exists |
| fill/stroke expansion | `pending` | no geometry generation yet |
| path tessellation | `pending` | no CPU or GPU tessellator |
| vertex/index generation | `pending` | none |
| GPU upload | `pending` | not connected to drawing commands |
| render pass setup | `pending` | none |
| pipeline binding | `pending` | none |
| draw submission | `pending` | none |
| async work completion | `pending` | tick exists, submission does not |

## Rendering Strategy Decisions

These decisions directly affect the remaining work and are not settled yet.

| Topic | Status | Notes |
| --- | --- | --- |
| first fill strategy | `blocked` | choose CPU tessellation vs stencil-and-cover vs analytic |
| first stroke strategy | `blocked` | depends on paint and path expansion model |
| clip implementation | `blocked` | depends on render pass and coverage strategy |
| atlas/text approach | `pending` | deferred until shapes are rendering |
| pipeline cache shape | `pending` | depends on command buffer and shader layout |

## Tests And Verification

| Verification area | Status | Notes |
| --- | --- | --- |
| unit tests for package wiring | `done` | `tests/drawing_graphite_dawn_test.ts` |
| type checking | `done` | package APIs type-check |
| geometry path tests | `partial` | indirect coverage only |
| real WebGPU integration test | `pending` | no draw execution yet |
| image snapshot regression | `pending` | no rendered output yet |
| backend capability tests | `pending` | no caps layer yet |

## Known Gaps

- `Path2D` is still very small compared to Skia `SkPath`
- recording is mutable command accumulation, not a true immutable recording object
- no separation yet between frontend drawing commands and backend executable passes
- no renderer for fills or strokes
- no clipping, transforms, or retained state model
- no pipeline or bind group cache

## Recommended Next Steps

1. Add `src/caps.ts`
   - Probe WebGPU features and limits
   - Decide minimum supported format/sample-count rules
   - Centralize backend capability checks
2. Add `src/recording.ts`
   - Freeze recorder output into an immutable work package
   - Separate API recording from backend execution
3. Add `src/command_buffer.ts`
   - Define the backend execution layer that consumes recording output
   - Start with `clear` and one simple filled path path
4. Decide and implement the first fill path
   - Prefer a simple CPU tessellation route first for momentum
5. Add `src/queue_manager.ts`
   - Own submit and unfinished-work tracking
   - Integrate backend tick handling
6. Expand `Path2D`
   - Add `cubicTo`
   - Add fill rule
   - Add basic transform helpers

## Update Rules

When work is added in this package, update this document with:

- the file that was added or changed
- the status transition
- the missing pieces that remain
- the test or check used to validate the change
