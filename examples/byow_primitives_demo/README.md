# BYOW Primitives Demo

Windows-native BYOW example using the `@rieul3d/desktop` shell, `Deno.UnsafeWindowSurface`, and the
built-in `@rieul3d/primitives` mesh generators.

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
deno task example:byow:primitives:run
```

Type-check with:

```sh
deno task example:byow:primitives:check
```

Expected output:

- a 2-row grid of colored primitives with visible light and shading variation in a native desktop
  window

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- the desktop host DLL built through `deno task desktop:host:build` or auto-built by the run task
