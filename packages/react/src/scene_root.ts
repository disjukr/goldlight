import type { SceneIr } from '@rieul3d/ir';

import { type AuthoringElement, authoringTreeToSceneIr } from './authoring.ts';

export type SceneRootCommit = Readonly<{
  scene: SceneIr;
  previousScene?: SceneIr;
  revision: number;
}>;

export type SceneRootSubscriber = (commit: SceneRootCommit) => void;

export type SceneRoot = Readonly<{
  render: (element: AuthoringElement) => SceneIr;
  getScene: () => SceneIr | undefined;
  getRevision: () => number;
  subscribe: (subscriber: SceneRootSubscriber) => () => void;
}>;

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

    for (const subscriber of subscribers) {
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
