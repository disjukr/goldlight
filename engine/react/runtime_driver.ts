import {
  type EvaluatedScene,
  evaluateScene,
  reevaluateSceneTransforms,
} from '@disjukr/goldlight/renderer';
import { applyRuntimeResidencyPlan, type RuntimeResidency } from '@disjukr/goldlight/gpu';
import type { SceneIr } from '@disjukr/goldlight/ir';
import {
  createFrameState,
  type FrameState,
  type FrameStateInit,
} from '@disjukr/goldlight/renderer';

import {
  canApplySceneRootTransformUpdates,
  type G3dSceneRoot,
  type G3dSceneRootCommit,
  type G3dSceneRootResidencyInvalidationPlan,
  type G3dSceneRootSubscriber,
  planG3dSceneRootResidencyInvalidation,
} from './scene_root.ts';

type SceneRootLike = Readonly<{
  flushUpdates?: () => void;
  getScene: () => SceneIr | undefined;
  subscribe: (subscriber: G3dSceneRootSubscriber) => () => void;
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
  initialFrameState?: FrameStateInit;
}>;

export type SceneRootFrameResult = Readonly<{
  scene: SceneIr;
  evaluatedScene: EvaluatedScene;
  commit?: G3dSceneRootCommit;
  evaluationMode: SceneRootFrameEvaluationMode;
  residencyPlan?: G3dSceneRootResidencyInvalidationPlan;
  stats: SceneRootFrameDriverStats;
}>;

export type SceneRootFrameDriver = Readonly<{
  getScene: () => SceneIr | undefined;
  getEvaluatedScene: () => EvaluatedScene | undefined;
  getStats: () => SceneRootFrameDriverStats;
  advanceFrame: (
    frameState: FrameState,
    options?: SceneRootFrameAdvanceOptions,
  ) => SceneRootFrameResult;
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
  sceneRoot: G3dSceneRoot | SceneRootLike,
  options: SceneRootFrameDriverOptions = {},
): SceneRootFrameDriver => {
  let currentScene = sceneRoot.getScene();
  let pendingCommit: G3dSceneRootCommit | undefined;
  let partialUpdateCount = 0;
  let fullUpdateCount = 0;
  let targetedInvalidationCount = 0;
  let resetInvalidationCount = 0;
  const initialFrameState = createFrameState(options.initialFrameState ?? {});
  let evaluatedScene = currentScene
    ? evaluateScene(currentScene, { timeMs: initialFrameState.timeMs })
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
    frameState: FrameState,
    advanceOptions: SceneRootFrameAdvanceOptions = {},
  ): SceneRootFrameResult => {
    sceneRoot.flushUpdates?.();
    const scene = currentScene;
    if (!scene) {
      throw new Error('Scene root stopped publishing scene snapshots');
    }

    const evaluationOptions = {
      timeMs: frameState.timeMs,
      clipId: advanceOptions.clipId,
    };
    const commit = pendingCommit;
    pendingCommit = undefined;
    let evaluationMode: SceneRootFrameEvaluationMode = 'none';
    let residencyPlan: G3dSceneRootResidencyInvalidationPlan | undefined;

    if (commit && options.residency) {
      residencyPlan = planG3dSceneRootResidencyInvalidation(commit);
      applyRuntimeResidencyPlan(options.residency, residencyPlan);
      if (residencyPlan.reset) {
        resetInvalidationCount += 1;
      } else {
        targetedInvalidationCount += 1;
      }
    } else if (commit) {
      residencyPlan = planG3dSceneRootResidencyInvalidation(commit);
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
