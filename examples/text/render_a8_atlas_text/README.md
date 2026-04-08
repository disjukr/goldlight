# Render A8 Atlas Text

This example shapes text through `@disjukr/goldlight/text`, rasterizes glyphs into A8 masks, packs them into an atlas page, and writes `out.png`.

Run from the repository root:

```sh
bun run build:text:native
bun examples/text/render_a8_atlas_text/main.ts
```

Optional verification:

```sh
bun run typecheck
```
