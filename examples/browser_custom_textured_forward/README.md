# Browser Custom Textured Forward Example

This browser example registers a custom WGSL program that samples a `baseColor` texture through the
general material binding path.

Build the example bundle:

```sh
deno task example:browser:custom-textured:build
```

Serve the repository root as static files:

```sh
deno task example:browser:serve
```

Then open:

```text
http://localhost:8000/examples/browser_custom_textured_forward/index.html
```

Related references:

- [`../../examples/README.md`](../README.md)
- [`../../docs/specs/rendering.md`](../../docs/specs/rendering.md)
- [`../../docs/specs/runtime-residency.md`](../../docs/specs/runtime-residency.md)
