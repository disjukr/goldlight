# Render Text On Path

This example shapes text through `@disjukr/goldlight/text`, places glyphs along two guide curves,
and writes `out.png`.

The current implementation uses the path fallback text route only, so each glyph is rendered from
its outline path after the placement transform is computed.

## Run

From the repository root:

```sh
deno task text:host:check
deno task text:host:build
deno check --unstable-ffi --unstable-webgpu examples/text/render_text_on_path/main.ts
deno run -A --unstable-ffi --unstable-webgpu examples/text/render_text_on_path/main.ts
```
