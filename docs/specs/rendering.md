# Rendering

## Renderer Families

`rieul3d` exposes two renderer descriptors in v1:

- `forward`
- `deferred`

Both share common pass contracts and evaluated scene extraction.

## Pass Model

The initial renderer uses a lightweight pass graph:

- explicit pass ordering
- explicit resource names
- explicit dependencies
- no full frame-graph aliasing or aggressive optimization yet

## Primitive Mapping

- mesh primitives are expected to use raster-oriented passes
- sdf and volume primitives are expected to use raymarch or compute-oriented passes
- hybrid frames may mix raster and raymarch passes

## Shader Model

- WGSL only
- built-in material descriptors for common cases
- custom material contracts that register shader source and binding expectations
