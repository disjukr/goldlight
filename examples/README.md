# Examples

Runnable examples live here. Each example should document how to build, serve, or execute it.

## Available Examples

- [`byow_native_demo/README.md`](./byow_native_demo/README.md): Windows-native BYOW surface demo
  using runtime mesh, texture residency, and built-in textured unlit rendering
- [`byow_primitives_demo/README.md`](./byow_primitives_demo/README.md): Windows-native BYOW demo
  rendering the built-in procedural mesh primitive set through a camera-backed, depth-tested forward
  path
- [`browser_forward/README.md`](./browser_forward/README.md): browser-based forward rendering flow
- [`browser_react_authoring/README.md`](./browser_react_authoring/README.md): browser forward flow
  with scene nodes authored through `@rieul3d/react` TSX
- [`browser_textured_forward/README.md`](./browser_textured_forward/README.md): browser forward flow
  with uploaded texture residency and built-in unlit sampling
- [`browser_custom_textured_forward/README.md`](./browser_custom_textured_forward/README.md):
  browser forward flow with a custom WGSL program that declares texture and sampler bindings
- [`headless_snapshot/README.md`](./headless_snapshot/README.md): offscreen render-to-PNG workflow
- [`byow_triangle/README.md`](./byow_triangle/README.md): Windows BYOW surface presentation smoke
  test

## Common Commands

- Run the native BYOW demo: `deno task example:byow:run`
- Type-check the native BYOW demo: `deno task example:byow:check`
- Run the BYOW triangle smoke test: `deno task example:byow:triangle:run`
- Type-check the BYOW triangle smoke test: `deno task example:byow:triangle:check`
- Run the BYOW primitives demo: `deno task example:byow:primitives:run`
- Type-check the BYOW primitives demo: `deno task example:byow:primitives:check`
- Build the browser bundle: `deno task example:browser:build`
- Build the React authoring browser bundle: `deno task example:browser:react:build`
- Build the textured browser bundle: `deno task example:browser:textured:build`
- Build the custom textured browser bundle: `deno task example:browser:custom-textured:build`
- Render a headless PNG snapshot: `deno task example:headless:png`
- Serve the repository for local testing: `deno task example:browser:serve`

## Primitive Authoring

`@rieul3d/primitives` exposes polygon mesh generators that return `MeshPrimitive` data. These are
mesh helpers, not SDF primitives.

```ts
import { appendMesh, createSceneIr } from '@rieul3d/ir';
import { createBoxMesh } from '@rieul3d/primitives';

const scene = appendMesh(
  createSceneIr('primitive-scene'),
  createBoxMesh({ id: 'box', width: 1, height: 1, depth: 1 }),
);
```

The BYOW primitives demo also shows the current camera path: it attaches a perspective camera to a
node, marks it as the scene's active camera, and renders the primitive grid through the standard
forward renderer.

## Related Docs

- [`../docs/README.md`](../docs/README.md): main documentation hub
- [`../docs/specs/rendering.md`](../docs/specs/rendering.md): rendering contracts and current gaps
