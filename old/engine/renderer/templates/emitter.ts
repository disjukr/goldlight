import type { ProgramSpec, TemplateMaterialProgram } from './types.ts';

export const emitMaterialProgram = (spec: ProgramSpec): TemplateMaterialProgram => ({
  id: spec.id,
  label: spec.label,
  wgsl: spec.wgsl,
  vertexEntryPoint: spec.vertexEntryPoint,
  fragmentEntryPoint: spec.fragmentEntryPoint,
  vertexAttributes: spec.vertexAttributes,
  usesMaterialBindings: spec.usesMaterialBindings &&
    spec.bindings.some((binding) => binding.group === 1),
  usesTransformBindings: spec.usesTransformBindings,
  usesFrameBindings: spec.usesFrameBindings ||
    spec.bindings.some((binding) => binding.group === 0 && binding.binding === 1),
  programBindings: spec.bindings,
  materialBindings: spec.bindings
    .filter((binding) => binding.group === 1)
    .map((binding) => {
      const { group: _group, ...descriptor } = binding;
      return descriptor;
    }),
});
