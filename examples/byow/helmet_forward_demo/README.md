# BYOW Helmet Forward Demo

Forward-rendered Damaged Helmet demo on the Electrobun desktop shell.

Run with:

```sh
bun run example:byow:helmet-forward:run
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
