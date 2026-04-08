# BYOW Multiwindow Demo

Electrobun multiwindow smoke test that opens more than one goldlight desktop window in a single process.

Run with:

```sh
bun run example:byow:multiwindow:run
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
