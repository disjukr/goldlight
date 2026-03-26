# React Authoring

## Position

React integration is an adapter layer. It must not become the source of truth for core scene data,
renderer ownership, or GPU residency ownership.

Core scene, evaluation, GPU, and renderer packages remain usable without React.

## Two Integration Surfaces

`@goldlight/react` currently exposes two distinct integration surfaces.

### Snapshot Bridge

The snapshot bridge is centered on `createG3dSceneRoot()`.

- app code authors a TSX tree
- the bridge lowers that tree into a committed `SceneIr` snapshot
- consumers can derive update summaries and targeted invalidation plans from each commit
- the bridge is useful when an integration wants explicit control over when snapshots are committed
  and how GPU residency is invalidated

This is still a valid path, especially in browser integrations and lower-level runtime experiments.

### Live Reconciler

The live reconciler is centered on `@goldlight/react/reconciler` and `createReactSceneRoot()`.

- normal React components mount into a package-local scene document
- React state and lifecycle drive authored scene changes directly
- reconciler roots publish committed scene snapshots to the renderer-side helpers
- nested `g2d-scene` and `g3d-scene` outputs participate in scene-level revision tracking and
  offscreen texture caching

This is the current path used by the desktop React demos.

## Current Authoring Model

The current live JSX surface is scene-oriented.

- `g3d-scene` is the authored 3D scene root and optional offscreen output boundary
- `g2d-scene` is the authored vector-drawing 2D scene root and optional offscreen output boundary
- nested scenes compose by naming an `outputTextureId` that a parent scene can consume as a normal
  texture
- `g3d-scene` supports a separate `viewportWidth` / `viewportHeight` and `textureWidth` /
  `textureHeight`
- `g2d-scene` supports the same viewport-versus-texture split

That split matters because viewport size describes scene coordinates and camera framing, while
texture size describes output resolution.

## Scene Composition

The main React authoring story today is scene composition.

- you can embed a vector-drawn `g2d-scene` inside a `g3d-scene`
- you can embed a `g3d-scene` inside another `g3d-scene` with a different camera
- nested scene drawing and final composition happen in one GPU context
- except for the root scene, nested scene outputs are cached by scene revision

That last point means a parent `g3d-scene` can keep animating while an unchanged nested `g2d-scene`
or `g3d-scene` keeps reusing its cached output texture.

The currently unsupported direction is `3d in 2d`: `@goldlight/drawing` does not yet support drawing
images or textures, so a `g2d-scene` cannot yet consume a `g3d-scene` output.

## Desktop Runtime Integration

`initializeWindow(...)` is the current high-level React desktop bootstrap.

It provides context handles for:

- runtime-managed frame state
- app-managed `timeMs`
- window metrics
- renderer config

Rendering cadence is application-controlled.

- if an app drives `useSetTimeMs()` from its own RAF loop, the window behaves like a
  continuously-updating renderer
- if it does not, the runtime redraws only when React state changes or when the system requires a
  new frame, such as resize or restore

This is an intentional part of the contract, not just a demo detail.

## Current Guarantees

- `createReactSceneRoot()` now requires an explicit root viewport size
- runtime-owned frame fields such as `viewportWidth`, `viewportHeight`, `frameIndex`, and
  `deltaTimeMs` are kept separate from app-owned `timeMs`
- renderer-facing `FrameState` is fully defined when rendering happens
- root and nested scene viewport sizes are explicit instead of inferred from texture size alone
- nested scene outputs use scene-level revision tracking instead of deep value fingerprint caches

## References

- Snapshot bridge browser example:
  [`../../examples/browser_react_authoring/README.md`](../../examples/browser_react_authoring/README.md)
- Live reconciler desktop examples:
  [`../../examples/byow_react_bunny_demo/README.md`](../../examples/byow_react_bunny_demo/README.md),
  [`../../examples/byow_react_surface_2d_in_3d_demo/README.md`](../../examples/byow_react_surface_2d_in_3d_demo/README.md),
  [`../../examples/byow_react_scene3d_in_3d_demo/README.md`](../../examples/byow_react_scene3d_in_3d_demo/README.md)
- Reconciler scene document ADR:
  [`../adr/0008-react-reconciler-scene-document.md`](../adr/0008-react-reconciler-scene-document.md)
- Snapshot bridge ADR:
  [`../adr/0006-react-scene-root-bridge.md`](../adr/0006-react-scene-root-bridge.md)
