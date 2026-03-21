# glTF Interop

## Strategy

Blender interoperability is `glTF-first`. The primary interchange path is:

`Blender -> glTF -> Scene IR`

## Initial Support

- nodes and transforms
- meshes and primitives
- materials and textures
- skins and animations
- morph target weights
- cameras and punctual lights

## Current Status

- The current glTF path ingests JSON scenes, GLB containers, data-URI buffers, bufferViews,
  accessors, images, textures, materials, meshes, nodes, and animations into Scene IR.
- Runtime support behind the importer includes mesh, texture, material, forward rendering, headless
  snapshotting, and real imported-asset demo coverage such as Damaged Helmet.
- External buffer and image URIs are supported when callers provide the referenced bytes through
  `importGltfFromJson(..., { baseUri, resources })`.
- `fetchGltfExternalResources` and `readDenoGltfExternalResources` provide supported helper paths
  for collecting those bytes in browser and Deno workflows without changing importer purity.

## Importer Notes

- `importGltfFromJson` remains synchronous. External binary payloads must be resolved by the caller
  ahead of time and passed through `resources`.
- `listExternalGltfResourceUris` exposes the normalized external URI set when callers want to
  inspect or cache resource fetch plans themselves.
- `importGltfFromGlb` parses glTF 2.0 GLB containers and uses the embedded BIN chunk for buffer
  data.
- The importer now preserves texture semantic and color-space intent per material usage instead of
  treating every imported image as a base-color sRGB texture.
- `inlineExternalAssets: true` can bake caller-provided external image resources directly into scene
  resource sources, which is useful for self-contained scene snapshots in renderer and React
  workflows.

## Helper Usage

Browser or remote-first workflows can prefetch resources with:

```ts
const resources = await fetchGltfExternalResources(json, {
  baseUri: 'https://example.test/models/scene.gltf',
});

const scene = importGltfFromJson(json, 'scene', {
  baseUri: 'https://example.test/models/scene.gltf',
  resources,
});
```

Deno workflows can resolve either local relative files or remote URLs with:

```ts
const resources = await readDenoGltfExternalResources(json, {
  baseUri: '/workspace/assets/scene.gltf',
});

const scene = importGltfFromJson(json, 'scene', {
  baseUri: '/workspace/assets/scene.gltf',
  resources,
});
```

## Other Formats

OBJ and STL are treated as geometry-focused formats. They normalize into the same Scene IR with
explicit limitations where material or animation data is unavailable.
