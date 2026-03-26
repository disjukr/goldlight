# Specifications

These documents describe the intended architecture and current runtime behavior. Read them as the
source of truth for package boundaries and feature expectations.

## Architecture And Data

- [`architecture.md`](./architecture.md): top-level runtime layers and package responsibilities
- [`scene-ir.md`](./scene-ir.md): serializable scene schema and lowering expectations
- [`react-authoring.md`](./react-authoring.md): current snapshot bridge, live reconciler, scene
  composition, and desktop React runtime model
- [`desktop-shell.md`](./desktop-shell.md): desktop host/runtime boundary, shared manager worker,
  multiwindow model, and redraw behavior
- [`interop-gltf.md`](./interop-gltf.md): interchange strategy for Blender, glTF, OBJ, and STL
- [`procedural-generation.md`](./procedural-generation.md): procedural sampling, texture, and volume
  generation helpers
- [`sdf-mesh-extraction.md`](./sdf-mesh-extraction.md): local-space SDF-to-mesh extraction helpers
  and algorithm tradeoffs
- [`cubemap-capture.md`](./cubemap-capture.md): offscreen cubemap face capture contracts and current
  format/readback limits
- [`cubemap-export.md`](./cubemap-export.md): CPU-side reprojection/export layouts built on captured
  cubemap faces
- [`interaction.md`](./interaction.md): screen-to-world interaction ray construction

## Runtime Behavior

- [`device-loss-recovery.md`](./device-loss-recovery.md): explicit device-loss recovery sequence and
  caller responsibilities
- [`runtime-residency.md`](./runtime-residency.md): device-local resource ownership and rebuild
  rules
- [`rendering.md`](./rendering.md): renderer families, pass model, shader model, and current gaps

## Contributor Reference

- [`coding-style.md`](./coding-style.md): code and API style guidance for contributors
- [`../README.md`](../README.md): docs landing page
