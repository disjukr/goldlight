# Interaction

## Screen-To-World Ray Utility

`@rieul3d/core` exposes `createScreenWorldRay()` for pointer-driven scene queries that need a
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
