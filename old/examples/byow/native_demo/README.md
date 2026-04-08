# BYOW Native Demo

Electrobun desktop demo that renders a textured quad and accent geometry through the goldlight forward path.

Run with:

```sh
bun run example:byow:run
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
