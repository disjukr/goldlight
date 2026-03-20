# BYOW Helmet Forward Demo

Windows-native BYOW example that renders the vendored Damaged Helmet GLB through the forward
renderer's built-in `lit` template path.

This demo exists to validate the renderer template assembly system against a real imported material
set. The helmet material is remapped from the importer's default `unlit` kind to `lit`, and the
forward `lit` template bakes the full helmet texture set:

- base color
- metallic-roughness
- normal
- occlusion
- emissive

Run with:

```sh
deno task example:byow:helmet-forward:run
```

Type-check with:

```sh
deno task example:byow:helmet-forward:check
```
