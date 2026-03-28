/// <reference lib="dom" />

import { evaluateScene } from '@disjukr/goldlight/renderer';
import {
  type AssetSource,
  createRuntimeResidency,
  createSurfaceBinding,
  ensureSceneMeshResidency,
  ensureSceneTextureResidency,
  requestGpuContext,
} from '@disjukr/goldlight/gpu';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '@disjukr/goldlight/ir';
import { createMaterialRegistry, renderForwardFrame } from '@disjukr/goldlight/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) {
  throw new Error('Missing #app canvas');
}

canvas.width = 640;
canvas.height = 480;

const textureAssetId = 'checkerboard-image';
const textureId = 'checkerboard-texture';
const materialId = 'checkerboard-material';
const meshId = 'textured-quad';

const scene = appendNode(
  appendMesh(
    appendMaterial(
      appendTexture(createSceneIr('browser-forward-textured'), {
        id: textureId,
        assetId: textureAssetId,
        semantic: 'baseColor',
        colorSpace: 'srgb',
        sampler: 'nearest-repeat',
      }),
      {
        id: materialId,
        kind: 'unlit',
        textures: [{
          id: textureId,
          assetId: textureAssetId,
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'nearest-repeat',
        }],
        parameters: {
          color: { x: 1, y: 1, z: 1, w: 1 },
        },
      },
    ),
    {
      id: meshId,
      materialId,
      attributes: [
        {
          semantic: 'POSITION',
          itemSize: 3,
          values: [
            -0.7,
            0.7,
            0,
            -0.7,
            -0.7,
            0,
            0.7,
            -0.7,
            0,
            0.7,
            0.7,
            0,
          ],
        },
        {
          semantic: 'TEXCOORD_0',
          itemSize: 2,
          values: [
            0,
            0,
            0,
            1,
            1,
            1,
            1,
            0,
          ],
        },
      ],
      indices: [0, 1, 2, 0, 2, 3],
    },
  ),
  createNode('textured-quad-node', {
    meshId,
  }),
);

const assetSource: AssetSource = {
  images: new Map([[
    textureAssetId,
    {
      id: textureAssetId,
      mimeType: 'image/raw-rgba',
      width: 2,
      height: 2,
      pixelFormat: 'rgba8unorm',
      bytes: Uint8Array.from([
        255,
        96,
        64,
        255,
        255,
        230,
        92,
        255,
        44,
        112,
        255,
        255,
        28,
        28,
        40,
        255,
      ]),
    },
  ]]),
  volumes: new Map(),
};

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
const residency = createRuntimeResidency();
const materialRegistry = createMaterialRegistry();
const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
ensureSceneTextureResidency(gpuContext, residency, scene, assetSource);

const drawFrame = () => {
  renderForwardFrame(gpuContext, surface, residency, {}, evaluatedScene, materialRegistry);
  requestAnimationFrame(drawFrame);
};

requestAnimationFrame(drawFrame);
