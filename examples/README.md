# Examples

Runnable examples live here. Each example should document how to build, serve, or execute it.

## Available Examples

- [`byow/native_demo/README.md`](./byow/native_demo/README.md): Windows-native BYOW surface demo
  using runtime mesh, texture residency, and built-in textured unlit rendering
- [`byow/primitives_demo/README.md`](./byow/primitives_demo/README.md): Windows-native BYOW demo
  rendering the built-in procedural mesh primitive set through a camera-backed, depth-tested forward
  path
- [`byow/helmet_pathtraced_demo/README.md`](./byow/helmet_pathtraced_demo/README.md): Windows-native
  BYOW demo exercising the default triangle-BVH mesh path tracing path with the vendored Damaged
  Helmet GLB
- [`byow/helmet_forward_demo/README.md`](./byow/helmet_forward_demo/README.md): Windows-native BYOW
  demo exercising the React-reconciler-driven forward `lit` template system against the full
  vendored Damaged Helmet material texture set, environment-map IBL, and renderer debug views
- [`byow/cornell_pathtraced_demo/README.md`](./byow/cornell_pathtraced_demo/README.md):
  Windows-native BYOW Cornell-box demo that supplies SDF room data through the pathtraced renderer's
  scene extension
- [`byow/cornell_helmet_pathtraced_demo/README.md`](./byow/cornell_helmet_pathtraced_demo/README.md):
  Windows-native BYOW demo mixing the Damaged Helmet mesh path with a Cornell-box SDF renderer
  extension
- [`byow/react_bunny_demo/README.md`](./byow/react_bunny_demo/README.md): Windows-native BYOW demo
  mounted through `@disjukr/goldlight/react/reconciler` and rendering the vendored Stanford Bunny
  PLY mesh
- [`byow/react_glyphs_demo/README.md`](./byow/react_glyphs_demo/README.md): Windows-native BYOW demo
  showing root-`g2d-scene` presentation with `g2d-glyphs` in A8 atlas, SDF, and path fallback modes
- [`byow/layout_demo/README.md`](./byow/layout_demo/README.md): Windows-native BYOW demo showing the
  first `@disjukr/goldlight/layout` box tree and paragraph APIs painted through
  `@disjukr/goldlight/drawing`
- [`byow/react_surface_2d_in_3d_demo/README.md`](./byow/react_surface_2d_in_3d_demo/README.md):
  Windows-native BYOW demo showing vector-drawn `g2d-scene` composition inside `g3d-scene`, scene
  texture caching, and app-controlled frame driving through `useSetTimeMs()`
- [`byow/react_scene3d_in_3d_demo/README.md`](./byow/react_scene3d_in_3d_demo/README.md):
  Windows-native BYOW demo showing nested `g3d-scene` composition with a different child camera
  rendered into a texture-backed 3D panel
- [`byow/multiwindow_demo/README.md`](./byow/multiwindow_demo/README.md): Windows-native BYOW demo
  opening two small windows at once to validate multiwindow orchestration
- [`assets/README.md`](./assets/README.md): in-repo small example assets plus refresh commands
  including the Stanford Bunny PLY source mesh
- [`headless_snapshot/README.md`](./headless_snapshot/README.md): offscreen render-to-PNG workflow
- [`byow/triangle/README.md`](./byow/triangle/README.md): Windows BYOW surface presentation smoke
  test

## Common Commands

- Run the native BYOW demo: `deno task example:byow:run`
- Type-check the native BYOW demo: `deno task example:byow:check`
- Run the BYOW triangle smoke test: `deno task example:byow:triangle:run`
- Type-check the BYOW triangle smoke test: `deno task example:byow:triangle:check`
- Run the BYOW primitives demo: `deno task example:byow:primitives:run`
- Type-check the BYOW primitives demo: `deno task example:byow:primitives:check`
- Run the default BYOW mesh pathtraced demo: `deno task example:byow:pathtraced:run`
- Type-check the default BYOW mesh pathtraced demo: `deno task example:byow:pathtraced:check`
- Run the BYOW Helmet pathtraced demo: `deno task example:byow:helmet-pathtraced:run`
- Type-check the BYOW Helmet pathtraced demo: `deno task example:byow:helmet-pathtraced:check`
- Run the BYOW Helmet forward demo: `deno task example:byow:helmet-forward:run`
- Type-check the BYOW Helmet forward demo: `deno task example:byow:helmet-forward:check`
- Run the BYOW Cornell pathtraced demo: `deno task example:byow:cornell:run`
- Type-check the BYOW Cornell pathtraced demo: `deno task example:byow:cornell:check`
- Run the BYOW Cornell Helmet pathtraced demo: `deno task example:byow:cornell-helmet:run`
- Type-check the BYOW Cornell Helmet pathtraced demo: `deno task example:byow:cornell-helmet:check`
- Run the BYOW React Bunny demo: `deno task example:byow:react-bunny:run`
- Type-check the BYOW React Bunny demo: `deno task example:byow:react-bunny:check`
- Run the BYOW React glyphs demo: `deno task example:byow:react-glyphs:run`
- Type-check the BYOW React glyphs demo: `deno task example:byow:react-glyphs:check`
- Run the BYOW layout demo: `deno task example:byow:layout:run`
- Type-check the BYOW layout demo: `deno task example:byow:layout:check`
- Run the BYOW React 2D surface demo:
  `deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/react_surface_2d_in_3d_demo/main.ts`
- Type-check the BYOW React 2D surface demo:
  `deno check --unstable-raw-imports examples/byow/react_surface_2d_in_3d_demo/main.ts examples/byow/react_surface_2d_in_3d_demo/app.tsx`
- Run the BYOW React 3D scene-in-scene demo:
  `deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/react_scene3d_in_3d_demo/main.ts`
- Type-check the BYOW React 3D scene-in-scene demo:
  `deno check --unstable-raw-imports examples/byow/react_scene3d_in_3d_demo/main.ts examples/byow/react_scene3d_in_3d_demo/app.tsx`
- Run the BYOW multiwindow demo:
  `deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/multiwindow_demo/main.ts`
- Type-check the BYOW multiwindow demo:
  `deno check --unstable-raw-imports examples/byow/multiwindow_demo/main.ts`
- Build the desktop host library: `deno task desktop:host:build`
- Refresh the in-repo example assets: `deno task asset:examples`
- Refresh the Stanford Bunny source and extracted mesh: `deno task asset:stanford-bunny`
- Refresh the Damaged Helmet sample: `deno task asset:damaged-helmet`
- Download the external Sponza sample: `deno task asset:sponza`
- Render a headless PNG snapshot: `deno task example:headless:png`

## Primitive Authoring

`@disjukr/goldlight/geometry` exposes polygon mesh generators that return `MeshPrimitive` data.
These are mesh helpers, not SDF primitives.

```ts
import { appendMesh, createSceneIr } from '@disjukr/goldlight/ir';
import { createBoxMesh } from '@disjukr/goldlight/geometry';

const scene = appendMesh(
  createSceneIr('primitive-scene'),
  createBoxMesh({ id: 'box', width: 1, height: 1, depth: 1 }),
);
```

The BYOW primitives demo and the BYOW React Bunny demo both show the current camera path: they
attach a perspective camera to a node, mark it as the scene's active camera, and render through the
standard forward renderer. The React Bunny demo now drives that scene path through the experimental
reconciler host instead of the snapshot-only JSX lowering helper.

For React integrations, read the examples in this order:

- [`byow/react_bunny_demo/README.md`](./byow/react_bunny_demo/README.md) for the experimental
  `@disjukr/goldlight/react/reconciler` live host
- [`byow/react_glyphs_demo/README.md`](./byow/react_glyphs_demo/README.md) for root-`g2d-scene`
  presentation and `g2d-glyphs` authoring
- [`byow/layout_demo/README.md`](./byow/layout_demo/README.md) for the first headless
  Taffy/Pretext-inspired layout tree rendered directly through drawing
- [`byow/react_surface_2d_in_3d_demo/README.md`](./byow/react_surface_2d_in_3d_demo/README.md) for
  the current `g2d-scene` vector-drawing-in-`g3d-scene` path, scene output caching, and
  app-controlled frame driving
- [`byow/react_scene3d_in_3d_demo/README.md`](./byow/react_scene3d_in_3d_demo/README.md) for the
  current `g3d-scene`-in-`g3d-scene` offscreen-to-texture path with a different child camera

## Related Docs

- [`../docs/README.md`](../docs/README.md): main documentation hub
- [`../docs/specs/rendering.md`](../docs/specs/rendering.md): rendering contracts and current gaps
