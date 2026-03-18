import type { EvaluatedCamera, EvaluatedScene } from '@rieul3d/core';
import type { Material } from '@rieul3d/ir';
import {
  acquireColorAttachmentView,
  acquireDepthAttachmentView,
  createOffscreenContext,
  ensureMaterialResidency,
  type GpuReadbackContext,
  readOffscreenSnapshot,
  type RenderContextBinding,
  type RuntimeResidency,
  type TextureResidency,
} from '@rieul3d/gpu';
import builtInForwardShader from './shaders/built_in_forward_unlit.wgsl' with { type: 'text' };
import builtInForwardLitShader from './shaders/built_in_forward_lit.wgsl' with { type: 'text' };
import builtInForwardTexturedShader from './shaders/built_in_forward_unlit_textured.wgsl' with {
  type: 'text',
};
import builtInDeferredDepthPrepassShader from './shaders/built_in_deferred_depth_prepass.wgsl' with {
  type: 'text',
};
import builtInDeferredGbufferUnlitShader from './shaders/built_in_deferred_gbuffer_unlit.wgsl' with {
  type: 'text',
};
import builtInDeferredGbufferTexturedUnlitShader from './shaders/built_in_deferred_gbuffer_unlit_textured.wgsl' with {
  type: 'text',
};
import builtInDeferredGbufferLitShader from './shaders/built_in_deferred_gbuffer_lit.wgsl' with {
  type: 'text',
};
import builtInDeferredLightingShader from './shaders/built_in_deferred_lighting.wgsl' with {
  type: 'text',
};
import builtInSdfRaymarchShader from './shaders/built_in_sdf_raymarch.wgsl' with { type: 'text' };
import builtInVolumeRaymarchShader from './shaders/built_in_volume_raymarch.wgsl' with {
  type: 'text',
};
import builtInNodePickShader from './shaders/built_in_node_pick.wgsl' with { type: 'text' };

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
  light: CapabilityState;
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
    | 'createSampler'
    | 'createShaderModule'
    | 'createTexture'
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

export type DeferredRenderResult = ForwardRenderResult;
export type DeferredSnapshotResult = ForwardSnapshotResult;

export type NodePickItem = Readonly<{
  encodedId: number;
  nodeId: string;
  meshId: string;
}>;

export type NodePickRenderResult = Readonly<{
  drawCount: number;
  submittedCommandBufferCount: number;
  picks: readonly NodePickItem[];
}>;

export type NodePickSnapshotResult = Readonly<{
  drawCount: number;
  submittedCommandBufferCount: number;
  width: number;
  height: number;
  bytes: Uint8Array;
  picks: readonly NodePickItem[];
}>;

export type NodePickHit = Readonly<{
  encodedId: number;
  nodeId: string;
  meshId: string;
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
  halfExtents: readonly [number, number, number];
  color: readonly [number, number, number, number];
  worldToLocalRotation: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}>;

export type RendererCapabilityIssue = Readonly<{
  nodeId: string;
  feature:
    | 'mesh'
    | 'sdf'
    | 'volume'
    | 'light'
    | 'material-kind'
    | 'custom-shader'
    | 'material-binding';
  requirement: string;
  message: string;
}>;

export type DirectionalLightItem = Readonly<{
  nodeId: string;
  lightId: string;
  direction: readonly [number, number, number];
  color: readonly [number, number, number];
  intensity: number;
}>;

const builtInUnlitProgramId = 'built-in:unlit';
const builtInLitProgramId = 'built-in:lit';
const builtInTexturedUnlitProgramId = 'built-in:unlit-textured';
const builtInDeferredDepthPrepassProgramId = 'built-in:deferred-depth-prepass';
const builtInDeferredGbufferUnlitProgramId = 'built-in:deferred-gbuffer-unlit';
const builtInDeferredGbufferTexturedUnlitProgramId = 'built-in:deferred-gbuffer-unlit-textured';
const builtInDeferredGbufferLitProgramId = 'built-in:deferred-gbuffer-lit';
const builtInDeferredLightingProgramId = 'built-in:deferred-lighting';
const builtInSdfRaymarchProgramId = 'built-in:sdf-raymarch';
const builtInVolumeRaymarchProgramId = 'built-in:volume-raymarch';
const builtInNodePickProgramId = 'built-in:node-pick';
const nodePickTargetFormat = 'rgba8unorm';
const textureBindingUsage = 0x04;
const renderAttachmentUsage = 0x10;
const uniformUsage = 0x40;
const bufferCopyDstUsage = 0x08;
const deferredDepthFormat = 'depth24plus';
const maxSdfPassItems = 16;
const depthTextureFormat = 'depth24plus';
const maxDirectionalLights = 4;
const defaultAmbientLight = 0.2;
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

const identityMat4 = (): readonly number[] => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
];

const multiplyMat4 = (a: readonly number[], b: readonly number[]): readonly number[] => {
  const out = new Array<number>(16).fill(0);

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const index = (col * 4) + row;
      out[index] = a[row] * b[col * 4] +
        a[4 + row] * b[(col * 4) + 1] +
        a[8 + row] * b[(col * 4) + 2] +
        a[12 + row] * b[(col * 4) + 3];
    }
  }

  return out;
};

const createPerspectiveProjection = (
  camera: EvaluatedCamera['camera'] & { type: 'perspective' },
  aspect: number,
): readonly number[] => {
  const yfov = camera.yfov ?? Math.PI / 3;
  const f = 1 / Math.tan(yfov / 2);
  const rangeInv = 1 / (camera.znear - camera.zfar);

  return [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    camera.zfar * rangeInv,
    -1,
    0,
    0,
    camera.znear * camera.zfar * rangeInv,
    0,
  ];
};

const createOrthographicProjection = (
  camera: EvaluatedCamera['camera'] & { type: 'orthographic' },
): readonly number[] => {
  const xmag = camera.xmag ?? 1;
  const ymag = camera.ymag ?? 1;
  const rangeInv = 1 / (camera.znear - camera.zfar);

  return [
    1 / xmag,
    0,
    0,
    0,
    0,
    1 / ymag,
    0,
    0,
    0,
    0,
    rangeInv,
    0,
    0,
    0,
    camera.znear * rangeInv,
    1,
  ];
};

const createViewProjectionMatrix = (
  binding: RenderContextBinding,
  activeCamera?: EvaluatedCamera,
): readonly number[] => {
  if (!activeCamera) {
    return identityMat4();
  }

  const aspect = binding.target.width / binding.target.height;
  const projection = activeCamera.camera.type === 'perspective'
    ? createPerspectiveProjection(activeCamera.camera, aspect)
    : createOrthographicProjection(activeCamera.camera);

  return multiplyMat4(projection, activeCamera.viewMatrix);
};

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

const builtInLitProgram: MaterialProgram = {
  id: builtInLitProgramId,
  label: 'Built-in Lit',
  wgsl: builtInForwardLitShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [{
    kind: 'uniform',
    binding: 0,
  }],
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'NORMAL',
      shaderLocation: 1,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
  ],
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

const builtInDeferredGbufferUnlitProgram: MaterialProgram = {
  id: builtInDeferredGbufferUnlitProgramId,
  label: 'Built-in Deferred G-buffer Unlit',
  wgsl: builtInDeferredGbufferUnlitShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [{
    kind: 'uniform',
    binding: 0,
  }],
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'NORMAL',
      shaderLocation: 1,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
  ],
};

const builtInDeferredGbufferTexturedUnlitProgram: MaterialProgram = {
  id: builtInDeferredGbufferTexturedUnlitProgramId,
  label: 'Built-in Deferred G-buffer Unlit (Textured)',
  wgsl: builtInDeferredGbufferTexturedUnlitShader,
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
      semantic: 'NORMAL',
      shaderLocation: 1,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'TEXCOORD_0',
      shaderLocation: 2,
      format: 'float32x2',
      offset: 0,
      arrayStride: 8,
    },
  ],
};

const builtInDeferredGbufferLitProgram: MaterialProgram = {
  id: builtInDeferredGbufferLitProgramId,
  label: 'Built-in Deferred G-buffer Lit',
  wgsl: builtInDeferredGbufferLitShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [{
    kind: 'uniform',
    binding: 0,
  }],
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'NORMAL',
      shaderLocation: 1,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
  ],
};

const createVertexBufferLayouts = (
  attributes: readonly MaterialVertexAttribute[],
): GPUVertexBufferLayout[] => {
  return attributes.map((attribute) => ({
    arrayStride: attribute.arrayStride,
    attributes: [{
      shaderLocation: attribute.shaderLocation,
      offset: attribute.offset,
      format: attribute.format,
    }],
  }));
};

export const createMaterialRegistry = (): MaterialRegistry => ({
  programs: new Map([
    [builtInUnlitProgramId, builtInUnlitProgram],
    [builtInLitProgramId, builtInLitProgram],
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

  if (material.kind === 'lit') {
    return registry.programs.get(builtInLitProgramId) ?? builtInLitProgram;
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
    light: 'supported',
    builtInMaterialKinds: ['unlit', 'lit'],
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
    mesh: 'supported',
    sdf: 'supported',
    volume: 'supported',
    light: 'supported',
    builtInMaterialKinds: ['unlit', 'lit'],
    customShaders: 'supported',
  },
  passes: [
    { id: 'depth-prepass', kind: 'depth-prepass', reads: ['scene'], writes: ['depth'] },
    { id: 'gbuffer', kind: 'gbuffer', reads: ['scene', 'depth'], writes: ['gbuffer'] },
    { id: 'lighting', kind: 'lighting', reads: ['gbuffer', 'depth'], writes: ['color'] },
    { id: 'raymarch', kind: 'raymarch', reads: ['scene', 'color'], writes: ['color'] },
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
  materialRegistry = createMaterialRegistry(),
  residency?: RuntimeResidency,
): readonly RendererCapabilityIssue[] =>
  evaluatedScene.nodes.flatMap((node) => {
    const issues: RendererCapabilityIssue[] = [];
    const hasTexcoord0 = Boolean(
      node.mesh?.attributes.some((attribute) => attribute.semantic === 'TEXCOORD_0'),
    );
    const material = node.material;
    const materialTextures = material?.textures ?? [];
    const issueKeys = new Set<string>();
    const pushIssue = (
      feature: RendererCapabilityIssue['feature'],
      requirement: string,
      message: string,
    ) => {
      const key = `${feature}:${requirement}`;
      if (issueKeys.has(key)) {
        return;
      }

      issueKeys.add(key);
      issues.push({
        nodeId: node.node.id,
        feature,
        requirement,
        message,
      });
    };

    if (node.mesh && renderer.capabilities.mesh !== 'supported') {
      pushIssue(
        'mesh',
        'mesh-execution',
        `renderer "${renderer.label}" does not support mesh execution`,
      );
    }

    if (renderer.kind === 'deferred' && node.mesh) {
      if (!node.mesh.attributes.some((attribute) => attribute.semantic === 'NORMAL')) {
        pushIssue(
          'mesh',
          'vertex-attribute:NORMAL',
          `renderer "${renderer.label}" requires NORMAL vertex data on node "${node.node.id}" for deferred lighting`,
        );
      }
    }

    if (node.sdf) {
      if (renderer.capabilities.sdf !== 'supported') {
        pushIssue(
          'sdf',
          'sdf-execution',
          `renderer "${renderer.label}" does not support sdf execution`,
        );
      } else if (!['sphere', 'box'].includes(node.sdf.op)) {
        pushIssue(
          'sdf',
          `sdf-op:${node.sdf.op}`,
          `renderer "${renderer.label}" only supports sphere and box sdf primitives right now; node "${node.node.id}" requested "${node.sdf.op}"`,
        );
      }
    }

    if (node.volume && renderer.capabilities.volume !== 'supported') {
      pushIssue(
        'volume',
        'volume-execution',
        `renderer "${renderer.label}" does not support volume execution`,
      );
    }

    if (
      node.light &&
      renderer.capabilities.light !== 'supported' &&
      renderer.kind !== 'deferred'
    ) {
      pushIssue(
        'light',
        'light-execution',
        `renderer "${renderer.label}" does not support scene light execution`,
      );
    }

    if (
      material &&
      !material.shaderId &&
      !renderer.capabilities.builtInMaterialKinds.includes(material.kind)
    ) {
      pushIssue(
        'material-kind',
        `material-kind:${material.kind}`,
        `renderer "${renderer.label}" does not support built-in material kind "${material.kind}"`,
      );
    }

    if (material?.shaderId) {
      if (renderer.capabilities.customShaders !== 'supported') {
        pushIssue(
          'custom-shader',
          `shader:${material.shaderId}`,
          `renderer "${renderer.label}" does not support custom shader materials`,
        );
      } else {
        const program = materialRegistry.programs.get(material.shaderId);
        if (!program) {
          pushIssue(
            'material-binding',
            `shader:${material.shaderId}`,
            `renderer "${renderer.label}" cannot resolve custom shader "${material.shaderId}" for material "${material.id}"`,
          );
        } else {
          for (const descriptor of getMaterialBindingDescriptors(program)) {
            if (descriptor.kind === 'uniform') {
              continue;
            }

            const semantic = descriptor.textureSemantic;
            const textureRef = materialTextures.find((texture) => texture.semantic === semantic);
            if (!textureRef) {
              pushIssue(
                'material-binding',
                `texture-semantic:${semantic}`,
                `renderer "${renderer.label}" cannot satisfy "${semantic}" ${descriptor.kind} binding for material "${material.id}"`,
              );
            } else if (residency && !residency.textures.get(textureRef.id)) {
              pushIssue(
                'material-binding',
                `texture-residency:${semantic}:${descriptor.kind}`,
                `renderer "${renderer.label}" cannot satisfy "${semantic}" ${descriptor.kind} binding for material "${material.id}" because texture "${textureRef.id}" is not resident`,
              );
            }

            if (node.mesh && !hasTexcoord0) {
              pushIssue(
                'material-binding',
                'vertex-attribute:TEXCOORD_0',
                `renderer "${renderer.label}" cannot sample material "${material.id}" on node "${node.node.id}" because mesh "${node.mesh.id}" is missing TEXCOORD_0`,
              );
            }
          }
        }
      }
    } else if (
      material?.kind === 'unlit' &&
      materialTextures.some((texture) => texture.semantic === 'baseColor') &&
      node.mesh &&
      !hasTexcoord0
    ) {
      pushIssue(
        'material-binding',
        'vertex-attribute:TEXCOORD_0',
        `renderer "${renderer.label}" cannot sample baseColor textures on node "${node.node.id}" because mesh "${node.mesh.id}" is missing TEXCOORD_0`,
      );
    } else if (material?.kind === 'unlit') {
      const baseColorTexture = materialTextures.find((texture) => texture.semantic === 'baseColor');
      if (baseColorTexture && residency && !residency.textures.get(baseColorTexture.id)) {
        pushIssue(
          'material-binding',
          'texture-residency:baseColor:texture',
          `renderer "${renderer.label}" cannot sample baseColor textures for material "${material.id}" because texture "${baseColorTexture.id}" is not resident`,
        );
      }
    } else if (material?.kind === 'lit') {
      if (renderer.capabilities.light !== 'supported') {
        pushIssue(
          'light',
          'light-material:lit',
          `renderer "${renderer.label}" does not support built-in lit materials`,
        );
      }

      if (!evaluatedScene.nodes.some((candidate) => candidate.light?.kind === 'directional')) {
        pushIssue(
          'light',
          'light-source:directional',
          `renderer "${renderer.label}" requires at least one directional light for material "${material.id}"`,
        );
      }

      if (materialTextures.length > 0) {
        pushIssue(
          'material-binding',
          'light-material:textures-unsupported',
          `renderer "${renderer.label}" does not yet support textures on built-in lit material "${material.id}"`,
        );
      }

      if (node.mesh && !node.mesh.attributes.some((attribute) => attribute.semantic === 'NORMAL')) {
        pushIssue(
          'material-binding',
          'vertex-attribute:NORMAL',
          `renderer "${renderer.label}" cannot light node "${node.node.id}" because mesh "${node.mesh.id}" is missing NORMAL`,
        );
      }
    }

    return issues;
  });

export const assertRendererSceneCapabilities = (
  renderer: Renderer,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
  residency?: RuntimeResidency,
): void => {
  const issues = collectRendererCapabilityIssues(
    renderer,
    evaluatedScene,
    materialRegistry,
    residency,
  );
  if (issues.length === 0) {
    return;
  }

  throw new Error(
    issues.map((issue) =>
      `[${issue.nodeId}] (${issue.feature}:${issue.requirement}) ${issue.message}`
    )
      .join('\n'),
  );
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

const normalizeVector3 = (
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] => {
  const length = Math.hypot(x, y, z);
  if (length < 1e-8) {
    return [0, 0, 0];
  }

  return [x / length, y / length, z / length];
};

const getWorldToLocalRotation = (
  worldMatrix: readonly number[],
): readonly [number, number, number, number, number, number, number, number, number] => {
  const [axisXx, axisXy, axisXz] = normalizeVector3(
    worldMatrix[0] ?? 0,
    worldMatrix[1] ?? 0,
    worldMatrix[2] ?? 0,
  );
  const [axisYx, axisYy, axisYz] = normalizeVector3(
    worldMatrix[4] ?? 0,
    worldMatrix[5] ?? 0,
    worldMatrix[6] ?? 0,
  );
  const [axisZx, axisZy, axisZz] = normalizeVector3(
    worldMatrix[8] ?? 0,
    worldMatrix[9] ?? 0,
    worldMatrix[10] ?? 0,
  );

  return [
    axisXx,
    axisXy,
    axisXz,
    axisYx,
    axisYy,
    axisYz,
    axisZx,
    axisZy,
    axisZz,
  ];
};

const invertAffineMatrix = (worldMatrix: readonly number[]): readonly number[] => {
  const m00 = worldMatrix[0] ?? 0;
  const m01 = worldMatrix[1] ?? 0;
  const m02 = worldMatrix[2] ?? 0;
  const m10 = worldMatrix[4] ?? 0;
  const m11 = worldMatrix[5] ?? 0;
  const m12 = worldMatrix[6] ?? 0;
  const m20 = worldMatrix[8] ?? 0;
  const m21 = worldMatrix[9] ?? 0;
  const m22 = worldMatrix[10] ?? 0;
  const tx = worldMatrix[12] ?? 0;
  const ty = worldMatrix[13] ?? 0;
  const tz = worldMatrix[14] ?? 0;

  const c00 = (m11 * m22) - (m12 * m21);
  const c01 = -((m10 * m22) - (m12 * m20));
  const c02 = (m10 * m21) - (m11 * m20);
  const c10 = -((m01 * m22) - (m02 * m21));
  const c11 = (m00 * m22) - (m02 * m20);
  const c12 = -((m00 * m21) - (m01 * m20));
  const c20 = (m01 * m12) - (m02 * m11);
  const c21 = -((m00 * m12) - (m02 * m10));
  const c22 = (m00 * m11) - (m01 * m10);
  const determinant = (m00 * c00) + (m01 * c01) + (m02 * c02);

  if (Math.abs(determinant) < 1e-8) {
    return [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    ];
  }

  const inverseDeterminant = 1 / determinant;
  const i00 = c00 * inverseDeterminant;
  const i01 = c10 * inverseDeterminant;
  const i02 = c20 * inverseDeterminant;
  const i10 = c01 * inverseDeterminant;
  const i11 = c11 * inverseDeterminant;
  const i12 = c21 * inverseDeterminant;
  const i20 = c02 * inverseDeterminant;
  const i21 = c12 * inverseDeterminant;
  const i22 = c22 * inverseDeterminant;

  return [
    i00,
    i01,
    i02,
    0,
    i10,
    i11,
    i12,
    0,
    i20,
    i21,
    i22,
    0,
    -((i00 * tx) + (i10 * ty) + (i20 * tz)),
    -((i01 * tx) + (i11 * ty) + (i21 * tz)),
    -((i02 * tx) + (i12 * ty) + (i22 * tz)),
    1,
  ];
};

export const extractSdfPassItems = (
  evaluatedScene: EvaluatedScene,
): readonly SdfPassItem[] =>
  evaluatedScene.nodes.flatMap((node) => {
    if (!node.sdf || !['sphere', 'box'].includes(node.sdf.op)) {
      return [];
    }

    const [scaleX, scaleY, scaleZ] = getMatrixScale(node.worldMatrix);
    const averageScale = (scaleX + scaleY + scaleZ) / 3 || 1;
    const radius = (node.sdf.parameters.radius?.x ?? 0.5) * averageScale;
    const halfExtents: readonly [number, number, number] = [
      (node.sdf.parameters.size?.x ?? 0.5) * (scaleX || 1),
      (node.sdf.parameters.size?.y ?? 0.5) * (scaleY || 1),
      (node.sdf.parameters.size?.z ?? 0.5) * (scaleZ || 1),
    ];
    const color = node.sdf.parameters.color ?? { x: 1, y: 0.55, z: 0.2, w: 1 };

    return [{
      nodeId: node.node.id,
      sdfId: node.sdf.id,
      op: node.sdf.op,
      center: getMatrixTranslation(node.worldMatrix),
      radius,
      halfExtents,
      color: [color.x, color.y, color.z, color.w],
      worldToLocalRotation: getWorldToLocalRotation(node.worldMatrix),
    }];
  });

export const extractDirectionalLightItems = (
  evaluatedScene: EvaluatedScene,
): readonly DirectionalLightItem[] =>
  evaluatedScene.nodes.flatMap((node) => {
    if (!node.light || node.light.kind !== 'directional') {
      return [];
    }

    const [x, y, z] = normalizeVector3(
      -(node.worldMatrix[8] ?? 0),
      -(node.worldMatrix[9] ?? 0),
      -(node.worldMatrix[10] ?? 1),
    );
    const direction: readonly [number, number, number] = x === 0 && y === 0 && z === 0
      ? [0, 0, -1]
      : [x, y, z];

    return [{
      nodeId: node.node.id,
      lightId: node.light.id,
      direction,
      color: [node.light.color.x, node.light.color.y, node.light.color.z],
      intensity: node.light.intensity,
    }];
  });

const createDirectionalLightUniformData = (
  lights: readonly DirectionalLightItem[],
): Float32Array => {
  const uniformData = new Float32Array((maxDirectionalLights * 8) + 4);
  const clampedLights = lights.slice(0, maxDirectionalLights);

  for (let index = 0; index < clampedLights.length; index += 1) {
    const light = clampedLights[index];
    const baseIndex = index * 4;
    uniformData.set(light.direction, baseIndex);
    uniformData.set(light.color, (maxDirectionalLights * 4) + baseIndex);
    uniformData[(maxDirectionalLights * 4) + baseIndex + 3] = light.intensity;
  }

  const settingsOffset = maxDirectionalLights * 8;
  uniformData[settingsOffset] = clampedLights.length;
  uniformData[settingsOffset + 1] = defaultAmbientLight;
  return uniformData;
};

const usesLitMaterialProgram = (program: MaterialProgram): boolean =>
  program.id === builtInLitProgramId;

export const ensureBuiltInForwardPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  return ensureMaterialPipeline(context, residency, builtInUnlitProgram, format);
};

export const ensureNodePickPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInNodePickProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInNodePickShader,
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: 'vsMain',
      buffers: createVertexBufferLayouts([{
        semantic: 'POSITION',
        shaderLocation: 0,
        format: 'float32x3',
        offset: 0,
        arrayStride: 12,
      }]),
    },
    fragment: {
      module: shader,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
    },
    depthStencil: {
      format: depthTextureFormat,
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

export const ensureDeferredDepthPrepassPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
): GPURenderPipeline => {
  const cacheKey = `${builtInDeferredDepthPrepassProgramId}:${deferredDepthFormat}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInDeferredDepthPrepassShader,
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: 'vsMain',
      buffers: createVertexBufferLayouts([{
        semantic: 'POSITION',
        shaderLocation: 0,
        format: 'float32x3',
        offset: 0,
        arrayStride: 12,
      }]),
    },
    primitive: {
      topology: 'triangle-list',
    },
    depthStencil: {
      format: deferredDepthFormat,
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

export const ensureDeferredGbufferPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
  program: MaterialProgram = builtInDeferredGbufferUnlitProgram,
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
      targets: [{ format }, { format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
    depthStencil: {
      format: deferredDepthFormat,
      depthWriteEnabled: false,
      depthCompare: 'equal',
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

export const ensureDeferredLightingPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInDeferredLightingProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInDeferredLightingShader,
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
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
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
      cullMode: 'back',
    },
    depthStencil: {
      format: depthTextureFormat,
      depthWriteEnabled: true,
      depthCompare: 'less',
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
  const floatsPerItem = 24;
  const uniformData = new Float32Array(8 + (maxSdfPassItems * floatsPerItem));
  uniformData[0] = Math.min(items.length, maxSdfPassItems);

  items.slice(0, maxSdfPassItems).forEach((item, index) => {
    const offset = 8 + (index * floatsPerItem);
    const opCode = item.op === 'box' ? 1 : 0;
    uniformData.set([...item.center, opCode], offset);
    uniformData.set([...item.halfExtents, item.radius], offset + 4);
    uniformData.set(item.color, offset + 8);
    uniformData.set([...item.worldToLocalRotation.slice(0, 3), 0], offset + 12);
    uniformData.set([...item.worldToLocalRotation.slice(3, 6), 0], offset + 16);
    uniformData.set([...item.worldToLocalRotation.slice(6, 9), 0], offset + 20);
  });

  return uniformData;
};

const createVolumeUniformData = (item: VolumePassItem): Float32Array => {
  return Float32Array.from(invertAffineMatrix(item.worldMatrix));
};

const createForwardMeshTransformUniformData = (
  worldMatrix: readonly number[],
  viewProjectionMatrix: readonly number[],
): Float32Array =>
  Float32Array.from([
    ...worldMatrix.slice(0, 16),
    ...viewProjectionMatrix.slice(0, 16),
  ]);

const createForwardLitMeshTransformUniformData = (
  worldMatrix: readonly number[],
  viewProjectionMatrix: readonly number[],
): Float32Array =>
  Float32Array.from([
    ...worldMatrix.slice(0, 16),
    ...viewProjectionMatrix.slice(0, 16),
    ...createDeferredNormalMatrix(worldMatrix),
  ]);

const encodePickIdColor = (encodedId: number): readonly [number, number, number, number] => [
  (encodedId & 0xff) / 255,
  ((encodedId >> 8) & 0xff) / 255,
  ((encodedId >> 16) & 0xff) / 255,
  ((encodedId >> 24) & 0xff) / 255,
];

const createNodePickTransformUniformData = (
  worldMatrix: readonly number[],
  viewProjectionMatrix: readonly number[],
  encodedId: number,
): Float32Array =>
  Float32Array.from([
    ...worldMatrix.slice(0, 16),
    ...viewProjectionMatrix.slice(0, 16),
    ...encodePickIdColor(encodedId),
  ]);

export const createNodePickItems = (
  evaluatedScene: EvaluatedScene,
): readonly NodePickItem[] => {
  const picks: NodePickItem[] = [];
  let encodedId = 1;

  for (const node of evaluatedScene.nodes) {
    if (!node.mesh) {
      continue;
    }

    picks.push({
      encodedId,
      nodeId: node.node.id,
      meshId: node.mesh.id,
    });
    encodedId += 1;
  }

  return picks;
};

export const decodePickId = (pixel: ArrayLike<number>): number =>
  (pixel[0] ?? 0) +
  ((pixel[1] ?? 0) << 8) +
  ((pixel[2] ?? 0) << 16) +
  ((pixel[3] ?? 0) << 24);

const assertNodePickBindingFormat = (binding: RenderContextBinding): void => {
  if (binding.target.format !== nodePickTargetFormat) {
    throw new Error(
      `node picking requires a ${nodePickTargetFormat} render target, received "${binding.target.format}"`,
    );
  }
};

const assertNodePickSceneCompatibility = (evaluatedScene: EvaluatedScene): void => {
  for (const node of evaluatedScene.nodes) {
    const material = node.material;
    if (!node.mesh || !material?.shaderId) {
      continue;
    }

    throw new Error(
      `node picking does not support custom shader material "${material.id}" on node "${node.node.id}"`,
    );
  }
};

const createWorldTransformUniformData = (worldMatrix: readonly number[]): Float32Array =>
  Float32Array.from(worldMatrix.slice(0, 16));

const createDeferredNormalMatrix = (worldMatrix: readonly number[]): readonly number[] => {
  const inverseWorld = invertAffineMatrix(worldMatrix);
  return [
    inverseWorld[0] ?? 0,
    inverseWorld[4] ?? 0,
    inverseWorld[8] ?? 0,
    0,
    inverseWorld[1] ?? 0,
    inverseWorld[5] ?? 0,
    inverseWorld[9] ?? 0,
    0,
    inverseWorld[2] ?? 0,
    inverseWorld[6] ?? 0,
    inverseWorld[10] ?? 0,
    0,
    0,
    0,
    0,
    1,
  ];
};

const createDeferredMeshTransformUniformData = (worldMatrix: readonly number[]): Float32Array =>
  Float32Array.from([
    ...worldMatrix.slice(0, 16),
    ...createDeferredNormalMatrix(worldMatrix),
  ]);

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
  pass.draw(6, 1, 0, 0);
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
    pass.draw(6, 1, 0, 0);
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

const resolveDeferredGbufferProgram = (
  materialRegistry: MaterialRegistry,
  material: Material,
  geometry: NonNullable<RuntimeResidency['geometry'] extends Map<string, infer T> ? T : never>,
  residency: RuntimeResidency,
): MaterialProgram => {
  if (material.shaderId) {
    return resolveMaterialProgram(materialRegistry, material);
  }

  if (material.kind === 'lit') {
    return builtInDeferredGbufferLitProgram;
  }

  const baseColorTexture = getBaseColorTextureResidency(residency, material);
  return baseColorTexture && geometry.attributeBuffers.TEXCOORD_0
    ? builtInDeferredGbufferTexturedUnlitProgram
    : builtInDeferredGbufferUnlitProgram;
};

export const renderForwardFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
): ForwardRenderResult => {
  assertRendererSceneCapabilities(
    createForwardRenderer(),
    evaluatedScene,
    materialRegistry,
    residency,
  );
  const view = acquireColorAttachmentView(binding);
  const viewProjectionMatrix = createViewProjectionMatrix(binding, evaluatedScene.activeCamera);
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
    depthStencilAttachment: {
      view: acquireDepthAttachmentView(binding),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  let drawCount = 0;
  const directionalLights = extractDirectionalLightItems(evaluatedScene);
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
      const transformData = usesLitMaterialProgram(program)
        ? createForwardLitMeshTransformUniformData(node.worldMatrix, viewProjectionMatrix)
        : createForwardMeshTransformUniformData(node.worldMatrix, viewProjectionMatrix);
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

    if (usesLitMaterialProgram(program)) {
      const lightingData = createDirectionalLightUniformData(directionalLights);
      const lightingBuffer = context.device.createBuffer({
        label: `${node.node.id}:lighting`,
        size: lightingData.byteLength,
        usage: uniformUsage | bufferCopyDstUsage,
      });
      context.queue.writeBuffer(lightingBuffer, 0, toBufferSource(lightingData));
      pass.setBindGroup(
        2,
        context.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(2),
          entries: [{
            binding: 0,
            resource: {
              buffer: lightingBuffer,
            },
          }],
        }),
      );
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

const createTransientRenderTexture = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  label: string,
  format: GPUTextureFormat,
  usage = renderAttachmentUsage | textureBindingUsage,
): GPUTexture =>
  context.device.createTexture({
    label,
    size: {
      width: binding.target.width,
      height: binding.target.height,
      depthOrArrayLayers: 1,
    },
    format,
    sampleCount: 1,
    usage,
  });

export const renderDeferredFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
): DeferredRenderResult => {
  assertRendererSceneCapabilities(
    createDeferredRenderer(),
    evaluatedScene,
    materialRegistry,
    residency,
  );

  const depthTexture = createTransientRenderTexture(
    context,
    binding,
    'deferred-depth',
    deferredDepthFormat,
    renderAttachmentUsage | textureBindingUsage,
  );
  const depthView = depthTexture.createView();
  const gbufferAlbedoTexture = createTransientRenderTexture(
    context,
    binding,
    'deferred-gbuffer-albedo',
    binding.target.format,
  );
  const gbufferNormalTexture = createTransientRenderTexture(
    context,
    binding,
    'deferred-gbuffer-normal',
    binding.target.format,
  );
  const gbufferAlbedoView = gbufferAlbedoTexture.createView();
  const gbufferNormalView = gbufferNormalTexture.createView();
  const encoder = context.device.createCommandEncoder({
    label: 'deferred-frame',
  });
  const depthPipeline = ensureDeferredDepthPrepassPipeline(context, residency);
  const lightingPipeline = ensureDeferredLightingPipeline(
    context,
    residency,
    binding.target.format,
  );
  const directionalLights = extractDirectionalLightItems(evaluatedScene);

  let drawCount = 0;

  const depthPass = encoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  depthPass.setPipeline(depthPipeline);
  for (const node of evaluatedScene.nodes) {
    const mesh = node.mesh;
    if (!mesh) {
      continue;
    }

    const geometry = residency.geometry.get(mesh.id);
    const positionBuffer = geometry?.attributeBuffers.POSITION;
    if (!geometry || !positionBuffer) {
      continue;
    }

    depthPass.setVertexBuffer(0, positionBuffer);
    const transformData = createWorldTransformUniformData(node.worldMatrix);
    const transformBuffer = context.device.createBuffer({
      label: `${node.node.id}:deferred-depth-transform`,
      size: transformData.byteLength,
      usage: uniformUsage | bufferCopyDstUsage,
    });
    context.queue.writeBuffer(transformBuffer, 0, toBufferSource(transformData));
    depthPass.setBindGroup(
      0,
      context.device.createBindGroup({
        layout: depthPipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: transformBuffer,
          },
        }],
      }),
    );

    if (geometry.indexBuffer && geometry.indexCount > 0) {
      depthPass.setIndexBuffer(geometry.indexBuffer, 'uint32');
      depthPass.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
    } else {
      depthPass.draw(geometry.vertexCount, 1, 0, 0);
    }
    drawCount += 1;
  }
  depthPass.end();

  const gbufferPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: gbufferAlbedoView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
      {
        view: gbufferNormalView,
        clearValue: { r: 0.5, g: 0.5, b: 1, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthLoadOp: 'load',
      depthStoreOp: 'store',
    },
  });
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
    const gbufferProgram = resolveDeferredGbufferProgram(
      materialRegistry,
      material,
      geometry,
      residency,
    );
    const gbufferPipeline = ensureDeferredGbufferPipeline(
      context,
      residency,
      binding.target.format,
      gbufferProgram,
    );

    let isDrawable = true;
    for (let index = 0; index < gbufferProgram.vertexAttributes.length; index += 1) {
      const attribute = gbufferProgram.vertexAttributes[index];
      if (attribute.offset !== 0) {
        isDrawable = false;
        break;
      }

      const buffer = geometry.attributeBuffers[attribute.semantic];
      if (!buffer) {
        isDrawable = false;
        break;
      }

      gbufferPass.setVertexBuffer(index, buffer);
    }
    if (!isDrawable) {
      continue;
    }

    gbufferPass.setPipeline(gbufferPipeline);

    const transformData = createDeferredMeshTransformUniformData(node.worldMatrix);
    const transformBuffer = context.device.createBuffer({
      label: `${node.node.id}:deferred-gbuffer-transform`,
      size: transformData.byteLength,
      usage: uniformUsage | bufferCopyDstUsage,
    });
    context.queue.writeBuffer(transformBuffer, 0, toBufferSource(transformData));
    gbufferPass.setBindGroup(
      0,
      context.device.createBindGroup({
        layout: gbufferPipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: transformBuffer,
          },
        }],
      }),
    );

    const materialBindings = getMaterialBindingDescriptors(gbufferProgram);
    const materialResidency = {
      current: undefined as ReturnType<typeof ensureMaterialResidency> | undefined,
    };
    gbufferPass.setBindGroup(
      1,
      context.device.createBindGroup({
        layout: gbufferPipeline.getBindGroupLayout(1),
        entries: materialBindings.map((descriptor) =>
          resolveMaterialBindingResource(
            context,
            residency,
            material,
            descriptor,
            materialResidency,
          )
        ),
      }),
    );

    if (geometry.indexBuffer && geometry.indexCount > 0) {
      gbufferPass.setIndexBuffer(geometry.indexBuffer, 'uint32');
      gbufferPass.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
    } else {
      gbufferPass.draw(geometry.vertexCount, 1, 0, 0);
    }
    drawCount += 1;
  }
  gbufferPass.end();

  const lightingSampler = context.device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const lightingPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: acquireColorAttachmentView(binding),
      clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  lightingPass.setPipeline(lightingPipeline);
  lightingPass.setBindGroup(
    0,
    context.device.createBindGroup({
      layout: lightingPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: gbufferAlbedoView,
        },
        {
          binding: 1,
          resource: lightingSampler,
        },
        {
          binding: 2,
          resource: gbufferNormalView,
        },
      ],
    }),
  );
  const lightingData = createDirectionalLightUniformData(directionalLights);
  const lightingBuffer = context.device.createBuffer({
    label: 'deferred-lighting',
    size: lightingData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(lightingBuffer, 0, toBufferSource(lightingData));
  lightingPass.setBindGroup(
    1,
    context.device.createBindGroup({
      layout: lightingPipeline.getBindGroupLayout(1),
      entries: [{
        binding: 0,
        resource: {
          buffer: lightingBuffer,
        },
      }],
    }),
  );
  lightingPass.draw(3, 1, 0, 0);
  lightingPass.end();
  drawCount += 1;

  drawCount += renderSdfRaymarchPass(context, encoder, binding, residency, evaluatedScene);
  drawCount += renderVolumeRaymarchPass(context, encoder, binding, residency, evaluatedScene);

  const commandBuffer = encoder.finish();
  context.queue.submit([commandBuffer]);

  return {
    drawCount,
    submittedCommandBufferCount: 1,
  };
};

export const renderNodePickFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
): NodePickRenderResult => {
  assertNodePickBindingFormat(binding);
  assertNodePickSceneCompatibility(evaluatedScene);
  const pipeline = ensureNodePickPipeline(context, residency, binding.target.format);
  const viewProjectionMatrix = createViewProjectionMatrix(binding, evaluatedScene.activeCamera);
  const picks = createNodePickItems(evaluatedScene);
  const pickByNodeId = new Map(picks.map((pick) => [pick.nodeId, pick]));
  const encoder = context.device.createCommandEncoder({
    label: 'node-pick-frame',
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: acquireColorAttachmentView(binding),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
    depthStencilAttachment: {
      view: acquireDepthAttachmentView(binding),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  pass.setPipeline(pipeline);

  let drawCount = 0;
  for (const node of evaluatedScene.nodes) {
    const mesh = node.mesh;
    if (!mesh) {
      continue;
    }

    const geometry = residency.geometry.get(mesh.id);
    const positionBuffer = geometry?.attributeBuffers.POSITION;
    const pick = pickByNodeId.get(node.node.id);
    if (!geometry || !positionBuffer || !pick) {
      continue;
    }

    pass.setVertexBuffer(0, positionBuffer);
    const uniformData = createNodePickTransformUniformData(
      node.worldMatrix,
      viewProjectionMatrix,
      pick.encodedId,
    );
    const uniformBuffer = context.device.createBuffer({
      label: `${node.node.id}:node-pick-transform`,
      size: uniformData.byteLength,
      usage: uniformUsage | bufferCopyDstUsage,
    });
    context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));
    pass.setBindGroup(
      0,
      context.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: uniformBuffer,
          },
        }],
      }),
    );

    if (geometry.indexBuffer && geometry.indexCount > 0) {
      pass.setIndexBuffer(geometry.indexBuffer, 'uint32');
      pass.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
    } else {
      pass.draw(geometry.vertexCount, 1, 0, 0);
    }
    drawCount += 1;
  }

  pass.end();

  const commandBuffer = encoder.finish();
  context.queue.submit([commandBuffer]);

  return {
    drawCount,
    submittedCommandBufferCount: 1,
    picks,
  };
};

const assertPixelCoordinate = (name: string, value: number, limit: number): number => {
  if (!Number.isInteger(value) || value < 0 || value >= limit) {
    throw new Error(`"${name}" must be an integer between 0 and ${limit - 1}`);
  }

  return value;
};

export const readNodePickHit = (
  snapshot: Pick<NodePickSnapshotResult, 'width' | 'height' | 'bytes' | 'picks'>,
  x: number,
  y: number,
): NodePickHit | undefined => {
  const pixelX = assertPixelCoordinate('x', x, snapshot.width);
  const pixelY = assertPixelCoordinate('y', y, snapshot.height);
  const pixelOffset = ((pixelY * snapshot.width) + pixelX) * 4;
  const encodedId = decodePickId(snapshot.bytes.slice(pixelOffset, pixelOffset + 4));
  if (encodedId === 0) {
    return undefined;
  }

  const pick = snapshot.picks.find((candidate) => candidate.encodedId === encodedId);
  return pick
    ? {
      encodedId,
      nodeId: pick.nodeId,
      meshId: pick.meshId,
    }
    : undefined;
};

export const renderNodePickSnapshot = async (
  context: GpuRenderExecutionContext & GpuReadbackContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
): Promise<NodePickSnapshotResult> => {
  const pickBinding = createOffscreenContext({
    device: context.device as GPUDevice,
    target: {
      kind: 'offscreen',
      width: binding.target.width,
      height: binding.target.height,
      format: nodePickTargetFormat,
      sampleCount: 1,
    },
  });
  const frame = renderNodePickFrame(context, pickBinding, residency, evaluatedScene);
  const snapshot = await readOffscreenSnapshot(context, pickBinding);

  return {
    ...frame,
    width: snapshot.width,
    height: snapshot.height,
    bytes: snapshot.bytes,
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

export const renderDeferredSnapshot = async (
  context: GpuRenderExecutionContext & GpuReadbackContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
): Promise<DeferredSnapshotResult> => {
  const frame = renderDeferredFrame(context, binding, residency, evaluatedScene, materialRegistry);
  const snapshot = await readOffscreenSnapshot(context, binding);

  return {
    ...frame,
    width: snapshot.width,
    height: snapshot.height,
    bytes: snapshot.bytes,
  };
};
