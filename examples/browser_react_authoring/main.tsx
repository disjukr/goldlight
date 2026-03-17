/** @jsxImportSource @rieul3d/react */
/** @jsxRuntime automatic */
/// <reference lib="dom" />

import { evaluateScene } from '../../packages/core/mod.ts';
import {
  configureSurfaceContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import { appendMesh, createSceneIr } from '../../packages/ir/mod.ts';
import { createBrowserSurfaceTarget } from '../../packages/platform/mod.ts';
import { authoringTreeToSceneIr } from '../../packages/react/mod.ts';
import { createMaterialRegistry, renderForwardFrame } from '../../packages/renderer/mod.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) {
  throw new Error('Missing #app canvas');
}

canvas.width = 640;
canvas.height = 480;

const TriangleNode = (props: Readonly<{ id: string }>) => (
  <node id={props.id} name='Authored Triangle' meshId='triangle' />
);

const authoredScene = authoringTreeToSceneIr(
  <scene id='react-browser-authoring'>
    <TriangleNode id='triangle-node' />
  </scene>,
);

const scene = appendMesh(createSceneIr(authoredScene.id), {
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
  materialId: undefined,
});

const finalScene = {
  ...scene,
  nodes: authoredScene.nodes,
  rootNodeIds: authoredScene.rootNodeIds,
};

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
  const evaluatedScene = evaluateScene(finalScene, { timeMs: performance.now() });
  ensureSceneMeshResidency(gpuContext, residency, finalScene, evaluatedScene);
  renderForwardFrame(gpuContext, surface, residency, evaluatedScene, materialRegistry);
  requestAnimationFrame(drawFrame);
};

requestAnimationFrame(drawFrame);
