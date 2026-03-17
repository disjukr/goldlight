# Browser Forward Example

This is the main runnable example for the current renderer scaffold.

It renders a triangle through the built-in forward Lambert path with a Scene IR directional light.

Build the example bundle:

```sh
deno task example:browser:build
```

Serve the repository root as static files:

```sh
deno task example:browser:serve
```

Then open:

```text
http://localhost:8000/examples/browser_forward/index.html
```

Related references:

- [`../../examples/README.md`](../README.md)
- [`../../docs/specs/rendering.md`](../../docs/specs/rendering.md)
- [`../../docs/specs/runtime-residency.md`](../../docs/specs/runtime-residency.md)
