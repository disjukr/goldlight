# ADR 0007: Post-Processing Execution Model

## Status

Accepted

## Decision

`goldlight` should introduce post-processing as an explicit render-execution stage that runs between
scene rendering and final presentation instead of treating fullscreen effects as ad hoc renderer
special cases.

The proposed execution model is:

- frame planning should distinguish between a scene-color output and the final present target
- forward and deferred scene rendering should write into an explicit intermediate scene-color
  texture when post-processing is requested
- post-processing should be represented as ordered fullscreen passes that consume the previous color
  result and write the next color result
- presentation should occur only after the last post-process pass completes
- offscreen rendering should use the same pass chain so snapshot and export workflows do not require
  a separate code path

The first implementation milestone should stay narrow:

- add a minimal post-process pass contract for a fullscreen triangle/quad program with one sampled
  input color texture, one sampler, and optional uniform data
- support a simple identity/blit or tone-map style pass to validate the pipeline shape
- keep pass ownership in the renderer/runtime layers rather than pushing it into scene IR or React
  authoring APIs

This decision intentionally does not propose a full frame graph. The goal is to establish the
scene-color to post-process to present boundary so future effects such as bloom, fog, color grading,
or reprojection can be added without restructuring the renderer again.

## Rationale

The current renderer already models pass ordering conceptually, but concrete execution still writes
scene results directly into the final target in ways that make chained image-space effects awkward.
That creates several avoidable constraints:

- forward rendering does not have a reusable intermediate scene-color target
- deferred rendering resolves lighting straight into the final output
- fullscreen image-space work has no first-class contract in the frame plan
- offscreen capture and future export workflows would need renderer-specific exceptions

Making post-processing explicit keeps the runtime data-oriented while preserving renderer control of
GPU resource lifetimes and attachment allocation.

## Consequences

- renderer planning APIs will need a pass kind or execution slot for fullscreen post-process stages
- runtime execution will need intermediate color target allocation and chaining rules
- forward and deferred paths can share the same present boundary instead of diverging at the last
  step
- scene IR remains focused on scene description instead of accumulating renderer graph details
- future work on cubemap reprojection, environment export, or presentation effects can build on the
  same fullscreen-pass contract

## Alternatives Considered

- write effects directly into existing forward/deferred frame functions: this keeps short-term code
  small but hardens renderer-specific special cases and does not give offscreen workflows a reusable
  boundary
- encode post-processing in scene IR: this would mix renderer execution concerns into serializable
  scene data too early
- jump straight to a full frame graph: this is heavier than needed for the current repository scope
  and would make the first milestone harder to land

Related discussion: `#101`, "Refactor renderer flow to support post-processing passes"
