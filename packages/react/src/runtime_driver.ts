import { type EvaluatedScene, evaluateScene, reevaluateSceneTransforms } from '@rieul3d/core';
import { applyRuntimeResidencyPlan, type RuntimeResidency } from '@rieul3d/gpu';
import type { SceneIr } from '@rieul3d/ir';

import {
  canApplySceneRootTransformUpdates,
  planSceneRootResidencyInvalidation,
  type SceneRoot,
  type SceneRootCommit,
  type SceneRootResidencyInvalidationPlan,
  type SceneRootSubscriber,
} from './scene_root.ts';

type SceneRootLike = Readonly<{
  flushUpdates?: () => void;
  getScene: () => SceneIr | undefined;
  subscribe: (subscriber: SceneRootSubscriber) => () => void;
}>;

export type SceneRootFrameEvaluationMode = 'none' | 'full' | 'partial';

export type SceneRootFrameDriverStats = Readonly<{
  partialUpdateCount: number;
  fullUpdateCount: number;
  targetedInvalidationCount: number;
  resetInvalidationCount: number;
}>;

export type SceneRootFrameAdvanceOptions = Readonly<{
  clipId?: string;
}>;

export type SceneRootFrameDriverOptions = Readonly<{
  residency?: RuntimeResidency;
  initialTimeMs?: number;
}>;

export type SceneRootFrameResult = Readonly<{
  scene: SceneIr;
  evaluatedScene: EvaluatedScene;
  commit?: SceneRootCommit;
  evaluationMode: SceneRootFrameEvaluationMode;
  residencyPlan?: SceneRootResidencyInvalidationPlan;
  stats: SceneRootFrameDriverStats;
}>;

export type SceneRootFrameDriver = Readonly<{
  getScene: () => SceneIr | undefined;
  getEvaluatedScene: () => EvaluatedScene | undefined;
  getStats: () => SceneRootFrameDriverStats;
  advanceFrame: (timeMs: number, options?: SceneRootFrameAdvanceOptions) => SceneRootFrameResult;
  dispose: () => void;
}>;

const createStatsSnapshot = (
  partialUpdateCount: number,
  fullUpdateCount: number,
  targetedInvalidationCount: number,
  resetInvalidationCount: number,
): SceneRootFrameDriverStats => ({
  partialUpdateCount,
  fullUpdateCount,
  targetedInvalidationCount,
  resetInvalidationCount,
});

export const createSceneRootFrameDriver = (
  sceneRoot: SceneRoot | SceneRootLike,
  options: SceneRootFrameDriverOptions = {},
): SceneRootFrameDriver => {
  let currentScene = sceneRoot.getScene();
  let pendingCommit: SceneRootCommit | undefined;
  let partialUpdateCount = 0;
  let fullUpdateCount = 0;
  let targetedInvalidationCount = 0;
  let resetInvalidationCount = 0;
  let evaluatedScene = currentScene
    ? evaluateScene(currentScene, { timeMs: options.initialTimeMs ?? 0 })
    : undefined;

  if (evaluatedScene) {
    fullUpdateCount = 1;
  }

  const unsubscribe = sceneRoot.subscribe((commit) => {
    currentScene = commit.scene;
    pendingCommit = commit;
  });

  const getStats = (): SceneRootFrameDriverStats =>
    createStatsSnapshot(
      partialUpdateCount,
      fullUpdateCount,
      targetedInvalidationCount,
      resetInvalidationCount,
    );

  const advanceFrame = (
    timeMs: number,
    advanceOptions: SceneRootFrameAdvanceOptions = {},
  ): SceneRootFrameResult => {
    sceneRoot.flushUpdates?.();
    const scene = currentScene;
    if (!scene) {
      throw new Error('Scene root stopped publishing scene snapshots');
    }

    const evaluationOptions = {
      timeMs,
      clipId: advanceOptions.clipId,
    };
    const commit = pendingCommit;
    pendingCommit = undefined;
    let evaluationMode: SceneRootFrameEvaluationMode = 'none';
    let residencyPlan: SceneRootResidencyInvalidationPlan | undefined;

    if (commit && options.residency) {
      residencyPlan = planSceneRootResidencyInvalidation(commit);
      applyRuntimeResidencyPlan(options.residency, residencyPlan);
      if (residencyPlan.reset) {
        resetInvalidationCount += 1;
      } else {
        targetedInvalidationCount += 1;
      }
    } else if (commit) {
      residencyPlan = planSceneRootResidencyInvalidation(commit);
    }

    if (!evaluatedScene || evaluatedScene.sceneId !== scene.id) {
      evaluatedScene = evaluateScene(scene, evaluationOptions);
      fullUpdateCount += 1;
      evaluationMode = 'full';
    } else if (commit) {
      if (canApplySceneRootTransformUpdates(commit)) {
        evaluatedScene = reevaluateSceneTransforms(scene, evaluatedScene, evaluationOptions);
        partialUpdateCount += 1;
        evaluationMode = 'partial';
      } else {
        evaluatedScene = evaluateScene(scene, evaluationOptions);
        fullUpdateCount += 1;
        evaluationMode = 'full';
      }
    } else if (advanceOptions.clipId !== undefined) {
      evaluatedScene = reevaluateSceneTransforms(scene, evaluatedScene, evaluationOptions);
      partialUpdateCount += 1;
      evaluationMode = 'partial';
    }

    return {
      scene,
      evaluatedScene,
      commit,
      evaluationMode,
      residencyPlan,
      stats: getStats(),
    };
  };

  return {
    getScene: () => currentScene,
    getEvaluatedScene: () => evaluatedScene,
    getStats,
    advanceFrame,
    dispose: unsubscribe,
  };
};
