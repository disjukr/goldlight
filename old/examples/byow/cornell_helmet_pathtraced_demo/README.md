# BYOW Cornell Helmet Pathtraced Demo

Pathtraced desktop demo combining the Damaged Helmet asset with Cornell-style scene framing.

Run with:

```sh
bun run example:byow:cornell-helmet:run
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
