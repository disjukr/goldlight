import type { Node, SceneIr } from '@rieul3d/ir';

import { type AuthoringElement, authoringTreeToSceneIr } from './authoring.ts';

type SceneRootEntityWithId = Readonly<{ id: string }>;

export type SceneRootCommit = Readonly<{
  scene: SceneIr;
  previousScene?: SceneIr;
  revision: number;
}>;

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
  sdfPrimitives: SceneRootCollectionSummary;
  volumePrimitives: SceneRootCollectionSummary;
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
  sdfPrimitives: SceneRootCollectionSummary;
  volumePrimitives: SceneRootCollectionSummary;
  nodes: SceneRootNodeUpdatePlan;
  animationClips: SceneRootCollectionSummary;
}>;

export type SceneRoot = Readonly<{
  render: (element: AuthoringElement) => SceneIr;
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

const nodeResourceBindingsChanged = (currentNode: Node, previousNode: Node): boolean => {
  return currentNode.meshId !== previousNode.meshId ||
    currentNode.cameraId !== previousNode.cameraId ||
    currentNode.sdfId !== previousNode.sdfId ||
    currentNode.volumeId !== previousNode.volumeId ||
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

export const summarizeSceneRootCommit = (commit: SceneRootCommit): SceneRootCommitSummary => ({
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
  sdfPrimitives: compareSceneRootCollection(
    commit.scene.sdfPrimitives,
    commit.previousScene?.sdfPrimitives,
  ),
  volumePrimitives: compareSceneRootCollection(
    commit.scene.volumePrimitives,
    commit.previousScene?.volumePrimitives,
  ),
  nodes: compareSceneRootCollection(commit.scene.nodes, commit.previousScene?.nodes),
  animationClips: compareSceneRootCollection(
    commit.scene.animationClips,
    commit.previousScene?.animationClips,
  ),
});

export const planSceneRootCommitUpdates = (commit: SceneRootCommit): SceneRootCommitUpdatePlan => ({
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
  sdfPrimitives: compareSceneRootCollection(
    commit.scene.sdfPrimitives,
    commit.previousScene?.sdfPrimitives,
  ),
  volumePrimitives: compareSceneRootCollection(
    commit.scene.volumePrimitives,
    commit.previousScene?.volumePrimitives,
  ),
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
    collectionHasChanges(summary.sdfPrimitives) ||
    collectionHasChanges(summary.volumePrimitives) ||
    collectionHasChanges(summary.nodes);
};

export const createSceneRoot = (initialElement?: AuthoringElement): SceneRoot => {
  let currentScene: SceneIr | undefined;
  let revision = 0;
  const subscribers = new Set<SceneRootSubscriber>();

  const render = (element: AuthoringElement): SceneIr => {
    const scene = authoringTreeToSceneIr(element);
    const commit = {
      scene,
      previousScene: currentScene,
      revision: revision + 1,
    } satisfies SceneRootCommit;

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
