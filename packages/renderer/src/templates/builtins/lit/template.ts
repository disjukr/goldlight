import alphaMaskFeatureSource from '../../features/alpha_mask.wgsl' with { type: 'text' };
import baseColorTextureFeatureSource from './features/base_color_texture.wgsl' with {
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
    binding: 0,
    varName: 'material',
    typeName: 'MaterialUniforms',
  }],
  baseVertexAttributes: [positionVertexAttribute, normalVertexAttribute],
  features: [baseColorTextureFeature, alphaMaskFeature],
  resolveProgramId: (_variant, activeFeatures) =>
    activeFeatures.some((feature) => feature.id === 'base_color_texture')
      ? 'built-in:lit-textured'
      : 'built-in:lit',
  resolveProgramLabel: (_variant, activeFeatures) =>
    activeFeatures.some((feature) => feature.id === 'base_color_texture')
      ? 'Built-in Lit (Textured)'
      : 'Built-in Lit',
};

export const prepareBuiltInLitTemplateProgram = (
  variant: BuiltInLitTemplateVariant,
): TemplateMaterialProgram => inspectBuiltInLitTemplateProgram(variant).program;

export const inspectBuiltInLitTemplateProgram = (
  variant: BuiltInLitTemplateVariant,
): TemplateBakeReport<BuiltInLitTemplateVariant> =>
  inspectShaderTemplate(builtInLitShaderTemplate, variant);
