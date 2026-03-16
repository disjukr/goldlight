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

- The current glTF path is still a scaffold and normalization layer, not full binary ingestion.
- Runtime support behind the loader is now broader than the loader itself: mesh, texture, material,
  forward rendering, headless snapshotting, and first volume residency paths already exist.
- The next interop milestone is real bufferView, accessor, image, and material ingestion from glTF.

## Other Formats

OBJ and STL are treated as geometry-focused formats. They normalize into the same Scene IR with
explicit limitations where material or animation data is unavailable.
