/// <reference lib="deno.unstable" />

import { createQuaternionFromEulerDegrees, evaluateScene, getMeshBounds } from '@rieul3d/core';
import type { DesktopModuleContext } from '@rieul3d/desktop';
import { createBoxMesh } from '@rieul3d/geometry';
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
  createNode,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '@rieul3d/ir';
import { importGltfFromGlb } from '@rieul3d/importers';
import { createMaterialRegistry, renderPathtracedFrame } from '@rieul3d/renderer';

const cameraId = 'helmet-pathtraced-camera';
const helmetSource = await Deno.readFile(
  new URL('../assets/damaged-helmet/DamagedHelmet.glb', import.meta.url),
);
const helmetScene = importGltfFromGlb(helmetSource, 'damaged-helmet');
const sourceMesh = helmetScene.meshes[0];

if (!sourceMesh) {
  throw new Error('Damaged Helmet mesh failed to load from the vendored GLB asset');
}

const helmetBounds = getMeshBounds(sourceMesh);
const helmetScale = 1.8 / helmetBounds.maxDimension;
const helmetMesh = {
  ...sourceMesh,
  id: 'damaged-helmet-pathtraced',
  materialId: 'damaged-helmet-pathtraced-material',
};
const floorMesh = {
  ...createBoxMesh({
    id: 'pathtraced-floor',
    materialId: 'pathtraced-floor-material',
    width: 7,
    height: 0.12,
    depth: 7,
  }),
};

const createHelmetScene = () => {
  let scene = createSceneIr('byow-helmet-pathtraced-demo');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera(cameraId, {
        yfov: Math.PI / 4.4,
        znear: 0.05,
        zfar: 100,
      }),
    ),
    cameraId,
  );
  scene = appendMaterial(scene, {
    id: 'damaged-helmet-pathtraced-material',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0.82, y: 0.84, z: 0.88, w: 1 },
    },
  });
  scene = appendMaterial(scene, {
    id: 'pathtraced-floor-material',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0.63, y: 0.64, z: 0.66, w: 1 },
    },
  });
  scene = appendMesh(scene, helmetMesh);
  scene = appendMesh(scene, floorMesh);
  scene = appendNode(
    scene,
    createNode('camera-node', {
      cameraId,
      transform: {
        translation: { x: 0.2, y: 0.25, z: 3.2 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );
  scene = appendNode(
    scene,
    createNode('helmet-node', {
      meshId: helmetMesh.id,
      transform: {
        translation: {
          x: -helmetBounds.center.x * helmetScale,
          y: -(helmetBounds.min.y * helmetScale) - 0.94,
          z: (-helmetBounds.center.z * helmetScale) - 0.45,
        },
        rotation: createQuaternionFromEulerDegrees(72, -32, 0),
        scale: { x: helmetScale, y: helmetScale, z: helmetScale },
      },
    }),
  );
  scene = appendNode(
    scene,
    createNode('floor-node', {
      meshId: floorMesh.id,
      transform: {
        translation: { x: 0, y: -1.02, z: -0.8 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
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
  const scene = createHelmetScene();
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
