# BYOW React Glyphs Demo

React-authored 2D glyph rendering demo showing atlas, transformed-mask, SDF, and path fallback modes.

Run with:

```sh
bun run example:byow:react-glyphs:run
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
