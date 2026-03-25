# BYOW React 3D Scene In 3D Demo

Windows-native BYOW example that renders a nested React-authored `<g3d-scene>` into an offscreen
texture and maps that texture onto a panel inside the parent `<g3d-scene>`.

The child `<g3d-scene>` names its output explicitly through `outputTextureId`, and the parent panel
material consumes that texture like any other `baseColor` texture. The parent room uses a cool teal
`clearColor` while the child inspector scene uses a warmer studio `clearColor`, so the boundary is
easy to read without extra background geometry. The panel also slides sideways while the child scene
contents rotate so the two scenes read as distinct live views.

Run:

```sh
deno run -A scripts/build_desktop_host.ts
deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow_react_scene3d_in_3d_demo/main.ts
```

Type check:

```sh
deno check --unstable-raw-imports examples/byow_react_scene3d_in_3d_demo/main.ts examples/byow_react_scene3d_in_3d_demo/app.tsx
```
