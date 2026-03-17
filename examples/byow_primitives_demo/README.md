# BYOW Primitives Demo

Windows-native BYOW example using SDL2, `Deno.UnsafeWindowSurface`, and the built-in
`@rieul3d/primitives` mesh generators.

This demo renders the current primitive set through the runtime's mesh path with a custom WGSL
shader that applies a fixed directional light to mesh normals. The scene is viewed through a
perspective camera and rendered through the depth-tested forward mesh path:

- box
- sphere
- cylinder
- capsule
- torus
- tetrahedron
- octahedron
- hexahedron
- dodecahedron
- icosahedron

Run with:

```sh
deno task setup:sdl2:windows
deno task example:byow:primitives:run
```

Type-check with:

```sh
deno task example:byow:primitives:check
```

Expected output:

- a 2-row grid of colored primitives with visible light and shading variation in a native SDL2
  window

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- SDL2 available to `jsr:@divy/sdl2`

The repository includes a Windows-only installer script that downloads the official SDL2 runtime zip
from `libsdl.org/release` into `vendor/sdl2/windows-x64`. The run task auto-detects that location on
Windows, so after setup you can launch the example directly.
