# Examples

Runnable examples live here. Each example should document how to build, serve, or execute it.

## Available Examples

- [`byow_native_demo/README.md`](./byow_native_demo/README.md): Windows-native BYOW surface demo
  using runtime mesh, texture residency, and built-in textured unlit rendering
- [`browser_forward/README.md`](./browser_forward/README.md): browser-based forward rendering flow
- [`headless_snapshot/README.md`](./headless_snapshot/README.md): offscreen render-to-PNG workflow
- [`byow_triangle/README.md`](./byow_triangle/README.md): Windows BYOW surface presentation smoke
  test

## Common Commands

- Run the native BYOW demo: `deno task example:byow:run`
- Type-check the native BYOW demo: `deno task example:byow:check`
- Build the browser bundle: `deno task example:browser:build`
- Render a headless PNG snapshot: `deno task example:headless:png`
- Serve the repository for local testing: `deno task example:browser:serve`

## Related Docs

- [`../docs/README.md`](../docs/README.md): main documentation hub
- [`../docs/specs/rendering.md`](../docs/specs/rendering.md): rendering contracts and current gaps
