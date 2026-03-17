import type { EvaluatedScene } from '@rieul3d/core';
import type { Material } from '@rieul3d/ir';
import {
  acquireColorAttachmentView,
  ensureMaterialResidency,
  type GpuReadbackContext,
  readOffscreenSnapshot,
  type RenderContextBinding,
  type RuntimeResidency,
  type TextureResidency,
} from '@rieul3d/gpu';
import builtInForwardShader from './shaders/built_in_forward_unlit.wgsl' with { type: 'text' };
import builtInForwardTexturedShader from './shaders/built_in_forward_unlit_textured.wgsl' with {
  type: 'text',
};
import builtInSdfRaymarchShader from './shaders/built_in_sdf_raymarch.wgsl' with { type: 'text' };
import builtInVolumeRaymarchShader from './shaders/built_in_volume_raymarch.wgsl' with {
  type: 'text',
};

export type RendererKind = 'forward' | 'deferred';
export type PassKind =
  | 'depth-prepass'
  | 'gbuffer'
  | 'lighting'
  | 'mesh'
  | 'raymarch'
  | 'present';

export type RenderPassPlan = Readonly<{
  id: string;
  kind: PassKind;
  reads: readonly string[];
  writes: readonly string[];
}>;

export type CapabilityState = 'supported' | 'planned' | 'unsupported';

export type RendererCapabilities = Readonly<{
  mesh: CapabilityState;
  sdf: CapabilityState;
  volume: CapabilityState;
  builtInMaterialKinds: readonly string[];
  customShaders: CapabilityState;
}>;

export type Renderer = Readonly<{
  kind: RendererKind;
  label: string;
  capabilities: RendererCapabilities;
  passes: readonly RenderPassPlan[];
}>;

export type FramePlan = Readonly<{
  renderer: RendererKind;
  nodeCount: number;
  meshNodeCount: number;
  sdfNodeCount: number;
  volumeNodeCount: number;
  passes: readonly RenderPassPlan[];
}>;

export type GpuRenderExecutionContext = Readonly<{
  device: Pick<
    GPUDevice,
    | 'createBindGroup'
    | 'createBuffer'
    | 'createCommandEncoder'
    | 'createRenderPipeline'
    | 'createShaderModule'
  >;
  queue: Pick<GPUQueue, 'submit' | 'writeBuffer'>;
}>;

export type ForwardRenderResult = Readonly<{
  drawCount: number;
  submittedCommandBufferCount: number;
}>;

export type ForwardSnapshotResult = Readonly<{
  drawCount: number;
  submittedCommandBufferCount: number;
  width: number;
  height: number;
  bytes: Uint8Array;
}>;

export type MaterialVertexAttribute = Readonly<{
  semantic: string;
  shaderLocation: number;
  format: GPUVertexFormat;
  offset: number;
  arrayStride: number;
}>;

export type MaterialProgram = Readonly<{
  id: string;
  label: string;
  wgsl: string;
  vertexEntryPoint: string;
  fragmentEntryPoint: string;
  vertexAttributes: readonly MaterialVertexAttribute[];
  usesMaterialBindings?: boolean;
  usesTransformBindings?: boolean;
  materialBindings?: readonly MaterialBindingDescriptor[];
}>;

export type MaterialBindingDescriptor = Readonly<
  | {
    kind: 'uniform';
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

export type MaterialRegistry = Readonly<{
  programs: Map<string, MaterialProgram>;
}>;

export type VolumePassItem = Readonly<{
  nodeId: string;
  volumeId: string;
  worldMatrix: readonly number[];
  residency: NonNullable<RuntimeResidency['volumes'] extends Map<string, infer T> ? T : never>;
}>;

export type SdfPassItem = Readonly<{
  nodeId: string;
  sdfId: string;
  op: string;
  center: readonly [number, number, number];
  radius: number;
  color: readonly [number, number, number, number];
}>;

export type RendererCapabilityIssue = Readonly<{
  nodeId: string;
  feature: 'mesh' | 'sdf' | 'volume' | 'material-kind' | 'custom-shader';
  message: string;
}>;

const builtInUnlitProgramId = 'built-in:unlit';
const builtInTexturedUnlitProgramId = 'built-in:unlit-textured';
const builtInSdfRaymarchProgramId = 'built-in:sdf-raymarch';
const builtInVolumeRaymarchProgramId = 'built-in:volume-raymarch';
const uniformUsage = 0x40;
const bufferCopyDstUsage = 0x08;
const maxSdfPassItems = 16;
const toBufferSource = (view: ArrayBufferView): Uint8Array<ArrayBuffer> => {
  const buffer = view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(buffer);
};

const countPrimitiveNodes = (evaluatedScene: EvaluatedScene) => ({
  meshNodeCount: evaluatedScene.nodes.filter((node) => Boolean(node.mesh)).length,
  sdfNodeCount: evaluatedScene.nodes.filter((node) => Boolean(node.sdf)).length,
  volumeNodeCount: evaluatedScene.nodes.filter((node) => Boolean(node.volume)).length,
});

const builtInUnlitProgram: MaterialProgram = {
  id: builtInUnlitProgramId,
  label: 'Built-in Unlit',
  wgsl: builtInForwardShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [{
    kind: 'uniform',
    binding: 0,
  }],
  vertexAttributes: [{
    semantic: 'POSITION',
    shaderLocation: 0,
    format: 'float32x3',
    offset: 0,
    arrayStride: 12,
  }],
};

const builtInTexturedUnlitProgram: MaterialProgram = {
  id: builtInTexturedUnlitProgramId,
  label: 'Built-in Unlit (Textured)',
  wgsl: builtInForwardTexturedShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [
    {
      kind: 'uniform',
      binding: 0,
    },
    {
      kind: 'texture',
      binding: 1,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'sampler',
      binding: 2,
      textureSemantic: 'baseColor',
    },
  ],
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'TEXCOORD_0',
      shaderLocation: 1,
      format: 'float32x2',
      offset: 0,
      arrayStride: 8,
    },
  ],
};

const createVertexBufferLayouts = (
  attributes: readonly MaterialVertexAttribute[],
): GPUVertexBufferLayout[] => {
  const grouped = new Map<number, MaterialVertexAttribute[]>();

  for (const attribute of attributes) {
    grouped.set(attribute.arrayStride, [...(grouped.get(attribute.arrayStride) ?? []), attribute]);
  }

  return [...grouped.entries()].map(([arrayStride, strideAttributes]) => ({
    arrayStride,
    attributes: strideAttributes.map((attribute) => ({
      shaderLocation: attribute.shaderLocation,
      offset: attribute.offset,
      format: attribute.format,
    })),
  }));
};

export const createMaterialRegistry = (): MaterialRegistry => ({
  programs: new Map([
    [builtInUnlitProgramId, builtInUnlitProgram],
    [builtInTexturedUnlitProgramId, builtInTexturedUnlitProgram],
  ]),
});

export type ResolveMaterialProgramOptions = Readonly<{
  preferTexturedUnlit?: boolean;
}>;

export const registerWgslMaterial = (
  registry: MaterialRegistry,
  program: MaterialProgram,
): MaterialRegistry => {
  registry.programs.set(program.id, program);
  return registry;
};

export const resolveMaterialProgram = (
  registry: MaterialRegistry,
  material?: Material,
  options: ResolveMaterialProgramOptions = {},
): MaterialProgram => {
  if (!material) {
    return registry.programs.get(builtInUnlitProgramId) ?? builtInUnlitProgram;
  }

  if (material.shaderId) {
    const customProgram = registry.programs.get(material.shaderId);
    if (!customProgram) {
      throw new Error(`material "${material.id}" references missing shader "${material.shaderId}"`);
    }
    return customProgram;
  }

  if (material.kind === 'unlit') {
    if (options.preferTexturedUnlit) {
      return registry.programs.get(builtInTexturedUnlitProgramId) ?? builtInTexturedUnlitProgram;
    }
    return registry.programs.get(builtInUnlitProgramId) ?? builtInUnlitProgram;
  }

  throw new Error(`material "${material.id}" uses unsupported kind "${material.kind}"`);
};

const getBaseColorTextureResidency = (
  residency: RuntimeResidency,
  material: Material,
): TextureResidency | undefined => {
  const textureRef = material.textures.find((texture) => texture.semantic === 'baseColor');
  return textureRef ? residency.textures.get(textureRef.id) : undefined;
};

const getMaterialTextureResidency = (
  residency: RuntimeResidency,
  material: Material,
  textureSemantic: string,
): TextureResidency | undefined => {
  const textureRef = material.textures.find((texture) => texture.semantic === textureSemantic);
  return textureRef ? residency.textures.get(textureRef.id) : undefined;
};

const defaultMaterialBindings = [{
  kind: 'uniform',
  binding: 0,
}] as const satisfies readonly MaterialBindingDescriptor[];

const getMaterialBindingDescriptors = (
  program: MaterialProgram,
): readonly MaterialBindingDescriptor[] =>
  program.materialBindings ?? (program.usesMaterialBindings ? defaultMaterialBindings : []);

const resolveMaterialBindingResource = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  material: Material,
  descriptor: MaterialBindingDescriptor,
  materialResidency: { current?: ReturnType<typeof ensureMaterialResidency> },
): GPUBindGroupEntry => {
  switch (descriptor.kind) {
    case 'uniform': {
      materialResidency.current ??= ensureMaterialResidency(context, residency, material);
      return {
        binding: descriptor.binding,
        resource: {
          buffer: materialResidency.current.uniformBuffer,
        },
      };
    }
    case 'texture': {
      const textureResidency = getMaterialTextureResidency(
        residency,
        material,
        descriptor.textureSemantic,
      );
      if (!textureResidency) {
        throw new Error(
          `material "${material.id}" is missing residency for "${descriptor.textureSemantic}" texture binding`,
        );
      }
      return {
        binding: descriptor.binding,
        resource: textureResidency.view,
      };
    }
    case 'sampler': {
      const textureResidency = getMaterialTextureResidency(
        residency,
        material,
        descriptor.textureSemantic,
      );
      if (!textureResidency) {
        throw new Error(
          `material "${material.id}" is missing residency for "${descriptor.textureSemantic}" sampler binding`,
        );
      }
      return {
        binding: descriptor.binding,
        resource: textureResidency.sampler,
      };
    }
  }
};

export const createForwardRenderer = (label = 'forward'): Renderer => ({
  kind: 'forward',
  label,
  capabilities: {
    mesh: 'supported',
    sdf: 'supported',
    volume: 'supported',
    builtInMaterialKinds: ['unlit'],
    customShaders: 'supported',
  },
  passes: [
    { id: 'mesh', kind: 'mesh', reads: ['scene'], writes: ['color', 'depth'] },
    { id: 'raymarch', kind: 'raymarch', reads: ['scene', 'depth'], writes: ['color'] },
    { id: 'present', kind: 'present', reads: ['color'], writes: ['target'] },
  ],
});

export const createDeferredRenderer = (label = 'deferred'): Renderer => ({
  kind: 'deferred',
  label,
  capabilities: {
    mesh: 'planned',
    sdf: 'planned',
    volume: 'planned',
    builtInMaterialKinds: ['unlit'],
    customShaders: 'planned',
  },
  passes: [
    { id: 'depth-prepass', kind: 'depth-prepass', reads: ['scene'], writes: ['depth'] },
    { id: 'gbuffer', kind: 'gbuffer', reads: ['scene', 'depth'], writes: ['gbuffer'] },
    { id: 'lighting', kind: 'lighting', reads: ['gbuffer', 'depth'], writes: ['color'] },
    { id: 'raymarch', kind: 'raymarch', reads: ['scene', 'depth', 'color'], writes: ['color'] },
    { id: 'present', kind: 'present', reads: ['color'], writes: ['target'] },
  ],
});

export const planFrame = (
  renderer: Renderer,
  evaluatedScene: EvaluatedScene,
  _residency: RuntimeResidency,
): FramePlan => {
  const counts = countPrimitiveNodes(evaluatedScene);

  return {
    renderer: renderer.kind,
    nodeCount: evaluatedScene.nodes.length,
    meshNodeCount: counts.meshNodeCount,
    sdfNodeCount: counts.sdfNodeCount,
    volumeNodeCount: counts.volumeNodeCount,
    passes: renderer.passes.filter((pass) =>
      pass.kind === 'raymarch' ? counts.sdfNodeCount > 0 || counts.volumeNodeCount > 0 : true
    ),
  };
};

export const collectRendererCapabilityIssues = (
  renderer: Renderer,
  evaluatedScene: EvaluatedScene,
): readonly RendererCapabilityIssue[] =>
  evaluatedScene.nodes.flatMap((node) => {
    const issues: RendererCapabilityIssue[] = [];

    if (node.mesh && renderer.capabilities.mesh !== 'supported') {
      issues.push({
        nodeId: node.node.id,
        feature: 'mesh',
        message: `renderer "${renderer.label}" does not support mesh execution`,
      });
    }

    if (node.sdf) {
      if (renderer.capabilities.sdf !== 'supported') {
        issues.push({
          nodeId: node.node.id,
          feature: 'sdf',
          message: `renderer "${renderer.label}" does not support sdf execution`,
        });
      } else if (node.sdf.op !== 'sphere') {
        issues.push({
          nodeId: node.node.id,
          feature: 'sdf',
          message: `renderer "${renderer.label}" only supports sphere sdf primitives right now`,
        });
      }
    }

    if (node.volume && renderer.capabilities.volume !== 'supported') {
      issues.push({
        nodeId: node.node.id,
        feature: 'volume',
        message: `renderer "${renderer.label}" does not support volume execution`,
      });
    }

    if (
      node.material &&
      !node.material.shaderId &&
      !renderer.capabilities.builtInMaterialKinds.includes(node.material.kind)
    ) {
      issues.push({
        nodeId: node.node.id,
        feature: 'material-kind',
        message:
          `renderer "${renderer.label}" does not support built-in material kind "${node.material.kind}"`,
      });
    }

    if (node.material?.shaderId && renderer.capabilities.customShaders !== 'supported') {
      issues.push({
        nodeId: node.node.id,
        feature: 'custom-shader',
        message: `renderer "${renderer.label}" does not support custom shader materials`,
      });
    }

    return issues;
  });

export const assertRendererSceneCapabilities = (
  renderer: Renderer,
  evaluatedScene: EvaluatedScene,
): void => {
  const issues = collectRendererCapabilityIssues(renderer, evaluatedScene);
  if (issues.length === 0) {
    return;
  }

  throw new Error(issues.map((issue) => `[${issue.nodeId}] ${issue.message}`).join('\n'));
};

export const extractVolumePassItems = (
  evaluatedScene: EvaluatedScene,
  residency: RuntimeResidency,
): readonly VolumePassItem[] =>
  evaluatedScene.nodes.flatMap((node) => {
    if (!node.volume) {
      return [];
    }

    const volumeResidency = residency.volumes.get(node.volume.id);
    if (!volumeResidency) {
      return [];
    }

    return [{
      nodeId: node.node.id,
      volumeId: node.volume.id,
      worldMatrix: node.worldMatrix,
      residency: volumeResidency,
    }];
  });

const getMatrixTranslation = (
  worldMatrix: readonly number[],
): readonly [number, number, number] => [
  worldMatrix[12] ?? 0,
  worldMatrix[13] ?? 0,
  worldMatrix[14] ?? 0,
];

const getMatrixScale = (worldMatrix: readonly number[]): readonly [number, number, number] => {
  const scaleX = Math.hypot(worldMatrix[0] ?? 0, worldMatrix[1] ?? 0, worldMatrix[2] ?? 0);
  const scaleY = Math.hypot(worldMatrix[4] ?? 0, worldMatrix[5] ?? 0, worldMatrix[6] ?? 0);
  const scaleZ = Math.hypot(worldMatrix[8] ?? 0, worldMatrix[9] ?? 0, worldMatrix[10] ?? 0);
  return [scaleX, scaleY, scaleZ];
};

export const extractSdfPassItems = (
  evaluatedScene: EvaluatedScene,
): readonly SdfPassItem[] =>
  evaluatedScene.nodes.flatMap((node) => {
    if (!node.sdf || node.sdf.op !== 'sphere') {
      return [];
    }

    const [scaleX, scaleY, scaleZ] = getMatrixScale(node.worldMatrix);
    const averageScale = (scaleX + scaleY + scaleZ) / 3 || 1;
    const radius = (node.sdf.parameters.radius?.x ?? 0.5) * averageScale;
    const color = node.sdf.parameters.color ?? { x: 1, y: 0.55, z: 0.2, w: 1 };

    return [{
      nodeId: node.node.id,
      sdfId: node.sdf.id,
      op: node.sdf.op,
      center: getMatrixTranslation(node.worldMatrix),
      radius,
      color: [color.x, color.y, color.z, color.w],
    }];
  });

export const ensureBuiltInForwardPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  return ensureMaterialPipeline(context, residency, builtInUnlitProgram, format);
};

export const ensureMaterialPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  program: MaterialProgram,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${program.id}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: program.wgsl,
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: program.vertexEntryPoint,
      buffers: createVertexBufferLayouts(program.vertexAttributes),
    },
    fragment: {
      module: shader,
      entryPoint: program.fragmentEntryPoint,
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

export const ensureSdfRaymarchPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInSdfRaymarchProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInSdfRaymarchShader,
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: 'vsMain',
    },
    fragment: {
      module: shader,
      entryPoint: 'fsMain',
      targets: [{
        format,
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
      }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

export const ensureVolumeRaymarchPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInVolumeRaymarchProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInVolumeRaymarchShader,
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: 'vsMain',
    },
    fragment: {
      module: shader,
      entryPoint: 'fsMain',
      targets: [{
        format,
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
      }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

const createSdfUniformData = (items: readonly SdfPassItem[]): Float32Array => {
  const uniformData = new Float32Array(4 + (maxSdfPassItems * 8));
  uniformData[0] = Math.min(items.length, maxSdfPassItems);

  items.slice(0, maxSdfPassItems).forEach((item, index) => {
    const offset = 4 + (index * 8);
    uniformData.set([...item.center, item.radius], offset);
    uniformData.set(item.color, offset + 4);
  });

  return uniformData;
};

const createVolumeUniformData = (item: VolumePassItem): Float32Array => {
  const center = getMatrixTranslation(item.worldMatrix);
  const [scaleX, scaleY, scaleZ] = getMatrixScale(item.worldMatrix);
  const halfExtent = [
    Math.max(scaleX * 0.5, 0.001),
    Math.max(scaleY * 0.5, 0.001),
    Math.max(scaleZ * 0.5, 0.001),
  ] as const;

  return Float32Array.from([
    center[0],
    center[1],
    center[2],
    0,
    halfExtent[0],
    halfExtent[1],
    halfExtent[2],
    0,
  ]);
};

const createMeshTransformUniformData = (worldMatrix: readonly number[]): Float32Array =>
  Float32Array.from(worldMatrix.slice(0, 16));

export const renderSdfRaymarchPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
): number => {
  const items = extractSdfPassItems(evaluatedScene);
  if (items.length === 0) {
    return 0;
  }

  const pipeline = ensureSdfRaymarchPipeline(context, residency, binding.target.format);
  const uniformData = createSdfUniformData(items);
  const uniformBuffer = context.device.createBuffer({
    label: 'sdf-raymarch-uniforms',
    size: uniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));

  const bindGroup = context.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{
      binding: 0,
      resource: {
        buffer: uniformBuffer,
      },
    }],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: acquireColorAttachmentView(binding),
      loadOp: 'load',
      storeOp: 'store',
    }],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();

  return 1;
};

export const renderVolumeRaymarchPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
): number => {
  const items = extractVolumePassItems(evaluatedScene, residency);
  if (items.length === 0) {
    return 0;
  }

  const pipeline = ensureVolumeRaymarchPipeline(context, residency, binding.target.format);
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: acquireColorAttachmentView(binding),
      loadOp: 'load',
      storeOp: 'store',
    }],
  });

  pass.setPipeline(pipeline);
  for (const item of items) {
    const uniformData = createVolumeUniformData(item);
    const uniformBuffer = context.device.createBuffer({
      label: `${item.nodeId}:volume-raymarch-uniforms`,
      size: uniformData.byteLength,
      usage: uniformUsage | bufferCopyDstUsage,
    });
    context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));

    const bindGroup = context.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
          },
        },
        {
          binding: 1,
          resource: item.residency.view,
        },
        {
          binding: 2,
          resource: item.residency.sampler,
        },
      ],
    });

    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
  }
  pass.end();

  return items.length;
};

const createDefaultMaterial = (): Material => ({
  id: 'built-in:default-unlit-material',
  kind: 'unlit',
  textures: [],
  parameters: {
    color: { x: 0.95, y: 0.95, z: 0.95, w: 1 },
  },
});

export const renderForwardFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
): ForwardRenderResult => {
  assertRendererSceneCapabilities(createForwardRenderer(), evaluatedScene);
  const view = acquireColorAttachmentView(binding);
  const encoder = context.device.createCommandEncoder({
    label: 'forward-frame',
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view,
      clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  let drawCount = 0;
  for (const node of evaluatedScene.nodes) {
    const mesh = node.mesh;
    if (!mesh) {
      continue;
    }

    const geometry = residency.geometry.get(mesh.id);
    if (!geometry) {
      continue;
    }

    const material = node.material ?? createDefaultMaterial();
    const baseColorTexture = getBaseColorTextureResidency(residency, material);
    const resolvedProgram = resolveMaterialProgram(materialRegistry, node.material);
    const preferTexturedUnlit = resolvedProgram.id === builtInUnlitProgramId &&
      Boolean(baseColorTexture) &&
      Boolean(geometry.attributeBuffers.TEXCOORD_0);
    const program = preferTexturedUnlit
      ? resolveMaterialProgram(materialRegistry, node.material, {
        preferTexturedUnlit: true,
      })
      : resolvedProgram;
    const pipeline = ensureMaterialPipeline(context, residency, program, binding.target.format);

    let isDrawable = true;
    for (let index = 0; index < program.vertexAttributes.length; index += 1) {
      const attribute = program.vertexAttributes[index];
      if (attribute.offset !== 0) {
        isDrawable = false;
        break;
      }

      const buffer = geometry.attributeBuffers[attribute.semantic];
      if (!buffer) {
        isDrawable = false;
        break;
      }

      pass.setVertexBuffer(index, buffer);
    }

    if (!isDrawable) {
      continue;
    }

    pass.setPipeline(pipeline);

    if (program.usesTransformBindings) {
      const transformData = createMeshTransformUniformData(node.worldMatrix);
      const transformBuffer = context.device.createBuffer({
        label: `${node.node.id}:mesh-transform`,
        size: transformData.byteLength,
        usage: uniformUsage | bufferCopyDstUsage,
      });
      context.queue.writeBuffer(transformBuffer, 0, toBufferSource(transformData));
      const transformBindGroup = context.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: transformBuffer,
          },
        }],
      });
      pass.setBindGroup(0, transformBindGroup);
    }

    const materialBindings = getMaterialBindingDescriptors(program);
    if (materialBindings.length > 0) {
      const materialBindGroupIndex = program.usesTransformBindings ? 1 : 0;
      const materialResidency = {
        current: undefined as ReturnType<typeof ensureMaterialResidency> | undefined,
      };
      const bindGroup = context.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(materialBindGroupIndex),
        entries: materialBindings.map((descriptor) =>
          resolveMaterialBindingResource(
            context,
            residency,
            material,
            descriptor,
            materialResidency,
          )
        ),
      });
      pass.setBindGroup(materialBindGroupIndex, bindGroup);
    }

    if (geometry.indexBuffer && geometry.indexCount > 0) {
      pass.setIndexBuffer(geometry.indexBuffer, 'uint32');
      pass.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
    } else {
      pass.draw(geometry.vertexCount, 1, 0, 0);
    }

    drawCount += 1;
  }

  pass.end();

  drawCount += renderSdfRaymarchPass(context, encoder, binding, residency, evaluatedScene);
  drawCount += renderVolumeRaymarchPass(context, encoder, binding, residency, evaluatedScene);

  const commandBuffer = encoder.finish();
  context.queue.submit([commandBuffer]);

  return {
    drawCount,
    submittedCommandBufferCount: 1,
  };
};

export const renderForwardSnapshot = async (
  context: GpuRenderExecutionContext & GpuReadbackContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
): Promise<ForwardSnapshotResult> => {
  const frame = renderForwardFrame(context, binding, residency, evaluatedScene, materialRegistry);
  const snapshot = await readOffscreenSnapshot(context, binding);

  return {
    ...frame,
    width: snapshot.width,
    height: snapshot.height,
    bytes: snapshot.bytes,
  };
};
