# `render_drawing_text_modes`

This example renders text through `@goldlight/text` and `@goldlight/drawing` together and writes
`out.png`.

The snapshot is meant to verify three GPU text paths side by side:

- `A8 atlas` via direct mask text
- `SDF` text
- `Path fallback`

It also includes a second row with the same Hangul sample drawn through all three paths so glyph
placement differences are easier to spot.

## Run

Build the native text host first:

```sh
deno task text:host:build
```

Then run the example:

```sh
deno check --unstable-ffi packages/text/examples/render_drawing_text_modes/main.ts
deno run -A --unstable-ffi --unstable-webgpu packages/text/examples/render_drawing_text_modes/main.ts
```

The output PNG is written next to this README as `out.png`.
