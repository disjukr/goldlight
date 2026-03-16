# Specifications

These documents describe the intended architecture and current runtime behavior. Read them as the
source of truth for package boundaries and feature expectations.

## Architecture And Data

- [`architecture.md`](./architecture.md): top-level runtime layers and package responsibilities
- [`scene-ir.md`](./scene-ir.md): serializable scene schema and lowering expectations
- [`interop-gltf.md`](./interop-gltf.md): interchange strategy for Blender, glTF, OBJ, and STL

## Runtime Behavior

- [`runtime-residency.md`](./runtime-residency.md): device-local resource ownership and rebuild
  rules
- [`rendering.md`](./rendering.md): renderer families, pass model, shader model, and current gaps
- [`react-authoring.md`](./react-authoring.md): React package role and lowering boundaries

## Contributor Reference

- [`coding-style.md`](./coding-style.md): code and API style guidance for contributors
- [`../README.md`](../README.md): docs landing page
