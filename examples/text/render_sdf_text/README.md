# Render SDF Text

This example shapes text through `@disjukr/goldlight/text`, converts A8 glyph masks into
single-channel SDF masks, packs them into an atlas page, and writes `out.png`.

The output shows:

- large text rendered back from the SDF atlas
- the packed SDF atlas itself
- atlas entry bounds

## Run

From the repository root:

```sh
deno task text:host:check
deno task text:host:build
deno check --unstable-ffi examples/text/render_sdf_text/main.ts
deno run -A --unstable-ffi examples/text/render_sdf_text/main.ts
```
