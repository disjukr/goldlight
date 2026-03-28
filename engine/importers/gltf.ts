import { dirname, isAbsolute, resolve as resolvePath } from '@std/path';
import {
  appendAnimationClip,
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createAssetTextureSource,
  createInlineMeshSource,
  createInlineTextureSource,
  createNode,
  createSceneIr,
  createVec3,
  identityTransform,
} from '@disjukr/goldlight/ir';
import type { AssetSource, ImageAsset } from '@disjukr/goldlight/gpu';
import type {
  AnimationChannel,
  AnimationClip,
  AnimationKeyframe,
  AssetRef,
  Material,
  MeshAttribute,
  SceneIr,
  TextureRef,
  Vec4,
} from '@disjukr/goldlight/ir';

type GltfComponentType = 5120 | 5121 | 5122 | 5123 | 5125 | 5126;
type GltfAccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';

type GltfBuffer = Readonly<{
  uri?: string;
  byteLength: number;
}>;

type GltfBufferView = Readonly<{
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}>;

type GltfAccessor = Readonly<{
  bufferView?: number;
  byteOffset?: number;
  componentType: GltfComponentType;
  count: number;
  type: GltfAccessorType;
}>;

type GltfImage = Readonly<{
  uri?: string;
  mimeType?: string;
  name?: string;
  bufferView?: number;
}>;

type GltfTexture = Readonly<{
  source?: number;
  sampler?: number;
}>;

type GltfMaterial = Readonly<{
  name?: string;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  normalTexture?: Readonly<{ index: number; scale?: number }>;
  occlusionTexture?: Readonly<{ index: number; strength?: number }>;
  emissiveTexture?: Readonly<{ index: number }>;
  emissiveFactor?: readonly number[];
  pbrMetallicRoughness?: Readonly<{
    baseColorTexture?: Readonly<{ index: number }>;
    baseColorFactor?: readonly number[];
    metallicRoughnessTexture?: Readonly<{ index: number }>;
    metallicFactor?: number;
    roughnessFactor?: number;
  }>;
}>;

type GltfPrimitiveAttributeValue = number | readonly number[];

type GltfPrimitive = Readonly<{
  attributes?: Readonly<Record<string, GltfPrimitiveAttributeValue>>;
  indices?: number | readonly number[];
  material?: number;
}>;

type GltfMesh = Readonly<{
  primitives: readonly GltfPrimitive[];
}>;

type GltfNode = Readonly<{
  name?: string;
  mesh?: number;
  translation?: readonly number[];
  rotation?: readonly number[];
  scale?: readonly number[];
  children?: readonly number[];
}>;

type GltfAnimationSampler = Readonly<{
  input: number;
  output: number;
}>;

type GltfAnimationChannel = Readonly<{
  sampler?: number;
  node?: number;
  path?: string;
  target?: Readonly<{
    node: number;
    path: string;
  }>;
  times?: readonly number[];
  values?: readonly (readonly number[])[];
}>;

type GltfAnimation = Readonly<{
  name?: string;
  samplers?: readonly GltfAnimationSampler[];
  channels: readonly GltfAnimationChannel[];
}>;

type GltfScene = Readonly<{
  nodes?: readonly number[];
}>;

type GltfJson = Readonly<{
  buffers?: readonly GltfBuffer[];
  bufferViews?: readonly GltfBufferView[];
  accessors?: readonly GltfAccessor[];
  images?: readonly GltfImage[];
  textures?: readonly GltfTexture[];
  materials?: readonly GltfMaterial[];
  meshes?: readonly GltfMesh[];
  nodes?: readonly GltfNode[];
  scenes?: readonly GltfScene[];
  scene?: number;
  animations?: readonly GltfAnimation[];
}>;

export type GltfExternalResourceMap = Readonly<Record<string, Uint8Array>>;

export type GltfImportOptions = Readonly<{
  baseUri?: string;
  resources?: GltfExternalResourceMap;
  inlineExternalAssets?: boolean;
}>;

export type GltfExternalResourceOptions = Readonly<{
  baseUri?: string;
}>;

export type GltfFetchExternalResourceOptions =
  & GltfExternalResourceOptions
  & Readonly<{
    fetch?: typeof globalThis.fetch;
  }>;

export type GltfDenoExternalResourceOptions =
  & GltfExternalResourceOptions
  & Readonly<{
    cwd?: string;
    fetch?: typeof globalThis.fetch;
    readFile?: (path: string | URL) => Promise<Uint8Array>;
  }>;

type ResolvedResource = Readonly<{
  uri: string;
  bytes?: Uint8Array;
}>;

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const accessorItemSize = (type: GltfAccessorType): number => {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
      return 4;
  }
};

const componentByteSize = (componentType: GltfComponentType): number => {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
  }
};

const decodeDataUri = (uri: string): Uint8Array => {
  const separatorIndex = uri.indexOf(',');
  if (separatorIndex < 0) {
    throw new Error('glTF data URI is missing a payload');
  }

  const metadata = uri.slice(0, separatorIndex);
  const payload = uri.slice(separatorIndex + 1);

  if (metadata.endsWith(';base64')) {
    const binary = atob(payload);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  return textEncoder.encode(decodeURIComponent(payload));
};

const inferDataUriMimeType = (uri: string): string | undefined => {
  if (!uri.startsWith('data:')) {
    return undefined;
  }

  const metadata = uri.slice(5, uri.indexOf(','));
  const mimeType = metadata.split(';')[0];
  return mimeType.length === 0 ? undefined : mimeType;
};

const inferMimeTypeFromUri = (uri: string): string | undefined => {
  const path = uri.split('?')[0]?.split('#')[0] ?? uri;
  const extensionIndex = path.lastIndexOf('.');
  if (extensionIndex < 0) {
    return undefined;
  }

  switch (path.slice(extensionIndex + 1).toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'ktx2':
      return 'image/ktx2';
    default:
      return undefined;
  }
};

const tryParseUrl = (value: string, baseUri?: string): URL | undefined => {
  try {
    return baseUri ? new URL(value, baseUri) : new URL(value);
  } catch {
    return undefined;
  }
};

const resolveUri = (uri: string, baseUri?: string): string => {
  const absoluteUrl = tryParseUrl(uri);
  if (absoluteUrl) {
    return absoluteUrl.toString();
  }

  if (!baseUri) {
    return uri;
  }

  const resolvedUrl = tryParseUrl(uri, baseUri);
  if (resolvedUrl) {
    return resolvedUrl.toString();
  }

  if (isAbsolute(uri)) {
    return resolvePath(uri);
  }

  const resolvedBaseUri = isAbsolute(baseUri) ? baseUri : resolvePath(baseUri);
  return resolvePath(dirname(resolvedBaseUri), uri);
};

const resolveResource = (
  uri: string,
  options: GltfImportOptions,
): ResolvedResource => {
  const resolvedUri = resolveUri(uri, options.baseUri);
  const bytes = options.resources?.[resolvedUri] ?? options.resources?.[uri];
  return { uri: resolvedUri, bytes };
};

const isExternalUri = (uri: string | undefined): uri is string =>
  typeof uri === 'string' && uri.length > 0 && !uri.startsWith('data:');

const collectExternalResourceUris = (
  json: GltfJson,
  options: GltfExternalResourceOptions = {},
): string[] => {
  const uris = new Set<string>();

  json.buffers?.forEach((buffer) => {
    if (isExternalUri(buffer.uri)) {
      uris.add(resolveUri(buffer.uri, options.baseUri));
    }
  });

  json.images?.forEach((image) => {
    if (isExternalUri(image.uri)) {
      uris.add(resolveUri(image.uri, options.baseUri));
    }
  });

  return [...uris];
};

const toUint8Array = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer());

const fetchExternalResource = async (
  uri: string,
  fetchFn: typeof globalThis.fetch,
): Promise<Uint8Array> => {
  const response = await fetchFn(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch glTF external resource "${uri}" (${response.status})`);
  }

  return toUint8Array(response);
};

const resolveDenoReadTarget = (
  uri: string,
  options: GltfDenoExternalResourceOptions,
): string | URL => {
  const resolvedUri = resolveUri(uri, options.baseUri);
  const parsedUrl = tryParseUrl(resolvedUri);

  if (parsedUrl?.protocol === 'file:') {
    return parsedUrl;
  }

  if (parsedUrl) {
    return resolvedUri;
  }

  if (isAbsolute(resolvedUri)) {
    return resolvedUri;
  }

  return resolvePath(options.cwd ?? Deno.cwd(), resolvedUri);
};

const sliceBufferView = (
  buffers: readonly Uint8Array[],
  bufferViews: readonly GltfBufferView[],
  bufferViewIndex: number,
  label: string,
): Uint8Array => {
  const bufferView = bufferViews[bufferViewIndex];
  if (!bufferView) {
    throw new Error(`${label} references missing bufferView ${bufferViewIndex}`);
  }

  const bytes = buffers[bufferView.buffer];
  if (!bytes) {
    throw new Error(`${label} references missing buffer ${bufferView.buffer}`);
  }

  const byteOffset = bufferView.byteOffset ?? 0;
  return bytes.slice(byteOffset, byteOffset + bufferView.byteLength);
};

const parseGlb = (glbBytes: Uint8Array): { json: GltfJson; binaryChunk?: Uint8Array } => {
  const headerLength = 12;
  if (glbBytes.byteLength < headerLength) {
    throw new Error('GLB payload is too short to contain a valid header');
  }

  const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);

  if (magic !== GLB_MAGIC) {
    throw new Error('GLB payload is missing the glTF magic header');
  }

  if (version !== GLB_VERSION) {
    throw new Error(`GLB version ${version} is not supported`);
  }

  if (length !== glbBytes.byteLength) {
    throw new Error(
      `GLB declared length ${length} does not match payload length ${glbBytes.byteLength}`,
    );
  }

  let offset = headerLength;
  let json: GltfJson | undefined;
  let binaryChunk: Uint8Array | undefined;

  while (offset + 8 <= glbBytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;

    if (offset + chunkLength > glbBytes.byteLength) {
      throw new Error('GLB chunk length exceeds the payload length');
    }

    const chunkBytes = glbBytes.slice(offset, offset + chunkLength);
    if (chunkType === GLB_JSON_CHUNK) {
      json = JSON.parse(textDecoder.decode(chunkBytes).replace(/\0+$/u, '').trimEnd()) as GltfJson;
    } else if (chunkType === GLB_BIN_CHUNK && binaryChunk === undefined) {
      binaryChunk = chunkBytes;
    }

    offset += chunkLength;
  }

  if (!json) {
    throw new Error('GLB payload does not contain a JSON chunk');
  }

  return { json, binaryChunk };
};

const getBufferBytes = (
  buffer: GltfBuffer,
  sceneId: string,
  bufferIndex: number,
  options: GltfImportOptions,
  binaryChunk?: Uint8Array,
): Uint8Array => {
  if (!buffer.uri) {
    if (binaryChunk) {
      return binaryChunk.slice(0, buffer.byteLength);
    }

    throw new Error(
      `glTF buffer ${bufferIndex} in "${sceneId}" does not provide a uri and no GLB binary chunk was supplied`,
    );
  }

  if (buffer.uri.startsWith('data:')) {
    return decodeDataUri(buffer.uri);
  }

  const resource = resolveResource(buffer.uri, options);
  if (!resource.bytes) {
    throw new Error(
      `glTF buffer ${bufferIndex} in "${sceneId}" uses external uri "${resource.uri}" without provided bytes`,
    );
  }

  return resource.bytes;
};

const getImageResource = (
  image: GltfImage,
  buffers: readonly Uint8Array[],
  bufferViews: readonly GltfBufferView[],
  options: GltfImportOptions,
  sceneId: string,
  imageIndex: number,
): ResolvedResource => {
  if (image.uri) {
    if (image.uri.startsWith('data:')) {
      return {
        uri: image.uri,
        bytes: decodeDataUri(image.uri),
      };
    }

    return resolveResource(image.uri, options);
  }

  if (image.bufferView === undefined) {
    return { uri: `${sceneId}-image-${imageIndex}` };
  }

  return {
    uri: `${sceneId}-image-${imageIndex}`,
    bytes: sliceBufferView(
      buffers,
      bufferViews,
      image.bufferView,
      `glTF image ${imageIndex}`,
    ),
  };
};

const readComponent = (
  view: DataView,
  offset: number,
  componentType: GltfComponentType,
): number => {
  switch (componentType) {
    case 5120:
      return view.getInt8(offset);
    case 5121:
      return view.getUint8(offset);
    case 5122:
      return view.getInt16(offset, true);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
  }
};

const readAccessorValues = (
  json: GltfJson,
  buffers: readonly Uint8Array[],
  accessorIndex: number,
): number[] => {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) {
    throw new Error(`glTF accessor ${accessorIndex} does not exist`);
  }

  if (accessor.bufferView === undefined) {
    return [];
  }

  const bufferView = json.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    throw new Error(
      `glTF accessor ${accessorIndex} references missing bufferView ${accessor.bufferView}`,
    );
  }

  const source = buffers[bufferView.buffer];
  if (!source) {
    throw new Error(
      `glTF accessor ${accessorIndex} references missing buffer ${bufferView.buffer}`,
    );
  }

  const itemSize = accessorItemSize(accessor.type);
  const componentSize = componentByteSize(accessor.componentType);
  const stride = bufferView.byteStride ?? (itemSize * componentSize);
  const startOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const values: number[] = [];

  for (let itemIndex = 0; itemIndex < accessor.count; itemIndex += 1) {
    const itemOffset = startOffset + (itemIndex * stride);
    for (let componentIndex = 0; componentIndex < itemSize; componentIndex += 1) {
      const componentOffset = itemOffset + (componentIndex * componentSize);
      values.push(readComponent(view, componentOffset, accessor.componentType));
    }
  }

  return values;
};

const readNumericArray = (
  value: number | readonly number[] | undefined,
  json: GltfJson,
  buffers: readonly Uint8Array[],
): number[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return readAccessorValues(json, buffers, value);
  }

  return [...value];
};

const getNodeIds = (sceneId: string, nodes: readonly GltfNode[]): string[] =>
  nodes.map((_, nodeIndex) => `${sceneId}-node-${nodeIndex}`);

const buildParentIds = (sceneId: string, nodes: readonly GltfNode[]): Map<number, string> => {
  const nodeIds = getNodeIds(sceneId, nodes);
  const parentIds = new Map<number, string>();

  nodes.forEach((node, parentIndex) => {
    for (const childIndex of node.children ?? []) {
      parentIds.set(childIndex, nodeIds[parentIndex]);
    }
  });

  return parentIds;
};

const createTransform = (node: GltfNode) => ({
  translation: createVec3(...(node.translation ?? [0, 0, 0])),
  rotation: {
    x: node.rotation?.[0] ?? 0,
    y: node.rotation?.[1] ?? 0,
    z: node.rotation?.[2] ?? 0,
    w: node.rotation?.[3] ?? 1,
  },
  scale: createVec3(...(node.scale ?? [1, 1, 1])),
});

const toVec4 = (value: readonly number[]): Vec4 => ({
  x: value[0] ?? 0,
  y: value[1] ?? 0,
  z: value[2] ?? 0,
  w: value[3] ?? 0,
});

const createTextureRefs = (
  sceneId: string,
  json: GltfJson,
  buffers: readonly Uint8Array[],
  options: GltfImportOptions,
): { assets: AssetRef[]; textures: TextureRef[]; imageAssets: Map<string, ImageAsset> } => {
  const assets: AssetRef[] = [];
  const textures: TextureRef[] = [];
  const imageAssets = new Map<string, ImageAsset>();
  const inferredTextureUsage = new Map<number, Pick<TextureRef, 'semantic' | 'colorSpace'>>();

  json.materials?.forEach((material) => {
    const registerUsage = (
      textureIndex: number | undefined,
      semantic: TextureRef['semantic'],
      colorSpace: TextureRef['colorSpace'],
    ) => {
      if (textureIndex === undefined || inferredTextureUsage.has(textureIndex)) {
        return;
      }
      inferredTextureUsage.set(textureIndex, { semantic, colorSpace });
    };

    registerUsage(material.pbrMetallicRoughness?.baseColorTexture?.index, 'baseColor', 'srgb');
    registerUsage(
      material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
      'metallicRoughness',
      'linear',
    );
    registerUsage(material.normalTexture?.index, 'normal', 'linear');
    registerUsage(material.occlusionTexture?.index, 'occlusion', 'linear');
    registerUsage(material.emissiveTexture?.index, 'emissive', 'srgb');
  });

  json.textures?.forEach((texture, textureIndex) => {
    const imageIndex = texture.source;
    const image = imageIndex === undefined ? undefined : json.images?.[imageIndex];
    const textureId = `${sceneId}-texture-${textureIndex}`;
    let assetId: string | undefined;
    let inlineImageSource: TextureRef['source'] | undefined;

    if (imageIndex !== undefined && image) {
      const resource = getImageResource(
        image,
        buffers,
        json.bufferViews ?? [],
        options,
        sceneId,
        imageIndex,
      );
      const isExternalImage = Boolean(image.uri && !image.uri.startsWith('data:'));
      const shouldInlineImage = Boolean(
        resource.bytes &&
          (!image.uri || image.uri.startsWith('data:') || options.inlineExternalAssets),
      );

      if (shouldInlineImage && resource.bytes) {
        inlineImageSource = createInlineTextureSource({
          mimeType: image.mimeType ?? inferMimeTypeFromUri(resource.uri) ??
            'application/octet-stream',
          bytes: [...resource.bytes],
        });
      }

      if (!shouldInlineImage || !isExternalImage) {
        assetId = `${sceneId}-image-${imageIndex}`;
      }

      if (assetId && !assets.some((asset) => asset.id === assetId)) {
        assets.push({
          id: assetId,
          uri: image.uri ? resource.uri : undefined,
          mimeType: image.mimeType ?? inferDataUriMimeType(image.uri ?? '') ??
            inferMimeTypeFromUri(resource.uri) ??
            (resource.bytes ? 'application/octet-stream' : undefined),
        });
        if (resource.bytes) {
          imageAssets.set(assetId, {
            id: assetId,
            mimeType: image.mimeType ?? inferDataUriMimeType(image.uri ?? '') ??
              inferMimeTypeFromUri(resource.uri) ??
              'application/octet-stream',
            bytes: resource.bytes,
          });
        }
      }
    }

    const usage = inferredTextureUsage.get(textureIndex) ?? {
      semantic: 'baseColor' as const,
      colorSpace: 'srgb' as const,
    };
    textures.push({
      id: textureId,
      assetId,
      source: inlineImageSource ?? (assetId ? createAssetTextureSource(assetId) : undefined),
      semantic: usage.semantic,
      colorSpace: usage.colorSpace,
      sampler: 'linear-repeat',
    });
  });

  return { assets, textures, imageAssets };
};

const createMaterials = (
  sceneId: string,
  json: GltfJson,
  sceneTextures: readonly TextureRef[],
): Material[] =>
  (json.materials ?? []).map((material, materialIndex) => {
    const baseColor = material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    const emissiveFactor = material.emissiveFactor ?? [0, 0, 0];
    const metallicFactor = material.pbrMetallicRoughness?.metallicFactor ?? 1;
    const roughnessFactor = material.pbrMetallicRoughness?.roughnessFactor ?? 1;
    const normalScale = material.normalTexture?.scale ?? 1;
    const occlusionStrength = material.occlusionTexture?.strength ?? 1;
    const toMaterialTexture = (
      textureIndex: number | undefined,
      semantic: string,
      colorSpace: string,
    ): TextureRef[] => {
      if (textureIndex === undefined) {
        return [];
      }

      const sceneTexture = sceneTextures.find((texture) =>
        texture.id === `${sceneId}-texture-${textureIndex}`
      );
      if (!sceneTexture) {
        return [];
      }

      return [{
        ...sceneTexture,
        semantic,
        colorSpace,
      }];
    };
    const textures: TextureRef[] = [
      ...toMaterialTexture(
        material.pbrMetallicRoughness?.baseColorTexture?.index,
        'baseColor',
        'srgb',
      ),
      ...toMaterialTexture(
        material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
        'metallicRoughness',
        'linear',
      ),
      ...toMaterialTexture(material.normalTexture?.index, 'normal', 'linear'),
      ...toMaterialTexture(material.occlusionTexture?.index, 'occlusion', 'linear'),
      ...toMaterialTexture(material.emissiveTexture?.index, 'emissive', 'srgb'),
    ];

    return {
      id: `${sceneId}-material-${materialIndex}`,
      kind: 'unlit',
      alphaMode: material.alphaMode?.toLowerCase(),
      alphaCutoff: material.alphaMode === 'MASK' ? material.alphaCutoff ?? 0.5 : undefined,
      doubleSided: material.doubleSided,
      renderQueue: material.alphaMode === 'BLEND' ? 'transparent' : 'opaque',
      textures,
      parameters: {
        color: toVec4(baseColor),
        emissive: {
          x: emissiveFactor[0] ?? 0,
          y: emissiveFactor[1] ?? 0,
          z: emissiveFactor[2] ?? 0,
          w: 1,
        },
        metallicRoughness: {
          x: metallicFactor,
          y: roughnessFactor,
          z: occlusionStrength,
          w: normalScale,
        },
      },
    };
  });

const createMeshAttributes = (
  primitive: GltfPrimitive,
  json: GltfJson,
  buffers: readonly Uint8Array[],
): MeshAttribute[] =>
  Object.entries(primitive.attributes ?? {}).map(([semantic, source]) => {
    const values = readNumericArray(source, json, buffers) ?? [];
    const itemSize = typeof source === 'number'
      ? accessorItemSize(json.accessors?.[source]?.type ?? 'SCALAR')
      : semantic === 'POSITION'
      ? 3
      : semantic === 'TEXCOORD_0'
      ? 2
      : 4;

    return {
      semantic,
      itemSize,
      values,
    };
  });

const createMeshPrimitiveIds = (sceneId: string, json: GltfJson): readonly string[][] =>
  (json.meshes ?? []).map((mesh, meshIndex) =>
    mesh.primitives.map((_, primitiveIndex) => `${sceneId}-mesh-${meshIndex}-${primitiveIndex}`)
  );

const getDefaultRootIndices = (json: GltfJson): number[] => {
  const sceneIndex = json.scene ?? 0;
  return [...(json.scenes?.[sceneIndex]?.nodes ?? [])];
};

const createAnimationClips = (
  sceneId: string,
  json: GltfJson,
  buffers: readonly Uint8Array[],
): AnimationClip[] =>
  (json.animations ?? []).map((animation, animationIndex) => {
    const channels: AnimationChannel[] = animation.channels.map((channel) => {
      const targetNode = channel.target?.node ?? channel.node ?? 0;
      const property = channel.target?.path ?? channel.path ?? 'translation';
      const sampler = channel.sampler === undefined
        ? undefined
        : animation.samplers?.[channel.sampler];
      const times = sampler
        ? readAccessorValues(json, buffers, sampler.input)
        : [...(channel.times ?? [])];
      const rawValues = sampler
        ? readAccessorValues(json, buffers, sampler.output)
        : (channel.values ?? []).flatMap((value) => [...value]);
      const outputAccessor = sampler ? json.accessors?.[sampler.output] : undefined;
      const itemSize = outputAccessor ? accessorItemSize(outputAccessor.type) : 4;
      const keyframes: AnimationKeyframe[] = times.map((time, keyframeIndex) => {
        const offset = keyframeIndex * itemSize;
        return {
          timeMs: time * 1000,
          value: toVec4(rawValues.slice(offset, offset + itemSize)),
        };
      });

      return {
        nodeId: `${sceneId}-node-${targetNode}`,
        property,
        keyframes,
      };
    });

    const durationMs = channels.reduce((duration, channel) => {
      const lastKeyframe = channel.keyframes.at(-1);
      return Math.max(duration, lastKeyframe?.timeMs ?? 0);
    }, 0);

    return {
      id: `${sceneId}-animation-${animationIndex}`,
      name: animation.name,
      durationMs,
      channels,
    };
  });

const importGltfSceneWithAssets = (
  json: GltfJson,
  sceneId: string,
  options: GltfImportOptions,
  binaryChunk?: Uint8Array,
): Readonly<{ scene: SceneIr; assetSource: AssetSource }> => {
  const nodes = json.nodes ?? [];
  const buffers = (json.buffers ?? []).map((buffer, bufferIndex) =>
    getBufferBytes(buffer, sceneId, bufferIndex, options, binaryChunk)
  );
  const parentIds = buildParentIds(sceneId, nodes);
  const { assets, textures, imageAssets } = createTextureRefs(sceneId, json, buffers, options);
  const materials = createMaterials(sceneId, json, textures);
  const rootNodeIds = getDefaultRootIndices(json).map((nodeIndex) =>
    `${sceneId}-node-${nodeIndex}`
  );
  const meshPrimitiveIds = createMeshPrimitiveIds(sceneId, json);
  let scene = createSceneIr(sceneId);

  for (const asset of assets) {
    scene = {
      ...scene,
      assets: [...scene.assets, asset],
    };
  }

  for (const texture of textures) {
    scene = appendTexture(scene, texture);
  }

  for (const material of materials) {
    scene = appendMaterial(scene, material);
  }

  json.meshes?.forEach((mesh, meshIndex) => {
    mesh.primitives.forEach((primitive, primitiveIndex) => {
      const meshId = `${sceneId}-mesh-${meshIndex}-${primitiveIndex}`;
      const attributes = createMeshAttributes(primitive, json, buffers);
      const indices = readNumericArray(primitive.indices, json, buffers);
      scene = appendMesh(scene, {
        id: meshId,
        attributes,
        indices,
        source: createInlineMeshSource(attributes, indices),
        materialId: primitive.material === undefined
          ? undefined
          : `${sceneId}-material-${primitive.material}`,
      });
    });
  });

  nodes.forEach((node, nodeIndex) => {
    const nodeId = `${sceneId}-node-${nodeIndex}`;
    const primitiveIds = node.mesh === undefined ? [] : [...(meshPrimitiveIds[node.mesh] ?? [])];
    scene = appendNode(
      scene,
      createNode(nodeId, {
        name: node.name,
        parentId: parentIds.get(nodeIndex),
        meshId: primitiveIds[0],
        transform: nodes[nodeIndex] ? createTransform(nodes[nodeIndex]) : identityTransform(),
      }),
    );

    primitiveIds.slice(1).forEach((meshId, primitiveIndex) => {
      scene = appendNode(
        scene,
        createNode(`${nodeId}-primitive-${primitiveIndex + 1}`, {
          parentId: nodeId,
          meshId,
          transform: identityTransform(),
        }),
      );
    });
  });

  scene = {
    ...scene,
    rootNodeIds: rootNodeIds.length > 0 ? rootNodeIds : scene.rootNodeIds,
  };

  for (const clip of createAnimationClips(sceneId, json, buffers)) {
    scene = appendAnimationClip(scene, clip);
  }

  return {
    scene,
    assetSource: {
      images: imageAssets,
    },
  };
};

const importGltfScene = (
  json: GltfJson,
  sceneId: string,
  options: GltfImportOptions,
  binaryChunk?: Uint8Array,
): SceneIr => importGltfSceneWithAssets(json, sceneId, options, binaryChunk).scene;

export const importGltfFromJson = (
  json: GltfJson,
  sceneId = 'gltf-scene',
  options: GltfImportOptions = {},
): SceneIr => importGltfScene(json, sceneId, options);

export const listExternalGltfResourceUris = (
  json: GltfJson,
  options: GltfExternalResourceOptions = {},
): string[] => collectExternalResourceUris(json, options);

export const fetchGltfExternalResources = async (
  json: GltfJson,
  options: GltfFetchExternalResourceOptions = {},
): Promise<Record<string, Uint8Array>> => {
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error('fetchGltfExternalResources requires a fetch implementation');
  }

  const resources = await Promise.all(
    collectExternalResourceUris(json, options).map(async (uri) =>
      [uri, await fetchExternalResource(uri, fetchFn)] as const
    ),
  );

  return Object.fromEntries(resources);
};

export const readDenoGltfExternalResources = async (
  json: GltfJson,
  options: GltfDenoExternalResourceOptions = {},
): Promise<Record<string, Uint8Array>> => {
  const readFile = options.readFile ?? Deno.readFile;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const resources = await Promise.all(
    collectExternalResourceUris(json, options).map(async (uri) => {
      const parsedUrl = tryParseUrl(uri);
      if (parsedUrl?.protocol === 'http:' || parsedUrl?.protocol === 'https:') {
        if (!fetchFn) {
          throw new Error(`readDenoGltfExternalResources requires fetch for "${uri}"`);
        }

        return [uri, await fetchExternalResource(uri, fetchFn)] as const;
      }

      return [uri, await readFile(resolveDenoReadTarget(uri, options))] as const;
    }),
  );

  return Object.fromEntries(resources);
};

export const importGltfFromGlb = (
  glbBytes: Uint8Array,
  sceneId = 'gltf-scene',
  options: GltfImportOptions = {},
): SceneIr => {
  const { json, binaryChunk } = parseGlb(glbBytes);
  return importGltfScene(json, sceneId, options, binaryChunk);
};

export const importGltfFromGlbWithAssets = (
  glbBytes: Uint8Array,
  sceneId = 'gltf-scene',
  options: GltfImportOptions = {},
): Readonly<{ scene: SceneIr; assetSource: AssetSource }> => {
  const { json, binaryChunk } = parseGlb(glbBytes);
  return importGltfSceneWithAssets(json, sceneId, options, binaryChunk);
};
