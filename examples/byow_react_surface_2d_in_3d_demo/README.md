# BYOW React 2D-In-3D Demo

Windows-native BYOW example that renders a React-authored `<g2d-scene>` into an offscreen drawing
texture and then applies that texture to an explicitly authored 3D panel mesh inside the scene.

`<g2d-scene>` names its output explicitly through `outputTextureId`, so the panel material
references that texture by name instead of relying on an implicit `surface id -> texture id`
mapping.

This demo exercises:

- `@goldlight/react/reconciler` `g2d-scene` authoring
- offscreen `@goldlight/drawing` rendering feeding a runtime texture
- textured 3D panel composition in the forward renderer
- native BYOW presentation and resize handling

Run with:

```sh
deno run -A scripts/build_desktop_host.ts
deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow_react_surface_2d_in_3d_demo/main.ts
```

Type-check with:

```sh
deno check --unstable-raw-imports examples/byow_react_surface_2d_in_3d_demo/main.ts examples/byow_react_surface_2d_in_3d_demo/app.tsx
```

Expected output:

- a dark box-like 3D scene
- a floating panel inside that scene textured from `@goldlight/drawing`
- animated 2D bars and strokes rendered into the panel

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- the desktop host DLL built through `deno task desktop:host:build` or
  `deno run -A scripts/build_desktop_host.ts`
- Rust toolchain available for the native desktop host build
- SDL2 runtime available if the host build or launch requires it
