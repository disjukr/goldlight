# Documentation

This repository keeps design intent, accepted decisions, and runnable workflows in separate folders.
Use this page as the main navigation hub.

## Read By Goal

- Understand the system shape: [`specs/architecture.md`](./specs/architecture.md)
- Understand the scene data model: [`specs/scene-ir.md`](./specs/scene-ir.md)
- Understand the renderer light and material support surface:
  [`specs/rendering.md`](./specs/rendering.md)
- Understand runtime GPU ownership and recovery:
  [`specs/runtime-residency.md`](./specs/runtime-residency.md)
- Understand device-loss handling and caller recovery steps:
  [`specs/device-loss-recovery.md`](./specs/device-loss-recovery.md)
- Understand current rendering scope and gaps: [`specs/rendering.md`](./specs/rendering.md)
- Understand forward vs. minimal deferred capability boundaries:
  [`specs/renderer-capabilities.md`](./specs/renderer-capabilities.md)
- Understand loader and interchange direction: [`specs/interop-gltf.md`](./specs/interop-gltf.md)
- Understand JSX authoring boundaries: [`specs/react-authoring.md`](./specs/react-authoring.md)
- Understand reusable built-in mesh generation and example coverage:
  [`../examples/byow_primitives_demo/README.md`](../examples/byow_primitives_demo/README.md)
- Review accepted architecture constraints: [`adr/README.md`](./adr/README.md)
- Review the JSX authoring boundary decision:
  [`adr/0004-react-jsx-authoring.md`](./adr/0004-react-jsx-authoring.md)
- Run the browser and native examples, including the textured and custom-material browser workflows:
  [`../examples/README.md`](../examples/README.md)
- Review the React authoring browser example with full-scene TSX lowering:
  [`../examples/browser_react_authoring/README.md`](../examples/browser_react_authoring/README.md)
- Run the headless snapshot PNG workflow:
  [`../examples/headless_snapshot/README.md`](../examples/headless_snapshot/README.md)

## Contributor Workflows

- Repository entry point: [`../README.md`](../README.md)
- Code style and repository conventions: [`specs/coding-style.md`](./specs/coding-style.md)
- Verification task bundle: `deno task check`
- Docs and formatting verification: `deno task docs:check`

## Directory Guide

- [`specs/README.md`](./specs/README.md): design docs and behavioral contracts
- [`adr/README.md`](./adr/README.md): short decision records for accepted constraints
- [`../examples/README.md`](../examples/README.md): runnable example entry points and commands
