import { evaluateScene } from '@rieul3d/core';
import {
  createOffscreenContext,
  createRuntimeResidency,
  createTextureUploadPlan,
  createVolumeUploadPlan,
  ensureSceneMeshResidency,
  type GpuTextureUploadContext,
  uploadTextureResidency,
  uploadVolumeResidency,
} from '@rieul3d/gpu';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '@rieul3d/ir';
import { createHeadlessTarget } from '@rieul3d/platform';
import {
  createMaterialRegistry,
  type GpuRenderExecutionContext,
  renderForwardFrame,
} from '@rieul3d/renderer';

const createBenchScene = () => {
  let scene = createSceneIr('bench-scene');
  scene = appendTexture(scene, {
    id: 'texture-0',
    assetId: 'image-0',
    semantic: 'baseColor',
    colorSpace: 'srgb',
    sampler: 'linear-repeat',
  });
  scene = appendMaterial(scene, {
    id: 'material-0',
    kind: 'unlit',
    textures: [],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-0',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [
        0,
        0.7,
        0,
        -0.7,
        -0.7,
        0,
        0.7,
        -0.7,
        0,
      ],
    }],
  });
  scene = {
    ...scene,
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 8, y: 8, z: 8 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));
  scene = appendNode(scene, createNode('volume-node', { volumeId: 'volume-0' }));
  return scene;
};

const imageAsset = {
  id: 'image-0',
  mimeType: 'image/raw+rgba8',
  bytes: new Uint8Array([
    255,
    0,
    0,
    255,
    0,
    255,
    0,
    255,
    0,
    0,
    255,
    255,
    255,
    255,
    255,
    255,
  ]),
  width: 2,
  height: 2,
} as const;

const volumeAsset = {
  id: 'volume-asset-0',
  mimeType: 'application/octet-stream',
  bytes: new Uint8Array(8 * 8 * 8),
  width: 8,
  height: 8,
  depth: 8,
} as const;

const createTextureBenchContext = (): GpuTextureUploadContext => ({
  device: {
    createTexture: (descriptor) => ({
      ...descriptor,
      createView: () => ({}) as GPUTextureView,
    } as unknown as GPUTexture),
    createSampler: () => ({}) as GPUSampler,
  },
  queue: {
    writeTexture: () => undefined,
  },
});

const createRenderBenchContext = (): GpuRenderExecutionContext & {
  device: GPUDevice;
} => ({
  device: {
    createShaderModule: () => ({}) as GPUShaderModule,
    createRenderPipeline: () => ({}) as GPURenderPipeline,
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline: () => undefined,
        setVertexBuffer: () => undefined,
        setIndexBuffer: () => undefined,
        draw: () => undefined,
        drawIndexed: () => undefined,
        end: () => undefined,
      }),
      finish: () => ({}) as GPUCommandBuffer,
    }),
    createTexture: () => ({
      createView: () => ({}) as GPUTextureView,
    } as GPUTexture),
  } as unknown as GPUDevice,
  queue: {
    submit: () => undefined,
  },
});

Deno.bench('mesh residency preparation', () => {
  const scene = createBenchScene();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  const runtimeResidency = createRuntimeResidency();
  const context = {
    device: {
      createBuffer: (descriptor: GPUBufferDescriptor) => descriptor as unknown as GPUBuffer,
    },
    queue: {
      writeBuffer: () => undefined,
    },
  };

  ensureSceneMeshResidency(context, runtimeResidency, scene, evaluatedScene);
});

Deno.bench('texture upload planning', () => {
  createTextureUploadPlan({
    id: 'texture-0',
    assetId: 'image-0',
    semantic: 'baseColor',
    colorSpace: 'srgb',
    sampler: 'linear-repeat',
  }, imageAsset);
});

Deno.bench('texture residency upload', () => {
  uploadTextureResidency(
    createTextureBenchContext(),
    {
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    },
    imageAsset,
  );
});

Deno.bench('volume upload planning', () => {
  createVolumeUploadPlan({
    id: 'volume-0',
    assetId: 'volume-asset-0',
    dimensions: { x: 8, y: 8, z: 8 },
    format: 'density:r8unorm',
  }, volumeAsset);
});

Deno.bench('volume residency upload', () => {
  uploadVolumeResidency(
    createTextureBenchContext(),
    {
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 8, y: 8, z: 8 },
      format: 'density:r8unorm',
    },
    volumeAsset,
  );
});

Deno.bench('scene evaluation', () => {
  evaluateScene(createBenchScene(), { timeMs: 16 });
});

Deno.bench('forward frame encoding', () => {
  const scene = createBenchScene();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  const runtimeResidency = createRuntimeResidency();
  runtimeResidency.geometry.set('mesh-0', {
    meshId: 'mesh-0',
    attributeBuffers: { POSITION: {} as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  const context = createRenderBenchContext();
  const binding = createOffscreenContext({
    device: context.device,
    target: createHeadlessTarget(64, 64),
  });

  renderForwardFrame(
    context,
    binding,
    runtimeResidency,
    evaluatedScene,
    createMaterialRegistry(),
  );
});
