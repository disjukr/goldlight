# BYOW Layout 3D Demo

This demo applies the current `@disjukr/goldlight/layout` prototype to a 3D scene.

It exercises:

- Taffy-style box layout driving multiple panel sizes
- nested `g2d-scene` text surfaces rendered into textures
- textured front faces mapped onto rounded 3D cards
- a slightly angled camera and lit panel bodies so the composition reads clearly as 3D

Run with:

```sh
deno task desktop:host:build
deno task text:host:build
deno task example:byow:layout-3d:run
```

Type-check with:

```sh
deno task example:byow:layout-3d:check
```

Compile to a single executable with:

```sh
deno task compile examples/byow/layout_3d_demo
```

Build a release executable with:

```sh
deno task compile examples/byow/layout_3d_demo --release
```
