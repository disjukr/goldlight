# glTF Interop

## Strategy

Blender interoperability is `glTF-first`. The primary interchange path is:

`Blender -> glTF -> Scene IR`

## Initial Support

- nodes and transforms
- meshes and primitives
- materials and textures
- skins and animations
- morph target weights
- cameras and punctual lights

## Current Status

- The current glTF path ingests JSON scenes, GLB containers, data-URI buffers, bufferViews,
  accessors, images, textures, materials, meshes, nodes, and animations into Scene IR.
- Runtime support behind the loader includes mesh, texture, material, forward rendering, headless
  snapshotting, and first volume residency paths.
- External buffer and image URIs are supported when callers provide the referenced bytes through
  `loadGltfFromJson(..., { baseUri, resources })`.

## Loader Notes

- `loadGltfFromJson` remains synchronous. External binary payloads must be resolved by the caller
  ahead of time and passed through `resources`.
- `loadGltfFromGlb` parses glTF 2.0 GLB containers and uses the embedded BIN chunk for buffer data.
- External image URIs are normalized against `baseUri` and preserved on emitted `SceneIr.assets`
  entries so runtime-side asset loading can still occur later.

## Other Formats

OBJ and STL are treated as geometry-focused formats. They normalize into the same Scene IR with
explicit limitations where material or animation data is unavailable.
