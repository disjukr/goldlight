# Render Tiger PNG

This example writes `tiger.png` next to `tiger.svg` without using `resvg`.

It implements a small SVG ingest layer inside the example and renders the result through
`@rieul3d/drawing`.

The example currently supports the subset used by `tiger.svg`:

- tags: `svg`, `g`, `path`
- attributes: `viewBox`, `fill`, `stroke`, `stroke-width`, `transform`
- transforms: `matrix(...)`, `translate(...)`, `scale(...)`
- path commands: `M/m`, `L/l`, `C/c`, `S/s`, `V/v`, `Z/z`

The tiger asset does not need gradients, text, masks, clip paths, or patterns, so those are not
implemented here.

## Run

From the repository root:

```sh
deno task example:drawing:tiger:check
deno task example:drawing:tiger:png
```
