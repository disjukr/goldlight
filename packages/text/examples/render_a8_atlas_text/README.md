# Render A8 Atlas Text

This example shapes text through `@goldlight/text`, rasterizes glyphs to A8 masks, packs them into
an atlas page, and writes `out.png`.

The output shows:

- final text composited from the A8 atlas
- the atlas page itself
- packed glyph bounds in the atlas preview

## Run

From the repository root:

```sh
deno task text:host:check
deno task text:host:build
deno check --unstable-ffi packages/text/examples/render_a8_atlas_text/main.ts
deno run -A --unstable-ffi packages/text/examples/render_a8_atlas_text/main.ts
```
