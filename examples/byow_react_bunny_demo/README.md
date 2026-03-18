# BYOW React Bunny Demo

Windows-native BYOW example that authors the scene through `@rieul3d/react` JSX and renders the
vendored Stanford Bunny PLY mesh on a native WebGPU surface.

This demo exercises:

- ASCII PLY ingestion of the in-repo Stanford Bunny asset
- React-style scene authoring lowered into `SceneIr`
- generated vertex normals for a loader-supplied position-only mesh
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
