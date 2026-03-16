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

## Other Formats

OBJ and STL are treated as geometry-focused formats. They normalize into the same Scene IR with
explicit limitations where material or animation data is unavailable.
