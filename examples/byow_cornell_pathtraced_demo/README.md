# BYOW Cornell Pathtraced Demo

Windows-native BYOW example that drives the current `pathtraced` renderer entrypoint through the
`@rieul3d/desktop` shell and `Deno.UnsafeWindowSurface`.

This demo intentionally stays within the current path-tracing slice by building a Cornell-box-like
room from supported SDF primitives:

- five box SDF walls for the room shell
- one inner white box
- one inner white sphere
- a perspective camera placed in front of the open room

Run with:

```sh
deno task example:byow:cornell:run
```

Type-check with:

```sh
deno task example:byow:cornell:check
```

Expected output:

- a Cornell-box-like room viewed from the front
- a red left wall and green right wall
- a white inner box and white sphere shaded by the current pathtraced SDF pass

Requirements:

- Windows with Deno `--unstable-ffi` and `--unstable-webgpu`
- the desktop host DLL built through `deno task desktop:host:build` or auto-built by the run task

Current limits:

- this demo exercises the current SDF-only pathtraced slice, not mesh path tracing
- lighting still comes from the renderer's current built-in pathtraced shader model rather than a
  Cornell-box area-light material contract
