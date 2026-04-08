import {
  appendAnimationClip,
  appendAsset,
  appendCamera,
  appendLight,
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '@disjukr/goldlight/ir';
import type {
  AnimationClip,
  AssetRef,
  Camera,
  Light,
  Material,
  MeshPrimitive,
  Node,
  SceneIr,
  TextureRef,
} from '@disjukr/goldlight/ir';

type G3dSceneDocumentScene = {
  id: string;
  activeCameraId?: string;
};

export type G3dSceneDocumentNodeInput = Readonly<{
  id: string;
  parentId?: string;
  index?: number;
  props?: Partial<Omit<Node, 'id' | 'parentId'>>;
}>;

export type G3dSceneDocumentNodeInstance = {
  readonly kind: 'node';
  readonly id: string;
  parentId?: string;
  childIds: string[];
  props: Partial<Omit<Node, 'id' | 'parentId'>>;
};

type G3dSceneDocumentResourceByKind = {
  asset: AssetRef;
  texture: TextureRef;
  material: Material;
  light: Light;
  mesh: MeshPrimitive;
  camera: Camera;
  animationClip: AnimationClip;
};

export type G3dSceneDocumentResourceKind = keyof G3dSceneDocumentResourceByKind;

export type G3dSceneDocumentResourceInput<TKind extends G3dSceneDocumentResourceKind> = Readonly<{
  kind: TKind;
  value: G3dSceneDocumentResourceByKind[TKind];
}>;

export type G3dSceneDocumentResourceInstance<TKind extends G3dSceneDocumentResourceKind> = {
  readonly kind: TKind;
  readonly id: string;
  value: G3dSceneDocumentResourceByKind[TKind];
};

type G3dSceneDocumentResourceCollection<TKind extends G3dSceneDocumentResourceKind> = {
  order: string[];
  byId: Map<string, G3dSceneDocumentResourceInstance<TKind>>;
};

type G3dSceneDocumentNodeCollection = {
  order: string[];
  rootNodeIds: string[];
  byId: Map<string, G3dSceneDocumentNodeInstance>;
};

export type G3dSceneDocument = {
  scene: G3dSceneDocumentScene;
  assets: G3dSceneDocumentResourceCollection<'asset'>;
  textures: G3dSceneDocumentResourceCollection<'texture'>;
  materials: G3dSceneDocumentResourceCollection<'material'>;
  lights: G3dSceneDocumentResourceCollection<'light'>;
  meshes: G3dSceneDocumentResourceCollection<'mesh'>;
  cameras: G3dSceneDocumentResourceCollection<'camera'>;
  animationClips: G3dSceneDocumentResourceCollection<'animationClip'>;
  nodes: G3dSceneDocumentNodeCollection;
};

const createResourceCollection = <
  TKind extends G3dSceneDocumentResourceKind,
>(): G3dSceneDocumentResourceCollection<TKind> => ({
  order: [],
  byId: new Map<string, G3dSceneDocumentResourceInstance<TKind>>(),
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

const getResourceCollection = <TKind extends G3dSceneDocumentResourceKind>(
  document: G3dSceneDocument,
  kind: TKind,
): G3dSceneDocumentResourceCollection<TKind> => {
  switch (kind) {
    case 'asset':
      return document.assets as G3dSceneDocumentResourceCollection<TKind>;
    case 'texture':
      return document.textures as G3dSceneDocumentResourceCollection<TKind>;
    case 'material':
      return document.materials as G3dSceneDocumentResourceCollection<TKind>;
    case 'light':
      return document.lights as G3dSceneDocumentResourceCollection<TKind>;
    case 'mesh':
      return document.meshes as G3dSceneDocumentResourceCollection<TKind>;
    case 'camera':
      return document.cameras as G3dSceneDocumentResourceCollection<TKind>;
    case 'animationClip':
      return document.animationClips as G3dSceneDocumentResourceCollection<TKind>;
  }
};

const detachNodeInstance = (
  document: G3dSceneDocument,
  node: G3dSceneDocumentNodeInstance,
): void => {
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
  document: G3dSceneDocument,
  node: G3dSceneDocumentNodeInstance,
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

export const createG3dSceneDocument = (id = 'scene'): G3dSceneDocument => ({
  scene: { id },
  assets: createResourceCollection(),
  textures: createResourceCollection(),
  materials: createResourceCollection(),
  lights: createResourceCollection(),
  meshes: createResourceCollection(),
  cameras: createResourceCollection(),
  animationClips: createResourceCollection(),
  nodes: {
    order: [],
    rootNodeIds: [],
    byId: new Map<string, G3dSceneDocumentNodeInstance>(),
  },
});

export const applyG3dSceneDocumentScene = (
  document: G3dSceneDocument,
  scene: Readonly<{
    id: string;
    activeCameraId?: string;
  }>,
): G3dSceneDocument => {
  document.scene.id = scene.id;
  document.scene.activeCameraId = scene.activeCameraId;
  return document;
};

export const upsertG3dSceneDocumentResource = <TKind extends G3dSceneDocumentResourceKind>(
  document: G3dSceneDocument,
  input: G3dSceneDocumentResourceInput<TKind>,
): G3dSceneDocumentResourceInstance<TKind> => {
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
  } satisfies G3dSceneDocumentResourceInstance<TKind>;
  collection.byId.set(instance.id, instance);
  collection.order.push(instance.id);
  return instance;
};

export const removeG3dSceneDocumentResource = <TKind extends G3dSceneDocumentResourceKind>(
  document: G3dSceneDocument,
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

export const upsertG3dSceneDocumentNode = (
  document: G3dSceneDocument,
  input: G3dSceneDocumentNodeInput,
): G3dSceneDocumentNodeInstance => {
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

  const instance: G3dSceneDocumentNodeInstance = {
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

export const removeG3dSceneDocumentNode = (document: G3dSceneDocument, id: string): boolean => {
  const node = document.nodes.byId.get(id);
  if (!node) {
    return false;
  }

  for (const childId of [...node.childIds]) {
    removeG3dSceneDocumentNode(document, childId);
  }

  detachNodeInstance(document, node);
  document.nodes.byId.delete(id);
  removeOrderedId(document.nodes.order, id);
  return true;
};

export const g3dSceneDocumentToSceneIr = (document: G3dSceneDocument): SceneIr => {
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
  for (const id of document.animationClips.order) {
    const clip = document.animationClips.byId.get(id);
    if (clip) {
      scene = appendAnimationClip(scene, clip.value);
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
