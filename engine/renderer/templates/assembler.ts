import type {
  BaseTemplateVariant,
  ProgramSpec,
  ShaderTemplate,
  ShaderTemplateFeature,
  SlotName,
  TemplateBakeReport,
  TemplateBindingResource,
  TemplateMaterialBindingDescriptor,
  TemplateMaterialVertexAttribute,
} from './types.ts';
import { emitMaterialProgram } from './emitter.ts';

const slotMarkerPrefix = '// @slot ';
const orderedSlots: readonly SlotName[] = [
  'module_scope',
  'bindings',
  'vertex_inputs',
  'vs_out_fields',
  'vertex_body',
  'fragment_body',
] as const;

const parseSlotBlocks = (source: string): Partial<Record<SlotName, string>> => {
  const slots: Partial<Record<SlotName, string[]>> = {};
  let activeSlot: SlotName | undefined;

  for (const line of source.split('\n')) {
    if (line.startsWith(slotMarkerPrefix)) {
      const slot = line.slice(slotMarkerPrefix.length).trim() as SlotName;
      activeSlot = orderedSlots.includes(slot) ? slot : undefined;
      if (activeSlot && !slots[activeSlot]) {
        slots[activeSlot] = [];
      }
      continue;
    }

    if (activeSlot) {
      slots[activeSlot]?.push(line);
    }
  }

  return Object.fromEntries(
    Object.entries(slots).map(([slot, lines]) => [slot, lines.join('\n').trimEnd()]),
  );
};

const createBindingDescriptor = (
  resource: TemplateBindingResource,
  binding: number,
): TemplateMaterialBindingDescriptor => {
  const group = resource.group ?? 1;
  switch (resource.kind) {
    case 'uniform':
      return { kind: 'uniform', group, binding };
    case 'alpha-policy':
      return { kind: 'alpha-policy', group, binding };
    case 'texture':
      return {
        kind: 'texture',
        group,
        binding,
        textureSemantic: resource.textureSemantic,
      };
    case 'sampler':
      return {
        kind: 'sampler',
        group,
        binding,
        textureSemantic: resource.textureSemantic,
      };
  }
};

const createBindingDeclaration = (
  resource: TemplateBindingResource,
  binding: number,
): string => {
  const group = resource.group ?? 1;
  switch (resource.kind) {
    case 'uniform':
      return `@group(${group}) @binding(${binding}) var<uniform> ${resource.varName}: ${resource.typeName};`;
    case 'alpha-policy':
      return `@group(${group}) @binding(${binding}) var<uniform> ${resource.varName}: ${resource.typeName};`;
    case 'texture':
      return `@group(${group}) @binding(${binding}) var ${resource.varName}: ${resource.textureType};`;
    case 'sampler':
      return `@group(${group}) @binding(${binding}) var ${resource.varName}: sampler;`;
  }
};

const assignBindings = (
  resources: readonly TemplateBindingResource[],
): Readonly<{
  bindings: readonly TemplateMaterialBindingDescriptor[];
  declarations: readonly string[];
}> => {
  const nextBindings = new Map<number, number>();
  const bindings: TemplateMaterialBindingDescriptor[] = [];
  const declarations: string[] = [];

  for (const resource of resources) {
    const group = resource.group ?? 1;
    const nextBinding = nextBindings.get(group) ?? 0;
    const binding = resource.binding ?? nextBinding;
    nextBindings.set(group, Math.max(nextBinding, binding + 1));
    bindings.push(createBindingDescriptor(resource, binding));
    declarations.push(createBindingDeclaration(resource, binding));
  }

  return { bindings, declarations };
};

const mergeVertexAttributes = <TVariant extends BaseTemplateVariant>(
  baseVertexAttributes: readonly TemplateMaterialVertexAttribute[],
  activeFeatures: readonly ShaderTemplateFeature<TVariant>[],
): readonly TemplateMaterialVertexAttribute[] => {
  const merged = new Map<string, TemplateMaterialVertexAttribute>();
  for (const attribute of baseVertexAttributes) {
    merged.set(attribute.semantic, attribute);
  }
  for (const feature of activeFeatures) {
    for (const attribute of feature.vertexAttributes ?? []) {
      merged.set(attribute.semantic, attribute);
    }
  }
  return [...merged.values()].sort((a, b) => a.shaderLocation - b.shaderLocation);
};

const collectSlotFragments = <TVariant extends BaseTemplateVariant>(
  activeFeatures: readonly ShaderTemplateFeature<TVariant>[],
  bindingDeclarations: readonly string[],
): Readonly<Record<SlotName, string>> => {
  const slotFragments = new Map<SlotName, string[]>();
  for (const slot of orderedSlots) {
    slotFragments.set(slot, []);
  }

  if (bindingDeclarations.length > 0) {
    slotFragments.get('bindings')?.push(bindingDeclarations.join('\n'));
  }

  for (const feature of activeFeatures) {
    for (const [slot, fragment] of Object.entries(feature.slots ?? {})) {
      if (!fragment) {
        continue;
      }
      slotFragments.get(slot as SlotName)?.push(fragment);
    }
  }

  return Object.fromEntries(
    [...slotFragments.entries()].map(([slot, fragments]) => [slot, fragments.join('\n').trim()]),
  ) as Record<SlotName, string>;
};

const assembleSource = (
  templateSource: string,
  slots: Readonly<Record<SlotName, string>>,
): string => {
  let assembled = templateSource;
  for (const slot of orderedSlots) {
    const marker = `${slotMarkerPrefix}${slot}`;
    assembled = assembled.replace(marker, slots[slot] || '');
  }
  return assembled;
};

export const createShaderTemplateFeature = <TVariant extends BaseTemplateVariant>(
  feature: Omit<ShaderTemplateFeature<TVariant>, 'slots'> & {
    source?: string;
    slots?: Partial<Record<SlotName, string>>;
  },
): ShaderTemplateFeature<TVariant> => ({
  ...feature,
  slots: feature.source ? parseSlotBlocks(feature.source) : feature.slots,
});

export const inspectShaderTemplate = <TVariant extends BaseTemplateVariant>(
  template: ShaderTemplate<TVariant>,
  variant: TVariant,
): TemplateBakeReport<TVariant> => {
  const activeFeatures = template.features.filter((feature) => feature.when(variant));
  const assignedBindings = assignBindings([
    ...(template.baseResources ?? []),
    ...activeFeatures.flatMap((feature) => feature.resources ?? []),
  ]);
  const slots = collectSlotFragments(activeFeatures, assignedBindings.declarations);
  const spec: ProgramSpec = {
    id: template.resolveProgramId(variant, activeFeatures),
    label: template.resolveProgramLabel?.(variant, activeFeatures) ?? template.label,
    templateId: template.id,
    bindings: assignedBindings.bindings,
    vertexAttributes: mergeVertexAttributes(template.baseVertexAttributes ?? [], activeFeatures),
    wgsl: assembleSource(template.source, slots),
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
    usesMaterialBindings: true,
    usesTransformBindings: true,
    usesFrameBindings: false,
  };
  return {
    variant,
    program: emitMaterialProgram(spec),
    spec,
    activeFeatureIds: activeFeatures.map((feature) => feature.id),
  };
};

export const buildProgramSpec = <TVariant extends BaseTemplateVariant>(
  template: ShaderTemplate<TVariant>,
  variant: TVariant,
): ProgramSpec => inspectShaderTemplate(template, variant).spec;
