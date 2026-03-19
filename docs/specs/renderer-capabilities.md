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
- scene-light support state for evaluated light nodes
- the list of built-in material kinds it accepts
- a support state for custom WGSL shader programs

The current TypeScript surface is:

- `CapabilityState`: `supported | planned | unsupported`
- `RendererCapabilities.mesh`
- `RendererCapabilities.sdf`
- `RendererCapabilities.volume`
- `RendererCapabilities.light`
- `RendererCapabilities.builtInMaterialKinds`
- `RendererCapabilities.customShaders`

## State Semantics

- `supported`: the renderer may encode this feature today
- `planned`: the renderer reserves the concept in its contract, but callers must treat it as not
  executable for the current release
- `unsupported`: the renderer does not expose this feature and callers should fail preflight

`planned` remains available for future descriptors, but current renderer declarations now prefer
`supported` or `unsupported` where execution behavior is concrete.

## Validation Contract

Capability validation runs against the evaluated scene rather than raw Scene IR. This keeps checks
aligned with the same node/material resolution that render extraction consumes.

The current preflight rules are:

- mesh nodes require `capabilities.mesh === 'supported'`
- SDF nodes require `capabilities.sdf === 'supported'`
- volume nodes require `capabilities.volume === 'supported'`
- light nodes require `capabilities.light === 'supported'`
- built-in materials without `shaderId` must have `material.kind` listed in
  `capabilities.builtInMaterialKinds`
- materials with `shaderId` require `capabilities.customShaders === 'supported'`
- built-in `lit` materials also require at least one directional light plus `NORMAL` mesh data

Renderers may apply narrower execution limits after the top-level capability gate. For example, the
forward renderer currently advertises SDF support but only encodes sphere and box SDF primitives;
that shape-specific restriction is reported as a validation issue during the same preflight step.

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
`texture-semantic:normal`, `texture-residency:baseColor:texture`, `vertex-attribute:TEXCOORD_0`, or
`vertex-attribute:NORMAL`.

Fatal render entry points should throw with the aggregated issue list when any incompatibility is
present. Non-fatal tooling may inspect the issue list directly for UI, tests, or diagnostics.

## Renderer Declarations

### Forward

The current forward renderer declares:

- `mesh: supported`
- `sdf: supported`
- `volume: supported`
- `light: supported`
- `builtInMaterialKinds: ['unlit', 'lit']`
- `customShaders: supported`

This matches the implemented path: mesh draws, directional-light Lambert shading with optional
base-color textures, plus first SDF and volume raymarch passes are encoded in the forward renderer.

### Deferred

The deferred renderer declares:

- `mesh: supported`
- `sdf: supported`
- `volume: supported`
- `light: supported`
- `builtInMaterialKinds: ['unlit', 'lit']`
- `customShaders: supported`

This now matches the implemented minimal deferred path:

- mesh nodes are accepted when they provide `POSITION` and `NORMAL`
- built-in `unlit` material uniforms are written into a small G-buffer and bypass the lighting
  resolve during fullscreen composition
- built-in `lit` material uniforms are written into the same G-buffer and consume first-class
  directional light nodes during the fullscreen lighting resolve
- built-in `unlit` materials may also sample resident `baseColor` textures when meshes provide
  `TEXCOORD_0`
- built-in `lit` materials may also sample resident `baseColor` textures when meshes provide
  `TEXCOORD_0`, but textured lit meshes are composited in a depth-tested forward pass after deferred
  lighting instead of writing through the deferred depth prepass
- materials classified with `renderQueue: 'transparent'` are rejected here and should use the hybrid
  renderer entry point instead of the pure deferred entry point
- registered custom WGSL materials may also execute in the G-buffer pass when they provide
  compatible transform bindings, fragment outputs, and declared material bindings
- SDF sphere/box primitives and resident volumes are composited afterward through the existing
  raymarch passes, so deferred frames can execute hybrid mesh-plus-raymarch scenes

### Hybrid

The hybrid renderer declares:

- `mesh: supported`
- `sdf: supported`
- `volume: supported`
- `light: supported`
- `builtInMaterialKinds: ['unlit', 'lit']`
- `customShaders: supported`

This matches the implemented hybrid path:

- deferred-eligible opaque meshes render through deferred depth, G-buffer, and lighting
- opaque meshes that are not deferred-eligible fall back to a forward opaque pass after lighting
- transparent meshes render in a second forward pass with blending enabled and deferred depth reused
- SDF sphere/box primitives and resident volumes still composite afterward through the shared
  raymarch passes

## Relationship To Other Specs

- [`rendering.md`](./rendering.md) defines pass families and current execution scope
- [`runtime-residency.md`](./runtime-residency.md) describes the device-local resources consumed
  after capability preflight succeeds
- [`architecture.md`](./architecture.md) positions capability checks between evaluated-scene output
  and render execution
