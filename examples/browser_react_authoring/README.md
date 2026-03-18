# Browser React Authoring Example

This example shows the current bridge between `@rieul3d/react` and the existing runtime layers. It
authors a scene with TSX, including the current built-in `perspectiveCamera` alias plus node
transform shorthands such as `position`, commits that tree through `createSceneRoot()`, then
renders the published `SceneIr` snapshot through the browser forward pipeline. Because the bridge
publishes whole-scene snapshots, the example also uses `summarizeSceneRootCommit()` together with
`commitSummaryNeedsResidencyReset()` so cached GPU residency still resets for resource or node
topology changes before the next frame upload.

The long-term direction is to move camera/light convenience toward reusable React components while
keeping primitive JSX authoring closer to explicit Scene IR concepts such as `<camera>`, `<light>`,
and `<node>`.

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
