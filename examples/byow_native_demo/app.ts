/// <reference lib="deno.unstable" />

import type { DesktopModuleContext } from '@goldlight/desktop';
import { evaluateScene } from '@goldlight/core';
import {
  type AssetSource,
  createRuntimeResidency,
  createSurfaceBinding,
  ensureSceneMaterialResidency,
  ensureSceneMeshResidency,
  ensureSceneTextureResidency,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@goldlight/gpu';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '@goldlight/ir';
import { createMaterialRegistry, renderForwardFrame } from '@goldlight/renderer';

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
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

  ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
  ensureSceneMaterialResidency(gpuContext, residency, evaluatedScene);
  ensureSceneTextureResidency(gpuContext, residency, scene, assetSource);

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  let frameHandle = 0;
  const drawFrame = () => {
    renderForwardFrame(gpuContext, binding, residency, {}, evaluatedScene, materialRegistry);
    window.present();
    frameHandle = requestAnimationFrame(drawFrame);
  };

  frameHandle = requestAnimationFrame(drawFrame);

  return () => {
    cancelAnimationFrame(frameHandle);
  };
};
