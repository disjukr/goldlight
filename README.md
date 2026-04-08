# goldlight

`goldlight` is a functional WebGPU spatial runtime built around Bun, Electrobun, and browser-capable engine modules.

## Runtime Direction

- desktop applications run through `@disjukr/goldlight/desktop` on top of Electrobun
- text shaping and glyph rasterization run through the bundled Rust `napi-rs` host at `engine/text/native`
- browser-oriented engine modules remain usable where they do not depend on the desktop shell
- the old Deno desktop FFI path is removed

## Package Areas

- `@disjukr/goldlight/ir`: scene IR definitions
- `@disjukr/goldlight/math`: deterministic math helpers
- `@disjukr/goldlight/geometry`: shapes, mesh generation, and SDF helpers
- `@disjukr/goldlight/gpu`: WebGPU context and residency helpers
- `@disjukr/goldlight/renderer`: scene evaluation and frame rendering
- `@disjukr/goldlight/importers`: OBJ/STL/PLY/glTF ingestion
- `@disjukr/goldlight/react`: declarative authoring and reconciler integration
- `@disjukr/goldlight/text`: text host abstraction backed by the Rust native module
- `@disjukr/goldlight/desktop`: Electrobun desktop shell

## Getting Started

```sh
bun install
bun run build:text:native
bun run typecheck
```

Run desktop examples with Electrobun:

```sh
bun run example:byow:run
bun run example:byow:triangle:run
bun run example:byow:primitives:run
bun run example:byow:cornell:run
bun run example:byow:cornell-helmet:run
bun run example:byow:helmet-forward:run
bun run example:byow:helmet-pathtraced:run
bun run example:byow:react-bunny:run
bun run example:byow:react-glyphs:run
bun run example:byow:layout:run
bun run example:byow:layout-3d:run
bun run example:byow:multiwindow:run
```

## Notes

- the desktop shell expects Bun/Electrobun rather than Deno runtime flags
- the text host must be built at least once before text-heavy examples run
- the current verification command is `bun run typecheck`

## Documentation

- [docs/README.md](./docs/README.md)
- [docs/specs/desktop-shell.md](./docs/specs/desktop-shell.md)
- [docs/specs/rendering.md](./docs/specs/rendering.md)
- [examples/README.md](./examples/README.md)
