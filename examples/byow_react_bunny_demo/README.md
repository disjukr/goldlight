# BYOW React Bunny Demo

Windows-native BYOW example that mounts a real React scene through `@rieul3d/react/reconciler` and
renders the vendored Stanford Bunny PLY mesh on a native WebGPU surface.

This demo exercises:

- ASCII PLY ingestion of the in-repo Stanford Bunny asset
- real React reconciliation into the package-local scene document
- normal TSX authoring against the `@rieul3d/react/reconciler` React-runtime JSX surface, using
  the same primitive contract as the snapshot path plus the exported convenience components
- hook-driven live scene updates that publish `SceneRootCommit` payloads and surface reconciler
  failures through the flush helper path used by tests/deterministic integrations
- react-package frame-driver wiring that applies targeted residency invalidation and uses the
  transform-only reevaluation fast path whenever the rotating bunny only changes node transforms
- reusable `@rieul3d/core` helpers for generated normals, mesh bounds, and Euler-authored light
  rotation
- built-in forward lit shading with a directional light in a native SDL2 window

Run with:

```sh
deno task setup:sdl2:windows
deno task example:byow:react-bunny:run
```

Type-check with:

```sh
deno task example:byow:react-bunny:check
```

Expected output:

- a slowly rotating Stanford Bunny centered in the frame
- simple directional lighting on a pale neutral material

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- SDL2 available to `jsr:@divy/sdl2`
