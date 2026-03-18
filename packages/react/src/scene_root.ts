import type { SceneIr } from '@rieul3d/ir';

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

export type SceneRoot = Readonly<{
  render: (element: AuthoringElement) => SceneIr;
  getScene: () => SceneIr | undefined;
  getRevision: () => number;
  subscribe: (subscriber: SceneRootSubscriber) => () => void;
}>;

const compareSceneRootCollection = <TEntry extends SceneRootEntityWithId>(
  currentEntries: readonly TEntry[],
  previousEntries: readonly TEntry[] | undefined,
): SceneRootCollectionSummary => {
  const previousById = new Map(
    (previousEntries ?? []).map((entry) => [entry.id, JSON.stringify(entry)]),
  );
  const currentById = new Map(currentEntries.map((entry) => [entry.id, JSON.stringify(entry)]));

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

export const summarizeSceneRootCommit = (commit: SceneRootCommit): SceneRootCommitSummary => ({
  sceneIdChanged: commit.scene.id !== commit.previousScene?.id,
  activeCameraChanged: commit.scene.activeCameraId !== commit.previousScene?.activeCameraId,
  rootNodeIdsChanged: JSON.stringify(commit.scene.rootNodeIds) !==
    JSON.stringify(commit.previousScene?.rootNodeIds ?? []),
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
