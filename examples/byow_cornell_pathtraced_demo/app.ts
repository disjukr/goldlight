/// <reference lib="deno.unstable" />

import type { DesktopModuleContext } from '@rieul3d/desktop';
import { evaluateScene } from '@rieul3d/core';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@rieul3d/gpu';
import {
  appendCamera,
  appendNode,
  appendSdfPrimitive,
  createNode,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '@rieul3d/ir';
import { renderPathtracedFrame } from '@rieul3d/renderer';

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

  const primitives = [
    {
      id: 'floor',
      primitive: {
        id: 'floor',
        op: 'box' as const,
        parameters: {
          size: { x: 1.6, y: 0.05, z: 1.6, w: 0 },
          color: { x: 0.74, y: 0.74, z: 0.72, w: 0 },
        },
      },
      nodeId: 'floor-node',
      translation: [0, -1.55, -1.6] as const,
    },
    {
      id: 'ceiling',
      primitive: {
        id: 'ceiling',
        op: 'box' as const,
        parameters: {
          size: { x: 1.6, y: 0.05, z: 1.6, w: 0 },
          color: { x: 0.74, y: 0.74, z: 0.72, w: 0 },
        },
      },
      nodeId: 'ceiling-node',
      translation: [0, 1.55, -1.6] as const,
    },
    {
      id: 'light-panel',
      primitive: {
        id: 'light-panel',
        op: 'box' as const,
        parameters: {
          size: { x: 0.45, y: 0.02, z: 0.45, w: 0 },
          color: { x: 1, y: 0.97, z: 0.92, w: 18 },
        },
      },
      nodeId: 'light-panel-node',
      translation: [0, 1.46, -1.6] as const,
    },
    {
      id: 'back-wall',
      primitive: {
        id: 'back-wall',
        op: 'box' as const,
        parameters: {
          size: { x: 1.6, y: 1.6, z: 0.05, w: 0 },
          color: { x: 0.74, y: 0.74, z: 0.72, w: 0 },
        },
      },
      nodeId: 'back-wall-node',
      translation: [0, 0, -3.15] as const,
    },
    {
      id: 'left-wall',
      primitive: {
        id: 'left-wall',
        op: 'box' as const,
        parameters: {
          size: { x: 0.05, y: 1.6, z: 1.6, w: 0 },
          color: { x: 0.72, y: 0.12, z: 0.1, w: 0 },
        },
      },
      nodeId: 'left-wall-node',
      translation: [-1.55, 0, -1.6] as const,
    },
    {
      id: 'right-wall',
      primitive: {
        id: 'right-wall',
        op: 'box' as const,
        parameters: {
          size: { x: 0.05, y: 1.6, z: 1.6, w: 0 },
          color: { x: 0.12, y: 0.54, z: 0.16, w: 0 },
        },
      },
      nodeId: 'right-wall-node',
      translation: [1.55, 0, -1.6] as const,
    },
    {
      id: 'short-box',
      primitive: {
        id: 'short-box',
        op: 'box' as const,
        parameters: {
          size: { x: 0.42, y: 0.62, z: 0.42, w: 0 },
          color: { x: 0.82, y: 0.82, z: 0.8, w: 0 },
        },
      },
      nodeId: 'short-box-node',
      translation: [-0.55, -0.92, -2.2] as const,
    },
    {
      id: 'sphere',
      primitive: {
        id: 'sphere',
        op: 'sphere' as const,
        parameters: {
          radius: { x: 0.46, y: 0, z: 0, w: 0 },
          color: { x: 0.88, y: 0.88, z: 0.86, w: 0 },
        },
      },
      nodeId: 'sphere-node',
      translation: [0.62, -1.08, -1.38] as const,
    },
  ] as const;

  for (const entry of primitives) {
    scene = appendSdfPrimitive(scene, entry.primitive);
    scene = appendNode(
      scene,
      createNode(entry.nodeId, {
        sdfId: entry.id,
        transform: {
          translation: {
            x: entry.translation[0],
            y: entry.translation[1],
            z: entry.translation[2],
          },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
      }),
    );
  }

  return scene;
};

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
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  let frameHandle = 0;
  const drawFrame = () => {
    renderPathtracedFrame(gpuContext, binding, residency, evaluatedScene);
    window.present();
    frameHandle = requestAnimationFrame(drawFrame);
  };

  frameHandle = requestAnimationFrame(drawFrame);

  return () => {
    cancelAnimationFrame(frameHandle);
  };
};
