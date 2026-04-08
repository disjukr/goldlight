# BYOW Layout Demo

Electrobun layout demo using g2l nodes, paragraph layout, and drawing-backed text rendering.

Run with:

```sh
bun run example:byow:layout:run
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
