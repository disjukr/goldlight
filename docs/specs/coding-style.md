# Coding Style

## Core Rules

- Prefer plain objects and functions over classes and method-based APIs.
- Pass explicit state/context objects through functions rather than relying on globals.
- Keep serializable data structures decoupled from runtime-resident resources.
- Use immutable-friendly inputs and return new values unless a hot path justifies reuse.

## Naming

- Treat acronyms as ordinary words in identifiers.
- Prefer `createSceneIr`, `requestGpuContext`, `loadGltfFromJson`, and `loadObjFromText`.
- Avoid all-caps acronym segments in exported TypeScript names such as `createSceneIR`,
  `requestGPUContext`, or `loadGLTFFromJson`.
- Apply the same rule to type names unless an external platform type forces a different spelling.

## Allowed Mutation

- scratch buffers reused inside evaluation or rendering internals
- typed array writes in performance-sensitive loops
- residency maps and caches that model device-local mutable state

## `class` Usage

Allowed only when there is a measurable runtime or lifetime reason, such as:

- wrapping disposable GPU resources
- avoiding allocation churn in a hot path
- storing typed-array-backed views with stable hidden classes

Not allowed for:

- scene graph entities with behavior
- inheritance-based polymorphism
- fluent builder APIs that hide state mutation

## Public API Shape

Prefer:

```ts
const scene = createSceneIr();
const nextScene = appendNode(scene, node);
const evaluated = evaluateScene(nextScene, { timeMs: 16 });
```

Avoid:

```ts
const scene = new Scene();
scene.add(node).render();
```
