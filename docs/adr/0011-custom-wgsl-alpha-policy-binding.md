# ADR 0011: Custom WGSL Alpha Policy Binding Contract

## Status

Proposed

## Decision

`@rieul3d/renderer` should expose first-class alpha-policy data to custom WGSL materials through an
explicit optional material binding contract instead of packing that policy into the existing generic
material uniform payload.

The proposed boundary is:

- renderer-side opaque/mask/blend partitioning continues to derive from `SceneIr.Material`
- custom WGSL programs may opt into a shared alpha-policy uniform binding through explicit material
  binding descriptors
- the alpha-policy binding stays in the material bind group, alongside existing material uniforms,
  textures, and samplers
- the shared alpha-policy payload mirrors the renderer-owned material policy fields already used by
  built-in materials:
  - `alphaCutoff`
  - alpha mode enum (`opaque`, `mask`, `blend`)
  - requested depth-write flag
  - requested double-sided flag
- custom material parameter uniforms remain owned by the custom program and should not need to
  reserve built-in slots or reinterpret built-in `values[]` packing

One acceptable API shape would extend `MaterialBindingDescriptor` with an explicit semantic for
renderer-owned alpha policy, for example an alpha-policy uniform descriptor distinct from the
current generic `uniform` entry.

## Rationale

Issue `#145` is not just a missing shader field. The renderer already decides whether a material is
opaque, masked, or blended before it chooses deferred, forward opaque fallback, or forward
transparent execution. Custom WGSL programs need access to that same policy if they are going to
clip masked texels or branch on the same material contract as built-in shaders.

Reusing the current generic material uniform payload is a weak boundary because:

- custom shaders cannot safely assume built-in `values[]` packing
- the renderer would still need out-of-band rules to know whether a custom material expects alpha
  policy
- future built-in material parameter layout changes would leak into custom shader contracts

An explicit alpha-policy binding keeps the renderer-owned classification contract separate from
program-owned parameter payloads while still letting custom WGSL materials participate in the same
hybrid execution model.

## Consequences

- custom WGSL materials can consume the same renderer-owned alpha policy as built-in shaders without
  reverse-engineering built-in uniform layout
- hybrid renderer partitioning remains driven by `SceneIr.Material`, not by shader source analysis
- material binding descriptors gain a clearer distinction between program-owned uniforms and
  renderer-owned policy data
- implementation still needs follow-up work to define the exact descriptor shape and tests

## Alternatives Considered

- pack alpha policy into the existing generic material uniform: less API surface, but it couples
  custom WGSL contracts to built-in layout details
- infer alpha behavior from custom WGSL code or material registration flags alone: too implicit for
  stable renderer partitioning
- keep custom transparent materials on forward-only fallback indefinitely: workable short term, but
  it preserves an avoidable capability gap between built-in and custom materials

Related issues: `#145`
