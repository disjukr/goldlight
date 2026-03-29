# G2L Layout Intrinsics

## Position

`g2l-*` is the planned layout substrate for the live React reconciler.

It is intentionally separate from:

- `g2d-*`, which owns 2D drawing primitives
- `g3d-*`, which owns 3D drawing primitives

`g2l-*` owns 2D-space layout only.

## Scope

`g2l-*` computes:

- box-tree layout in 2D space
- box model geometry such as border/content rectangles
- text paragraph layout and line breaking

`g2l-*` does not directly decide whether output is drawn with `g2d-*` or `g3d-*`.

## Naming

The naming split is:

- `g2d-*`: 2D drawing
- `g3d-*`: 3D drawing
- `g2l-*`: 2D layout

This keeps layout explicit as a 2D-space concern while still allowing a `g3d-*` consumer to use the
computed layout result.

## Rendering Model

`g2l-*` has no built-in visual rendering.

Each layout node can instead provide a `render` function that consumes committed layout state and
returns normal React children, typically built from `g2d-*` or `g3d-*`.

Conceptually:

```tsx
<g2l-box render={(ctx) => ...}>
  ...
</g2l-box>
```

The important split is:

- `children` builds the layout subtree
- `render` consumes the computed layout snapshot

This keeps `g2l-*` renderer-agnostic and avoids a default 2D-or-3D policy.

## Why Reconciler-Owned

`g2l-*` is intended to be collected by the reconciler rather than by React child-tree inspection.

That choice is driven by two constraints:

- arbitrary user components must remain valid between layout nodes
- layout collection must not require a two-pass registration model that causes visible first-frame
  flicker

The reconciler is therefore the source of truth for `g2l-*` structure.

## Layout State Exposure

Using the reconciler for structure collection does not prevent user access to layout state.

The plan is:

- structure collection is reconciler-owned
- committed layout state is exposed to user code as a read-only snapshot
- internal storage is ref/store-oriented rather than React state-oriented

This avoids a second render solely to publish layout results.

## Render Context Shape

The render interface should be uniform across node kinds.

Instead of distinct callback signatures for box nodes and text nodes, `render` receives a single
context shape whose `node` field is an algebraic data type.

Conceptually:

```ts
type G2lRenderNode =
  | G2lBoxRenderNode
  | G2lTextRenderNode;

type G2lRenderContext = {
  node: G2lRenderNode;
  tree: G2lRenderTreeReader;
};
```

Common node information should include:

- stable node id
- node kind
- resolved style
- resolved box-model geometry
  - margin rect
  - border rect
  - padding rect
  - content rect

Text nodes additionally carry paragraph layout data such as:

- prepared paragraph
- committed paragraph layout
- line and run data

## Tree Access

The render context should also expose a read-only tree reader.

This allows a render callback to inspect parent/child relationships without mutating layout during
render.

The expected direction is:

- current node info is always available directly
- parent/child/sibling lookup is available through the reader
- mutation is not allowed from render

## Initial Intrinsics

The first planned intrinsic set is intentionally small:

- `g2l-root`
- `g2l-box`
- `g2l-text`

`row` and `column` remain style-driven rather than becoming separate intrinsics in the initial
shape.

## User-Level Components

`g2l-*` is the internal layout substrate, not the final ergonomic component surface.

User-facing wrappers are expected to sit above it and hide the `render` callback, for example:

- a 2D panel wrapper that lowers to `g2l-box` plus `g2d-*`
- a 3D panel wrapper that lowers to `g2l-box` plus `g3d-*`

That keeps the substrate generic while allowing opinionated higher-level components on top.

## Current Status

`engine/layout` already contains a headless prototype for:

- box tree layout
- flex row/column behavior
- paragraph preparation and layout
- bidi-safe run-based line output

The next implementation step is to connect that headless model to `g2l-*` reconciler host nodes.
