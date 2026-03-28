# BYOW Layout Demo

This demo shows the first `@disjukr/goldlight/layout` box-tree and paragraph APIs driving a live
BYOW window through `@disjukr/goldlight/drawing`.

It exercises:

- `prepareParagraph()` and `layoutParagraph()` from `@disjukr/goldlight/layout`
- `box` and `text` nodes with `row` / `column`, `padding`, and `gap`
- drawing-backed visual inspection of nested layout boxes
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
deno check --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/layout_demo/main.ts examples/byow/layout_demo/app.ts
```

Compile to a single executable with:

```sh
deno task compile examples/byow/layout_demo
```

Expected output:

- a dark BYOW window with nested cards and text
- one animated paragraph panel whose width changes over time
- visible line reflow for both Latin and Hangul text

The demo currently defaults to `SDF` text in
[app.ts](/C:/Users/user/github/disjukr/goldlight/examples/byow/layout_demo/app.ts). To compare with
`A8 atlas` rendering, change `layoutDemoTextMode` from `'sdf'` to `'a8'`.
