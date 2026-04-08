// @ts-nocheck
import { readFile } from 'node:fs/promises';

import { getMeshBounds } from '@disjukr/goldlight/geometry';
import { createQuaternionFromEulerDegrees } from '@disjukr/goldlight/math';
import { evaluateScene } from '@disjukr/goldlight/renderer';
import type { DesktopModuleContext } from '@disjukr/goldlight/desktop';
import { createBoxMesh } from '@disjukr/goldlight/geometry';
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
  appendLight,
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '@disjukr/goldlight/ir';
import { importGltfFromGlbWithAssets } from '@disjukr/goldlight/importers';
import { createMaterialRegistry, renderPathtracedFrame } from '@disjukr/goldlight/renderer';

const cameraId = 'helmet-pathtraced-camera';
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
const helmetScale = 1.8 / helmetBounds.maxDimension;
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
        yfov: Math.PI / 4.4,
        znear: 0.05,
        zfar: 100,
      }),
    ),
    cameraId,
  );
  scene = appendMaterial(scene, {
    id: 'pathtraced-floor-material',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0.63, y: 0.64, z: 0.66, w: 1 },
    },
  });
  scene = appendLight(scene, {
    id: 'helmet-pathtraced-sun',
    kind: 'directional',
    color: { x: 0.95, y: 0.9, z: 0.84 },
    intensity: 0.65,
  });
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
      meshId: sourceMesh.id,
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
    createNode('sun-node', {
      lightId: 'helmet-pathtraced-sun',
      transform: {
        translation: { x: 0, y: 0, z: 0 },
        rotation: createQuaternionFromEulerDegrees(-62, 24, 0),
        scale: { x: 1, y: 1, z: 1 },
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
  const gpuContext = await requestGpuContext({ target, compatibleSurface: window.compatibleSurface });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const residency = createRuntimeResidency();
  const materialRegistry = createMaterialRegistry();
  const scene = createHelmetScene();
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
    renderPathtracedFrame(gpuContext, binding, residency, evaluatedScene, materialRegistry);
    window.present();
    frameHandle = window.runtime.requestAnimationFrame(drawFrame);
  };

  frameHandle = window.runtime.requestAnimationFrame(drawFrame);

  return () => {
    window.runtime.cancelAnimationFrame(frameHandle);
  };
};



