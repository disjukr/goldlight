# Headless Snapshot PNG

Render a small offscreen forward frame and write the PNG result to disk.

Run from the repository root:

```sh
bun examples/headless_snapshot/main.ts
```

Optional arguments:

```sh
bun examples/headless_snapshot/main.ts ./tmp/custom.png 256 256
```

- Argument 1: output path
- Argument 2: width
- Argument 3: height

Default output path: `examples/headless_snapshot/out/forward.png`

Requirements:

- Bun installed through `bun install`
- a runtime where `navigator.gpu` can request a WebGPU adapter/device
