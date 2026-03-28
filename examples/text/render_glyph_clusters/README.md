# Render Glyph Clusters

This example shapes a few text samples through `@disjukr/goldlight/text`, builds glyph clusters, and
writes `out.png`.

It overlays:

- glyph cluster bounds
- baseline / ascent / descent guides
- glyph outline paths

The current samples cover:

- Latin ligature-heavy text
- combining-mark text
- Hangul syllables

## Run

From the repository root:

```sh
deno task text:host:check
deno task text:host:build
deno check --unstable-ffi --unstable-webgpu examples/text/render_glyph_clusters/main.ts
deno run -A --unstable-ffi --unstable-webgpu examples/text/render_glyph_clusters/main.ts
```
