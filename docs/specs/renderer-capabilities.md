# Renderer Capabilities

## Purpose

Renderer capabilities define the preflight contract between an evaluated scene and a renderer
descriptor before pass encoding begins.

The capability model exists to answer two questions early:

- can this renderer execute the primitive mix in the scene?
- can this renderer satisfy the material requirements attached to those nodes?

## Capability Shape

Each renderer advertises a `capabilities` object with:

- primitive support states for `mesh`, `sdf`, and `volume`
- the list of built-in material kinds it accepts
- a support state for custom WGSL shader programs

The current TypeScript surface is:

- `CapabilityState`: `supported | planned | unsupported`
- `RendererCapabilities.mesh`
- `RendererCapabilities.sdf`
- `RendererCapabilities.volume`
- `RendererCapabilities.builtInMaterialKinds`
- `RendererCapabilities.customShaders`

## State Semantics

- `supported`: the renderer may encode this feature today
- `planned`: the renderer reserves the concept in its contract, but callers must treat it as not
  executable for the current release
- `unsupported`: the renderer does not expose this feature and callers should fail preflight

`planned` is intentionally visible in descriptors so the deferred pipeline can publish its intended
surface area without pretending the implementation is ready.

## Validation Contract

Capability validation runs against the evaluated scene rather than raw Scene IR. This keeps checks
aligned with the same node/material resolution that render extraction consumes.

The current preflight rules are:

- mesh nodes require `capabilities.mesh === 'supported'`
- SDF nodes require `capabilities.sdf === 'supported'`
- volume nodes require `capabilities.volume === 'supported'`
- built-in materials without `shaderId` must have `material.kind` listed in
  `capabilities.builtInMaterialKinds`
- materials with `shaderId` require `capabilities.customShaders === 'supported'`

Renderers may apply narrower execution limits after the top-level capability gate. For example, the
forward renderer currently advertises SDF support but only encodes sphere SDF primitives; that
shape-specific restriction is reported as a validation issue during the same preflight step.

## Failure Reporting

Validation should return one issue per incompatible node/feature pair so callers can surface all
known blockers in a single pass.

Each issue should include:

- the evaluated node ID
- the failing feature category
- a machine-friendly requirement key for the exact unsupported shape, binding, or capability
- a human-readable message that names the renderer and unsupported requirement

Current requirement keys include renderer execution gates such as `mesh-execution`, shape-specific
keys such as `sdf-op:box`, and binding-specific keys such as `shader:shader:missing`,
`texture-semantic:normal`, `texture-residency:baseColor:texture`, or `vertex-attribute:TEXCOORD_0`.

Fatal render entry points should throw with the aggregated issue list when any incompatibility is
present. Non-fatal tooling may inspect the issue list directly for UI, tests, or diagnostics.

## Renderer Declarations

### Forward

The current forward renderer declares:

- `mesh: supported`
- `sdf: supported`
- `volume: supported`
- `builtInMaterialKinds: ['unlit']`
- `customShaders: supported`

This matches the implemented path: mesh draws plus first SDF and volume raymarch passes are encoded
in the forward renderer.

### Deferred

The deferred renderer declares:

- `mesh: planned`
- `sdf: planned`
- `volume: planned`
- `builtInMaterialKinds: ['unlit']`
- `customShaders: planned`

That descriptor is a planning contract only. Callers should not expect deferred execution to accept
scenes yet, but the declaration makes the intended support matrix explicit for future work.

## Relationship To Other Specs

- [`rendering.md`](./rendering.md) defines pass families and current execution scope
- [`runtime-residency.md`](./runtime-residency.md) describes the device-local resources consumed
  after capability preflight succeeds
- [`architecture.md`](./architecture.md) positions capability checks between evaluated-scene output
  and render execution
