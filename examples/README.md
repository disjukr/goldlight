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
bun run goldlight dev
```

Each example directory is a goldlight project root with its own `goldlight.json`.
`goldlight dev` reads that file, starts the local Vite dev server, and runs the
local Rust dev runtime.

## Build a production bundle

From [`examples/window/basic_window`](./window/basic_window):

```sh
bun run goldlight build
```
