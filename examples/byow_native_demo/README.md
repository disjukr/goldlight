# BYOW Native Demo

Windows-native BYOW example using the `@goldlight/desktop` shell and `Deno.UnsafeWindowSurface`.

This demo exercises more of the `goldlight` runtime than the startup triangle by rendering:

- an indexed quad through the built-in textured unlit path
- an additional accent mesh with a separate material
- a native WebGPU surface presented through the `winit` desktop host on Windows with an opaque
  swapchain format

Run with:

```sh
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
- the desktop host DLL built through `deno task desktop:host:build` or auto-built by the run task

If the native surface drops its presentation state after window events, the runtime reconfigures the
surface binding on the next frame before retrying `getCurrentTexture()`.
