import type { ProgramSpec, TemplateMaterialProgram } from './types.ts';

export const emitMaterialProgram = (spec: ProgramSpec): TemplateMaterialProgram => ({
  id: spec.id,
  label: spec.label,
  wgsl: spec.wgsl,
  vertexEntryPoint: spec.vertexEntryPoint,
  fragmentEntryPoint: spec.fragmentEntryPoint,
  vertexAttributes: spec.vertexAttributes,
  usesMaterialBindings: spec.usesMaterialBindings,
  usesTransformBindings: spec.usesTransformBindings,
  materialBindings: spec.bindings,
});
