import type { Node, SceneIr } from '@rieul3d/ir';

import { type AuthoringElement, authoringTreeToSceneDocument } from './authoring.ts';
import {
  createSceneDocument,
  type SceneDocument,
  sceneDocumentToSceneIr,
} from './scene_document.ts';

type SceneRootEntityWithId = Readonly<{ id: string }>;
type SceneRootCommitBase = Readonly<{
  scene: SceneIr;
  previousScene?: SceneIr;
  revision: number;
}>;

type SceneRootCollectionName =
  | 'assets'
  | 'textures'
  | 'materials'
  | 'lights'
  | 'meshes'
  | 'cameras'
  | 'animationClips';

type SceneRootCollectionValueByName = {
  assets: SceneIr['assets'][number];
  textures: SceneIr['textures'][number];
  materials: SceneIr['materials'][number];
  lights: SceneIr['lights'][number];
  meshes: SceneIr['meshes'][number];
  cameras: SceneIr['cameras'][number];
  animationClips: SceneIr['animationClips'][number];
};

export type SceneRootCollectionUpdatePayload<TEntry extends SceneRootEntityWithId> = Readonly<{
  added: readonly TEntry[];
  updated: readonly TEntry[];
  removedIds: readonly string[];
  unchangedIds: readonly string[];
}>;

export type SceneRootNodeUpdatePayload = Readonly<{
  added: readonly Node[];
  updated: readonly Node[];
  removedIds: readonly string[];
  unchangedIds: readonly string[];
  transform: readonly Node[];
  transformOnly: readonly Node[];
  parenting: readonly Node[];
  resourceBinding: readonly Node[];
  metadata: readonly Node[];
  otherUpdated: readonly Node[];
}>;

export type SceneRootCommitUpdatePayload = Readonly<{
  sceneId: SceneIr['id'];
  previousSceneId?: SceneIr['id'];
  revision: number;
  activeCameraId?: SceneIr['activeCameraId'];
  activeCameraChanged: boolean;
  rootNodeIds: readonly string[];
  rootNodeIdsChanged: boolean;
  assets: SceneRootCollectionUpdatePayload<SceneRootCollectionValueByName['assets']>;
  textures: SceneRootCollectionUpdatePayload<SceneRootCollectionValueByName['textures']>;
  materials: SceneRootCollectionUpdatePayload<SceneRootCollectionValueByName['materials']>;
  lights: SceneRootCollectionUpdatePayload<SceneRootCollectionValueByName['lights']>;
  meshes: SceneRootCollectionUpdatePayload<SceneRootCollectionValueByName['meshes']>;
  cameras: SceneRootCollectionUpdatePayload<SceneRootCollectionValueByName['cameras']>;
  nodes: SceneRootNodeUpdatePayload;
  animationClips: SceneRootCollectionUpdatePayload<
    SceneRootCollectionValueByName['animationClips']
  >;
}>;

export type SceneRootResidencyInvalidationPlan = Readonly<{
  reset: boolean;
  meshIds: readonly string[];
  materialIds: readonly string[];
  textureIds: readonly string[];
  reasons: readonly string[];
}>;

export type SceneRootCommit = Readonly<
  & SceneRootCommitBase
  & {
    summary: SceneRootCommitSummary;
    updatePlan: SceneRootCommitUpdatePlan;
    updatePayload: SceneRootCommitUpdatePayload;
  }
>;

export type SceneRootSubscriber = (commit: SceneRootCommit) => void;

export type SceneRootCollectionSummary = Readonly<{
  addedIds: readonly string[];
  removedIds: readonly string[];
  updatedIds: readonly string[];
  unchangedIds: readonly string[];
}>;

export type SceneRootCommitSummary = Readonly<{
  sceneIdChanged: boolean;
  activeCameraChanged: boolean;
  rootNodeIdsChanged: boolean;
  assets: SceneRootCollectionSummary;
  textures: SceneRootCollectionSummary;
  materials: SceneRootCollectionSummary;
  lights: SceneRootCollectionSummary;
  meshes: SceneRootCollectionSummary;
  cameras: SceneRootCollectionSummary;
  nodes: SceneRootCollectionSummary;
  animationClips: SceneRootCollectionSummary;
}>;

export type SceneRootNodeUpdatePlan = Readonly<
  & SceneRootCollectionSummary
  & {
    transformIds: readonly string[];
    transformOnlyIds: readonly string[];
    parentingIds: readonly string[];
    resourceBindingIds: readonly string[];
    metadataIds: readonly string[];
    otherUpdatedIds: readonly string[];
  }
>;

export type SceneRootCommitUpdatePlan = Readonly<{
  sceneIdChanged: boolean;
  activeCameraChanged: boolean;
  rootNodeIdsChanged: boolean;
  assets: SceneRootCollectionSummary;
  textures: SceneRootCollectionSummary;
  materials: SceneRootCollectionSummary;
  lights: SceneRootCollectionSummary;
  meshes: SceneRootCollectionSummary;
  cameras: SceneRootCollectionSummary;
  nodes: SceneRootNodeUpdatePlan;
  animationClips: SceneRootCollectionSummary;
}>;

export type SceneRoot = Readonly<{
  render: (element: AuthoringElement) => SceneIr;
  flushUpdates: () => void;
  getScene: () => SceneIr | undefined;
  getRevision: () => number;
  subscribe: (subscriber: SceneRootSubscriber) => () => void;
}>;

const HASH_OFFSET = 2166136261;
const HASH_PRIME = 16777619;
const numberHashBuffer = new ArrayBuffer(8);
const numberHashView = new DataView(numberHashBuffer);
const fingerprintCache = new WeakMap<object, number>();

const mixHash = (hash: number, byte: number): number => {
  return Math.imul(hash ^ byte, HASH_PRIME) >>> 0;
};

const hashString = (hash: number, value: string): number => {
  let nextHash = hash;
  for (let index = 0; index < value.length; index += 1) {
    nextHash = mixHash(nextHash, value.charCodeAt(index) & 0xff);
    nextHash = mixHash(nextHash, value.charCodeAt(index) >>> 8);
  }
  return nextHash;
};

const hashNumber = (hash: number, value: number): number => {
  numberHashView.setFloat64(0, value, true);
  let nextHash = hash;
  for (let index = 0; index < 8; index += 1) {
    nextHash = mixHash(nextHash, numberHashView.getUint8(index));
  }
  return nextHash;
};

const fingerprintValue = (value: unknown): number => {
  if (value === null) {
    return hashString(HASH_OFFSET, 'null');
  }
  if (value === undefined) {
    return hashString(HASH_OFFSET, 'undefined');
  }
  if (typeof value === 'string') {
    return hashString(HASH_OFFSET, value);
  }
  if (typeof value === 'number') {
    return hashNumber(HASH_OFFSET, value);
  }
  if (typeof value === 'boolean') {
    return hashString(HASH_OFFSET, value ? 'true' : 'false');
  }
  if (Array.isArray(value)) {
    let hash = hashString(HASH_OFFSET, 'array');
    for (const item of value) {
      const itemFingerprint = fingerprintValue(item);
      hash = mixHash(hash, 0xff);
      hash = mixHash(hash, itemFingerprint & 0xff);
      hash = mixHash(hash, (itemFingerprint >>> 8) & 0xff);
      hash = mixHash(hash, (itemFingerprint >>> 16) & 0xff);
      hash = mixHash(hash, itemFingerprint >>> 24);
    }
    return hash;
  }
  if (typeof value === 'object') {
    const cachedFingerprint = fingerprintCache.get(value);
    if (cachedFingerprint !== undefined) {
      return cachedFingerprint;
    }

    let hash = hashString(HASH_OFFSET, 'object');
    const entries = Object.entries(value).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    );
    for (const [key, entryValue] of entries) {
      hash = hashString(hash, key);
      const entryFingerprint = fingerprintValue(entryValue);
      hash = mixHash(hash, entryFingerprint & 0xff);
      hash = mixHash(hash, (entryFingerprint >>> 8) & 0xff);
      hash = mixHash(hash, (entryFingerprint >>> 16) & 0xff);
      hash = mixHash(hash, entryFingerprint >>> 24);
    }

    fingerprintCache.set(value, hash);
    return hash;
  }

  return hashString(HASH_OFFSET, String(value));
};

const collectionHasChanges = (summary: SceneRootCollectionSummary): boolean => {
  return summary.addedIds.length > 0 ||
    summary.removedIds.length > 0 ||
    summary.updatedIds.length > 0;
};

const compareSceneRootCollection = <TEntry extends SceneRootEntityWithId>(
  currentEntries: readonly TEntry[],
  previousEntries: readonly TEntry[] | undefined,
): SceneRootCollectionSummary => {
  const previousById = new Map(
    (previousEntries ?? []).map((entry) => [entry.id, fingerprintValue(entry)]),
  );
  const currentById = new Map(currentEntries.map((entry) => [entry.id, fingerprintValue(entry)]));

  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  const unchangedIds: string[] = [];

  for (const entry of currentEntries) {
    const previousValue = previousById.get(entry.id);
    if (previousValue === undefined) {
      addedIds.push(entry.id);
      continue;
    }
    if (previousValue === currentById.get(entry.id)) {
      unchangedIds.push(entry.id);
      continue;
    }
    updatedIds.push(entry.id);
  }

  const removedIds = (previousEntries ?? [])
    .filter((entry) => !currentById.has(entry.id))
    .map((entry) => entry.id);

  return {
    addedIds,
    removedIds,
    updatedIds,
    unchangedIds,
  };
};

const getSceneCollection = <TName extends SceneRootCollectionName>(
  scene: SceneIr,
  name: TName,
): readonly SceneRootCollectionValueByName[TName][] =>
  scene[name] as readonly SceneRootCollectionValueByName[TName][];

const toSceneRootCollectionUpdatePayload = <TEntry extends SceneRootEntityWithId>(
  currentEntries: readonly TEntry[],
  summary: SceneRootCollectionSummary,
): SceneRootCollectionUpdatePayload<TEntry> => {
  const currentById = new Map(currentEntries.map((entry) => [entry.id, entry]));

  return {
    added: summary.addedIds.flatMap((id) => {
      const entry = currentById.get(id);
      return entry ? [entry] : [];
    }),
    updated: summary.updatedIds.flatMap((id) => {
      const entry = currentById.get(id);
      return entry ? [entry] : [];
    }),
    removedIds: summary.removedIds,
    unchangedIds: summary.unchangedIds,
  };
};

const toSceneRootNodeUpdatePayload = (
  currentNodes: readonly Node[],
  plan: SceneRootNodeUpdatePlan,
): SceneRootNodeUpdatePayload => {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const pickNodes = (ids: readonly string[]): Node[] =>
    ids.flatMap((id) => {
      const node = currentById.get(id);
      return node ? [node] : [];
    });

  return {
    added: pickNodes(plan.addedIds),
    updated: pickNodes(plan.updatedIds),
    removedIds: plan.removedIds,
    unchangedIds: plan.unchangedIds,
    transform: pickNodes(plan.transformIds),
    transformOnly: pickNodes(plan.transformOnlyIds),
    parenting: pickNodes(plan.parentingIds),
    resourceBinding: pickNodes(plan.resourceBindingIds),
    metadata: pickNodes(plan.metadataIds),
    otherUpdated: pickNodes(plan.otherUpdatedIds),
  };
};

const nodeResourceBindingsChanged = (currentNode: Node, previousNode: Node): boolean => {
  return currentNode.meshId !== previousNode.meshId ||
    currentNode.cameraId !== previousNode.cameraId ||
    currentNode.lightId !== previousNode.lightId;
};

const buildChildNodeIdsByParentId = (nodes: readonly Node[]): Map<string | undefined, string[]> => {
  const childNodeIdsByParentId = new Map<string | undefined, string[]>();
  for (const node of nodes) {
    const siblingIds = childNodeIdsByParentId.get(node.parentId) ?? [];
    siblingIds.push(node.id);
    childNodeIdsByParentId.set(node.parentId, siblingIds);
  }
  return childNodeIdsByParentId;
};

const collectDescendantNodeIds = (
  nodeIds: Iterable<string>,
  childNodeIdsByParentId: ReadonlyMap<string | undefined, readonly string[]>,
): string[] => {
  const descendantNodeIds: string[] = [];
  const queuedNodeIds = [...nodeIds];

  for (let index = 0; index < queuedNodeIds.length; index += 1) {
    const nodeId = queuedNodeIds[index];
    const childNodeIds = childNodeIdsByParentId.get(nodeId) ?? [];
    for (const childNodeId of childNodeIds) {
      descendantNodeIds.push(childNodeId);
      queuedNodeIds.push(childNodeId);
    }
  }

  return descendantNodeIds;
};

const compareSceneRootNodes = (
  currentNodes: readonly Node[],
  previousNodes: readonly Node[] | undefined,
): SceneRootNodeUpdatePlan => {
  const summary = compareSceneRootCollection(currentNodes, previousNodes);
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const previousById = new Map((previousNodes ?? []).map((node) => [node.id, node]));
  const directlyChangedTransformIds: string[] = [];
  const parentingIds: string[] = [];
  const resourceBindingIds: string[] = [];
  const metadataIds: string[] = [];

  for (const nodeId of summary.updatedIds) {
    const currentNode = currentById.get(nodeId);
    const previousNode = previousById.get(nodeId);
    if (!currentNode || !previousNode) {
      continue;
    }

    if (currentNode.parentId !== previousNode.parentId) {
      parentingIds.push(nodeId);
    }
    if (fingerprintValue(currentNode.transform) !== fingerprintValue(previousNode.transform)) {
      directlyChangedTransformIds.push(nodeId);
    }
    if (nodeResourceBindingsChanged(currentNode, previousNode)) {
      resourceBindingIds.push(nodeId);
    }
    if (currentNode.name !== previousNode.name) {
      metadataIds.push(nodeId);
    }
  }

  const childNodeIdsByParentId = buildChildNodeIdsByParentId(currentNodes);
  const transformIds = [
    ...new Set([
      ...directlyChangedTransformIds,
      ...parentingIds,
      ...collectDescendantNodeIds(
        [...directlyChangedTransformIds, ...parentingIds],
        childNodeIdsByParentId,
      ),
    ]),
  ];

  const classifiedUpdatedIds = new Set([
    ...transformIds,
    ...parentingIds,
    ...resourceBindingIds,
    ...metadataIds,
  ]);
  const transformOnlyIds = transformIds.filter((nodeId) =>
    !parentingIds.includes(nodeId) &&
    !resourceBindingIds.includes(nodeId) &&
    !metadataIds.includes(nodeId)
  );

  return {
    ...summary,
    transformIds,
    transformOnlyIds,
    parentingIds,
    resourceBindingIds,
    metadataIds,
    otherUpdatedIds: summary.updatedIds.filter((nodeId) => !classifiedUpdatedIds.has(nodeId)),
  };
};

const validateSceneRootTextureReferences = (scene: SceneIr): void => {
  const textureIds = new Set(scene.textures.map((texture) => texture.id));

  for (const material of scene.materials) {
    for (const texture of material.textures) {
      if (textureIds.has(texture.id)) {
        continue;
      }

      throw new Error(
        `material "${material.id}" references missing texture "${texture.id}" in scene "${scene.id}"`,
      );
    }
  }
};

const validateSceneRootCommitScene = (scene: SceneIr): void => {
  validateSceneRootTextureReferences(scene);
};

export const summarizeSceneRootCommit = (commit: SceneRootCommitBase): SceneRootCommitSummary => ({
  sceneIdChanged: commit.scene.id !== commit.previousScene?.id,
  activeCameraChanged: commit.scene.activeCameraId !== commit.previousScene?.activeCameraId,
  rootNodeIdsChanged: fingerprintValue(commit.scene.rootNodeIds) !==
    fingerprintValue(commit.previousScene?.rootNodeIds ?? []),
  assets: compareSceneRootCollection(commit.scene.assets, commit.previousScene?.assets),
  textures: compareSceneRootCollection(commit.scene.textures, commit.previousScene?.textures),
  materials: compareSceneRootCollection(commit.scene.materials, commit.previousScene?.materials),
  lights: compareSceneRootCollection(commit.scene.lights, commit.previousScene?.lights),
  meshes: compareSceneRootCollection(commit.scene.meshes, commit.previousScene?.meshes),
  cameras: compareSceneRootCollection(commit.scene.cameras, commit.previousScene?.cameras),
  nodes: compareSceneRootCollection(commit.scene.nodes, commit.previousScene?.nodes),
  animationClips: compareSceneRootCollection(
    commit.scene.animationClips,
    commit.previousScene?.animationClips,
  ),
});

export const planSceneRootCommitUpdates = (
  commit: SceneRootCommitBase,
): SceneRootCommitUpdatePlan => ({
  sceneIdChanged: commit.scene.id !== commit.previousScene?.id,
  activeCameraChanged: commit.scene.activeCameraId !== commit.previousScene?.activeCameraId,
  rootNodeIdsChanged: fingerprintValue(commit.scene.rootNodeIds) !==
    fingerprintValue(commit.previousScene?.rootNodeIds ?? []),
  assets: compareSceneRootCollection(commit.scene.assets, commit.previousScene?.assets),
  textures: compareSceneRootCollection(commit.scene.textures, commit.previousScene?.textures),
  materials: compareSceneRootCollection(commit.scene.materials, commit.previousScene?.materials),
  lights: compareSceneRootCollection(commit.scene.lights, commit.previousScene?.lights),
  meshes: compareSceneRootCollection(commit.scene.meshes, commit.previousScene?.meshes),
  cameras: compareSceneRootCollection(commit.scene.cameras, commit.previousScene?.cameras),
  nodes: compareSceneRootNodes(commit.scene.nodes, commit.previousScene?.nodes),
  animationClips: compareSceneRootCollection(
    commit.scene.animationClips,
    commit.previousScene?.animationClips,
  ),
});

export const commitSummaryNeedsResidencyReset = (summary: SceneRootCommitSummary): boolean => {
  return summary.sceneIdChanged ||
    summary.rootNodeIdsChanged ||
    collectionHasChanges(summary.assets) ||
    collectionHasChanges(summary.textures) ||
    collectionHasChanges(summary.materials) ||
    collectionHasChanges(summary.meshes) ||
    collectionHasChanges(summary.nodes);
};

export const canApplySceneRootTransformUpdates = (commit: SceneRootCommit): boolean => {
  const { updatePlan } = commit;
  return !updatePlan.sceneIdChanged &&
    !updatePlan.activeCameraChanged &&
    !updatePlan.rootNodeIdsChanged &&
    !collectionHasChanges(updatePlan.assets) &&
    !collectionHasChanges(updatePlan.textures) &&
    !collectionHasChanges(updatePlan.materials) &&
    !collectionHasChanges(updatePlan.lights) &&
    !collectionHasChanges(updatePlan.meshes) &&
    !collectionHasChanges(updatePlan.cameras) &&
    !collectionHasChanges(updatePlan.animationClips) &&
    updatePlan.nodes.addedIds.length === 0 &&
    updatePlan.nodes.removedIds.length === 0 &&
    updatePlan.nodes.parentingIds.length === 0 &&
    updatePlan.nodes.resourceBindingIds.length === 0 &&
    updatePlan.nodes.metadataIds.length === 0 &&
    updatePlan.nodes.otherUpdatedIds.length === 0;
};

export const createSceneRootCommit = (
  scene: SceneIr,
  previousScene: SceneIr | undefined,
  revision: number,
): SceneRootCommit => {
  validateSceneRootCommitScene(scene);

  const baseCommit = {
    scene,
    previousScene,
    revision,
  } as const;
  const summary = summarizeSceneRootCommit(baseCommit);
  const updatePlan = planSceneRootCommitUpdates(baseCommit);

  return {
    ...baseCommit,
    summary,
    updatePlan,
    updatePayload: {
      sceneId: scene.id,
      previousSceneId: previousScene?.id,
      revision,
      activeCameraId: scene.activeCameraId,
      activeCameraChanged: updatePlan.activeCameraChanged,
      rootNodeIds: scene.rootNodeIds,
      rootNodeIdsChanged: updatePlan.rootNodeIdsChanged,
      assets: toSceneRootCollectionUpdatePayload(
        getSceneCollection(scene, 'assets'),
        updatePlan.assets,
      ),
      textures: toSceneRootCollectionUpdatePayload(
        getSceneCollection(scene, 'textures'),
        updatePlan.textures,
      ),
      materials: toSceneRootCollectionUpdatePayload(
        getSceneCollection(scene, 'materials'),
        updatePlan.materials,
      ),
      lights: toSceneRootCollectionUpdatePayload(
        getSceneCollection(scene, 'lights'),
        updatePlan.lights,
      ),
      meshes: toSceneRootCollectionUpdatePayload(
        getSceneCollection(scene, 'meshes'),
        updatePlan.meshes,
      ),
      cameras: toSceneRootCollectionUpdatePayload(
        getSceneCollection(scene, 'cameras'),
        updatePlan.cameras,
      ),
      nodes: toSceneRootNodeUpdatePayload(scene.nodes, updatePlan.nodes),
      animationClips: toSceneRootCollectionUpdatePayload(
        getSceneCollection(scene, 'animationClips'),
        updatePlan.animationClips,
      ),
    },
  };
};

const appendUniqueIds = (target: Set<string>, ids: readonly string[]): void => {
  for (const id of ids) {
    target.add(id);
  }
};

const collectAssetLinkedIds = (
  commit: SceneRootCommit,
  assetIds: readonly string[],
): Readonly<{
  textureIds: readonly string[];
}> => {
  const changedAssetIds = new Set(assetIds);
  const scenes = [commit.previousScene, commit.scene].filter((candidate): candidate is SceneIr =>
    candidate !== undefined
  );
  const textureIds = new Set<string>();

  for (const candidateScene of scenes) {
    for (const texture of candidateScene.textures) {
      if (texture.assetId && changedAssetIds.has(texture.assetId)) {
        textureIds.add(texture.id);
      }
    }
  }

  return {
    textureIds: [...textureIds],
  };
};

export const planSceneRootResidencyInvalidation = (
  commit: SceneRootCommit,
): SceneRootResidencyInvalidationPlan => {
  const { updatePlan } = commit;
  const reasons: string[] = [];

  if (updatePlan.sceneIdChanged) reasons.push('sceneIdChanged');
  if (updatePlan.rootNodeIdsChanged) reasons.push('rootNodeIdsChanged');
  if (updatePlan.nodes.addedIds.length > 0) reasons.push('nodeAdded');
  if (updatePlan.nodes.removedIds.length > 0) reasons.push('nodeRemoved');
  if (updatePlan.nodes.parentingIds.length > 0) reasons.push('nodeParentingChanged');
  if (updatePlan.nodes.resourceBindingIds.length > 0) reasons.push('nodeResourceBindingChanged');
  if (updatePlan.nodes.metadataIds.length > 0) reasons.push('nodeMetadataChanged');
  if (updatePlan.nodes.otherUpdatedIds.length > 0) reasons.push('nodeOtherChanged');

  const reset = reasons.length > 0;
  if (reset) {
    return {
      reset,
      meshIds: [],
      materialIds: [],
      textureIds: [],
      reasons,
    };
  }

  const meshIds = new Set<string>();
  const materialIds = new Set<string>();
  const textureIds = new Set<string>();

  appendUniqueIds(meshIds, updatePlan.meshes.addedIds);
  appendUniqueIds(meshIds, updatePlan.meshes.removedIds);
  appendUniqueIds(meshIds, updatePlan.meshes.updatedIds);

  appendUniqueIds(materialIds, updatePlan.materials.addedIds);
  appendUniqueIds(materialIds, updatePlan.materials.removedIds);
  appendUniqueIds(materialIds, updatePlan.materials.updatedIds);

  appendUniqueIds(textureIds, updatePlan.textures.addedIds);
  appendUniqueIds(textureIds, updatePlan.textures.removedIds);
  appendUniqueIds(textureIds, updatePlan.textures.updatedIds);

  const assetLinkedIds = collectAssetLinkedIds(commit, [
    ...updatePlan.assets.addedIds,
    ...updatePlan.assets.removedIds,
    ...updatePlan.assets.updatedIds,
  ]);
  appendUniqueIds(textureIds, assetLinkedIds.textureIds);

  return {
    reset: false,
    meshIds: [...meshIds],
    materialIds: [...materialIds],
    textureIds: [...textureIds],
    reasons: [],
  };
};

export const createSceneRoot = (initialElement?: AuthoringElement): SceneRoot => {
  let currentScene: SceneIr | undefined;
  let currentDocument: SceneDocument | undefined;
  let revision = 0;
  const subscribers = new Set<SceneRootSubscriber>();

  const render = (element: AuthoringElement): SceneIr => {
    if (currentDocument === undefined) {
      currentDocument = createSceneDocument(element.id);
    }
    authoringTreeToSceneDocument(element, currentDocument);
    const scene = sceneDocumentToSceneIr(currentDocument);
    const commit = createSceneRootCommit(scene, currentScene, revision + 1);

    currentScene = scene;
    revision = commit.revision;

    const currentSubscribers = [...subscribers];
    for (const subscriber of currentSubscribers) {
      subscriber(commit);
    }

    return scene;
  };

  if (initialElement !== undefined) {
    render(initialElement);
  }

  return {
    render,
    flushUpdates: () => {},
    getScene: () => currentScene,
    getRevision: () => revision,
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
};
