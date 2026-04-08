# BYOW React 2D In 3D Demo

Nested 2D-in-3D composition demo with a React-authored `g2d-scene` rendered into a 3D panel texture.

Run with:

```sh
bun run example:byow:react-surface-2d-in-3d:run
```

Build the native text host first when the demo renders glyphs or layout text:

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
