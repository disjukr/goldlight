/// <reference lib="deno.unstable" />

import { EventType, WindowBuilder } from 'jsr:@divy/sdl2@0.15.0';
import { evaluateScene } from '../../packages/core/mod.ts';
import {
  type AssetSource,
  configureSurfaceContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  ensureSceneTextureResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '../../packages/ir/mod.ts';
import { createDenoSurfaceTarget } from '../../packages/platform/mod.ts';
import { createMaterialRegistry, renderForwardFrame } from '../../packages/renderer/mod.ts';

const width = 960;
const height = 540;
const textureAssetId = 'checkerboard-image';
const textureId = 'checkerboard-texture';
const texturedMaterialId = 'checkerboard-material';
const accentMaterialId = 'accent-material';
const quadMeshId = 'checkerboard-quad';
const accentMeshId = 'accent-triangle';

const scene = appendNode(
  appendNode(
    appendMesh(
      appendMesh(
        appendMaterial(
          appendMaterial(
            appendTexture(createSceneIr('byow-native-demo'), {
              id: textureId,
              assetId: textureAssetId,
              semantic: 'baseColor',
              colorSpace: 'srgb',
              sampler: 'nearest-repeat',
            }),
            {
              id: texturedMaterialId,
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
            id: accentMaterialId,
            kind: 'unlit',
            textures: [],
            parameters: {
              color: { x: 0.92, y: 0.36, z: 0.18, w: 1 },
            },
          },
        ),
        {
          id: quadMeshId,
          materialId: texturedMaterialId,
          attributes: [
            {
              semantic: 'POSITION',
              itemSize: 3,
              values: [
                -0.9,
                0.75,
                0,
                -0.9,
                -0.75,
                0,
                0.35,
                -0.75,
                0,
                0.35,
                0.75,
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
                3,
                3,
                3,
                3,
                0,
              ],
            },
          ],
          indices: [0, 1, 2, 0, 2, 3],
        },
      ),
      {
        id: accentMeshId,
        materialId: accentMaterialId,
        attributes: [{
          semantic: 'POSITION',
          itemSize: 3,
          values: [
            0.15,
            0.7,
            0,
            0.92,
            0.18,
            0,
            0.44,
            -0.72,
            0,
          ],
        }],
      },
    ),
    createNode('checkerboard-quad-node', {
      meshId: quadMeshId,
    }),
  ),
  createNode('accent-triangle-node', {
    meshId: accentMeshId,
  }),
);

const assetSource: AssetSource = {
  images: new Map([[
    textureAssetId,
    {
      id: textureAssetId,
      mimeType: 'image/raw-rgba',
      width: 4,
      height: 4,
      pixelFormat: 'rgba8unorm',
      bytes: Uint8Array.from([
        22,
        28,
        36,
        255,
        236,
        229,
        116,
        255,
        22,
        28,
        36,
        255,
        236,
        229,
        116,
        255,
        236,
        229,
        116,
        255,
        67,
        115,
        201,
        255,
        236,
        229,
        116,
        255,
        67,
        115,
        201,
        255,
        22,
        28,
        36,
        255,
        236,
        229,
        116,
        255,
        22,
        28,
        36,
        255,
        236,
        229,
        116,
        255,
        236,
        229,
        116,
        255,
        67,
        115,
        201,
        255,
        236,
        229,
        116,
        255,
        67,
        115,
        201,
        255,
      ]),
    },
  ]]),
  volumes: new Map(),
};

const window = new WindowBuilder('rieul3d byow native demo', width, height).build();
const target = createDenoSurfaceTarget(
  width,
  height,
  navigator.gpu.getPreferredCanvasFormat(),
  'opaque',
);
const gpuContext = await requestGpuContext({ target });
const windowSurface = window.windowSurface(width, height);
const canvasContext = windowSurface.getContext('webgpu');

const surfaceBinding = configureSurfaceContext(
  gpuContext,
  canvasContext as unknown as GPUCanvasContext,
);
const residency = createRuntimeResidency();
const materialRegistry = createMaterialRegistry();
const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
ensureSceneTextureResidency(gpuContext, residency, scene, assetSource);

const drawFrame = () => {
  renderForwardFrame(gpuContext, surfaceBinding, residency, evaluatedScene, materialRegistry);
  windowSurface.present();
};

for await (const event of window.events()) {
  switch (event.type) {
    case EventType.Draw:
      drawFrame();
      break;
    case EventType.Quit:
      Deno.exit(0);
      break;
  }
}
