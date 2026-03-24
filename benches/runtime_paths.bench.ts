import { evaluateScene } from '@goldlight/core';
import {
  createMaterialUploadPlan,
  createOffscreenBinding,
  createRuntimeResidency,
  createTextureUploadPlan,
  ensureMaterialResidency,
  ensureSceneMeshResidency,
  type GpuTextureUploadContext,
  uploadTextureResidency,
} from '@goldlight/gpu';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '@goldlight/ir';
import {
  assertRendererSceneCapabilities,
  collectRendererCapabilityIssues,
  createDeferredRenderer,
  createMaterialRegistry,
  type GpuRenderExecutionContext,
  renderForwardFrame,
} from '@goldlight/renderer';

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
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));
  return scene;
};

const createCapabilityBenchScene = () => {
  let scene = createBenchScene();
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:flat-red',
    textures: [],
    parameters: {
      color: { x: 1, y: 0.2, z: 0.2, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-custom',
    materialId: 'material-custom',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [0, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0],
    }],
  });
  scene = appendNode(scene, createNode('custom-mesh-node', { meshId: 'mesh-custom' }));
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

const createMaterialBenchContext = () => ({
  device: {
    createBuffer: (descriptor: GPUBufferDescriptor) => descriptor as unknown as GPUBuffer,
  },
  queue: {
    writeBuffer: () => undefined,
  },
});

const createRenderBenchContext = (): GpuRenderExecutionContext & {
  device: GPUDevice;
} => ({
  device: {
    createShaderModule: () => ({}) as GPUShaderModule,
    createRenderPipeline: () =>
      ({
        getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
      }) as unknown as GPURenderPipeline,
    createBindGroup: () => ({}) as GPUBindGroup,
    createBuffer: (descriptor: GPUBufferDescriptor) => descriptor as unknown as GPUBuffer,
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
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
    writeBuffer: () => undefined,
    submit: () => undefined,
  },
});

const benchMaterial = {
  id: 'material-bench',
  kind: 'unlit',
  textures: [],
  parameters: {
    color: { x: 0.8, y: 0.4, z: 0.2, w: 1 },
    emissive: { x: 0.05, y: 0.1, z: 0.15, w: 0 },
  },
} as const;

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

Deno.bench('material upload planning', () => {
  createMaterialUploadPlan(benchMaterial);
});

Deno.bench('material residency upload', () => {
  ensureMaterialResidency(createMaterialBenchContext(), createRuntimeResidency(), benchMaterial);
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

Deno.bench('scene evaluation', () => {
  evaluateScene(createBenchScene(), { timeMs: 16 });
});

Deno.bench('renderer capability issue collection', () => {
  const scene = createCapabilityBenchScene();
  const issues = collectRendererCapabilityIssues(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  if (issues.length === 0) {
    throw new Error('expected at least one renderer capability issue');
  }
});

Deno.bench('renderer capability assertion', () => {
  const scene = createCapabilityBenchScene();
  let didThrow = false;

  try {
    assertRendererSceneCapabilities(
      createDeferredRenderer(),
      evaluateScene(scene, { timeMs: 0 }),
    );
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    if (!error.message.includes('renderer "deferred" does not support')) {
      throw error;
    }

    didThrow = true;
  }

  if (!didThrow) {
    throw new Error('expected renderer capability assertion to throw');
  }
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
  const binding = createOffscreenBinding({
    device: context.device,
    target: { kind: 'offscreen', width: 64, height: 64, format: 'rgba8unorm', sampleCount: 1 },
  });

  renderForwardFrame(
    context,
    binding,
    runtimeResidency,
    evaluatedScene,
    createMaterialRegistry(),
  );
});
