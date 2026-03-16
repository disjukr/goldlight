# Runtime Residency

## Purpose

Runtime residency is the device-local representation of evaluated scene data. It is kept separate
from Scene IR so the same IR can run in browsers, Deno, and headless targets.

## Separation Rules

- Asset source data is never the same object as runtime residency.
- IR references textures and geometry declaratively through IDs and descriptors.
- Residency owns `GPUBuffer`, `GPUTexture`, `GPUTextureView`, `GPUSampler`, and pipeline cache
  records.
- Residency is rebuildable from assets + IR + evaluated scene after device loss.

## Texture Example

1. Image asset: PNG/JPEG/EXR/KTX2 bytes and metadata
2. Texture IR: intended semantic, color space, sampler intent
3. Residency: actual `GPUTexture` and related views/samplers

## Lifecycle

- Asset loading is platform and I/O facing.
- Scene evaluation is CPU and IR facing.
- Residency preparation is device facing.
- Render execution consumes residency and evaluated scene extracts.
