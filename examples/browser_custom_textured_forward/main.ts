/// <reference lib="dom" />

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
import { createBrowserSurfaceTarget } from '../../packages/platform/mod.ts';
import {
  createMaterialRegistry,
  registerWgslMaterial,
  renderForwardFrame,
} from '../../packages/renderer/mod.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) {
  throw new Error('Missing #app canvas');
}

canvas.width = 640;
canvas.height = 480;

const textureAssetId = 'custom-checkerboard-image';
const textureId = 'custom-checkerboard-texture';
const materialId = 'custom-checkerboard-material';
const meshId = 'custom-textured-quad';
const shaderId = 'shader:custom-textured-unlit';

const scene = appendNode(
  appendMesh(
    appendMaterial(
      appendTexture(createSceneIr('browser-custom-textured-forward'), {
        id: textureId,
        assetId: textureAssetId,
        semantic: 'baseColor',
        colorSpace: 'srgb',
        sampler: 'nearest-repeat',
      }),
      {
        id: materialId,
        kind: 'custom',
        shaderId,
        textures: [{
          id: textureId,
          assetId: textureAssetId,
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'nearest-repeat',
        }],
        parameters: {
          color: { x: 0.85, y: 1, z: 0.95, w: 1 },
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
          values: [-0.7, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0, 0.7, 0.7, 0],
        },
        {
          semantic: 'TEXCOORD_0',
          itemSize: 2,
          values: [0, 0, 0, 1, 1, 1, 1, 0],
        },
      ],
      indices: [0, 1, 2, 0, 2, 3],
    },
  ),
  createNode('custom-textured-quad-node', {
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

const materialRegistry = registerWgslMaterial(createMaterialRegistry(), {
  id: shaderId,
  label: 'Custom Textured Unlit',
  wgsl: `
struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct MeshTransform {
  world: mat4x4<f32>,
};

struct MaterialUniforms {
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(2) var baseColorSampler: sampler;

@vertex
fn vsMain(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.world * vec4<f32>(position, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(input: VsOut) -> @location(0) vec4<f32> {
  return textureSample(baseColorTexture, baseColorSampler, input.uv) * material.color;
}
`,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [
    { kind: 'uniform', binding: 0 },
    { kind: 'texture', binding: 1, textureSemantic: 'baseColor' },
    { kind: 'sampler', binding: 2, textureSemantic: 'baseColor' },
  ],
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'TEXCOORD_0',
      shaderLocation: 1,
      format: 'float32x2',
      offset: 0,
      arrayStride: 8,
    },
  ],
});

const target = createBrowserSurfaceTarget(canvas.width, canvas.height);
const gpuContext = await requestGpuContext({ target });
const canvasContext = canvas.getContext('webgpu');
if (!canvasContext) {
  throw new Error('Failed to acquire WebGPU canvas context');
}

const surface = configureSurfaceContext(gpuContext, canvasContext as unknown as GPUCanvasContext);
const residency = createRuntimeResidency();
const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
ensureSceneTextureResidency(gpuContext, residency, scene, assetSource);

const drawFrame = () => {
  renderForwardFrame(gpuContext, surface, residency, evaluatedScene, materialRegistry);
  requestAnimationFrame(drawFrame);
};

requestAnimationFrame(drawFrame);
