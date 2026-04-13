# goldlight examples

Examples for the new goldlight runtime live here.

## Categories

- [`window`](./window): window lifecycle and app shell examples
- [`input`](./input): keyboard and future input handling examples
- [`2d`](./2d): 2D scene, layout, path drawing, and text rendering examples
- [`3d`](./3d): 3D scene and camera examples

## Run the basic window example

From [`examples/window/basic_window`](./window/basic_window):

```sh
bun run goldlight dev
```

Each example directory is a goldlight project root with its own `goldlight.json`.
`goldlight dev` reads that file, starts the local Vite dev server, and runs the
local Rust dev runtime.

## Rendering examples

- [`examples/input/keyboard_input`](./input/keyboard_input): keyboard event inspector with highlighted keycaps
- [`examples/2d/basic_rect`](./2d/basic_rect): animated 2D rectangles
- [`examples/2d/fills`](./2d/fills): multiple filled path compositions
- [`examples/2d/tiger`](./2d/tiger): `usvg`-parsed SVG tiger rendering
- [`examples/2d/strokes`](./2d/strokes): stroke join and cap samples
- [`examples/2d/text_modes`](./2d/text_modes): direct mask, SDF, and path fallback text
- [`examples/2d/text_auto_transform`](./2d/text_auto_transform): animated auto text under translate, rotate, and scale changes
- [`examples/2d/text_on_path`](./2d/text_on_path): path-aligned glyph path fallback text
- [`examples/3d/basic_triangle`](./3d/basic_triangle): animated 3D triangle

## Build a production bundle

From [`examples/window/basic_window`](./window/basic_window):

```sh
bun run goldlight build
```
