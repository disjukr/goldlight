# BYOW React 2D In 3D Demo

This demo shows the current scene-composition story in `goldlight`:

- you can naturally place a vector-drawn React-authored `<g2d-scene>` inside a `<g3d-scene>`
- the 2D scene renders into an offscreen texture, and the parent 3D scene consumes that texture on a
  normal panel material
- the 2D draw and the 3D draw happen inside one GPU context, so the nested-scene render and final
  composition stay on the GPU and do not require an extra CPU readback between them

Today the supported direction is `2d in 3d`. The opposite direction is not supported yet:
`@goldlight/drawing` does not currently draw images or textures, so a `g2d-scene` cannot yet embed
the output of a `g3d-scene`.

This demo also shows the current redraw model:

- if you drive `const setTimeMs = useSetTimeMs();` from your own `requestAnimationFrame` loop, the
  app behaves like a game-style continuously animating renderer
- if you do not do that, `initializeWindow(...)` behaves like a normal application shell and redraws
  only when React state changes or when the system requires it, such as resize or restore

Nested scenes are cached by scene. In practice that means:

- the root scene still redraws when it needs to present
- nested scenes such as the panel `<g2d-scene>` keep their output texture until their own content
  revision changes
- if the parent `<g3d-scene>` keeps animating but the `<g2d-scene>` content stays the same,
  `goldlight` reuses the cached 2D texture instead of replaying the vector drawing commands

This demo exercises:

- `@goldlight/react/reconciler` `g2d-scene` authoring inside `g3d-scene`
- offscreen `@goldlight/drawing` rendering feeding a runtime texture
- textured 3D panel composition in the forward renderer
- scene-level offscreen texture caching
- app-controlled frame driving through `useSetTimeMs()`
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

- a lit 3D room with a floating panel
- a vector-drawn 2D star scene rendered into that panel
- animation driven by the app's own `setTimeMs(...)` loop

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- the desktop host DLL built through `deno task desktop:host:build` or
  `deno run -A scripts/build_desktop_host.ts`
- Rust toolchain available for the native desktop host build
- SDL2 runtime available if the host build or launch requires it
