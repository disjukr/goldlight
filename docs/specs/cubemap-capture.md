# Cubemap Capture

## Goal

`@rieul3d/renderer` exposes an offscreen cubemap capture path that renders a mesh scene into six
square faces without coupling that capture step to any 2D export layout.

## Current Scope

- the first capture API is `renderForwardCubemapSnapshot(...)`
- capture is offscreen-only and returns CPU-readable bytes per face
- face order is fixed to:
  - `positive-x`
  - `negative-x`
  - `positive-y`
  - `negative-y`
  - `positive-z`
  - `negative-z`
- each face uses a 90-degree perspective projection with aspect ratio `1`
- capture origin defaults to the active camera position when present, otherwise world origin
- callers may override cubemap size, capture origin, near plane, far plane, and output format
- CPU readback is currently limited to `rgba8unorm`; other formats should fail fast until readback
  stride sizing becomes format-aware

## Output Contract

`CubemapSnapshotResult` returns:

- `size`: the square edge length used for every face
- `drawCount`: total draw calls across all six face renders
- `submittedCommandBufferCount`: total render submissions across all six face renders
- `faces`: ordered per-face snapshots, each containing:
  - `face`
  - `width` / `height`
  - `bytes`
  - `viewMatrix`
  - `projectionMatrix`

This keeps the renderer-side product as a reusable cubemap capture instead of locking it to
equirectangular, angular-map, cross, or strip reprojection.

## Compatibility

- built-in forward mesh rendering, lit/unlit materials, texture sampling, and directional lights are
  supported
- the first capture path rejects scenes with SDF or volume nodes because current raymarch shaders
  still assume one fixed camera instead of face-specific cubemap cameras
- downstream reprojection/export should consume the returned face snapshots rather than reaching
  back into the renderer

## Follow-Up Direction

- add camera-aware SDF and volume raymarch uniforms so cubemap capture can cover hybrid scenes
- add renderer-level reprojection/export helpers on top of captured cubemap faces
- evaluate a shared GPU texture-array backing when cubemap capture needs to stay on the device
