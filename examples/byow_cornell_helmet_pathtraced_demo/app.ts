/// <reference lib="deno.unstable" />

import { createQuaternionFromEulerDegrees, evaluateScene, getMeshBounds } from '@rieul3d/core';
import type { DesktopModuleContext } from '@rieul3d/desktop';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@rieul3d/gpu';
import {
  appendCamera,
  appendMaterial,
  appendMesh,
  appendNode,
  appendSdfPrimitive,
  createNode,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '@rieul3d/ir';
import { importGltfFromGlb } from '@rieul3d/importers';
import { createMaterialRegistry, renderPathtracedFrame } from '@rieul3d/renderer';

const cameraId = 'cornell-helmet-camera';
const helmetSource = await Deno.readFile(
  new URL('../assets/damaged-helmet/DamagedHelmet.glb', import.meta.url),
);
const helmetScene = importGltfFromGlb(helmetSource, 'damaged-helmet');
const sourceMesh = helmetScene.meshes[0];

if (!sourceMesh) {
  throw new Error('Damaged Helmet mesh failed to load from the vendored GLB asset');
}

const helmetBounds = getMeshBounds(sourceMesh);
const helmetScale = 1.15 / helmetBounds.maxDimension;
const helmetMesh = {
  ...sourceMesh,
  id: 'cornell-damaged-helmet',
  materialId: 'cornell-damaged-helmet-material',
};

const createCornellHelmetScene = () => {
  let scene = createSceneIr('byow-cornell-helmet-pathtraced-demo');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera(cameraId, {
        yfov: Math.PI / 4.1,
        znear: 0.1,
        zfar: 100,
      }),
    ),
    cameraId,
  );
  scene = appendMaterial(scene, {
    id: 'cornell-damaged-helmet-material',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0.84, y: 0.85, z: 0.88, w: 1 },
    },
  });
  scene = appendMesh(scene, helmetMesh);
  scene = appendNode(
    scene,
    createNode('cornell-camera-node', {
      cameraId,
      transform: {
        translation: { x: 0, y: -0.05, z: 3.45 },
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
          color: { x: 1, y: 0.97, z: 0.92, w: 5 },
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
      id: 'pedestal',
      primitive: {
        id: 'pedestal',
        op: 'box' as const,
        parameters: {
          size: { x: 0.52, y: 0.2, z: 0.52, w: 0 },
          color: { x: 0.8, y: 0.8, z: 0.78, w: 0 },
        },
      },
      nodeId: 'pedestal-node',
      translation: [0, -1.3, -1.78] as const,
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

  scene = appendNode(
    scene,
    createNode('helmet-node', {
      meshId: helmetMesh.id,
      transform: {
        translation: {
          x: -helmetBounds.center.x * helmetScale,
          y: -(helmetBounds.min.y * helmetScale) - 1.08,
          z: (-helmetBounds.center.z * helmetScale) - 1.78,
        },
        rotation: createQuaternionFromEulerDegrees(72, -32, 0),
        scale: { x: helmetScale, y: helmetScale, z: helmetScale },
      },
    }),
  );

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
  const materialRegistry = createMaterialRegistry();
  const scene = createCornellHelmetScene();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  let frameHandle = 0;
  const drawFrame = () => {
    renderPathtracedFrame(gpuContext, binding, residency, evaluatedScene, materialRegistry);
    window.present();
    frameHandle = requestAnimationFrame(drawFrame);
  };

  frameHandle = requestAnimationFrame(drawFrame);

  return () => {
    cancelAnimationFrame(frameHandle);
  };
};
