# BYOW React Bunny Demo

Windows-native BYOW example that mounts a real React scene through `@goldlight/react/reconciler` and
renders the vendored Stanford Bunny PLY mesh on a native WebGPU surface.

This demo exercises:

- ASCII PLY ingestion of the in-repo Stanford Bunny asset
- real React reconciliation into the package-local scene document
- normal TSX authoring against the `@goldlight/react/reconciler` React-runtime JSX surface, using
  the same primitive contract as the snapshot path plus the exported convenience components
- hook-driven live scene updates that publish `G3dSceneRootCommit` payloads and surface reconciler
  failures through the flush helper path used by tests/deterministic integrations
- react-package frame-driver wiring that applies targeted residency invalidation and uses the
  transform-only reevaluation fast path whenever the rotating bunny only changes node transforms
- reusable `@goldlight/geometry` and `@goldlight/math` helpers for generated normals, mesh bounds,
  and Euler-authored light rotation
- built-in forward lit shading with a directional light in a native desktop window

Run with:

```sh
deno task example:byow:react-bunny:run
```

Type-check with:

```sh
deno task example:byow:react-bunny:check
```

Compile to a single executable with:

```sh
deno task compile examples/byow_react_bunny_demo
```

This writes a debug build next to the entrypoint as
`examples/byow_react_bunny_demo/byow_react_bunny_demo.exe` by default. The local demo resources
listed in [`goldlight.json`](./goldlight.json) are included, and common runtime dependencies are
picked up automatically:

- desktop worker modules
- desktop/text native host DLLs when the module graph requires them

Build a release executable with:

```sh
deno task compile examples/byow_react_bunny_demo --release
```

On Windows, release builds default to `--no-terminal`, so the executable opens without a console
window.

Override the output path with:

```sh
deno task compile examples/byow_react_bunny_demo --output tmp/byow_react_bunny_custom.exe
```

Expected output:

- a slowly rotating Stanford Bunny centered in the frame
- simple directional lighting on a pale neutral material

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- the desktop host DLL built through `deno task desktop:host:build` or auto-built by the run task
