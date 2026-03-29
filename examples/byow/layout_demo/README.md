# BYOW Layout Demo

This demo shows the first `@disjukr/goldlight/layout` box-tree and paragraph APIs driving a live
BYOW window through the new `g2l-*` React substrate layered over `g2d-*`.

It exercises:

- `g2l-root`, `g2l-box`, and `g2l-text`
- reconciler-owned layout collection and committed `render(ctx)` callbacks
- `row` / `column`, `padding`, `gap`, and flex sizing
- `g2d-*` rendering produced from `g2l` render callbacks
- atlas text rendering in the demo app, with a single constant switch for `sdf` or `a8`
- animated width constraints so text reflow is visible frame-to-frame

Run with:

```sh
deno task desktop:host:build
deno task text:host:build
deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/layout_demo/main.ts
```

Type-check with:

```sh
deno check --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/layout_demo/main.ts examples/byow/layout_demo/app.tsx
```

Compile to a single executable with:

```sh
deno task compile examples/byow/layout_demo
```

Expected output:

- a dark BYOW window with nested cards and text
- one animated paragraph panel whose width changes over time
- visible line reflow for both Latin and Hangul text

The demo currently defaults to `A8 atlas` text in
[app.tsx](/C:/Users/user/github/disjukr/goldlight/examples/byow/layout_demo/app.tsx). To compare
with `SDF` rendering, change `layoutDemoTextMode` from `'a8'` to `'sdf'`.
