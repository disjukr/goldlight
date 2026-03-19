import type { EvaluatedScene } from '@rieul3d/core';
import type { Material, MeshAttribute, MeshPrimitive, SceneIr } from '@rieul3d/ir';

export type ImageAsset = Readonly<{
  id: string;
  mimeType: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  pixelFormat?: GPUTextureFormat;
  bytesPerRow?: number;
  rowsPerImage?: number;
}>;

export type VolumeAsset = Readonly<{
  id: string;
  mimeType: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  depth: number;
  pixelFormat?: GPUTextureFormat;
  bytesPerRow?: number;
  rowsPerImage?: number;
}>;

export type AssetSource = Readonly<{
  images: ReadonlyMap<string, ImageAsset>;
  volumes: ReadonlyMap<string, VolumeAsset>;
}>;

export type TextureResidency = Readonly<{
  textureId: string;
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
  width: number;
  height: number;
  format: GPUTextureFormat;
}>;

export type GeometryResidency = Readonly<{
  meshId: string;
  attributeBuffers: Readonly<Record<string, GPUBuffer>>;
  indexBuffer?: GPUBuffer;
  vertexCount: number;
  indexCount: number;
}>;

export type MaterialResidency = Readonly<{
  materialId: string;
  parameterNames: readonly string[];
  uniformData: Float32Array;
  uniformBuffer: GPUBuffer;
  alphaPolicyData: Float32Array;
  alphaPolicyBuffer: GPUBuffer;
}>;

export type VolumeResidency = Readonly<{
  volumeId: string;
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
  width: number;
  height: number;
  depth: number;
  format: GPUTextureFormat;
}>;

export type RuntimeResidency = {
  readonly textures: Map<string, TextureResidency>;
  readonly geometry: Map<string, GeometryResidency>;
  readonly materials: Map<string, MaterialResidency>;
  readonly volumes: Map<string, VolumeResidency>;
  readonly pipelines: Map<string, GPURenderPipeline | GPUComputePipeline>;
};

export type ResidencyInvalidationPlan = Readonly<{
  meshIds?: readonly string[];
  materialIds?: readonly string[];
  textureIds?: readonly string[];
  volumeIds?: readonly string[];
  pipelineKeys?: readonly string[];
}>;

export type RuntimeResidencyAdapterPlan = Readonly<{
  reset: boolean;
  meshIds?: readonly string[];
  materialIds?: readonly string[];
  textureIds?: readonly string[];
  volumeIds?: readonly string[];
  pipelineKeys?: readonly string[];
}>;

export const createRuntimeResidency = (): RuntimeResidency => ({
  textures: new Map(),
  geometry: new Map(),
  materials: new Map(),
  volumes: new Map(),
  pipelines: new Map(),
});

export const describeResidencyInputs = (
  scene: SceneIr,
  evaluatedScene: EvaluatedScene,
): Readonly<{
  meshCount: number;
  textureCount: number;
  nodeCount: number;
}> => ({
  meshCount: scene.meshes.length,
  textureCount: scene.textures.length,
  nodeCount: evaluatedScene.nodes.length,
});

const destroyGeometryResidency = (geometry: GeometryResidency): void => {
  for (const buffer of Object.values(geometry.attributeBuffers)) {
    buffer.destroy?.();
  }

  geometry.indexBuffer?.destroy?.();
};

const destroyMaterialResidency = (material: MaterialResidency): void => {
  material.uniformBuffer.destroy?.();
  material.alphaPolicyBuffer.destroy?.();
};

const destroyTextureResidency = (texture: TextureResidency): void => {
  texture.texture.destroy?.();
};

const destroyVolumeResidency = (volume: VolumeResidency): void => {
  volume.texture.destroy?.();
};

const deleteResidencyEntries = <TEntry>(
  cache: Map<string, TEntry>,
  ids: readonly string[] | undefined,
  destroyEntry: (entry: TEntry) => void,
): void => {
  for (const id of ids ?? []) {
    const cached = cache.get(id);
    if (!cached) {
      continue;
    }

    destroyEntry(cached);
    cache.delete(id);
  }
};

export const invalidateResidencyResources = (
  residency: RuntimeResidency,
  plan: ResidencyInvalidationPlan,
): RuntimeResidency => {
  deleteResidencyEntries(residency.geometry, plan.meshIds, destroyGeometryResidency);
  deleteResidencyEntries(residency.materials, plan.materialIds, destroyMaterialResidency);
  deleteResidencyEntries(residency.textures, plan.textureIds, destroyTextureResidency);
  deleteResidencyEntries(residency.volumes, plan.volumeIds, destroyVolumeResidency);

  for (const pipelineKey of plan.pipelineKeys ?? []) {
    residency.pipelines.delete(pipelineKey);
  }

  return residency;
};

export const invalidateResidency = (residency: RuntimeResidency): RuntimeResidency => {
  invalidateResidencyResources(residency, {
    meshIds: [...residency.geometry.keys()],
    materialIds: [...residency.materials.keys()],
    textureIds: [...residency.textures.keys()],
    volumeIds: [...residency.volumes.keys()],
    pipelineKeys: [...residency.pipelines.keys()],
  });
  return residency;
};

export const applyRuntimeResidencyPlan = (
  residency: RuntimeResidency,
  plan: RuntimeResidencyAdapterPlan,
): RuntimeResidency => {
  if (plan.reset) {
    return invalidateResidency(residency);
  }

  return invalidateResidencyResources(residency, {
    meshIds: plan.meshIds,
    materialIds: plan.materialIds,
    textureIds: plan.textureIds,
    volumeIds: plan.volumeIds,
    pipelineKeys: plan.pipelineKeys,
  });
};

export type GpuUploadContext = Readonly<{
  device: Pick<GPUDevice, 'createBuffer'>;
  queue: Pick<GPUQueue, 'writeBuffer'>;
}>;

export type GpuTextureUploadContext = Readonly<{
  device: Pick<GPUDevice, 'createSampler' | 'createTexture'>;
  queue: Pick<GPUQueue, 'writeTexture'>;
}>;

export type RuntimeResidencyRebuildContext = GpuUploadContext & GpuTextureUploadContext;

export type MaterialUploadPlan = Readonly<{
  materialId: string;
  parameterNames: readonly string[];
  uniformData: Float32Array;
  byteLength: number;
}>;

export type MeshBufferLayout = Readonly<{
  semantic: string;
  itemSize: number;
  vertexCount: number;
  byteLength: number;
}>;

export type MeshUploadPlan = Readonly<{
  meshId: string;
  attributes: readonly MeshBufferLayout[];
  hasIndices: boolean;
  indexCount: number;
}>;

const vertexUsage = 0x20;
const indexUsage = 0x10;
const uniformUsage = 0x40;
const textureBindingUsage = 0x04;
const bufferCopyDstUsage = 0x08;
const textureCopyDstUsage = 0x02;
const materialParameterSlots = 16;
const floatsPerVec4 = 4;
const defaultMaterialColor = [0.95, 0.95, 0.95, 1] as const;
const materialAlphaPolicySlot = 1;
const materialReservedParameterNames = new Set(['color']);

const encodeMaterialAlphaMode = (material: Material): number => {
  switch (material.alphaMode) {
    case 'mask':
      return 1;
    case 'blend':
      return 2;
    case 'opaque':
    default:
      return 0;
  }
};

const resolveMaterialAlphaPolicy = (
  material: Material,
): Readonly<{
  alphaCutoff: number;
  alphaMode: number;
  depthWrite: number;
  doubleSided: number;
}> => {
  const alphaMode = material.alphaMode === 'mask' || material.alphaMode === 'blend'
    ? material.alphaMode
    : 'opaque';
  const depthWrite = material.depthWrite ?? (alphaMode !== 'blend');

  return {
    alphaCutoff: material.alphaCutoff ?? 0.5,
    alphaMode: encodeMaterialAlphaMode({ ...material, alphaMode }),
    depthWrite: depthWrite ? 1 : 0,
    doubleSided: material.doubleSided ? 1 : 0,
  };
};

const createAttributeArray = (attribute: MeshAttribute): Float32Array =>
  Float32Array.from(attribute.values);

const createIndexArray = (indices: readonly number[]): Uint32Array => Uint32Array.from(indices);

const toBufferSource = (view: ArrayBufferView): Uint8Array<ArrayBuffer> => {
  const buffer = view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(buffer);
};

const getVertexCount = (attribute: MeshAttribute): number =>
  attribute.itemSize > 0 ? Math.floor(attribute.values.length / attribute.itemSize) : 0;

export const createMeshUploadPlan = (mesh: MeshPrimitive): MeshUploadPlan => ({
  meshId: mesh.id,
  attributes: mesh.attributes.map((attribute) => ({
    semantic: attribute.semantic,
    itemSize: attribute.itemSize,
    vertexCount: getVertexCount(attribute),
    byteLength: createAttributeArray(attribute).byteLength,
  })),
  hasIndices: Boolean(mesh.indices && mesh.indices.length > 0),
  indexCount: mesh.indices?.length ?? 0,
});

export const uploadMeshResidency = (
  context: GpuUploadContext,
  mesh: MeshPrimitive,
): GeometryResidency => {
  const attributeBuffers: Record<string, GPUBuffer> = {};

  for (const attribute of mesh.attributes) {
    const data = createAttributeArray(attribute);
    const buffer = context.device.createBuffer({
      label: `${mesh.id}:${attribute.semantic}`,
      size: data.byteLength,
      usage: vertexUsage | bufferCopyDstUsage,
    });
    context.queue.writeBuffer(buffer, 0, toBufferSource(data));
    attributeBuffers[attribute.semantic] = buffer;
  }

  let indexBuffer: GPUBuffer | undefined;
  if (mesh.indices && mesh.indices.length > 0) {
    const indexData = createIndexArray(mesh.indices);
    indexBuffer = context.device.createBuffer({
      label: `${mesh.id}:indices`,
      size: indexData.byteLength,
      usage: indexUsage | bufferCopyDstUsage,
    });
    context.queue.writeBuffer(indexBuffer, 0, toBufferSource(indexData));
  }

  return {
    meshId: mesh.id,
    attributeBuffers,
    indexBuffer,
    vertexCount: mesh.attributes[0] ? getVertexCount(mesh.attributes[0]) : 0,
    indexCount: mesh.indices?.length ?? 0,
  };
};

export const ensureMeshResidency = (
  context: GpuUploadContext,
  residency: RuntimeResidency,
  mesh: MeshPrimitive,
): GeometryResidency => {
  const cached = residency.geometry.get(mesh.id);
  if (cached) {
    return cached;
  }

  const uploaded = uploadMeshResidency(context, mesh);
  residency.geometry.set(mesh.id, uploaded);
  return uploaded;
};

export const ensureSceneMeshResidency = (
  context: GpuUploadContext,
  residency: RuntimeResidency,
  scene: SceneIr,
  evaluatedScene: EvaluatedScene,
): RuntimeResidency => {
  const meshIds = new Set(
    evaluatedScene.nodes
      .map((node) => node.mesh?.id)
      .filter((meshId): meshId is string => Boolean(meshId)),
  );

  for (const mesh of scene.meshes) {
    if (!meshIds.has(mesh.id)) {
      continue;
    }

    ensureMeshResidency(context, residency, mesh);
  }

  return residency;
};

const getMaterialParameterNames = (material: Material): readonly string[] => {
  const names = Object.keys(material.parameters).filter((name) =>
    !materialReservedParameterNames.has(name)
  ).sort();
  return material.parameters.color ? ['color', ...names] : names;
};

export const createMaterialUploadPlan = (material: Material): MaterialUploadPlan => {
  const customParameterLimit = Math.max(materialParameterSlots - 1, 0);
  const parameterNames = getMaterialParameterNames(material).slice(0, customParameterLimit);
  const uniformData = new Float32Array(materialParameterSlots * floatsPerVec4);

  if (parameterNames.length === 0) {
    uniformData.set(defaultMaterialColor, 0);
  }

  uniformData.set(
    [
      material.alphaCutoff ?? 0.5,
      encodeMaterialAlphaMode(material),
      material.depthWrite === false ? 0 : 1,
      material.doubleSided ? 1 : 0,
    ],
    materialAlphaPolicySlot * floatsPerVec4,
  );

  for (let index = 0; index < parameterNames.length; index += 1) {
    const value = material.parameters[parameterNames[index]];
    const targetIndex = index >= materialAlphaPolicySlot ? index + 1 : index;
    uniformData.set([value.x, value.y, value.z, value.w], targetIndex * floatsPerVec4);
  }

  return {
    materialId: material.id,
    parameterNames,
    uniformData,
    byteLength: uniformData.byteLength,
  };
};

export const createMaterialAlphaPolicyData = (material: Material): Float32Array =>
  new Float32Array(Object.values(resolveMaterialAlphaPolicy(material)));

export const uploadMaterialResidency = (
  context: GpuUploadContext,
  material: Material,
): MaterialResidency => {
  const plan = createMaterialUploadPlan(material);
  const alphaPolicyData = createMaterialAlphaPolicyData(material);
  const uniformBuffer = context.device.createBuffer({
    label: `${material.id}:uniforms`,
    size: plan.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  const alphaPolicyBuffer = context.device.createBuffer({
    label: `${material.id}:alpha-policy`,
    size: alphaPolicyData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(plan.uniformData));
  context.queue.writeBuffer(alphaPolicyBuffer, 0, toBufferSource(alphaPolicyData));

  return {
    materialId: material.id,
    parameterNames: plan.parameterNames,
    uniformData: plan.uniformData,
    uniformBuffer,
    alphaPolicyData,
    alphaPolicyBuffer,
  };
};

export const ensureMaterialResidency = (
  context: GpuUploadContext,
  residency: RuntimeResidency,
  material: Material,
): MaterialResidency => {
  const cached = residency.materials.get(material.id);
  if (cached) {
    return cached;
  }

  const uploaded = uploadMaterialResidency(context, material);
  residency.materials.set(material.id, uploaded);
  return uploaded;
};

export const ensureSceneMaterialResidency = (
  context: GpuUploadContext,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
): RuntimeResidency => {
  for (const node of evaluatedScene.nodes) {
    if (!node.material) {
      continue;
    }

    ensureMaterialResidency(context, residency, node.material);
  }

  return residency;
};

export type TextureUploadPlan = Readonly<{
  textureId: string;
  width: number;
  height: number;
  format: GPUTextureFormat;
  bytesPerRow: number;
  rowsPerImage: number;
}>;

export type VolumeUploadPlan = Readonly<{
  volumeId: string;
  width: number;
  height: number;
  depth: number;
  format: GPUTextureFormat;
  bytesPerRow: number;
  rowsPerImage: number;
}>;

export const resolveTextureImageAsset = (
  assetSource: AssetSource,
  textureRef: SceneIr['textures'][number],
): ImageAsset | undefined => {
  if (!textureRef.assetId) {
    return undefined;
  }

  return assetSource.images.get(textureRef.assetId);
};

export const createTextureUploadPlan = (
  textureRef: SceneIr['textures'][number],
  imageAsset: ImageAsset,
): TextureUploadPlan => {
  if (!imageAsset.width || !imageAsset.height) {
    throw new Error(`texture asset "${imageAsset.id}" is missing width/height`);
  }

  return {
    textureId: textureRef.id,
    width: imageAsset.width,
    height: imageAsset.height,
    format: imageAsset.pixelFormat ?? 'rgba8unorm',
    bytesPerRow: imageAsset.bytesPerRow ?? imageAsset.width * 4,
    rowsPerImage: imageAsset.rowsPerImage ?? imageAsset.height,
  };
};

const createSamplerDescriptor = (
  textureRef: SceneIr['textures'][number],
): GPUSamplerDescriptor => {
  switch (textureRef.sampler) {
    case 'nearest-clamp':
      return {
        magFilter: 'nearest',
        minFilter: 'nearest',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      };
    case 'linear-clamp':
      return {
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      };
    case 'nearest-repeat':
      return {
        magFilter: 'nearest',
        minFilter: 'nearest',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
      };
    case 'linear-repeat':
    default:
      return {
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
      };
  }
};

export const uploadTextureResidency = (
  context: GpuTextureUploadContext,
  textureRef: SceneIr['textures'][number],
  imageAsset: ImageAsset,
): TextureResidency => {
  const plan = createTextureUploadPlan(textureRef, imageAsset);
  const texture = context.device.createTexture({
    label: textureRef.id,
    size: { width: plan.width, height: plan.height, depthOrArrayLayers: 1 },
    format: plan.format,
    usage: textureBindingUsage | textureCopyDstUsage,
  });

  context.queue.writeTexture(
    { texture },
    toBufferSource(imageAsset.bytes),
    {
      offset: 0,
      bytesPerRow: plan.bytesPerRow,
      rowsPerImage: plan.rowsPerImage,
    },
    {
      width: plan.width,
      height: plan.height,
      depthOrArrayLayers: 1,
    },
  );

  return {
    textureId: textureRef.id,
    texture,
    view: texture.createView(),
    sampler: context.device.createSampler(createSamplerDescriptor(textureRef)),
    width: plan.width,
    height: plan.height,
    format: plan.format,
  };
};

export const ensureTextureResidency = (
  context: GpuTextureUploadContext,
  residency: RuntimeResidency,
  assetSource: AssetSource,
  textureRef: SceneIr['textures'][number],
): TextureResidency => {
  const cached = residency.textures.get(textureRef.id);
  if (cached) {
    return cached;
  }

  const imageAsset = resolveTextureImageAsset(assetSource, textureRef);
  if (!imageAsset) {
    throw new Error(`texture "${textureRef.id}" references missing asset "${textureRef.assetId}"`);
  }

  const uploaded = uploadTextureResidency(context, textureRef, imageAsset);
  residency.textures.set(textureRef.id, uploaded);
  return uploaded;
};

export const ensureSceneTextureResidency = (
  context: GpuTextureUploadContext,
  residency: RuntimeResidency,
  scene: SceneIr,
  assetSource: AssetSource,
): RuntimeResidency => {
  for (const textureRef of scene.textures) {
    if (!textureRef.assetId) {
      continue;
    }

    ensureTextureResidency(context, residency, assetSource, textureRef);
  }

  return residency;
};

export const resolveVolumeAsset = (
  assetSource: AssetSource,
  volumePrimitive: SceneIr['volumePrimitives'][number],
): VolumeAsset | undefined => {
  if (!volumePrimitive.assetId) {
    return undefined;
  }

  return assetSource.volumes.get(volumePrimitive.assetId);
};

export const createVolumeUploadPlan = (
  volumePrimitive: SceneIr['volumePrimitives'][number],
  volumeAsset: VolumeAsset,
): VolumeUploadPlan => ({
  volumeId: volumePrimitive.id,
  width: volumeAsset.width,
  height: volumeAsset.height,
  depth: volumeAsset.depth,
  format: volumeAsset.pixelFormat ?? 'r8unorm',
  bytesPerRow: volumeAsset.bytesPerRow ?? volumeAsset.width,
  rowsPerImage: volumeAsset.rowsPerImage ?? volumeAsset.height,
});

export const uploadVolumeResidency = (
  context: GpuTextureUploadContext,
  volumePrimitive: SceneIr['volumePrimitives'][number],
  volumeAsset: VolumeAsset,
): VolumeResidency => {
  const plan = createVolumeUploadPlan(volumePrimitive, volumeAsset);
  const texture = context.device.createTexture({
    label: volumePrimitive.id,
    size: {
      width: plan.width,
      height: plan.height,
      depthOrArrayLayers: plan.depth,
    },
    dimension: '3d',
    format: plan.format,
    usage: textureBindingUsage | textureCopyDstUsage,
  });

  context.queue.writeTexture(
    { texture },
    toBufferSource(volumeAsset.bytes),
    {
      offset: 0,
      bytesPerRow: plan.bytesPerRow,
      rowsPerImage: plan.rowsPerImage,
    },
    {
      width: plan.width,
      height: plan.height,
      depthOrArrayLayers: plan.depth,
    },
  );

  return {
    volumeId: volumePrimitive.id,
    texture,
    view: texture.createView({ dimension: '3d' }),
    sampler: context.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    }),
    width: plan.width,
    height: plan.height,
    depth: plan.depth,
    format: plan.format,
  };
};

export const ensureVolumeResidency = (
  context: GpuTextureUploadContext,
  residency: RuntimeResidency,
  assetSource: AssetSource,
  volumePrimitive: SceneIr['volumePrimitives'][number],
): VolumeResidency => {
  const cached = residency.volumes.get(volumePrimitive.id);
  if (cached) {
    return cached;
  }

  const volumeAsset = resolveVolumeAsset(assetSource, volumePrimitive);
  if (!volumeAsset) {
    throw new Error(
      `volume "${volumePrimitive.id}" references missing asset "${volumePrimitive.assetId}"`,
    );
  }

  const uploaded = uploadVolumeResidency(context, volumePrimitive, volumeAsset);
  residency.volumes.set(volumePrimitive.id, uploaded);
  return uploaded;
};

export const ensureSceneVolumeResidency = (
  context: GpuTextureUploadContext,
  residency: RuntimeResidency,
  scene: SceneIr,
  assetSource: AssetSource,
): RuntimeResidency => {
  for (const volumePrimitive of scene.volumePrimitives) {
    if (!volumePrimitive.assetId) {
      continue;
    }

    ensureVolumeResidency(context, residency, assetSource, volumePrimitive);
  }

  return residency;
};

export const rebuildRuntimeResidency = (
  context: RuntimeResidencyRebuildContext,
  residency: RuntimeResidency,
  scene: SceneIr,
  evaluatedScene: EvaluatedScene,
  assetSource: AssetSource,
): RuntimeResidency => {
  invalidateResidency(residency);
  ensureSceneMeshResidency(context, residency, scene, evaluatedScene);
  ensureSceneMaterialResidency(context, residency, evaluatedScene);
  ensureSceneTextureResidency(context, residency, scene, assetSource);
  ensureSceneVolumeResidency(context, residency, scene, assetSource);
  return residency;
};
