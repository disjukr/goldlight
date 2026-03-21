import { assert, assertEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createOffscreenBinding, createRuntimeResidency } from '@rieul3d/gpu';
import { appendMaterial, appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import {
  createMaterialRegistry,
  ensureMaterialPipeline,
  type GpuRenderExecutionContext,
  inspectMaterialTemplateBake,
  invalidateTemplateProgramResidency,
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
    writeTexture: () => undefined,
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
    format: 'rgba8unorm-srgb',
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
  assertEquals(
    texturedProgram.materialBindings,
    [
      { kind: 'uniform', binding: 0 },
      { kind: 'texture', binding: 1, textureSemantic: 'baseColor' },
      { kind: 'sampler', binding: 2, textureSemantic: 'baseColor' },
    ],
  );
  assert(
    texturedProgram.wgsl.includes('@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;'),
  );
  assert(texturedProgram.wgsl.includes('out.texCoord = texCoord;'));
  assert(
    texturedProgram.wgsl.includes('textureSample(baseColorTexture, baseColorSampler, in.texCoord)'),
  );
});

Deno.test('inspectMaterialTemplateBake reports active features and baked WGSL for built-in templates', () => {
  const report = inspectMaterialTemplateBake(createMaterialRegistry(), 'built-in:unlit-template', {
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

  assertEquals(report.templateId, 'built-in:unlit-template');
  assertEquals(report.program.id, 'built-in:unlit-textured');
  assertEquals(report.activeFeatureIds, ['base_color_texture', 'alpha_mask']);
  assertEquals(report.bindings, [
    { kind: 'uniform', binding: 0 },
    { kind: 'texture', binding: 1, textureSemantic: 'baseColor' },
    { kind: 'sampler', binding: 2, textureSemantic: 'baseColor' },
  ]);
  assert(report.wgsl.includes('textureSample(baseColorTexture, baseColorSampler, in.texCoord)'));
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
    usesEmissiveTexture: false,
    usesMetallicRoughnessTexture: false,
    usesNormalTexture: false,
    usesOcclusionTexture: false,
    usesCustomShader: false,
    usesTangent: false,
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
    usesEmissiveTexture: true,
    usesMetallicRoughnessTexture: true,
    usesNormalTexture: true,
    usesOcclusionTexture: true,
    usesCustomShader: false,
    usesTangent: true,
    usesBaseColorTexture: true,
    usesTexcoord0: true,
  });

  assertEquals(plainProgram.id, 'built-in:lit+alpha_mask');
  assertEquals(
    texturedProgram.id,
    'built-in:lit+base_color_texture+metallic_roughness_texture+normal_texture_tangent+occlusion_texture+emissive_texture+alpha_mask',
  );
  assertEquals(
    texturedProgram.materialBindings,
    [
      { kind: 'uniform', binding: 0 },
      { kind: 'texture', binding: 1, textureSemantic: 'baseColor' },
      { kind: 'sampler', binding: 2, textureSemantic: 'baseColor' },
      { kind: 'texture', binding: 3, textureSemantic: 'metallicRoughness' },
      { kind: 'sampler', binding: 4, textureSemantic: 'metallicRoughness' },
      { kind: 'texture', binding: 5, textureSemantic: 'normal' },
      { kind: 'sampler', binding: 6, textureSemantic: 'normal' },
      { kind: 'texture', binding: 7, textureSemantic: 'occlusion' },
      { kind: 'sampler', binding: 8, textureSemantic: 'occlusion' },
      { kind: 'texture', binding: 9, textureSemantic: 'emissive' },
      { kind: 'sampler', binding: 10, textureSemantic: 'emissive' },
    ],
  );
  assert(
    texturedProgram.wgsl.includes('@group(2) @binding(0) var<uniform> lighting: LightingUniforms;'),
  );
  assert(
    texturedProgram.wgsl.includes('@group(3) @binding(0) var environmentTexture: texture_2d<f32>;'),
  );
  assert(
    texturedProgram.wgsl.includes('@group(3) @binding(1) var environmentSampler: sampler;'),
  );
  assert(
    texturedProgram.wgsl.includes('@group(3) @binding(2) var brdfLutTexture: texture_2d<f32>;'),
  );
  assert(
    texturedProgram.wgsl.includes('@group(3) @binding(3) var brdfLutSampler: sampler;'),
  );
  assert(
    texturedProgram.wgsl.includes('textureSample(baseColorTexture, baseColorSampler, in.texCoord)'),
  );
  assert(texturedProgram.wgsl.includes('let metallicRoughnessSample = textureSample('));
  assert(texturedProgram.wgsl.includes('surfaceNormal = sampleNormalTexture(&in);'));
  assert(texturedProgram.wgsl.includes('textureSample(occlusionTexture, occlusionSampler'));
  assert(texturedProgram.wgsl.includes('textureSample(emissiveTexture, emissiveSampler'));
  assert(texturedProgram.wgsl.includes('let alphaPolicy = material.values[1];'));
});

Deno.test('inspectMaterialTemplateBake reports all lit helmet-style features', () => {
  const report = inspectMaterialTemplateBake(createMaterialRegistry(), 'built-in:lit-template', {
    materialId: 'helmet-material',
    alphaMode: 'opaque',
    renderQueue: 'opaque',
    doubleSided: false,
    depthWrite: true,
    usesEmissiveTexture: true,
    usesMetallicRoughnessTexture: true,
    usesNormalTexture: true,
    usesOcclusionTexture: true,
    usesTangent: true,
    usesBaseColorTexture: true,
    usesTexcoord0: true,
  } as never);

  assertEquals(report.activeFeatureIds, [
    'base_color_texture',
    'metallic_roughness_texture',
    'normal_texture_tangent',
    'occlusion_texture',
    'emissive_texture',
    'alpha_mask',
  ]);
  assert(report.wgsl.includes('fn sampleNormalTexture(in: ptr<function, VsOut>) -> vec3<f32>'));
  assert(report.wgsl.includes('fn sampleEnvironmentMap(direction: vec3<f32>) -> vec3<f32>'));
  assert(report.wgsl.includes('var emissive = material.values[2].xyz;'));
  assert(report.wgsl.includes('var metallic = clamp(material.values[3].x, 0.0, 1.0);'));
  assert(report.wgsl.includes('occlusion = mix(1.0, occlusionSample'));
  assert(report.wgsl.includes('fn distributionGgx(nDotH: f32, roughness: f32) -> f32'));
  assert(report.wgsl.includes('let specular = (distribution * geometry) * fresnel /'));
});

Deno.test('renderForwardFrame can prepare a custom WGSL template from material variant inputs', () => {
  type CustomTemplateVariant = {
    materialId: string;
    alphaMode: 'opaque' | 'mask' | 'blend';
    renderQueue: 'opaque' | 'transparent';
    doubleSided: boolean;
    depthWrite: boolean;
    usesBaseColorTexture: boolean;
    usesTexcoord0: boolean;
  };

  const mocks = createRenderMocks();
  const residency = createRuntimeResidency();
  residency.textures.set('base-color-texture', {
    textureId: 'base-color-texture',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm-srgb',
  });

  let capturedProgramId = '';
  const registry = registerWgslMaterialTemplate<CustomTemplateVariant>(createMaterialRegistry(), {
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

Deno.test('custom material templates can provide template-specific variant resolvers', () => {
  type CustomResolvedTemplateVariant = {
    materialId: string;
    alphaMode: 'opaque';
    renderQueue: 'opaque';
    doubleSided: false;
    depthWrite: true;
    usesTexcoord0: boolean;
    customMode: 'resolved';
  };

  let inspectedVariant: Record<string, unknown> | undefined;
  const registry = registerWgslMaterialTemplate<CustomResolvedTemplateVariant>(
    createMaterialRegistry(),
    {
      id: 'custom:resolved-template',
      label: 'custom resolved template',
      resolveVariant: (_material, _options, resolutionOptions) => ({
        materialId: 'resolved-material',
        alphaMode: 'opaque',
        renderQueue: 'opaque',
        doubleSided: false,
        depthWrite: true,
        usesTexcoord0: Boolean(
          resolutionOptions.geometry &&
            'attributeBuffers' in resolutionOptions.geometry &&
            resolutionOptions.geometry.attributeBuffers.TEXCOORD_0,
        ),
        customMode: 'resolved',
      }),
      prepareProgram: (variant) => {
        inspectedVariant = variant as Record<string, unknown>;
        return {
          id: 'custom:resolved-template:program',
          label: 'custom resolved template program',
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
  return vec4<f32>(1.0);
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
    },
  );

  const report = inspectMaterialTemplateBake(
    registry,
    'custom:resolved-template',
    {
      materialId: 'ignored',
      alphaMode: 'opaque',
      renderQueue: 'opaque',
      doubleSided: false,
      depthWrite: true,
      usesTexcoord0: true,
      customMode: 'resolved',
    } as never,
  );

  assertEquals(report.program.id, 'custom:resolved-template:program');
  assertEquals(inspectedVariant?.customMode, 'resolved');
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

Deno.test('invalidateTemplateProgramResidency clears cached shader modules and pipelines by template id', () => {
  const residency = createRuntimeResidency();
  residency.shaderModules.set('built-in:unlit-template:shader-a', {} as GPUShaderModule);
  residency.shaderModules.set('custom:template:shader-a', {} as GPUShaderModule);
  residency.pipelines.set('built-in:unlit-template:pipeline-a', {} as GPURenderPipeline);
  residency.pipelines.set('custom:template:pipeline-a', {} as GPURenderPipeline);

  invalidateTemplateProgramResidency(residency, 'built-in:unlit-template');

  assertEquals([...residency.shaderModules.keys()], ['custom:template:shader-a']);
  assertEquals([...residency.pipelines.keys()], ['custom:template:pipeline-a']);
});
