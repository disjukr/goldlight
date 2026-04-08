# BYOW React 3D In 3D Demo

Nested 3D scene composition demo running directly on the Electrobun desktop runtime.

Run with:

```sh
bun run example:byow:react-scene3d-in-3d:run
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
