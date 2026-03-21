# Render Strokes

This example renders only stroked paths to an offscreen WebGPU target and writes `out.png`.

What it shows:

- miter, bevel, and round joins
- butt, square, and round caps
- a stroked cubic path

## Run

From the repository root:

```sh
deno task example:drawing:strokes:check
deno task example:drawing:strokes:png
```
