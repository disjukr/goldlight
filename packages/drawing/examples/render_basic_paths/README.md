# Render Basic Paths

This example exercises the current `@goldlight/drawing` implementation against an offscreen WebGPU
target and writes `out.png`.

What it uses:

- `clear`
- simple filled polygon paths
- Dawn command buffer encoding
- queue submission and readback
- PNG export through `@goldlight/exporters`

## Run

From the repository root:

```sh
deno task example:drawing:basic-paths:check
deno task example:drawing:basic-paths:png
```
