# BYOW React 3D Scene In 3D Demo

This demo shows that scene composition is not limited to `2d in 3d`. A nested React-authored
`<g3d-scene>` can render into its own offscreen texture, use its own camera, and then appear inside
another `<g3d-scene>` as a textured panel.

The child `<g3d-scene>` names its output explicitly through `outputTextureId`, and the parent panel
material consumes that texture like any other `baseColor` texture. That means a parent scene can
embed a different live 3D view without leaving the main GPU context.

Like the `2d in 3d` path, both the nested 3D draw and the parent 3D draw run in one GPU context. The
child scene output is cached by scene revision, so if the child scene content does not change, the
parent can keep animating without rerendering the child offscreen texture.

The demo uses different cameras and different `clearColor` values for the parent room and the child
inspector scene so the two views are easy to distinguish.

Run:

```sh
deno run -A scripts/build_desktop_host.ts
deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow_react_scene3d_in_3d_demo/main.ts
```

Type check:

```sh
deno check --unstable-raw-imports examples/byow_react_scene3d_in_3d_demo/main.ts examples/byow_react_scene3d_in_3d_demo/app.tsx
```

Expected output:

- a parent 3D room scene
- a floating panel that shows a second 3D scene from a different camera
- independent motion in the parent scene and in the child scene
