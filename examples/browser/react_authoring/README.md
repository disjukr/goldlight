# Browser React Authoring Example

This example documents the snapshot bridge side of `@disjukr/goldlight/react`.

It authors a scene with TSX, commits that tree through `createG3dSceneRoot()`, then renders the
published `SceneIr` snapshot through the browser forward pipeline. This path is useful when an
integration wants explicit control over when scene snapshots are committed and how targeted GPU
residency invalidation is applied.

Because the bridge publishes whole-scene snapshots, the example also uses
`planG3dSceneRootResidencyInvalidation()` together with `@disjukr/goldlight/gpu`'s
`applyRuntimeResidencyPlan()` helper so cached GPU residency can drop changed mesh/material/texture
entries by ID, keep transform-only node updates on the lighter path, and still fall back to a full
reset for node topology or binding changes.

The example follows ADR 0005's preferred direction: camera/light convenience lives in reusable React
components while primitive JSX authoring stays closer to explicit Scene IR concepts such as
`<g3d-camera>`, `<g3d-light>`, and `<g3d-node>`. It intentionally documents the snapshot path, not
the live reconciler path.

`@disjukr/goldlight/react` currently has two distinct integration surfaces:

- `createG3dSceneRoot()` for JSX authoring plus snapshot commits, summaries, and targeted update
  planning
- `@disjukr/goldlight/react/reconciler` for the experimental live React host that publishes
  committed `SceneIr` snapshots from normal React state and lifecycle updates

If you want the live reconciler path instead of the snapshot bridge, use the BYOW React Bunny demo
and the nested-scene desktop demos as the current reference examples.

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
http://localhost:8000/examples/browser/react_authoring/index.html
```

Related references:

- [`../../examples/README.md`](../README.md)
- [`../byow/react_bunny_demo/README.md`](../byow/react_bunny_demo/README.md)
- [`../../docs/specs/react-authoring.md`](../../docs/specs/react-authoring.md)
- [`../../docs/adr/0004-react-jsx-authoring.md`](../../docs/adr/0004-react-jsx-authoring.md)
- [`../../docs/specs/rendering.md`](../../docs/specs/rendering.md)
