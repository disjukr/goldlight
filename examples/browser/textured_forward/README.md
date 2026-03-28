# Browser Textured Forward Example

This browser example uploads a small in-memory RGBA texture and renders it through the built-in
unlit material path.

Build the example bundle:

```sh
deno task example:browser:textured:build
```

Serve the repository root as static files:

```sh
deno task example:browser:serve
```

Then open:

```text
http://localhost:8000/examples/browser/textured_forward/index.html
```

Related references:

- [`../../examples/README.md`](../README.md)
- [`../../docs/specs/rendering.md`](../../docs/specs/rendering.md)
- [`../../docs/specs/runtime-residency.md`](../../docs/specs/runtime-residency.md)
