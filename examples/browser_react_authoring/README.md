# Browser React Authoring Example

This example shows the current bridge between `@rieul3d/react` and the existing runtime layers. It
uses the package's declarative authoring helpers to build a scene tree, lowers that tree into Scene
IR node data, then renders the result through the browser forward pipeline.

This is not a React runtime or JSX example. The current `@rieul3d/react` package exposes an
authoring API that mirrors the intended React-facing shape, but it does not provide a React renderer
or reconciler yet.

Longer term, this package should move toward a `react-three-fiber`-style interface where scene
content is authored as normal React elements and reconciled into rieul3d's runtime, instead of being
assembled through helper functions first.

Build the example bundle:

```sh
deno task example:browser:react:build
```

Serve the repository root as static files:

```sh
deno task example:browser:serve
```

Then open:

```text
http://localhost:8000/examples/browser_react_authoring/index.html
```

Related references:

- [`../../examples/README.md`](../README.md)
- [`../../docs/specs/react-authoring.md`](../../docs/specs/react-authoring.md)
- [`../../docs/specs/rendering.md`](../../docs/specs/rendering.md)
