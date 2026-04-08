# BYOW Triangle Demo

Minimal Electrobun triangle smoke test for window creation, WebGPU context setup, and presentation.

Run with:

```sh
bun run example:byow:triangle:run
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
