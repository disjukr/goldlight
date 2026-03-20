# Browser React Authoring Example

This example shows the current bridge between `@rieul3d/react` and the existing runtime layers. It
authors a scene with TSX, including the exported `PerspectiveCamera` convenience component plus node
transform shorthands such as `position`, commits that tree through `createSceneRoot()`, then renders
the published `SceneIr` snapshot through the browser forward pipeline. Because the bridge publishes
whole-scene snapshots, the example also uses `planSceneRootResidencyInvalidation()` together with
`@rieul3d/gpu`'s `applyRuntimeResidencyPlan()` helper so cached GPU residency can drop changed
mesh/material/texture entries by ID, keep transform-only node updates on the lighter path, and still
fall back to a full reset for node topology or binding changes.

The example follows ADR 0005's preferred direction: camera/light convenience lives in reusable React
components while primitive JSX authoring stays closer to explicit Scene IR concepts such as
`<camera>`, `<light>`, and `<node>`. It intentionally documents the snapshot path, not the live
reconciler path.

`@rieul3d/react` now has two distinct integration surfaces:

- `createSceneRoot()` for JSX authoring plus snapshot commits, summaries, and targeted update
  planning
- `@rieul3d/react/reconciler` for the experimental live React host that publishes committed
  `SceneIr` snapshots from normal React state and lifecycle updates

If you want the live reconciler path instead of the snapshot bridge, use the BYOW React Bunny demo
as the current reference example.

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
- [`../byow_react_bunny_demo/README.md`](../byow_react_bunny_demo/README.md)
- [`../../docs/specs/react-authoring.md`](../../docs/specs/react-authoring.md)
- [`../../docs/adr/0004-react-jsx-authoring.md`](../../docs/adr/0004-react-jsx-authoring.md)
- [`../../docs/specs/rendering.md`](../../docs/specs/rendering.md)
