# BYOW Layout 3D Demo

Layout and nested scene composition demo that places g2l and g2d content inside a 3D scene.

Run with:

```sh
bun run example:byow:layout-3d:run
```

Build the text host first when the demo renders glyphs or layout text:

```sh
bun run build:text:native
```

Verify the migrated runtime surface with:

```sh
bun run typecheck
```

Requirements:

- Bun dependencies installed through `bun install`
- a successful native text build for text-heavy demos
- a WebGPU-capable desktop environment
