# GM Fillrect Gradient

This example ports Skia
[`gm/fillrect_gradient.cpp`](/C:/Users/user/github/google/skia/gm/fillrect_gradient.cpp) into
`examples/drawing/gm/fillrect_gradient`.

It renders the same 2-column grid of linear and radial rectangle gradients and writes:

- `out.png`: current `@disjukr/goldlight/drawing` output
- `ckout.png`: CanvasKit reference output

What it shows:

- simple two-stop gradients
- middle and narrow stop bands
- single-stop degenerate gradients
- repeated-stop/disjoint gradient transitions
- unsorted stop behavior

## Run

From the repository root:

```sh
deno task example:drawing -- gm/fillrect-gradient check
deno task example:drawing -- gm/fillrect-gradient png
deno task example:drawing -- gm/fillrect-gradient ckpng
```
