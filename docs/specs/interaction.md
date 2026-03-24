# Interaction

## Screen-To-World Ray Utility

`@goldlight/core` exposes `createScreenWorldRay()` for pointer-driven scene queries that need a
world-space ray from the current evaluated camera.

## Contract

- inputs are pointer coordinates plus viewport dimensions
- `viewportX` and `viewportY` are optional screen-space offsets for sub-rect viewports
- when viewport offsets are omitted, `x` and `y` are interpreted as viewport-local coordinates
- screen-space origin is top-left
- positive screen-space `x` moves right and positive screen-space `y` moves down
- returned rays are world-space and normalized

## Camera Behavior

- perspective cameras emit rays from the camera origin through the requested viewport coordinate
- orthographic cameras emit parallel `-Z` rays and offset the ray origin across the camera plane
- both camera modes use the evaluated camera world transform, so parent transforms and camera node
  rotation/translation apply automatically

## Current Scope

- intended as a reusable foundation for picking and hover workflows
- does not perform mesh, SDF, or bounds intersection tests
- index-buffer or id-buffer picking remains a separate renderer-side concern

## Renderer-Side Picking

`@goldlight/renderer` exposes a mesh-node picking path that rasterizes stable encoded ids into an
offscreen color target.

### Contract

- pick ids are assigned per evaluated mesh node in scene order, starting at `1`
- `0` remains the reserved background / no-hit value
- pick snapshots render into an internal linear `rgba8unorm` target before readback so decoded ids
  stay stable even when the caller's main render target uses another color format
- pick snapshots return both compact RGBA bytes and the node-to-mesh metadata needed to decode hits
- `readNodePickHit()` resolves one screen pixel back to a node id and mesh id without coupling to
  CPU ray construction

### Current Scope

- current picking support targets mesh nodes only
- ids map back to scene nodes and mesh resources, not per-triangle primitives
- only built-in mesh materials are currently supported; custom WGSL materials are rejected because
  their vertex/discard behavior can diverge from the visible frame
- readback currently requires an offscreen render target because it depends on snapshot bytes
