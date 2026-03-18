/** @jsxImportSource @rieul3d/react */
/** @jsxRuntime automatic */
/// <reference lib="dom" />

import { evaluateScene } from '../../packages/core/mod.ts';
import {
  configureSurfaceContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  invalidateResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import { createBrowserSurfaceTarget } from '../../packages/platform/mod.ts';
import { createSceneRoot, summarizeSceneRootCommit } from '../../packages/react/mod.ts';
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
    <perspectiveCamera id='camera-main' position={[0, 0, 2]} />
    <group id='scene-root' name='Authored Root'>
      <node id='triangle-node' name='Authored Triangle' meshId='triangle' />
    </group>
  </scene>
);

const sceneRoot = createSceneRoot();
let scene = sceneRoot.getScene();
const residency = createRuntimeResidency();

sceneRoot.subscribe((commit) => {
  scene = commit.scene;
  const summary = summarizeSceneRootCommit(commit);
  const needsResidencyReset = summary.assets.addedIds.length > 0 ||
    summary.assets.removedIds.length > 0 ||
    summary.assets.updatedIds.length > 0 ||
    summary.textures.addedIds.length > 0 ||
    summary.textures.removedIds.length > 0 ||
    summary.textures.updatedIds.length > 0 ||
    summary.materials.addedIds.length > 0 ||
    summary.materials.removedIds.length > 0 ||
    summary.materials.updatedIds.length > 0 ||
    summary.meshes.addedIds.length > 0 ||
    summary.meshes.removedIds.length > 0 ||
    summary.meshes.updatedIds.length > 0 ||
    summary.volumePrimitives.addedIds.length > 0 ||
    summary.volumePrimitives.removedIds.length > 0 ||
    summary.volumePrimitives.updatedIds.length > 0;

  if (needsResidencyReset) {
    invalidateResidency(residency);
  }
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
