# Render Gradients

This example renders Skia-style linear, radial, two-point conical, and sweep gradient fills to an
offscreen WebGPU target and writes `out.png`. A matching CanvasKit reference can also be rendered to
`ckout.png`.

What it shows:

- linear gradient fill across an irregular blob and a rect
- two-point conical and radial gradient fills
- sweep gradient fill on star/blob shapes

## Run

From the repository root:

```sh
deno task example:drawing:gradients:check
deno task example:drawing:gradients:png
deno task example:drawing:gradients:ckpng
```

Use `out.png` and `ckout.png` side by side to compare the current Graphite/Dawn gradient output
against CanvasKit.
