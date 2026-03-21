import alphaMaskFeatureSource from '../../features/alpha_mask.wgsl' with { type: 'text' };
import baseColorTextureFeatureSource from './features/base_color_texture.wgsl' with {
  type: 'text',
};
import emissiveTextureFeatureSource from './features/emissive_texture.wgsl' with {
  type: 'text',
};
import metallicRoughnessTextureFeatureSource from './features/metallic_roughness_texture.wgsl' with {
  type: 'text',
};
import normalTextureDerivativeFeatureSource from './features/normal_texture_derivative.wgsl' with {
  type: 'text',
};
import normalTextureFeatureSource from './features/normal_texture.wgsl' with {
  type: 'text',
};
import occlusionTextureFeatureSource from './features/occlusion_texture.wgsl' with {
  type: 'text',
};
import templateSource from './template.wgsl' with { type: 'text' };
import { createShaderTemplateFeature, inspectShaderTemplate } from '../../assembler.ts';
import type {
  BaseTemplateVariant,
  ShaderTemplate,
  TemplateBakeReport,
  TemplateMaterialProgram,
} from '../../types.ts';

export type BuiltInLitTemplateVariant =
  & BaseTemplateVariant
  & Readonly<{
    templateId: 'built-in:lit-template';
    usesBaseColorTexture: boolean;
    usesEmissiveTexture: boolean;
    usesMetallicRoughnessTexture: boolean;
    usesNormalTexture: boolean;
    usesOcclusionTexture: boolean;
    usesTangent: boolean;
    usesTexcoord0: boolean;
  }>;

const positionVertexAttribute = {
  semantic: 'POSITION',
  shaderLocation: 0,
  format: 'float32x3',
  offset: 0,
  arrayStride: 12,
} as const;

const normalVertexAttribute = {
  semantic: 'NORMAL',
  shaderLocation: 1,
  format: 'float32x3',
  offset: 0,
  arrayStride: 12,
} as const;

const texcoordVertexAttribute = {
  semantic: 'TEXCOORD_0',
  shaderLocation: 2,
  format: 'float32x2',
  offset: 0,
  arrayStride: 8,
} as const;

const tangentVertexAttribute = {
  semantic: 'TANGENT',
  shaderLocation: 3,
  format: 'float32x4',
  offset: 0,
  arrayStride: 16,
} as const;

const baseColorTextureFeature = createShaderTemplateFeature<BuiltInLitTemplateVariant>({
  id: 'base_color_texture',
  when: (variant) => variant.usesBaseColorTexture && variant.usesTexcoord0,
  resources: [
    {
      id: 'baseColorTexture',
      kind: 'texture',
      textureSemantic: 'baseColor',
      varName: 'baseColorTexture',
      textureType: 'texture_2d<f32>',
    },
    {
      id: 'baseColorSampler',
      kind: 'sampler',
      textureSemantic: 'baseColor',
      varName: 'baseColorSampler',
    },
  ],
  vertexAttributes: [texcoordVertexAttribute],
  source: baseColorTextureFeatureSource,
});

const metallicRoughnessTextureFeature = createShaderTemplateFeature<BuiltInLitTemplateVariant>({
  id: 'metallic_roughness_texture',
  when: (variant) => variant.usesMetallicRoughnessTexture && variant.usesTexcoord0,
  resources: [
    {
      id: 'metallicRoughnessTexture',
      kind: 'texture',
      textureSemantic: 'metallicRoughness',
      varName: 'metallicRoughnessTexture',
      textureType: 'texture_2d<f32>',
    },
    {
      id: 'metallicRoughnessSampler',
      kind: 'sampler',
      textureSemantic: 'metallicRoughness',
      varName: 'metallicRoughnessSampler',
    },
  ],
  source: metallicRoughnessTextureFeatureSource,
});

const normalTextureFeature = createShaderTemplateFeature<BuiltInLitTemplateVariant>({
  id: 'normal_texture_tangent',
  when: (variant) => variant.usesNormalTexture && variant.usesTexcoord0 && variant.usesTangent,
  resources: [
    {
      id: 'normalTexture',
      kind: 'texture',
      textureSemantic: 'normal',
      varName: 'normalTexture',
      textureType: 'texture_2d<f32>',
    },
    {
      id: 'normalSampler',
      kind: 'sampler',
      textureSemantic: 'normal',
      varName: 'normalSampler',
    },
  ],
  vertexAttributes: [tangentVertexAttribute],
  source: normalTextureFeatureSource,
});

const normalTextureDerivativeFeature = createShaderTemplateFeature<BuiltInLitTemplateVariant>({
  id: 'normal_texture',
  when: (variant) => variant.usesNormalTexture && variant.usesTexcoord0 && !variant.usesTangent,
  resources: [
    {
      id: 'normalTexture',
      kind: 'texture',
      textureSemantic: 'normal',
      varName: 'normalTexture',
      textureType: 'texture_2d<f32>',
    },
    {
      id: 'normalSampler',
      kind: 'sampler',
      textureSemantic: 'normal',
      varName: 'normalSampler',
    },
  ],
  source: normalTextureDerivativeFeatureSource,
});

const occlusionTextureFeature = createShaderTemplateFeature<BuiltInLitTemplateVariant>({
  id: 'occlusion_texture',
  when: (variant) => variant.usesOcclusionTexture && variant.usesTexcoord0,
  resources: [
    {
      id: 'occlusionTexture',
      kind: 'texture',
      textureSemantic: 'occlusion',
      varName: 'occlusionTexture',
      textureType: 'texture_2d<f32>',
    },
    {
      id: 'occlusionSampler',
      kind: 'sampler',
      textureSemantic: 'occlusion',
      varName: 'occlusionSampler',
    },
  ],
  source: occlusionTextureFeatureSource,
});

const emissiveTextureFeature = createShaderTemplateFeature<BuiltInLitTemplateVariant>({
  id: 'emissive_texture',
  when: (variant) => variant.usesEmissiveTexture && variant.usesTexcoord0,
  resources: [
    {
      id: 'emissiveTexture',
      kind: 'texture',
      textureSemantic: 'emissive',
      varName: 'emissiveTexture',
      textureType: 'texture_2d<f32>',
    },
    {
      id: 'emissiveSampler',
      kind: 'sampler',
      textureSemantic: 'emissive',
      varName: 'emissiveSampler',
    },
  ],
  source: emissiveTextureFeatureSource,
});

const alphaMaskFeature = createShaderTemplateFeature<BuiltInLitTemplateVariant>({
  id: 'alpha_mask',
  when: (variant) => variant.alphaMode === 'mask' || variant.alphaMode === 'opaque',
  source: alphaMaskFeatureSource,
});

const builtInLitShaderTemplate: ShaderTemplate<BuiltInLitTemplateVariant> = {
  id: 'built-in:lit-template',
  label: 'Built-in Lit Template',
  source: templateSource,
  baseResources: [{
    id: 'materialUniforms',
    kind: 'uniform',
    group: 1,
    binding: 0,
    varName: 'material',
    typeName: 'MaterialUniforms',
  }, {
    id: 'lightingUniforms',
    kind: 'uniform',
    group: 2,
    binding: 0,
    varName: 'lighting',
    typeName: 'LightingUniforms',
  }, {
    id: 'environmentTexture',
    kind: 'texture',
    group: 3,
    binding: 0,
    textureSemantic: 'environment',
    varName: 'environmentTexture',
    textureType: 'texture_2d<f32>',
  }, {
    id: 'environmentSampler',
    kind: 'sampler',
    group: 3,
    binding: 1,
    textureSemantic: 'environment',
    varName: 'environmentSampler',
  }, {
    id: 'brdfLutTexture',
    kind: 'texture',
    group: 3,
    binding: 2,
    textureSemantic: 'brdfLut',
    varName: 'brdfLutTexture',
    textureType: 'texture_2d<f32>',
  }, {
    id: 'brdfLutSampler',
    kind: 'sampler',
    group: 3,
    binding: 3,
    textureSemantic: 'brdfLut',
    varName: 'brdfLutSampler',
  }],
  baseVertexAttributes: [positionVertexAttribute, normalVertexAttribute],
  features: [
    baseColorTextureFeature,
    metallicRoughnessTextureFeature,
    normalTextureFeature,
    normalTextureDerivativeFeature,
    occlusionTextureFeature,
    emissiveTextureFeature,
    alphaMaskFeature,
  ],
  resolveProgramId: (_variant, activeFeatures) =>
    [
      'built-in:lit',
      ...activeFeatures.map((feature) => feature.id),
    ].join('+'),
  resolveProgramLabel: (_variant, activeFeatures) =>
    activeFeatures.length > 0
      ? `Built-in Lit (${activeFeatures.map((feature) => feature.id).join(', ')})`
      : 'Built-in Lit',
};

export const prepareBuiltInLitTemplateProgram = (
  variant: BuiltInLitTemplateVariant,
): TemplateMaterialProgram => inspectBuiltInLitTemplateProgram(variant).program;

export const inspectBuiltInLitTemplateProgram = (
  variant: BuiltInLitTemplateVariant,
): TemplateBakeReport<BuiltInLitTemplateVariant> =>
  inspectShaderTemplate(builtInLitShaderTemplate, variant);
