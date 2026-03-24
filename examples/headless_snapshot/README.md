# Headless Snapshot PNG

Render a small offscreen frame and write the PNG result to disk.

Run with:

```sh
deno task example:headless:png
```

Optional arguments:

```sh
deno task example:headless:png ./tmp/custom.png 256 256
```

- Argument 1: output path
- Argument 2: width
- Argument 3: height

Default output path: `examples/headless_snapshot/out/forward.png`

Requirements:

- Deno with `--unstable-webgpu`
- A runtime where `navigator.gpu` can request a WebGPU adapter/device

The script builds a small indexed + non-indexed unlit scene, renders it through the existing forward
renderer, reads back the offscreen texture, and exports the RGBA bytes with `@goldlight/exporters`
`exportPngRgba`.
