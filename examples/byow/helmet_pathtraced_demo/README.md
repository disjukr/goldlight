# BYOW Helmet Pathtraced Demo

Windows-native BYOW example that renders the vendored Damaged Helmet GLB through the current
triangle-BVH mesh `pathtraced` renderer slice. This is the default mesh pathtraced BYOW demo.

This demo exercises:

- GLB ingestion of the in-repo Damaged Helmet sample asset
- mesh-local triangle BVH construction through `@disjukr/goldlight/raytrace`
- node-transform-aware fullscreen mesh path tracing with accumulation on a native
  `Deno.UnsafeWindowSurface`

Run with:

```sh
deno task example:byow:pathtraced:run
```

Type-check with:

```sh
deno task example:byow:pathtraced:check
```

Expected output:

- a progressively refining Damaged Helmet resting on a floor plane against the pathtraced sky
