# glTF Interop

## Strategy

Blender interoperability stays `glTF-first`:

`Blender -> glTF -> Scene IR`

## Current Status

- JSON glTF, GLB, data-URI buffers, bufferViews, accessors, images, textures, materials, meshes, nodes, and animations import into Scene IR
- external buffers and images are supported when callers provide resource bytes through `importGltfFromJson(..., { baseUri, resources })`
- helper paths exist for browser fetching and Bun/Node filesystem loading without pushing I/O into the importer core

## Helper Usage

Browser or remote-first workflows can prefetch resources with:

```ts
const resources = await fetchGltfExternalResources(json, {
  baseUri: 'https://example.test/models/scene.gltf',
});
```

Local Bun/Node workflows can resolve relative files or remote URLs with:

```ts
const resources = await readNodeGltfExternalResources(json, {
  baseUri: '/workspace/assets/scene.gltf',
});
```

## Other Formats

OBJ and STL remain geometry-focused import paths that normalize into the same Scene IR.
