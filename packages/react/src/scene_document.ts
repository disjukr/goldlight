import {
  appendAsset,
  appendCamera,
  appendLight,
  appendMaterial,
  appendMesh,
  appendNode,
  appendSdfPrimitive,
  appendTexture,
  appendVolumePrimitive,
  createNode,
  createSceneIr,
} from '@rieul3d/ir';
import type {
  AssetRef,
  Camera,
  Light,
  Material,
  MeshPrimitive,
  Node,
  SceneIr,
  SdfPrimitive,
  TextureRef,
  VolumePrimitive,
} from '@rieul3d/ir';

type SceneDocumentScene = {
  id: string;
  activeCameraId?: string;
};

export type SceneDocumentNodeInput = Readonly<{
  id: string;
  parentId?: string;
  index?: number;
  props?: Partial<Omit<Node, 'id' | 'parentId'>>;
}>;

export type SceneDocumentNodeInstance = {
  readonly kind: 'node';
  readonly id: string;
  parentId?: string;
  childIds: string[];
  props: Partial<Omit<Node, 'id' | 'parentId'>>;
};

type SceneDocumentResourceByKind = {
  asset: AssetRef;
  texture: TextureRef;
  material: Material;
  light: Light;
  mesh: MeshPrimitive;
  camera: Camera;
  sdf: SdfPrimitive;
  volume: VolumePrimitive;
};

export type SceneDocumentResourceKind = keyof SceneDocumentResourceByKind;

export type SceneDocumentResourceInput<TKind extends SceneDocumentResourceKind> = Readonly<{
  kind: TKind;
  value: SceneDocumentResourceByKind[TKind];
}>;

export type SceneDocumentResourceInstance<TKind extends SceneDocumentResourceKind> = {
  readonly kind: TKind;
  readonly id: string;
  value: SceneDocumentResourceByKind[TKind];
};

type SceneDocumentResourceCollection<TKind extends SceneDocumentResourceKind> = {
  order: string[];
  byId: Map<string, SceneDocumentResourceInstance<TKind>>;
};

type SceneDocumentNodeCollection = {
  order: string[];
  rootNodeIds: string[];
  byId: Map<string, SceneDocumentNodeInstance>;
};

export type SceneDocument = {
  scene: SceneDocumentScene;
  assets: SceneDocumentResourceCollection<'asset'>;
  textures: SceneDocumentResourceCollection<'texture'>;
  materials: SceneDocumentResourceCollection<'material'>;
  lights: SceneDocumentResourceCollection<'light'>;
  meshes: SceneDocumentResourceCollection<'mesh'>;
  cameras: SceneDocumentResourceCollection<'camera'>;
  sdfs: SceneDocumentResourceCollection<'sdf'>;
  volumes: SceneDocumentResourceCollection<'volume'>;
  nodes: SceneDocumentNodeCollection;
};

const createResourceCollection = <
  TKind extends SceneDocumentResourceKind,
>(): SceneDocumentResourceCollection<TKind> => ({
  order: [],
  byId: new Map<string, SceneDocumentResourceInstance<TKind>>(),
});

const removeOrderedId = (orderedIds: string[], id: string): void => {
  const index = orderedIds.indexOf(id);
  if (index >= 0) {
    orderedIds.splice(index, 1);
  }
};

const insertOrderedId = (orderedIds: string[], id: string, index?: number): void => {
  removeOrderedId(orderedIds, id);
  if (index === undefined || index < 0 || index >= orderedIds.length) {
    orderedIds.push(id);
    return;
  }
  orderedIds.splice(index, 0, id);
};

const getResourceCollection = <TKind extends SceneDocumentResourceKind>(
  document: SceneDocument,
  kind: TKind,
): SceneDocumentResourceCollection<TKind> => {
  switch (kind) {
    case 'asset':
      return document.assets as SceneDocumentResourceCollection<TKind>;
    case 'texture':
      return document.textures as SceneDocumentResourceCollection<TKind>;
    case 'material':
      return document.materials as SceneDocumentResourceCollection<TKind>;
    case 'light':
      return document.lights as SceneDocumentResourceCollection<TKind>;
    case 'mesh':
      return document.meshes as SceneDocumentResourceCollection<TKind>;
    case 'camera':
      return document.cameras as SceneDocumentResourceCollection<TKind>;
    case 'sdf':
      return document.sdfs as SceneDocumentResourceCollection<TKind>;
    case 'volume':
      return document.volumes as SceneDocumentResourceCollection<TKind>;
  }
};

const detachNodeInstance = (document: SceneDocument, node: SceneDocumentNodeInstance): void => {
  if (node.parentId === undefined) {
    removeOrderedId(document.nodes.rootNodeIds, node.id);
    return;
  }
  const parentNode = document.nodes.byId.get(node.parentId);
  if (!parentNode) {
    return;
  }
  removeOrderedId(parentNode.childIds, node.id);
};

const attachNodeInstance = (
  document: SceneDocument,
  node: SceneDocumentNodeInstance,
  parentId: string | undefined,
  index?: number,
): void => {
  node.parentId = parentId;
  if (parentId === undefined) {
    insertOrderedId(document.nodes.rootNodeIds, node.id, index);
    return;
  }
  const parentNode = document.nodes.byId.get(parentId);
  if (!parentNode) {
    throw new Error(`scene document parent node "${parentId}" does not exist`);
  }
  insertOrderedId(parentNode.childIds, node.id, index);
};

export const createSceneDocument = (id = 'scene'): SceneDocument => ({
  scene: { id },
  assets: createResourceCollection(),
  textures: createResourceCollection(),
  materials: createResourceCollection(),
  lights: createResourceCollection(),
  meshes: createResourceCollection(),
  cameras: createResourceCollection(),
  sdfs: createResourceCollection(),
  volumes: createResourceCollection(),
  nodes: {
    order: [],
    rootNodeIds: [],
    byId: new Map<string, SceneDocumentNodeInstance>(),
  },
});

export const applySceneDocumentScene = (
  document: SceneDocument,
  scene: Readonly<{
    id: string;
    activeCameraId?: string;
  }>,
): SceneDocument => {
  document.scene.id = scene.id;
  document.scene.activeCameraId = scene.activeCameraId;
  return document;
};

export const upsertSceneDocumentResource = <TKind extends SceneDocumentResourceKind>(
  document: SceneDocument,
  input: SceneDocumentResourceInput<TKind>,
): SceneDocumentResourceInstance<TKind> => {
  const collection = getResourceCollection(document, input.kind);
  const existing = collection.byId.get(input.value.id);
  if (existing) {
    existing.value = input.value;
    return existing;
  }

  const instance = {
    kind: input.kind,
    id: input.value.id,
    value: input.value,
  } satisfies SceneDocumentResourceInstance<TKind>;
  collection.byId.set(instance.id, instance);
  collection.order.push(instance.id);
  return instance;
};

export const removeSceneDocumentResource = <TKind extends SceneDocumentResourceKind>(
  document: SceneDocument,
  kind: TKind,
  id: string,
): boolean => {
  const collection = getResourceCollection(document, kind);
  if (!collection.byId.delete(id)) {
    return false;
  }
  removeOrderedId(collection.order, id);
  return true;
};

export const upsertSceneDocumentNode = (
  document: SceneDocument,
  input: SceneDocumentNodeInput,
): SceneDocumentNodeInstance => {
  const existing = document.nodes.byId.get(input.id);
  if (existing) {
    if (existing.parentId !== input.parentId) {
      detachNodeInstance(document, existing);
      attachNodeInstance(document, existing, input.parentId, input.index);
    } else if (input.parentId === undefined) {
      insertOrderedId(document.nodes.rootNodeIds, existing.id, input.index);
    } else {
      const parentNode = document.nodes.byId.get(input.parentId);
      if (!parentNode) {
        throw new Error(`scene document parent node "${input.parentId}" does not exist`);
      }
      insertOrderedId(parentNode.childIds, existing.id, input.index);
    }
    existing.props = input.props ?? {};
    return existing;
  }

  const instance: SceneDocumentNodeInstance = {
    kind: 'node',
    id: input.id,
    parentId: undefined,
    childIds: [],
    props: input.props ?? {},
  };
  document.nodes.byId.set(instance.id, instance);
  document.nodes.order.push(instance.id);
  attachNodeInstance(document, instance, input.parentId, input.index);
  return instance;
};

export const removeSceneDocumentNode = (document: SceneDocument, id: string): boolean => {
  const node = document.nodes.byId.get(id);
  if (!node) {
    return false;
  }

  for (const childId of [...node.childIds]) {
    removeSceneDocumentNode(document, childId);
  }

  detachNodeInstance(document, node);
  document.nodes.byId.delete(id);
  removeOrderedId(document.nodes.order, id);
  return true;
};

export const sceneDocumentToSceneIr = (document: SceneDocument): SceneIr => {
  let scene = document.scene.activeCameraId === undefined ? createSceneIr(document.scene.id) : {
    ...createSceneIr(document.scene.id),
    activeCameraId: document.scene.activeCameraId,
  };

  for (const id of document.assets.order) {
    const asset = document.assets.byId.get(id);
    if (asset) {
      scene = appendAsset(scene, asset.value);
    }
  }
  for (const id of document.textures.order) {
    const texture = document.textures.byId.get(id);
    if (texture) {
      scene = appendTexture(scene, texture.value);
    }
  }
  for (const id of document.materials.order) {
    const material = document.materials.byId.get(id);
    if (material) {
      scene = appendMaterial(scene, material.value);
    }
  }
  for (const id of document.lights.order) {
    const light = document.lights.byId.get(id);
    if (light) {
      scene = appendLight(scene, light.value);
    }
  }
  for (const id of document.meshes.order) {
    const mesh = document.meshes.byId.get(id);
    if (mesh) {
      scene = appendMesh(scene, mesh.value);
    }
  }
  for (const id of document.cameras.order) {
    const camera = document.cameras.byId.get(id);
    if (camera) {
      scene = appendCamera(scene, camera.value);
    }
  }
  for (const id of document.sdfs.order) {
    const sdf = document.sdfs.byId.get(id);
    if (sdf) {
      scene = appendSdfPrimitive(scene, sdf.value);
    }
  }
  for (const id of document.volumes.order) {
    const volume = document.volumes.byId.get(id);
    if (volume) {
      scene = appendVolumePrimitive(scene, volume.value);
    }
  }
  for (const id of document.nodes.order) {
    const node = document.nodes.byId.get(id);
    if (node) {
      scene = appendNode(
        scene,
        createNode(node.id, {
          parentId: node.parentId,
          ...node.props,
        }),
      );
    }
  }

  return scene;
};
