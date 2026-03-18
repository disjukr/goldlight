# Browser React Authoring Example

This example shows the current bridge between `@rieul3d/react` and the existing runtime layers. It
authors a scene with TSX, including React-style aliases such as `perspectiveCamera` and `group`,
plus node transform shorthands such as `position`, lowers that tree into `SceneIr`, then renders the
result through the browser forward pipeline.

This is now a real JSX authoring example, but it is still not a live React renderer or reconciler.
`@rieul3d/react` currently owns authoring and lowering only.

Longer term, this package should move toward a `react-three-fiber`-style interface where
reconciliation updates rieul3d's runtime over time instead of lowering the tree only once.

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
- [`../../docs/adr/0004-react-jsx-authoring.md`](../../docs/adr/0004-react-jsx-authoring.md)
- [`../../docs/specs/rendering.md`](../../docs/specs/rendering.md)
