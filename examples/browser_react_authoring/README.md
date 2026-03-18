# Browser React Authoring Example

This example shows the current bridge between `@rieul3d/react` and the existing runtime layers. It
authors a scene with TSX, including the exported `PerspectiveCamera` convenience component plus node
transform shorthands such as `position`, commits that tree through `createSceneRoot()`, then renders
the published `SceneIr` snapshot through the browser forward pipeline. Because the bridge publishes
whole-scene snapshots, the example also uses `summarizeSceneRootCommit()` together with
`@rieul3d/gpu` targeted invalidation helpers so cached GPU residency can drop changed
mesh/material/texture/volume entries by ID before falling back to a full reset for node topology
changes.

The example now follows ADR 0005's preferred direction: camera/light convenience lives in reusable
React components while primitive JSX authoring stays closer to explicit Scene IR concepts such as
`<camera>`, `<light>`, and `<node>`.

This is now a real JSX authoring example with the current snapshot-based `createSceneRoot()` path,
but it is still not a live React renderer or reconciler. `@rieul3d/react` currently owns authoring,
snapshot commits, and subscription only.

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
