import { assert, assertEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createOffscreenBinding, createRuntimeResidency } from '@rieul3d/gpu';
import { appendMaterial, appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import {
  createMaterialRegistry,
  ensureMaterialPipeline,
  type GpuRenderExecutionContext,
  registerWgslMaterial,
  registerWgslMaterialTemplate,
  renderForwardFrame,
  resolveMaterialVariant,
} from '@rieul3d/renderer';

type MockBindGroup = Readonly<{
  entries: readonly GPUBindGroupEntry[];
}>;

const createRenderMocks = () => {
  const bindGroups: MockBindGroup[] = [];
  const buffers: GPUBuffer[] = [];
  const shaderModules: GPUShaderModule[] = [];

  const device = {
    createShaderModule: ({ code }: GPUShaderModuleDescriptor) => {
      const shaderModule = ({ code }) as unknown as GPUShaderModule;
      shaderModules.push(shaderModule);
      return shaderModule;
    },
    createRenderPipeline: (_descriptor: GPURenderPipelineDescriptor) =>
      ({
        getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
      }) as unknown as GPURenderPipeline,
    createBindGroup: ({ entries }: GPUBindGroupDescriptor) => {
      const bindGroup = { entries } as const;
      bindGroups.push(bindGroup);
      return bindGroup as unknown as GPUBindGroup;
    },
    createBuffer: (descriptor: GPUBufferDescriptor) => {
      const buffer = {
        label: descriptor.label,
        size: descriptor.size,
        destroy: () => undefined,
      } as unknown as GPUBuffer;
      buffers.push(buffer);
      return buffer;
    },
    createCommandEncoder: () =>
      ({
        beginRenderPass: () =>
          ({
            setPipeline: () => undefined,
            setBindGroup: () => undefined,
            setVertexBuffer: () => undefined,
            setIndexBuffer: () => undefined,
            draw: () => undefined,
            drawIndexed: () => undefined,
            end: () => undefined,
          }) as unknown as GPURenderPassEncoder,
        finish: () => ({}) as GPUCommandBuffer,
      }) as unknown as GPUCommandEncoder,
    createTexture: () =>
      ({
        createView: () => ({}) as GPUTextureView,
      }) as unknown as GPUTexture,
    createSampler: () => ({}) as GPUSampler,
  };

  const queue = {
    writeBuffer: () => undefined,
    submit: () => undefined,
  };

  return {
    device,
    queue,
    bindGroups,
    buffers,
    shaderModules,
  };
};

Deno.test('renderForwardFrame binds renderer-owned alpha policy for custom WGSL materials', () => {
  const mocks = createRenderMocks();
  const residency = createRuntimeResidency();
  const registry = registerWgslMaterial(createMaterialRegistry(), {
    id: 'custom:alpha-policy',
    label: 'custom alpha policy',
    wgsl: `
struct TransformUniforms {
  world: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

struct AlphaPolicyUniforms {
  alphaCutoff: f32,
  alphaMode: f32,
  depthWrite: f32,
  doubleSided: f32,
};

@group(0) @binding(0) var<uniform> transform: TransformUniforms;
@group(1) @binding(0) var<uniform> alphaPolicy: AlphaPolicyUniforms;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return transform.viewProjection * transform.world * vec4<f32>(position, 1.0);
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(alphaPolicy.alphaCutoff, alphaPolicy.alphaMode, alphaPolicy.depthWrite, 1.0);
}
    `,
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
    vertexAttributes: [{
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    }],
    usesTransformBindings: true,
    materialBindings: [{
      kind: 'alpha-policy',
      binding: 0,
    }],
  });

  let scene = createSceneIr('custom-alpha-policy');
  scene = appendMaterial(scene, {
    id: 'custom-material',
    kind: 'custom',
    shaderId: 'custom:alpha-policy',
    alphaMode: 'mask',
    alphaCutoff: 0.35,
    doubleSided: true,
    textures: [],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'custom-material',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
    }],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  residency.geometry.set('mesh-0', {
    meshId: 'mesh-0',
    attributeBuffers: { POSITION: { id: 0 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenBinding({
      device: mocks.device as unknown as GPUDevice,
      target: { kind: 'offscreen', width: 16, height: 16, format: 'rgba8unorm', sampleCount: 1 },
    }),
    residency,
    evaluateScene(scene, { timeMs: 0 }),
    registry,
  );

  const materialResidency = residency.materials.get('custom-material');
  assertEquals(materialResidency?.alphaPolicyData, new Float32Array([0.35, 1, 1, 1]));

  const alphaPolicyBuffer = materialResidency?.alphaPolicyBuffer;
  const alphaPolicyBindGroup = mocks.bindGroups.find((bindGroup) =>
    bindGroup.entries.some((entry) =>
      'buffer' in entry.resource && entry.resource.buffer === alphaPolicyBuffer
    )
  );

  assertEquals(alphaPolicyBindGroup?.entries.length, 1);
  assertEquals(
    alphaPolicyBindGroup?.entries.map((entry) => entry.binding),
    [0],
  );
});

Deno.test('resolveMaterialVariant captures shader-structure features for built-in materials', () => {
  const residency = createRuntimeResidency();
  residency.textures.set('base-color-texture', {
    textureId: 'base-color-texture',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
  });

  const variant = resolveMaterialVariant(
    {
      id: 'lit-material',
      kind: 'lit',
      textures: [{
        id: 'base-color-texture',
        semantic: 'baseColor',
        colorSpace: 'srgb',
        sampler: 'linear-repeat',
      }],
      parameters: {
        color: { x: 0.2, y: 0.3, z: 0.4, w: 1 },
      },
    },
    { preferTexturedLit: true },
    {
      geometry: {
        meshId: 'mesh-0',
        attributeBuffers: {
          POSITION: {} as GPUBuffer,
          TEXCOORD_0: {} as GPUBuffer,
        },
        vertexCount: 3,
        indexCount: 0,
      },
      residency,
    },
  );

  assertEquals(variant.programId, 'built-in:lit-textured');
  assertEquals(variant.shaderFamily, 'lit');
  assertEquals(variant.usesCustomShader, false);
  assertEquals(variant.usesBaseColorTexture, true);
  assertEquals(variant.usesTexcoord0, true);
});

Deno.test('resolveMaterialVariant marks custom shader materials separately', () => {
  const variant = resolveMaterialVariant({
    id: 'custom-material',
    kind: 'custom',
    shaderId: 'custom:program',
    alphaMode: 'mask',
    alphaCutoff: 0.2,
    textures: [],
    parameters: {
      color: { x: 1, y: 0, z: 0, w: 1 },
    },
  });

  assertEquals(variant.programId, 'custom:program');
  assertEquals(variant.shaderFamily, 'custom');
  assertEquals(variant.alphaMode, 'mask');
  assertEquals(variant.usesCustomShader, true);
  assertEquals(variant.usesBaseColorTexture, false);
  assertEquals(variant.usesTexcoord0, false);
});

Deno.test('createMaterialRegistry exposes a built-in unlit template that selects textured variants', () => {
  const template = createMaterialRegistry().templates.get('built-in:unlit-template');
  assert(template);

  const plainProgram = template.prepareProgram({
    materialId: 'plain-material',
    programId: 'built-in:unlit',
    shaderFamily: 'unlit',
    alphaMode: 'opaque',
    renderQueue: 'opaque',
    doubleSided: false,
    depthWrite: true,
    usesCustomShader: false,
    usesBaseColorTexture: false,
    usesTexcoord0: false,
  });
  const texturedProgram = template.prepareProgram({
    materialId: 'textured-material',
    programId: 'built-in:unlit',
    shaderFamily: 'unlit',
    alphaMode: 'opaque',
    renderQueue: 'opaque',
    doubleSided: false,
    depthWrite: true,
    usesCustomShader: false,
    usesBaseColorTexture: true,
    usesTexcoord0: true,
  });

  assertEquals(plainProgram.id, 'built-in:unlit');
  assertEquals(texturedProgram.id, 'built-in:unlit-textured');
});

Deno.test('createMaterialRegistry exposes a built-in lit template that selects textured variants', () => {
  const template = createMaterialRegistry().templates.get('built-in:lit-template');
  assert(template);

  const plainProgram = template.prepareProgram({
    materialId: 'plain-material',
    programId: 'built-in:lit',
    shaderFamily: 'lit',
    alphaMode: 'opaque',
    renderQueue: 'opaque',
    doubleSided: false,
    depthWrite: true,
    usesCustomShader: false,
    usesBaseColorTexture: false,
    usesTexcoord0: false,
  });
  const texturedProgram = template.prepareProgram({
    materialId: 'textured-material',
    programId: 'built-in:lit',
    shaderFamily: 'lit',
    alphaMode: 'opaque',
    renderQueue: 'opaque',
    doubleSided: false,
    depthWrite: true,
    usesCustomShader: false,
    usesBaseColorTexture: true,
    usesTexcoord0: true,
  });

  assertEquals(plainProgram.id, 'built-in:lit');
  assertEquals(texturedProgram.id, 'built-in:lit-textured');
});

Deno.test('renderForwardFrame can prepare a custom WGSL template from material variant inputs', () => {
  const mocks = createRenderMocks();
  const residency = createRuntimeResidency();
  residency.textures.set('base-color-texture', {
    textureId: 'base-color-texture',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
  });

  let capturedProgramId = '';
  const registry = registerWgslMaterialTemplate(createMaterialRegistry(), {
    id: 'custom:template',
    label: 'custom template',
    prepareProgram: (variant) => {
      capturedProgramId = variant.usesBaseColorTexture && variant.usesTexcoord0
        ? 'custom:template:textured'
        : 'custom:template:plain';
      return {
        id: capturedProgramId,
        label: 'templated custom program',
        wgsl: `
struct TransformUniforms {
  world: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> transform: TransformUniforms;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return transform.viewProjection * transform.world * vec4<f32>(position, 1.0);
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
        `,
        vertexEntryPoint: 'vsMain',
        fragmentEntryPoint: 'fsMain',
        vertexAttributes: [{
          semantic: 'POSITION',
          shaderLocation: 0,
          format: 'float32x3',
          offset: 0,
          arrayStride: 12,
        }],
        usesTransformBindings: true,
      };
    },
  });

  let scene = createSceneIr('custom-template');
  scene = appendMaterial(scene, {
    id: 'custom-template-material',
    kind: 'custom',
    shaderId: 'custom:template',
    textures: [{
      id: 'base-color-texture',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'custom-template-material',
    attributes: [
      {
        semantic: 'POSITION',
        itemSize: 3,
        values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
      },
      {
        semantic: 'TEXCOORD_0',
        itemSize: 2,
        values: [0.5, 1, 0, 0, 1, 0],
      },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  residency.geometry.set('mesh-0', {
    meshId: 'mesh-0',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      TEXCOORD_0: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });

  renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenBinding({
      device: mocks.device as unknown as GPUDevice,
      target: { kind: 'offscreen', width: 16, height: 16, format: 'rgba8unorm', sampleCount: 1 },
    }),
    residency,
    evaluateScene(scene, { timeMs: 0 }),
    registry,
  );

  assertEquals(capturedProgramId, 'custom:template:textured');
});

Deno.test('ensureMaterialPipeline reuses shader modules across pipeline variants', () => {
  const mocks = createRenderMocks();
  const residency = createRuntimeResidency();
  const program = {
    id: 'custom:shared-module',
    label: 'custom shared module',
    wgsl: `
struct TransformUniforms {
  world: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> transform: TransformUniforms;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return transform.viewProjection * transform.world * vec4<f32>(position, 1.0);
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
    `,
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
    vertexAttributes: [{
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    }],
    usesTransformBindings: true,
  } as const;

  ensureMaterialPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    residency,
    program,
    'rgba8unorm',
  );
  ensureMaterialPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    residency,
    program,
    'rgba8unorm',
    {
      blend: {
        color: {
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add',
        },
        alpha: {
          srcFactor: 'one',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add',
        },
      },
      depthWriteEnabled: false,
    },
  );

  assertEquals(mocks.shaderModules.length, 1);
});
