/** @jsxImportSource @rieul3d/react */
/** @jsxRuntime automatic */
/// <reference lib="dom" />

import { evaluateScene } from '../../packages/core/mod.ts';
import {
  configureSurfaceContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  invalidateResidency,
  invalidateResidencyResources,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import { createBrowserSurfaceTarget } from '../../packages/platform/mod.ts';
import {
  createSceneRoot,
  PerspectiveCamera,
  planSceneRootCommitUpdates,
  type SceneRootCommit,
} from '../../packages/react/mod.ts';
import { createMaterialRegistry, renderForwardFrame } from '../../packages/renderer/mod.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) {
  throw new Error('Missing #app canvas');
}

canvas.width = 640;
canvas.height = 480;

const TriangleScene = () => (
  <scene id='react-browser-authoring' activeCameraId='camera-main'>
    <material
      id='triangle-material'
      kind='unlit'
      textures={[]}
      parameters={{
        color: { x: 0.19, y: 0.62, z: 0.97, w: 1 },
      }}
    />
    <mesh
      id='triangle'
      materialId='triangle-material'
      attributes={[{
        semantic: 'POSITION',
        itemSize: 3,
        values: [
          0,
          0.7,
          0,
          -0.7,
          -0.7,
          0,
          0.7,
          -0.7,
          0,
        ],
      }]}
    />
    <PerspectiveCamera id='camera-main' position={[0, 0, 2]} />
    <group id='scene-root' name='Authored Root'>
      <node id='triangle-node' name='Authored Triangle' meshId='triangle' />
    </group>
  </scene>
);

const sceneRoot = createSceneRoot();
let scene = sceneRoot.getScene();
const residency = createRuntimeResidency();

const collectAssetLinkedIds = (
  commit: SceneRootCommit,
  assetIds: readonly string[],
): Readonly<{
  textureIds: readonly string[];
  volumeIds: readonly string[];
}> => {
  const changedAssetIds = new Set(assetIds);
  const scenes = [commit.previousScene, commit.scene].filter((
    candidate,
  ): candidate is typeof commit.scene => candidate !== undefined);
  const textureIds = new Set<string>();
  const volumeIds = new Set<string>();

  for (const candidateScene of scenes) {
    for (const texture of candidateScene.textures) {
      if (texture.assetId && changedAssetIds.has(texture.assetId)) {
        textureIds.add(texture.id);
      }
    }

    for (const volume of candidateScene.volumePrimitives) {
      if (volume.assetId && changedAssetIds.has(volume.assetId)) {
        volumeIds.add(volume.id);
      }
    }
  }

  return {
    textureIds: [...textureIds],
    volumeIds: [...volumeIds],
  };
};

sceneRoot.subscribe((commit) => {
  scene = commit.scene;
  const updatePlan = planSceneRootCommitUpdates(commit);
  if (
    updatePlan.sceneIdChanged ||
    updatePlan.rootNodeIdsChanged ||
    updatePlan.nodes.addedIds.length > 0 ||
    updatePlan.nodes.removedIds.length > 0 ||
    updatePlan.nodes.parentingIds.length > 0 ||
    updatePlan.nodes.resourceBindingIds.length > 0 ||
    updatePlan.nodes.metadataIds.length > 0 ||
    updatePlan.nodes.otherUpdatedIds.length > 0 ||
    updatePlan.sdfPrimitives.addedIds.length > 0 ||
    updatePlan.sdfPrimitives.removedIds.length > 0 ||
    updatePlan.sdfPrimitives.updatedIds.length > 0
  ) {
    invalidateResidency(residency);
    return;
  }

  const assetLinkedIds = collectAssetLinkedIds(
    commit,
    [
      ...updatePlan.assets.addedIds,
      ...updatePlan.assets.removedIds,
      ...updatePlan.assets.updatedIds,
    ],
  );

  invalidateResidencyResources(residency, {
    meshIds: [
      ...updatePlan.meshes.addedIds,
      ...updatePlan.meshes.removedIds,
      ...updatePlan.meshes.updatedIds,
    ],
    materialIds: [
      ...updatePlan.materials.addedIds,
      ...updatePlan.materials.removedIds,
      ...updatePlan.materials.updatedIds,
    ],
    textureIds: [
      ...updatePlan.textures.addedIds,
      ...updatePlan.textures.removedIds,
      ...updatePlan.textures.updatedIds,
      ...assetLinkedIds.textureIds,
    ],
    volumeIds: [
      ...updatePlan.volumePrimitives.addedIds,
      ...updatePlan.volumePrimitives.removedIds,
      ...updatePlan.volumePrimitives.updatedIds,
      ...assetLinkedIds.volumeIds,
    ],
  });
});
sceneRoot.render(<TriangleScene />);

if (!scene) {
  throw new Error('Scene root did not publish an initial scene snapshot');
}

const target = createBrowserSurfaceTarget(canvas.width, canvas.height);
const gpuContext = await requestGpuContext({ target });
const canvasContext = canvas.getContext('webgpu');
if (!canvasContext) {
  throw new Error('Failed to acquire WebGPU canvas context');
}

const surface = configureSurfaceContext(gpuContext, canvasContext as unknown as GPUCanvasContext);
const materialRegistry = createMaterialRegistry();

const drawFrame = () => {
  const evaluatedScene = evaluateScene(scene, { timeMs: performance.now() });
  ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
  renderForwardFrame(gpuContext, surface, residency, evaluatedScene, materialRegistry);
  requestAnimationFrame(drawFrame);
};

requestAnimationFrame(drawFrame);
