# BYOW Primitives Demo

Electrobun desktop demo for generated primitive meshes, lit materials, and directional lighting.

Run with:

```sh
bun run example:byow:primitives:run
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
