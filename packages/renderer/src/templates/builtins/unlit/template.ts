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

export type BuiltInUnlitTemplateVariant =
  & BaseTemplateVariant
  & Readonly<{
    templateId: 'built-in:unlit-template';
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

const texcoordVertexAttribute = {
  semantic: 'TEXCOORD_0',
  shaderLocation: 1,
  format: 'float32x2',
  offset: 0,
  arrayStride: 8,
} as const;

const baseColorTextureFeature = createShaderTemplateFeature<BuiltInUnlitTemplateVariant>({
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

const alphaMaskFeature = createShaderTemplateFeature<BuiltInUnlitTemplateVariant>({
  id: 'alpha_mask',
  when: (variant) => variant.alphaMode === 'mask' || variant.alphaMode === 'opaque',
  source: alphaMaskFeatureSource,
});

const builtInUnlitShaderTemplate: ShaderTemplate<BuiltInUnlitTemplateVariant> = {
  id: 'built-in:unlit-template',
  label: 'Built-in Unlit Template',
  source: templateSource,
  baseResources: [{
    id: 'frameUniforms',
    kind: 'uniform',
    group: 0,
    binding: 1,
    varName: 'frameUniforms',
    typeName: 'FrameUniforms',
  }, {
    id: 'materialUniforms',
    kind: 'uniform',
    binding: 0,
    varName: 'material',
    typeName: 'MaterialUniforms',
  }],
  baseVertexAttributes: [positionVertexAttribute],
  features: [baseColorTextureFeature, alphaMaskFeature],
  resolveProgramId: (_variant, activeFeatures) =>
    activeFeatures.some((feature) => feature.id === 'base_color_texture')
      ? 'built-in:unlit-textured'
      : 'built-in:unlit',
  resolveProgramLabel: (_variant, activeFeatures) =>
    activeFeatures.some((feature) => feature.id === 'base_color_texture')
      ? 'Built-in Unlit (Textured)'
      : 'Built-in Unlit',
};

export const prepareBuiltInUnlitTemplateProgram = (
  variant: BuiltInUnlitTemplateVariant,
): TemplateMaterialProgram => inspectBuiltInUnlitTemplateProgram(variant).program;

export const inspectBuiltInUnlitTemplateProgram = (
  variant: BuiltInUnlitTemplateVariant,
): TemplateBakeReport<BuiltInUnlitTemplateVariant> =>
  inspectShaderTemplate(builtInUnlitShaderTemplate, variant);
