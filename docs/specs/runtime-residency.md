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

## Current Residency Coverage

- Mesh residency is uploaded into per-attribute vertex buffers plus an optional index buffer.
- Texture residency is uploaded into `GPUTexture`/view/sampler triples from image assets.
- Volume residency is uploaded into 3D textures from volume assets.
- Residency caches are keyed by IR object IDs.

## Recovery

- Device-local residency is invalidatable and rebuildable from
  `AssetSource + SceneIr + EvaluatedScene`.
- Pipeline caches are considered disposable and are cleared during rebuild.
- Device loss is observed explicitly rather than hidden behind global runtime state.
- Browser examples exercise both `ensureSceneMeshResidency(...)` and
  `ensureSceneTextureResidency(...)` for WebGPU surface rendering.
- Callers still own replacement device creation, target rebinding, and the first rerender after
  rebuild. See [`device-loss-recovery.md`](./device-loss-recovery.md) for the full sequence.
