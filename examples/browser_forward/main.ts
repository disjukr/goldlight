/// <reference lib="dom" />

import { evaluateScene } from '../../packages/core/mod.ts';
import {
  configureSurfaceContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import { appendMesh, appendNode, createNode, createSceneIr } from '../../packages/ir/mod.ts';
import { createBrowserSurfaceTarget } from '../../packages/platform/mod.ts';
import { createMaterialRegistry, renderForwardFrame } from '../../packages/renderer/mod.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) {
  throw new Error('Missing #app canvas');
}

canvas.width = 640;
canvas.height = 480;

const scene = appendNode(
  appendMesh(createSceneIr('browser-forward'), {
    id: 'triangle',
    attributes: [{
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
    }],
  }),
  createNode('triangle-node', {
    meshId: 'triangle',
  }),
);

const target = createBrowserSurfaceTarget(canvas.width, canvas.height);
const gpuContext = await requestGpuContext({ target });
const canvasContext = canvas.getContext('webgpu');
if (!canvasContext) {
  throw new Error('Failed to acquire WebGPU canvas context');
}

const surface = configureSurfaceContext(gpuContext, canvasContext as unknown as GPUCanvasContext);
const residency = createRuntimeResidency();
const materialRegistry = createMaterialRegistry();

const drawFrame = () => {
  const evaluatedScene = evaluateScene(scene, { timeMs: performance.now() });
  ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
  renderForwardFrame(gpuContext, surface, residency, evaluatedScene, materialRegistry);
  requestAnimationFrame(drawFrame);
};

requestAnimationFrame(drawFrame);
