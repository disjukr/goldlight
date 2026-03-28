/// <reference lib="deno.unstable" />

import type { DesktopModuleContext } from '@disjukr/goldlight/desktop';
import { evaluateScene } from '@disjukr/goldlight/renderer';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@disjukr/goldlight/gpu';
import {
  appendCamera,
  appendNode,
  createNode,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '@disjukr/goldlight/ir';
import type { PathtracedSceneExtension } from '@disjukr/goldlight/renderer';
import { renderPathtracedFrame } from '@disjukr/goldlight/renderer';

const cameraId = 'cornell-camera';

const createCornellScene = () => {
  let scene = createSceneIr('byow-cornell-pathtraced-demo');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera(cameraId, {
        yfov: Math.PI / 4.2,
        znear: 0.1,
        zfar: 100,
      }),
    ),
    cameraId,
  );

  scene = appendNode(
    scene,
    createNode('cornell-camera-node', {
      cameraId,
      transform: {
        translation: { x: 0, y: -0.1, z: 3.6 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  return scene;
};

const createCornellExtension = (): PathtracedSceneExtension => ({
  sdfPrimitives: [
    {
      id: 'floor',
      op: 'box',
      center: [0, -1.55, -1.6],
      halfExtents: [1.6, 0.05, 1.6],
      color: [0.74, 0.74, 0.72, 0],
    },
    {
      id: 'ceiling',
      op: 'box',
      center: [0, 1.55, -1.6],
      halfExtents: [1.6, 0.05, 1.6],
      color: [0.74, 0.74, 0.72, 0],
    },
    {
      id: 'light-panel',
      op: 'box',
      center: [0, 1.46, -1.6],
      halfExtents: [0.45, 0.02, 0.45],
      color: [1, 0.97, 0.92, 5],
    },
    {
      id: 'back-wall',
      op: 'box',
      center: [0, 0, -3.15],
      halfExtents: [1.6, 1.6, 0.05],
      color: [0.74, 0.74, 0.72, 0],
    },
    {
      id: 'left-wall',
      op: 'box',
      center: [-1.55, 0, -1.6],
      halfExtents: [0.05, 1.6, 1.6],
      color: [0.72, 0.12, 0.1, 0],
    },
    {
      id: 'right-wall',
      op: 'box',
      center: [1.55, 0, -1.6],
      halfExtents: [0.05, 1.6, 1.6],
      color: [0.12, 0.54, 0.16, 0],
    },
    {
      id: 'short-box',
      op: 'box',
      center: [-0.55, -0.92, -2.2],
      halfExtents: [0.42, 0.62, 0.42],
      color: [0.82, 0.82, 0.8, 0],
    },
    {
      id: 'sphere',
      op: 'sphere',
      center: [0.62, -1.08, -1.38],
      radius: 0.46,
      color: [0.88, 0.88, 0.86, 0],
    },
  ],
});

export default async ({ window }: DesktopModuleContext): Promise<() => void> => {
  const target = {
    kind: 'surface' as const,
    width: window.surfaceInfo.width,
    height: window.surfaceInfo.height,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
  };
  const gpuContext = await requestGpuContext({ target });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const residency = createRuntimeResidency();
  const scene = createCornellScene();
  const extension = createCornellExtension();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  let frameHandle = 0;
  const drawFrame = () => {
    renderPathtracedFrame(gpuContext, binding, residency, evaluatedScene, { extension });
    window.present();
    frameHandle = requestAnimationFrame(drawFrame);
  };

  frameHandle = requestAnimationFrame(drawFrame);

  return () => {
    cancelAnimationFrame(frameHandle);
  };
};
