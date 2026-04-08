# goldlight examples

Examples for the new goldlight runtime live here.

## Categories

- [`window`](./window): window lifecycle and app shell examples
- [`2d`](./2d): 2D rendering and drawing examples
- [`3d`](./3d): 3D scene and camera examples
- [`text`](./text): text layout and rendering examples

## Run the basic window example

From [`examples/window/basic_window`](./window/basic_window):

```sh
bun run ../../../sdk/src/cli.ts dev
```

This goes through the local workspace `sdk` entrypoint, starts the local Vite
dev server, and runs against the local Rust dev runtime.

## Build a production bundle

From [`examples/window/basic_window`](./window/basic_window):

```sh
bun run ../../../sdk/src/cli.ts build
```
