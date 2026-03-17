# BYOW Native Demo

Windows-native BYOW example using SDL2 and `Deno.UnsafeWindowSurface`.

This demo exercises more of the `rieul3d` runtime than the startup triangle by rendering:

- an indexed quad through the built-in textured unlit path
- an additional accent mesh with a separate material
- a native WebGPU surface presented through SDL2 on Windows

Run with:

```sh
deno task setup:sdl2:windows
deno task example:byow:run
```

Type-check with:

```sh
deno task example:byow:check
```

Expected output:

- a tiled checkerboard panel on the left side of the window
- an orange accent triangle on the right side

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- SDL2 available to `jsr:@divy/sdl2`

The repository includes a Windows-only installer script that downloads the official SDL2 runtime zip
from `libsdl.org/release` into `vendor/sdl2/windows-x64`. The run task auto-detects that location on
Windows, so after setup you can launch the example directly.
