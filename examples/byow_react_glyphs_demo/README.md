# BYOW React Glyphs Demo

This demo shows `@goldlight/react/reconciler` `g2d-glyphs` authoring with a root `<g2d-scene>`.

It exercises:

- direct-present root `g2d-scene` output
- `g2d-glyphs` in `a8`, `sdf`, and `path` modes
- `g2d-group` transforms applied to glyph rendering and normal vector primitives together
- shared `TextHost` usage through `<g2d-scene textHost={...}>`

Run with:

```sh
deno task desktop:host:build
deno task text:host:build
deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow_react_glyphs_demo/main.tsx
```

Type-check with:

```sh
deno check --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow_react_glyphs_demo/main.tsx examples/byow_react_glyphs_demo/app.tsx
```

Expected output:

- a dark 2D canvas window with three glyph rendering cards
- A8 atlas, SDF, and path fallback text shown side by side
- a lower section where `g2d-group` rotates glyphs and surrounding vector primitives together
