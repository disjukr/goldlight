# Device-Loss Recovery

## Purpose

This document defines the contract for reacting to WebGPU device loss in `goldlight`. Recovery is
explicit: callers own device replacement, target rebinding, residency rebuild, and the first frame
submitted on the new device.

## Recovery Entry Points

- `observeDeviceLoss(device, onLost)` waits for `GPUDevice.lost`, normalizes the payload into
  `GpuLostInfo`, and forwards it to the caller.
- `rebuildRuntimeResidency(context, residency, scene, evaluatedScene, assetSource)` clears stale
  device-local caches and recreates mesh, material, texture, and volume residency from CPU-owned
  inputs.

These helpers are intentionally small. They do not hide adapter/device negotiation or surface
reconfiguration behind a global runtime singleton.

Separately from device loss, surface-backed contexts may lose presentation configuration because of
window-system events. In that narrower case `acquireColorAttachmentView(...)` retries once after
reconfiguring the existing surface binding; callers do not need to rebuild residency when the device
itself is still valid.

## Ownership Rules

- `SceneIr`, source assets, and evaluated scene results remain the source of truth.
- `RuntimeResidency` is disposable device-local state.
- Render target bindings are disposable device-local state.
- Pipeline caches are disposable device-local state and are always dropped during rebuild.
- The caller is responsible for holding onto enough CPU-side state to rebuild residency.

## Recovery Sequence

When a device is lost, callers should perform recovery in this order:

1. Observe loss and stop submitting new work on the dead device.
2. Request or construct a replacement `GPUDevice` and queue.
3. Recreate the render target binding.
4. Re-evaluate the scene if transforms, animation time, or authoring state changed since the last
   frame.
5. Call `rebuildRuntimeResidency(...)` with the replacement device/queue plus the current `SceneIr`,
   evaluated scene, and asset source.
6. Recreate any renderer-side objects that depend on the old device.
7. Submit a new frame explicitly.

`rebuildRuntimeResidency(...)` only restores residency caches. It does not implicitly redraw.

## Disposable vs Persistent State

| State                               | Owner                | After loss                |
| ----------------------------------- | -------------------- | ------------------------- |
| `SceneIr`                           | caller               | keep                      |
| image/volume asset bytes + metadata | caller               | keep                      |
| evaluated scene snapshot            | caller               | keep or recompute         |
| `RuntimeResidency.geometry`         | runtime residency    | rebuild                   |
| `RuntimeResidency.materials`        | runtime residency    | rebuild                   |
| `RuntimeResidency.textures`         | runtime residency    | rebuild                   |
| `RuntimeResidency.volumes`          | runtime residency    | rebuild                   |
| `RuntimeResidency.pipelines`        | runtime residency    | clear and lazily recreate |
| surface/offscreen target binding    | caller + GPU context | recreate                  |

## Caller Responsibilities

- Keep the latest asset source reachable for rebuild.
- Keep or recompute the evaluated scene before rebuild.
- Rebind browser canvases or recreate offscreen targets on the replacement device.
- Treat the first post-recovery frame as a normal render submission that must be requested
  explicitly.
- Surface recovery failure if replacement device creation or residency rebuild throws.

## Failure Model

- `observeDeviceLoss(...)` reports the platform-provided reason and message, but does not interpret
  whether the device can be recovered.
- `rebuildRuntimeResidency(...)` throws if required image or volume assets are missing or
  incomplete.
- If rebuild fails, callers should keep the runtime in a non-rendering state rather than reuse
  partially rebuilt residency.

## Current Scope

Today the documented recovery contract covers:

- mesh residency
- material uniform residency
- texture residency
- volume residency
- render pipeline cache invalidation

Future renderer-specific transient resources can extend this contract, but they must follow the same
rule: CPU-owned source data survives, device-local caches are recreated.

## Coverage

- `tests/device_recovery_test.ts` exercises the documented recovery order with offscreen target
  rebinding, residency rebuild, and the first post-recovery frame submission.
- The same test file also covers a rebuild failure path so callers can keep the runtime in an
  explicit non-rendering state until recovery succeeds.
- `tests/golden_snapshot_test.ts` also verifies that a volume snapshot remains deterministic after
  rebuilding residency on a replacement device and still differs from the clear-only frame.
