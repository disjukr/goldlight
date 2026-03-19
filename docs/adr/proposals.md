# Proposed ADR Index

Proposed architectural decisions live here until they are reviewed and promoted into the accepted
ADR index.

## Proposed Decisions

- [`0011-custom-wgsl-alpha-policy-binding.md`](./0011-custom-wgsl-alpha-policy-binding.md): custom
  WGSL materials should receive renderer-owned alpha policy through an explicit shared binding
  contract instead of built-in uniform packing
- [`0012-role-oriented-utility-package-layout.md`](./0012-role-oriented-utility-package-layout.md):
  utility and generation modules should organize around geometry, spatial, procedural, and raytrace
  roles before any public package split

## Related References

- [`README.md`](./README.md): accepted ADR index
- [`../specs/rendering.md`](../specs/rendering.md): renderer execution surface and pass model
- [`../specs/cubemap-capture.md`](../specs/cubemap-capture.md): cubemap face capture contract
- [`../README.md`](../README.md): docs landing page
