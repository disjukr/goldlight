export type TemplateMaterialVertexAttribute = Readonly<{
  semantic: string;
  shaderLocation: number;
  format: GPUVertexFormat;
  offset: number;
  arrayStride: number;
}>;

export type TemplateMaterialBindingDescriptor = Readonly<
  | {
    kind: 'uniform';
    binding: number;
  }
  | {
    kind: 'alpha-policy';
    binding: number;
  }
  | {
    kind: 'texture';
    binding: number;
    textureSemantic: string;
  }
  | {
    kind: 'sampler';
    binding: number;
    textureSemantic: string;
  }
>;

export type TemplateMaterialProgram = Readonly<{
  id: string;
  label: string;
  wgsl: string;
  vertexEntryPoint: string;
  fragmentEntryPoint: string;
  vertexAttributes: readonly TemplateMaterialVertexAttribute[];
  usesMaterialBindings?: boolean;
  usesTransformBindings?: boolean;
  materialBindings?: readonly TemplateMaterialBindingDescriptor[];
}>;

export type BaseTemplateVariant = Readonly<{
  materialId: string;
  alphaMode: 'opaque' | 'mask' | 'blend';
  renderQueue: 'opaque' | 'transparent';
  doubleSided: boolean;
  depthWrite: boolean;
}>;

export type TemplateMaterialVariant =
  & BaseTemplateVariant
  & Readonly<{
    programId: string;
    shaderFamily: string;
    usesCustomShader: boolean;
    usesBaseColorTexture: boolean;
    usesTexcoord0: boolean;
  }>;

export type SlotName =
  | 'module_scope'
  | 'bindings'
  | 'vertex_inputs'
  | 'vs_out_fields'
  | 'vertex_body'
  | 'fragment_body';

export type TemplateBindingResource = Readonly<
  | {
    id: string;
    kind: 'uniform';
    binding?: number;
    varName: string;
    typeName: string;
  }
  | {
    id: string;
    kind: 'alpha-policy';
    binding?: number;
    varName: string;
    typeName: string;
  }
  | {
    id: string;
    kind: 'texture';
    binding?: number;
    textureSemantic: string;
    varName: string;
    textureType: string;
  }
  | {
    id: string;
    kind: 'sampler';
    binding?: number;
    textureSemantic: string;
    varName: string;
  }
>;

export type ShaderTemplateFeature<TVariant extends BaseTemplateVariant = TemplateMaterialVariant> =
  Readonly<{
    id: string;
    when: (variant: TVariant) => boolean;
    resources?: readonly TemplateBindingResource[];
    vertexAttributes?: readonly TemplateMaterialVertexAttribute[];
    slots?: Partial<Record<SlotName, string>>;
  }>;

export type ShaderTemplate<TVariant extends BaseTemplateVariant = TemplateMaterialVariant> =
  Readonly<{
    id: string;
    label: string;
    source: string;
    baseResources?: readonly TemplateBindingResource[];
    baseVertexAttributes?: readonly TemplateMaterialVertexAttribute[];
    features: readonly ShaderTemplateFeature<TVariant>[];
    resolveProgramId: (
      variant: TVariant,
      activeFeatures: readonly ShaderTemplateFeature<TVariant>[],
    ) => string;
    resolveProgramLabel?: (
      variant: TVariant,
      activeFeatures: readonly ShaderTemplateFeature<TVariant>[],
    ) => string;
  }>;

export type ProgramSpec = Readonly<{
  id: string;
  label: string;
  templateId: string;
  bindings: readonly TemplateMaterialBindingDescriptor[];
  vertexAttributes: readonly TemplateMaterialVertexAttribute[];
  wgsl: string;
  vertexEntryPoint: string;
  fragmentEntryPoint: string;
  usesMaterialBindings: boolean;
  usesTransformBindings: boolean;
}>;

export type TemplateBakeReport<TVariant extends BaseTemplateVariant = TemplateMaterialVariant> =
  Readonly<{
    variant: TVariant;
    program: TemplateMaterialProgram;
    spec: ProgramSpec;
    activeFeatureIds: readonly string[];
  }>;
