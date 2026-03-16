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

- The current glTF path ingests JSON scenes, data-URI buffers, bufferViews, accessors, images,
  textures, materials, meshes, nodes, and animations into Scene IR.
- Runtime support behind the loader includes mesh, texture, material, forward rendering, headless
  snapshotting, and first volume residency paths.
- GLB containers and external file URIs are still out of scope; the loader currently expects inline
  data for binary payloads.

## Other Formats

OBJ and STL are treated as geometry-focused formats. They normalize into the same Scene IR with
explicit limitations where material or animation data is unavailable.
