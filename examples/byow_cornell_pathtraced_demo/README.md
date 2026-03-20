# BYOW Cornell Pathtraced Demo

Windows-native BYOW example that drives the `pathtraced` renderer through the `@rieul3d/desktop`
shell while supplying a Cornell-box SDF scene as a pathtraced renderer extension rather than as
engine-owned scene IR.

This demo intentionally keeps engine scene data minimal:

- a perspective camera stays in `SceneIr`
- Cornell room, light panel, box, and sphere travel through `PathtracedSceneExtension`

Run with:

```sh
deno task example:byow:cornell:run
```

Type-check with:

```sh
deno task example:byow:cornell:check
```
