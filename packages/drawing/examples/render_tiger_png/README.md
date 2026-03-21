# Render Tiger PNG

This example writes `tiger.png` next to `tiger.svg` without using `resvg`.

Right now it is a progress scaffold for `@rieul3d/drawing`, not a real tiger renderer.

The script:

- reads `tiger.svg`
- reports how much SVG structure is present
- uses `@rieul3d/drawing` path construction for the placeholder frame
- writes a PNG through `@rieul3d/exporters`

It deliberately does not call any external SVG rasterizer. Real tiger output is blocked until
`drawing` has SVG path ingestion plus fill/stroke rendering.

## Run

From the repository root:

```sh
deno task example:drawing:tiger:check
deno task example:drawing:tiger:png
```
