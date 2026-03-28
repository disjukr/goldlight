# BYOW React Glyphs Demo

This demo shows `@disjukr/goldlight/react/reconciler` `g2d-glyphs` authoring with a root
`<g2d-scene>`.

It exercises:

- root `g2d-scene` output
- `g2d-glyphs` in `a8`, `transformed-mask`, `sdf`, and `path` modes
- `g2d-group` transforms applied to glyph rendering and normal vector primitives together
- shared `TextHost` usage through `<g2d-scene textHost={...}>`

Run with:

```sh
deno task desktop:host:build
deno task text:host:build
deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/react_glyphs_demo/main.tsx
```

Type-check with:

```sh
deno check --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/react_glyphs_demo/main.tsx examples/byow/react_glyphs_demo/app.tsx
```

Compile to a single executable with:

```sh
deno task compile examples/byow/react_glyphs_demo
```

This writes a debug build next to the entrypoint as
`examples/byow/react_glyphs_demo/byow_react_glyphs_demo.exe` by default. The local demo resources
listed in [`goldlight.json`](./goldlight.json) are included, and common runtime dependencies are
picked up automatically:

- desktop worker modules
- desktop/text native host DLLs

Build a release executable with:

```sh
deno task compile examples/byow/react_glyphs_demo --release
```

On Windows, release builds default to `--no-terminal`, so the executable opens without a console
window.

Override the output path with:

```sh
deno task compile examples/byow/react_glyphs_demo --output tmp/byow_react_glyphs_custom.exe
```

Expected output:

- a dark 2D canvas window with four glyph rendering cards
- A8 atlas, transformed-mask, SDF, and path fallback text shown side by side
- a lower section where `g2d-group` rotates each text mode with surrounding vector primitives
