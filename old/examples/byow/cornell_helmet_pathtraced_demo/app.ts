// @ts-nocheck
import { readFile } from 'node:fs/promises';

import { getMeshBounds } from '@disjukr/goldlight/geometry';
import { createQuaternionFromEulerDegrees } from '@disjukr/goldlight/math';
import { evaluateScene } from '@disjukr/goldlight/renderer';
import type { DesktopModuleContext } from '@disjukr/goldlight/desktop';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  ensureSceneMaterialResidency,
  ensureSceneMeshResidency,
  ensureSceneTextureResidency,
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
import { importGltfFromGlbWithAssets } from '@disjukr/goldlight/importers';
import {
  createMaterialRegistry,
  type PathtracedSceneExtension,
  renderPathtracedFrame,
} from '@disjukr/goldlight/renderer';

const cameraId = 'cornell-helmet-camera';
const helmetSource = await readFile(
  new URL('../../assets/damaged-helmet/DamagedHelmet.glb', import.meta.url),
);
const { scene: helmetScene, assetSource: helmetAssetSource } = importGltfFromGlbWithAssets(
  helmetSource,
  'damaged-helmet',
);
const sourceMesh = helmetScene.meshes[0];

if (!sourceMesh) {
  throw new Error('Damaged Helmet mesh failed to load from the vendored GLB asset');
}

const helmetBounds = getMeshBounds(sourceMesh);
const helmetScale = 1.56 / helmetBounds.maxDimension;

const createCornellHelmetScene = () => {
  let scene = createSceneIr('byow-cornell-helmet-pathtraced-demo');
  scene = {
    ...scene,
    assets: [...scene.assets, ...helmetScene.assets],
    textures: [...scene.textures, ...helmetScene.textures],
    materials: [...scene.materials, ...helmetScene.materials],
    meshes: [...scene.meshes, ...helmetScene.meshes],
  };
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
  scene = appendNode(
    scene,
    createNode('helmet-node', {
      meshId: sourceMesh.id,
      transform: {
        translation: {
          x: -helmetBounds.center.x * helmetScale,
          y: -(helmetBounds.min.y * helmetScale) - 0.84,
          z: (-helmetBounds.center.z * helmetScale) - 1.78,
        },
        rotation: createQuaternionFromEulerDegrees(72, -32, 0),
        scale: { x: helmetScale, y: helmetScale, z: helmetScale },
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
      id: 'pedestal',
      op: 'box',
      center: [0, -1.16, -1.78],
      halfExtents: [0.78, 0.34, 0.78],
      color: [0.8, 0.8, 0.78, 0],
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
  const gpuContext = await requestGpuContext({ target, compatibleSurface: window.compatibleSurface });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const residency = createRuntimeResidency();
  const materialRegistry = createMaterialRegistry();
  const scene = createCornellHelmetScene();
  const extension = createCornellExtension();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
  ensureSceneMaterialResidency(gpuContext, residency, evaluatedScene);
  ensureSceneTextureResidency(gpuContext, residency, scene, helmetAssetSource);

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  let frameHandle = 0;
  const drawFrame = () => {
    renderPathtracedFrame(gpuContext, binding, residency, evaluatedScene, {
      materialRegistry,
      extension,
    });
    window.present();
    frameHandle = window.runtime.requestAnimationFrame(drawFrame);
  };

  frameHandle = window.runtime.requestAnimationFrame(drawFrame);

  return () => {
    window.runtime.cancelAnimationFrame(frameHandle);
  };
};



