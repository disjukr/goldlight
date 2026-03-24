# BYOW Helmet Forward Demo

Windows-native BYOW example that renders the vendored Damaged Helmet GLB through the forward
renderer's built-in `lit` template path via `@goldlight/react/reconciler`.

This demo exists to validate the renderer template assembly system, forward PBR path, and
environment-lighting setup against a real imported material set. The helmet material is remapped
from the importer's default `unlit` kind to `lit`, and the forward `lit` template bakes the full
helmet texture set:

- base color
- metallic-roughness
- normal
- occlusion
- emissive

The demo also uses a vendored 1K EXR environment map for image-based lighting and background
rendering.

Debug keys:

- `N`: toggle debug mode
- `Z`: geometric world normal
- `X`: sampled tangent-space normal
- `C`: mapped world normal
- `V`: mapped view normal
- `A`: world tangent
- `S`: world bitangent
- `D`: tangent handedness
- `F`: raw tangent-space normal sample
- `G`: UV view

Run with:

```sh
deno task example:byow:helmet-forward:run
```

Type-check with:

```sh
deno task example:byow:helmet-forward:check
```
