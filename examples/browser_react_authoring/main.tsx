/** @jsxImportSource @goldlight/react */
/** @jsxRuntime automatic */
/// <reference lib="dom" />

import { evaluateScene } from '../../packages/core/mod.ts';
import {
  applyRuntimeResidencyPlan,
  createRuntimeResidency,
  createSurfaceBinding,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import {
  createG3dSceneRoot,
  G3dPerspectiveCamera,
  planG3dSceneRootResidencyInvalidation,
} from '../../packages/react/mod.ts';
import { createMaterialRegistry, renderForwardFrame } from '../../packages/renderer/mod.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) {
  throw new Error('Missing #app canvas');
}

canvas.width = 640;
canvas.height = 480;

const TriangleScene = () => (
  <g3d-scene id='react-browser-authoring' activeCameraId='camera-main'>
    <g3d-material
      id='triangle-material'
      kind='unlit'
      textures={[]}
      parameters={{
        color: { x: 0.19, y: 0.62, z: 0.97, w: 1 },
      }}
    />
    <g3d-mesh
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
    <G3dPerspectiveCamera id='camera-main' position={[0, 0, 2]} />
    <g3d-group id='scene-root' name='Authored Root'>
      <g3d-node id='triangle-node' name='Authored Triangle' meshId='triangle' />
    </g3d-group>
  </g3d-scene>
);

const sceneRoot = createG3dSceneRoot();
let scene = sceneRoot.getScene();
const residency = createRuntimeResidency();

sceneRoot.subscribe((commit) => {
  scene = commit.scene;
  applyRuntimeResidencyPlan(residency, planG3dSceneRootResidencyInvalidation(commit));
});
sceneRoot.render(<TriangleScene />);

if (!scene) {
  throw new Error('Scene root did not publish an initial scene snapshot');
}

const target = {
  kind: 'surface',
  width: canvas.width,
  height: canvas.height,
  format: 'bgra8unorm',
  alphaMode: undefined,
} as const;
const gpuContext = await requestGpuContext({ target });
const canvasContext = canvas.getContext('webgpu');
if (!canvasContext) {
  throw new Error('Failed to acquire WebGPU canvas context');
}

const surface = createSurfaceBinding(gpuContext, canvasContext as unknown as GPUCanvasContext);
const materialRegistry = createMaterialRegistry();

const drawFrame = () => {
  const currentScene = scene;
  if (!currentScene) {
    throw new Error('Scene root stopped publishing scene snapshots');
  }

  const evaluatedScene = evaluateScene(currentScene, { timeMs: performance.now() });
  ensureSceneMeshResidency(gpuContext, residency, currentScene, evaluatedScene);
  renderForwardFrame(gpuContext, surface, residency, evaluatedScene, materialRegistry);
  requestAnimationFrame(drawFrame);
};

requestAnimationFrame(drawFrame);
