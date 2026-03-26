import type { EvaluatedCamera, EvaluatedScene } from '@goldlight/core';
import type { Material } from '@goldlight/ir';
import { buildBvh, type BvhNode, type RaytraceTriangle } from '@goldlight/raytrace';
import {
  acquireColorAttachmentView,
  acquireDepthAttachmentView,
  createOffscreenBinding,
  ensureMaterialResidency,
  type GpuReadbackContext,
  type ImageAsset,
  readOffscreenSnapshot,
  type RenderContextBinding,
  type RuntimeResidency,
  type TextureResidency,
} from '@goldlight/gpu';
import { EXRLoader } from 'npm:three@0.180.0/examples/jsm/loaders/EXRLoader.js';
import builtInForwardShader from './shaders/built_in_forward_unlit.wgsl' with { type: 'text' };
import builtInForwardLitShader from './shaders/built_in_forward_lit.wgsl' with { type: 'text' };
import builtInForwardTexturedShader from './shaders/built_in_forward_unlit_textured.wgsl' with {
  type: 'text',
};
import builtInForwardTexturedLitShader from './shaders/built_in_forward_lit_textured.wgsl' with {
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
import builtInPathtracedAccumulateShader from './shaders/built_in_pathtraced_accumulate.wgsl' with {
  type: 'text',
};
import builtInPathtracedSdfShader from './shaders/built_in_pathtraced_sdf.wgsl' with {
  type: 'text',
};
import builtInPathtracedMeshShader from './shaders/built_in_pathtraced_mesh.wgsl' with {
  type: 'text',
};
import builtInPathtracedPresentShader from './shaders/built_in_pathtraced_present.wgsl' with {
  type: 'text',
};
import builtInSdfRaymarchShader from './shaders/built_in_sdf_raymarch.wgsl' with { type: 'text' };
import builtInVolumeRaymarchShader from './shaders/built_in_volume_raymarch.wgsl' with {
  type: 'text',
};
import builtInNodePickShader from './shaders/built_in_node_pick.wgsl' with { type: 'text' };
import builtInPostProcessBlitShader from './shaders/built_in_post_process_blit.wgsl' with {
  type: 'text',
};
import builtInEnvironmentBackgroundShader from './shaders/built_in_environment_background.wgsl' with {
  type: 'text',
};
import builtInEnvironmentBackgroundBlurShader from './shaders/built_in_environment_background_blur.wgsl' with {
  type: 'text',
};
import forwardEnvironmentBrdfLutBytes from './images/forward_environment_brdf_lut_rg16f.bin' with {
  type: 'bytes',
};
import {
  type BuiltInLitTemplateVariant as BuiltInLitTemplateVariantFromTemplate,
  inspectBuiltInLitTemplateProgram,
  prepareBuiltInLitTemplateProgram,
} from './templates/builtins/lit/template.ts';
import {
  type BuiltInUnlitTemplateVariant,
  inspectBuiltInUnlitTemplateProgram,
  prepareBuiltInUnlitTemplateProgram,
} from './templates/builtins/unlit/template.ts';

export type RendererKind = 'forward' | 'deferred' | 'pathtraced' | 'uber';
export type PassKind =
  | 'depth-prepass'
  | 'gbuffer'
  | 'lighting'
  | 'mesh'
  | 'pathtrace'
  | 'post-process'
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
  passes: readonly RenderPassPlan[];
}>;

export type GpuRenderExecutionContext = Readonly<{
  device: Pick<
    GPUDevice,
    | 'createBindGroup'
    | 'createBindGroupLayout'
    | 'createBuffer'
    | 'createCommandEncoder'
    | 'createPipelineLayout'
    | 'createRenderPipeline'
    | 'createSampler'
    | 'createShaderModule'
    | 'createTexture'
  >;
  queue: Pick<GPUQueue, 'submit' | 'writeBuffer'> & Partial<Pick<GPUQueue, 'writeTexture'>>;
}>;

export type FrameState = Readonly<
  & {
    timeMs?: number;
    deltaTimeMs?: number;
    frameIndex?: number;
  }
  & Record<string, unknown>
>;

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
export type PathtracedRenderResult = ForwardRenderResult;
export type PathtracedSnapshotResult = ForwardSnapshotResult;
export type UberRenderResult = ForwardRenderResult;
export type UberSnapshotResult = ForwardSnapshotResult;

export type CubemapFace =
  | 'positive-x'
  | 'negative-x'
  | 'positive-y'
  | 'negative-y'
  | 'positive-z'
  | 'negative-z';

export type CubemapCaptureOptions = Readonly<{
  size: number;
  format?: GPUTextureFormat;
  position?: readonly [number, number, number];
  znear?: number;
  zfar?: number;
}>;

export type CubemapFaceSnapshotResult = Readonly<{
  face: CubemapFace;
  width: number;
  height: number;
  bytes: Uint8Array;
  viewMatrix: readonly number[];
  projectionMatrix: readonly number[];
}>;

export type CubemapSnapshotResult = Readonly<{
  drawCount: number;
  submittedCommandBufferCount: number;
  size: number;
  faces: readonly CubemapFaceSnapshotResult[];
}>;

export type CubemapExportLayout = 'equirectangular' | 'angular' | 'cross' | 'strip';

export type CubemapExportSampling = 'nearest' | 'linear';

export type CubemapExportOptions = Readonly<{
  layout: CubemapExportLayout;
  width?: number;
  height?: number;
  sampling?: CubemapExportSampling;
}>;

export type CubemapExportResult = Readonly<{
  layout: CubemapExportLayout;
  width: number;
  height: number;
  bytes: Uint8Array;
}>;

type RaymarchCamera = Readonly<{
  origin: readonly [number, number, number];
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  forward: readonly [number, number, number];
  projection: 'perspective' | 'orthographic';
}>;

type PathtracedAccumulationState = {
  width: number;
  height: number;
  format: GPUTextureFormat;
  sceneKey: string;
  sampleCount: number;
  currentSampleTexture: GPUTexture;
  accumulationA: GPUTexture;
  accumulationB: GPUTexture;
  frameIndex: number;
  swap: boolean;
};

type PathtracedMeshTriangle = Readonly<{
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  c: readonly [number, number, number];
  na: readonly [number, number, number];
  nb: readonly [number, number, number];
  nc: readonly [number, number, number];
  ta: readonly [number, number];
  tb: readonly [number, number];
  tc: readonly [number, number];
}>;

type PathtracedMeshAsset = Readonly<{
  meshId: string;
  rootNodeIndex: number;
}>;

type PathtracedMeshSceneState = Readonly<{
  meshCacheKey: string;
  triangleBuffer: GPUBuffer;
  bvhBuffer: GPUBuffer;
  meshAssets: ReadonlyMap<string, PathtracedMeshAsset>;
}>;

type PathtracedMeshInstance = Readonly<{
  rootNodeIndex: number;
  baseColorTextureSlot: number;
  metallicRoughnessTextureSlot: number;
  normalTextureSlot: number;
  emissiveTextureSlot: number;
  occlusionTextureSlot: number;
  localToWorld: readonly number[];
  worldToLocal: readonly number[];
  albedo: readonly [number, number, number];
  emissive: readonly [number, number, number];
  metallic: number;
  roughness: number;
  occlusionStrength: number;
  normalScale: number;
}>;

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
  usesFrameBindings?: boolean;
  programBindings?: readonly MaterialBindingDescriptor[];
  materialBindings?: readonly MaterialBindingDescriptor[];
}>;

export type MaterialBindingDescriptor = Readonly<
  | {
    kind: 'uniform';
    group?: number;
    binding: number;
  }
  | {
    kind: 'alpha-policy';
    group?: number;
    binding: number;
  }
  | {
    kind: 'texture';
    group?: number;
    binding: number;
    textureSemantic: string;
  }
  | {
    kind: 'sampler';
    group?: number;
    binding: number;
    textureSemantic: string;
  }
>;

export type BaseMaterialVariant = Readonly<{
  materialId: string;
  alphaMode: 'opaque' | 'mask' | 'blend';
  renderQueue: 'opaque' | 'transparent';
  doubleSided: boolean;
  depthWrite: boolean;
}>;

export type MaterialVariant =
  & BaseMaterialVariant
  & Readonly<{
    programId: string;
    shaderFamily: string;
    usesCustomShader: boolean;
    usesBaseColorTexture: boolean;
    usesTexcoord0: boolean;
  }>;

export type BuiltInLitTemplateVariant = BuiltInLitTemplateVariantFromTemplate;

type PreparedMaterialProgram = Readonly<{
  key: string;
  variant: Readonly<Record<string, unknown>>;
  program: MaterialProgram;
}>;

export type MaterialProgramTemplate<TVariant extends BaseMaterialVariant = MaterialVariant> =
  Readonly<{
    id: string;
    label: string;
    prepareProgram: (variant: TVariant) => MaterialProgram;
    inspectProgram?: (variant: TVariant) => MaterialTemplateBakeReport<TVariant>;
    resolveVariant?: (
      material: Material | undefined,
      options: ResolveMaterialProgramOptions,
      resolutionOptions: MaterialVariantResolutionOptions,
    ) => TVariant;
  }>;

export type MaterialTemplateBakeReport<TVariant extends BaseMaterialVariant = BaseMaterialVariant> =
  Readonly<{
    templateId: string;
    templateLabel: string;
    variant: TVariant;
    program: MaterialProgram;
    activeFeatureIds: readonly string[];
    wgsl: string;
    bindings: readonly MaterialBindingDescriptor[];
    programBindings?: readonly MaterialBindingDescriptor[];
    vertexAttributes: readonly MaterialVertexAttribute[];
  }>;

type RegisteredMaterialTemplateVariant = BaseMaterialVariant & Readonly<Record<string, unknown>>;

type RegisteredMaterialProgramTemplate = Readonly<{
  id: string;
  label: string;
  prepareProgram: (variant: RegisteredMaterialTemplateVariant) => MaterialProgram;
  inspectProgram?: (
    variant: RegisteredMaterialTemplateVariant,
  ) => MaterialTemplateBakeReport<RegisteredMaterialTemplateVariant>;
  resolveVariant?: (
    material: Material | undefined,
    options: ResolveMaterialProgramOptions,
    resolutionOptions: MaterialVariantResolutionOptions,
  ) => RegisteredMaterialTemplateVariant;
}>;

export type MaterialRegistry = Readonly<{
  programs: Map<string, MaterialProgram>;
  templates: Map<string, RegisteredMaterialProgramTemplate>;
}>;

const eraseMaterialProgramTemplate = <TVariant extends BaseMaterialVariant>(
  template: MaterialProgramTemplate<TVariant>,
): RegisteredMaterialProgramTemplate => template as unknown as RegisteredMaterialProgramTemplate;

export type PostProcessProgram = Readonly<{
  id: string;
  label: string;
  wgsl: string;
  fragmentEntryPoint: string;
  usesUniformBuffer?: boolean;
}>;

export type PostProcessPass = Readonly<{
  id: string;
  label: string;
  program: PostProcessProgram;
  uniformData?: ArrayBuffer | ArrayBufferView;
}>;

export type PathtracedSdfPrimitive = Readonly<{
  id: string;
  op: 'sphere' | 'box';
  center: readonly [number, number, number];
  radius?: number;
  halfExtents?: readonly [number, number, number];
  color?: readonly [number, number, number, number];
  worldToLocalRotation?: readonly [
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

export type PathtracedSceneExtension = Readonly<{
  sdfPrimitives?: readonly PathtracedSdfPrimitive[];
}>;

export type PathtracedRenderOptions = Readonly<{
  materialRegistry?: MaterialRegistry;
  postProcessPasses?: readonly PostProcessPass[];
  extension?: PathtracedSceneExtension;
}>;

export type ForwardEnvironmentMap = Readonly<{
  id: string;
  image: ImageAsset;
  intensity?: number;
}>;

export type ForwardDebugView =
  | 'none'
  | 'normal-world-geometric'
  | 'normal-tangent-sampled'
  | 'normal-tangent-sampled-raw'
  | 'normal-world-mapped'
  | 'normal-view-mapped'
  | 'tangent-world'
  | 'bitangent-world'
  | 'tangent-handedness'
  | 'uv';

export type ForwardSceneExtension = Readonly<{
  environmentMap?: ForwardEnvironmentMap;
  debugView?: ForwardDebugView;
}>;

export type ForwardRenderOptions = Readonly<{
  materialRegistry?: MaterialRegistry;
  postProcessPasses?: readonly PostProcessPass[];
  extension?: ForwardSceneExtension;
  clearColor?: readonly [number, number, number, number];
  frameState?: FrameState;
}>;

export type VolumePassItem = Readonly<{
  nodeId: string;
  volumeId: string;
  worldMatrix: readonly number[];
  residency: never;
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
const builtInTexturedLitProgramId = 'built-in:lit-textured';
const builtInUnlitTemplateId = 'built-in:unlit-template';
const builtInLitTemplateId = 'built-in:lit-template';
const builtInDeferredDepthPrepassProgramId = 'built-in:deferred-depth-prepass';
const builtInDeferredGbufferUnlitProgramId = 'built-in:deferred-gbuffer-unlit';
const builtInDeferredGbufferTexturedUnlitProgramId = 'built-in:deferred-gbuffer-unlit-textured';
const builtInDeferredGbufferLitProgramId = 'built-in:deferred-gbuffer-lit';
const builtInDeferredLightingProgramId = 'built-in:deferred-lighting';
const builtInPathtracedAccumulateProgramId = 'built-in:pathtraced-accumulate';
const builtInPathtracedMeshProgramId = 'built-in:pathtraced-mesh';
const builtInPathtracedPresentProgramId = 'built-in:pathtraced-present';
const builtInPathtracedSdfProgramId = 'built-in:pathtraced-sdf';
const builtInSdfRaymarchProgramId = 'built-in:sdf-raymarch';
const builtInVolumeRaymarchProgramId = 'built-in:volume-raymarch';
const builtInNodePickProgramId = 'built-in:node-pick';
const builtInPostProcessBlitProgramId = 'built-in:post-process-blit';
const nodePickTargetFormat = 'rgba8unorm';
const textureBindingUsage = 0x04;
const renderAttachmentUsage = 0x10;
const uniformUsage = 0x40;
const storageUsage = 0x80;
const bufferCopyDstUsage = 0x08;
const textureCopyDstUsage = 0x02;
const deferredDepthFormat = 'depth24plus';
const maxSdfPassItems = 16;
const pathtracedAccumulationFormat = 'rgba16float';
const depthTextureFormat = 'depth24plus';
const maxDirectionalLights = 4;
const maxPathtracedMaterialTextures = 8;
const defaultAmbientLight = 0.34;
const defaultCubemapFormat = 'rgba8unorm';
const defaultCubemapZnear = 0.1;
const defaultCubemapZfar = 100;
const pathtracedAccumulationStates = new WeakMap<
  RenderContextBinding,
  PathtracedAccumulationState
>();
const pathtracedMeshSceneStates = new WeakMap<RenderContextBinding, PathtracedMeshSceneState>();
const exrLoader = new EXRLoader();
type ForwardEnvironmentPrefilterLevel = Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}>;

type ForwardEnvironmentPrefilterState =
  | Readonly<{
    status: 'pending';
  }>
  | Readonly<{
    status: 'ready';
    width: number;
    height: number;
    levels: readonly ForwardEnvironmentPrefilterLevel[];
  }>
  | Readonly<{
    status: 'error';
    error: string;
  }>;

let forwardEnvironmentPrefilterWorker: Worker | null = null;
const forwardEnvironmentPrefilterStates = new Map<string, ForwardEnvironmentPrefilterState>();

const getForwardEnvironmentPrefilterWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') {
    return null;
  }
  if (forwardEnvironmentPrefilterWorker) {
    return forwardEnvironmentPrefilterWorker;
  }

  const worker = new Worker(
    new URL('./environment_prefilter_worker.ts', import.meta.url).href,
    { type: 'module' },
  );
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as
      | Readonly<{
        type: 'prefiltered';
        cacheId: string;
        width: number;
        height: number;
        levels: readonly Readonly<{
          width: number;
          height: number;
          data: ArrayBuffer;
        }>[];
      }>
      | Readonly<{
        type: 'error';
        cacheId: string;
        error: string;
      }>;
    if (message?.type === 'prefiltered') {
      forwardEnvironmentPrefilterStates.set(message.cacheId, {
        status: 'ready',
        width: message.width,
        height: message.height,
        levels: message.levels.map((level) => ({
          width: level.width,
          height: level.height,
          data: new Uint16Array(level.data),
        })),
      });
      return;
    }
    if (message?.type === 'error') {
      forwardEnvironmentPrefilterStates.set(message.cacheId, {
        status: 'error',
        error: message.error,
      });
    }
  };
  forwardEnvironmentPrefilterWorker = worker;
  return worker;
};

const queueForwardEnvironmentPrefilter = (
  cacheId: string,
  environmentMap: ForwardEnvironmentMap,
): boolean => {
  if (forwardEnvironmentPrefilterStates.get(cacheId)?.status === 'pending') {
    return true;
  }
  const worker = getForwardEnvironmentPrefilterWorker();
  if (!worker) {
    return false;
  }
  const bytesCopy = new Uint8Array(environmentMap.image.bytes);
  const bytes = bytesCopy.buffer as ArrayBuffer;
  forwardEnvironmentPrefilterStates.set(cacheId, { status: 'pending' });
  worker.postMessage({
    type: 'prefilter',
    cacheId,
    image: {
      id: environmentMap.image.id,
      mimeType: environmentMap.image.mimeType,
      bytes,
    },
  }, [bytes]);
  return true;
};

const pathtracedFallbackTextureBindings = new WeakMap<
  object,
  Readonly<{ texture: GPUTexture; textureView: GPUTextureView; sampler: GPUSampler }>
>();
const alphaBlendState: GPUBlendState = {
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
};
const defaultRaymarchCamera: RaymarchCamera = {
  origin: [0, 0, 2.5],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1.75],
  projection: 'perspective',
};
const toBufferSource = (view: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> => {
  if (view instanceof ArrayBuffer) {
    return new Uint8Array(view.slice(0));
  }

  const buffer = view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(buffer);
};

const countPrimitiveNodes = (evaluatedScene: EvaluatedScene) => ({
  meshNodeCount: evaluatedScene.nodes.filter((node) => Boolean(node.mesh)).length,
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

const subtractVector3 = (
  [ax, ay, az]: readonly [number, number, number],
  [bx, by, bz]: readonly [number, number, number],
): readonly [number, number, number] => [ax - bx, ay - by, az - bz];

const crossVector3 = (
  [ax, ay, az]: readonly [number, number, number],
  [bx, by, bz]: readonly [number, number, number],
): readonly [number, number, number] => [
  (ay * bz) - (az * by),
  (az * bx) - (ax * bz),
  (ax * by) - (ay * bx),
];

const dotVector3 = (
  [ax, ay, az]: readonly [number, number, number],
  [bx, by, bz]: readonly [number, number, number],
): number => (ax * bx) + (ay * by) + (az * bz);

const createLookAtViewMatrix = (
  origin: readonly [number, number, number],
  target: readonly [number, number, number],
  up: readonly [number, number, number],
): readonly number[] => {
  const forward = normalizeVector3(...subtractVector3(target, origin));
  const right = normalizeVector3(...crossVector3(forward, up));
  const adjustedUp = normalizeVector3(...crossVector3(right, forward));

  return [
    right[0],
    adjustedUp[0],
    -forward[0],
    0,
    right[1],
    adjustedUp[1],
    -forward[1],
    0,
    right[2],
    adjustedUp[2],
    -forward[2],
    0,
    -dotVector3(right, origin),
    -dotVector3(adjustedUp, origin),
    dotVector3(forward, origin),
    1,
  ];
};

const createRaymarchCamera = (
  origin: readonly [number, number, number],
  forward: readonly [number, number, number],
  up: readonly [number, number, number],
  forwardScale = 1,
): RaymarchCamera => {
  const normalizedForward = normalizeVector3(...forward);
  const right = normalizeVector3(...crossVector3(normalizedForward, up));
  const adjustedUp = normalizeVector3(...crossVector3(right, normalizedForward));

  return {
    origin,
    right,
    up: adjustedUp,
    forward: [
      normalizedForward[0] * forwardScale,
      normalizedForward[1] * forwardScale,
      normalizedForward[2] * forwardScale,
    ],
    projection: 'perspective',
  };
};

const createRaymarchCameraFromEvaluatedCamera = (
  binding: Pick<RenderContextBinding, 'target'>,
  activeCamera?: EvaluatedCamera,
): RaymarchCamera => {
  if (!activeCamera) {
    return defaultRaymarchCamera;
  }

  const worldMatrix = activeCamera.worldMatrix;
  const origin = getMatrixTranslation(worldMatrix);
  const rightAxis = normalizeVector3(
    worldMatrix[0] ?? 0,
    worldMatrix[1] ?? 0,
    worldMatrix[2] ?? 0,
  );
  const upAxis = normalizeVector3(
    worldMatrix[4] ?? 0,
    worldMatrix[5] ?? 0,
    worldMatrix[6] ?? 0,
  );
  const forwardAxis = normalizeVector3(
    -(worldMatrix[8] ?? 0),
    -(worldMatrix[9] ?? 0),
    -(worldMatrix[10] ?? 1),
  );

  if (activeCamera.camera.type === 'orthographic') {
    return {
      origin,
      right: [
        rightAxis[0] * (activeCamera.camera.xmag ?? 1),
        rightAxis[1] * (activeCamera.camera.xmag ?? 1),
        rightAxis[2] * (activeCamera.camera.xmag ?? 1),
      ],
      up: [
        upAxis[0] * (activeCamera.camera.ymag ?? 1),
        upAxis[1] * (activeCamera.camera.ymag ?? 1),
        upAxis[2] * (activeCamera.camera.ymag ?? 1),
      ],
      forward: forwardAxis,
      projection: 'orthographic',
    };
  }

  const aspect = binding.target.width / binding.target.height;
  const halfFovTan = Math.tan((activeCamera.camera.yfov ?? Math.PI / 3) / 2);

  return {
    origin,
    right: [
      rightAxis[0] * aspect * halfFovTan,
      rightAxis[1] * aspect * halfFovTan,
      rightAxis[2] * aspect * halfFovTan,
    ],
    up: [
      upAxis[0] * halfFovTan,
      upAxis[1] * halfFovTan,
      upAxis[2] * halfFovTan,
    ],
    forward: forwardAxis,
    projection: 'perspective',
  };
};

const cubemapFaceDescriptors: readonly Readonly<{
  face: CubemapFace;
  direction: readonly [number, number, number];
  up: readonly [number, number, number];
}>[] = [
  {
    face: 'positive-x',
    direction: [1, 0, 0],
    up: [0, -1, 0],
  },
  {
    face: 'negative-x',
    direction: [-1, 0, 0],
    up: [0, -1, 0],
  },
  {
    face: 'positive-y',
    direction: [0, 1, 0],
    up: [0, 0, 1],
  },
  {
    face: 'negative-y',
    direction: [0, -1, 0],
    up: [0, 0, -1],
  },
  {
    face: 'positive-z',
    direction: [0, 0, 1],
    up: [0, -1, 0],
  },
  {
    face: 'negative-z',
    direction: [0, 0, -1],
    up: [0, -1, 0],
  },
];

const cubemapFaceDescriptorByFace = new Map(
  cubemapFaceDescriptors.map((descriptor) => [descriptor.face, descriptor] as const),
);

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const hashString = (value: string): string => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const createRgbaBuffer = (width: number, height: number): Uint8Array =>
  new Uint8Array(width * height * 4);

const writeRgbaPixel = (
  bytes: Uint8Array,
  width: number,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void => {
  const offset = ((y * width) + x) * 4;
  bytes[offset] = rgba[0];
  bytes[offset + 1] = rgba[1];
  bytes[offset + 2] = rgba[2];
  bytes[offset + 3] = rgba[3];
};

const readRgbaPixel = (
  bytes: Uint8Array,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number, number] => {
  const offset = ((y * width) + x) * 4;

  return [
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  ];
};

const lerpNumber = (start: number, end: number, t: number): number => start + ((end - start) * t);

const sampleFaceNearest = (
  face: CubemapFaceSnapshotResult,
  u: number,
  v: number,
): readonly [number, number, number, number] => {
  const x = clampNumber(Math.round(u * (face.width - 1)), 0, face.width - 1);
  const y = clampNumber(Math.round(v * (face.height - 1)), 0, face.height - 1);

  return readRgbaPixel(face.bytes, face.width, x, y);
};

const sampleFaceLinear = (
  face: CubemapFaceSnapshotResult,
  u: number,
  v: number,
): readonly [number, number, number, number] => {
  const x = clampNumber(u * (face.width - 1), 0, face.width - 1);
  const y = clampNumber(v * (face.height - 1), 0, face.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, face.width - 1);
  const y1 = Math.min(y0 + 1, face.height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const topLeft = readRgbaPixel(face.bytes, face.width, x0, y0);
  const topRight = readRgbaPixel(face.bytes, face.width, x1, y0);
  const bottomLeft = readRgbaPixel(face.bytes, face.width, x0, y1);
  const bottomRight = readRgbaPixel(face.bytes, face.width, x1, y1);

  return [
    Math.round(
      lerpNumber(
        lerpNumber(topLeft[0], topRight[0], tx),
        lerpNumber(bottomLeft[0], bottomRight[0], tx),
        ty,
      ),
    ),
    Math.round(
      lerpNumber(
        lerpNumber(topLeft[1], topRight[1], tx),
        lerpNumber(bottomLeft[1], bottomRight[1], tx),
        ty,
      ),
    ),
    Math.round(
      lerpNumber(
        lerpNumber(topLeft[2], topRight[2], tx),
        lerpNumber(bottomLeft[2], bottomRight[2], tx),
        ty,
      ),
    ),
    Math.round(
      lerpNumber(
        lerpNumber(topLeft[3], topRight[3], tx),
        lerpNumber(bottomLeft[3], bottomRight[3], tx),
        ty,
      ),
    ),
  ];
};

const sampleFacePixel = (
  face: CubemapFaceSnapshotResult,
  u: number,
  v: number,
  sampling: CubemapExportSampling,
): readonly [number, number, number, number] =>
  sampling === 'linear' ? sampleFaceLinear(face, u, v) : sampleFaceNearest(face, u, v);

const blitCubemapFace = (
  source: CubemapFaceSnapshotResult,
  destination: Uint8Array,
  destinationWidth: number,
  destinationHeight: number,
  offsetX: number,
  offsetY: number,
  outputSize: number,
  sampling: CubemapExportSampling,
): void => {
  for (let y = 0; y < outputSize; y += 1) {
    const v = outputSize === 1 ? 0.5 : (y + 0.5) / outputSize;
    for (let x = 0; x < outputSize; x += 1) {
      const u = outputSize === 1 ? 0.5 : (x + 0.5) / outputSize;
      const color = sampleFacePixel(source, u, v, sampling);
      if (offsetX + x >= destinationWidth || offsetY + y >= destinationHeight) {
        continue;
      }
      writeRgbaPixel(destination, destinationWidth, offsetX + x, offsetY + y, color);
    }
  }
};

const assertCubemapFaceBytes = (face: CubemapFaceSnapshotResult, size: number): void => {
  if (face.width !== size || face.height !== size) {
    throw new Error(
      `cubemap face "${face.face}" must be ${size}x${size}, received ${face.width}x${face.height}`,
    );
  }

  if (face.bytes.length !== face.width * face.height * 4) {
    throw new Error(
      `cubemap face "${face.face}" must contain width*height*4 bytes, received ${face.bytes.length}`,
    );
  }
};

const getOrderedCubemapFaces = (
  snapshot: CubemapSnapshotResult,
): readonly CubemapFaceSnapshotResult[] => {
  const facesById = new Map(snapshot.faces.map((face) => [face.face, face] as const));

  if (
    snapshot.faces.length !== cubemapFaceDescriptors.length ||
    facesById.size !== cubemapFaceDescriptors.length
  ) {
    throw new Error(
      'cubemap export requires exactly one snapshot for each of the six cubemap faces',
    );
  }

  return cubemapFaceDescriptors.map((descriptor) => {
    const face = facesById.get(descriptor.face);
    if (!face) {
      throw new Error(`cubemap export is missing face "${descriptor.face}"`);
    }

    assertCubemapFaceBytes(face, snapshot.size);
    return face;
  });
};

type CubemapFaceLookup = Readonly<{
  orderedFaces: readonly CubemapFaceSnapshotResult[];
  faceMap: ReadonlyMap<CubemapFace, CubemapFaceSnapshotResult>;
}>;

type CubemapExportDimensions = Readonly<{
  width: number;
  height: number;
  faceSize?: number;
}>;

const createCubemapFaceLookup = (snapshot: CubemapSnapshotResult): CubemapFaceLookup => {
  const orderedFaces = getOrderedCubemapFaces(snapshot);

  return {
    orderedFaces,
    faceMap: new Map(orderedFaces.map((face) => [face.face, face] as const)),
  };
};

const assertPositiveExportInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, received ${value}`);
  }

  return value;
};

const resolveCubemapExportDimensions = (
  snapshot: CubemapSnapshotResult,
  options: CubemapExportOptions,
): CubemapExportDimensions => {
  const requestedWidth = options.width === undefined
    ? undefined
    : assertPositiveExportInteger(options.width, 'cubemap export width');
  const requestedHeight = options.height === undefined
    ? undefined
    : assertPositiveExportInteger(options.height, 'cubemap export height');

  switch (options.layout) {
    case 'equirectangular': {
      const width = requestedWidth ??
        (requestedHeight === undefined ? snapshot.size * 4 : requestedHeight * 2);
      const height = requestedHeight ??
        (requestedWidth === undefined ? snapshot.size * 2 : requestedWidth / 2);
      assertPositiveExportInteger(width, 'cubemap export width');
      assertPositiveExportInteger(height, 'cubemap export height');
      if (width !== height * 2) {
        throw new Error('equirectangular exports require a 2:1 width/height ratio');
      }
      return { width, height };
    }
    case 'angular': {
      const width = requestedWidth ?? requestedHeight ?? snapshot.size * 2;
      const height = requestedHeight ?? requestedWidth ?? snapshot.size * 2;
      assertPositiveExportInteger(width, 'cubemap export width');
      assertPositiveExportInteger(height, 'cubemap export height');
      if (width !== height) {
        throw new Error('angular exports require matching width and height');
      }
      return { width, height };
    }
    case 'cross': {
      const faceSize = requestedWidth === undefined
        ? requestedHeight === undefined ? snapshot.size : requestedHeight / 3
        : requestedWidth / 4;
      if (!Number.isInteger(faceSize) || faceSize <= 0) {
        throw new Error('cross exports require dimensions that resolve to an integer face size');
      }
      const width = requestedWidth ?? faceSize * 4;
      const height = requestedHeight ?? faceSize * 3;
      if (width !== faceSize * 4 || height !== faceSize * 3) {
        throw new Error('cross exports require a 4:3 layout with square face regions');
      }
      return { width, height, faceSize };
    }
    case 'strip': {
      const faceSize = requestedWidth === undefined
        ? requestedHeight === undefined ? snapshot.size : requestedHeight
        : requestedWidth / 6;
      if (!Number.isInteger(faceSize) || faceSize <= 0) {
        throw new Error('strip exports require dimensions that resolve to an integer face size');
      }
      const width = requestedWidth ?? faceSize * 6;
      const height = requestedHeight ?? faceSize;
      if (width !== faceSize * 6 || height !== faceSize) {
        throw new Error('strip exports require a 6:1 layout with square face regions');
      }
      return { width, height, faceSize };
    }
  }
};

const createFaceBasis = (
  face: CubemapFace,
): Readonly<{
  forward: readonly [number, number, number];
  right: readonly [number, number, number];
  up: readonly [number, number, number];
}> => {
  const descriptor = cubemapFaceDescriptorByFace.get(face);
  if (!descriptor) {
    throw new Error(`unsupported cubemap face "${face}"`);
  }

  const forward = normalizeVector3(...descriptor.direction);
  const right = normalizeVector3(...crossVector3(forward, descriptor.up));
  const up = normalizeVector3(...crossVector3(right, forward));

  return { forward, right, up };
};

const sampleCubemapDirection = (
  lookup: CubemapFaceLookup,
  direction: readonly [number, number, number],
  sampling: CubemapExportSampling,
): readonly [number, number, number, number] => {
  const [dx, dy, dz] = normalizeVector3(...direction);
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const absZ = Math.abs(dz);

  let face: CubemapFace;
  if (absX >= absY && absX >= absZ) {
    face = dx >= 0 ? 'positive-x' : 'negative-x';
  } else if (absY >= absX && absY >= absZ) {
    face = dy >= 0 ? 'positive-y' : 'negative-y';
  } else {
    face = dz >= 0 ? 'positive-z' : 'negative-z';
  }

  const selectedFace = lookup.faceMap.get(face);
  if (!selectedFace) {
    throw new Error(`cubemap export is missing face "${face}"`);
  }

  const basis = createFaceBasis(face);
  const majorAxis = Math.max(Math.abs(dotVector3([dx, dy, dz], basis.forward)), Number.EPSILON);
  const sx = clampNumber(dotVector3([dx, dy, dz], basis.right) / majorAxis, -1, 1);
  const sy = clampNumber(dotVector3([dx, dy, dz], basis.up) / majorAxis, -1, 1);
  const u = (sx + 1) * 0.5;
  const v = (1 - sy) * 0.5;

  return sampleFacePixel(selectedFace, u, v, sampling);
};

const builtInUnlitProgram: MaterialProgram = {
  id: builtInUnlitProgramId,
  label: 'Built-in Unlit',
  wgsl: builtInForwardShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  usesFrameBindings: true,
  programBindings: [{
    kind: 'uniform',
    group: 1,
    binding: 0,
  }],
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
  usesFrameBindings: true,
  programBindings: [
    {
      kind: 'uniform',
      group: 1,
      binding: 0,
    },
    {
      kind: 'uniform',
      group: 2,
      binding: 0,
    },
    {
      kind: 'texture',
      group: 3,
      binding: 0,
      textureSemantic: 'environment',
    },
    {
      kind: 'sampler',
      group: 3,
      binding: 1,
      textureSemantic: 'environment',
    },
    {
      kind: 'texture',
      group: 3,
      binding: 2,
      textureSemantic: 'brdfLut',
    },
    {
      kind: 'sampler',
      group: 3,
      binding: 3,
      textureSemantic: 'brdfLut',
    },
  ],
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
  usesFrameBindings: true,
  programBindings: [
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

const builtInTexturedLitProgram: MaterialProgram = {
  id: builtInTexturedLitProgramId,
  label: 'Built-in Lit (Textured)',
  wgsl: builtInForwardTexturedLitShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  usesFrameBindings: true,
  programBindings: [
    {
      kind: 'uniform',
      group: 1,
      binding: 0,
    },
    {
      kind: 'texture',
      group: 1,
      binding: 1,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'sampler',
      group: 1,
      binding: 2,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'uniform',
      group: 2,
      binding: 0,
    },
    {
      kind: 'texture',
      group: 3,
      binding: 0,
      textureSemantic: 'environment',
    },
    {
      kind: 'sampler',
      group: 3,
      binding: 1,
      textureSemantic: 'environment',
    },
    {
      kind: 'texture',
      group: 3,
      binding: 2,
      textureSemantic: 'brdfLut',
    },
    {
      kind: 'sampler',
      group: 3,
      binding: 3,
      textureSemantic: 'brdfLut',
    },
  ],
  materialBindings: [
    {
      kind: 'uniform',
      group: 1,
      binding: 0,
    },
    {
      kind: 'texture',
      group: 1,
      binding: 1,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'sampler',
      group: 1,
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

const builtInUnlitProgramTemplate: MaterialProgramTemplate<BuiltInUnlitTemplateVariant> = {
  id: builtInUnlitTemplateId,
  label: 'Built-in Unlit Template',
  resolveVariant: (
    material,
    _options,
    resolutionOptions,
  ): BuiltInUnlitTemplateVariant => {
    const policy = resolveMaterialRenderPolicy(material);
    const geometry = resolutionOptions.geometry;
    const residency = resolutionOptions.residency;
    const usesBaseColorTexture = Boolean(
      material &&
        residency &&
        getBaseColorTextureResidency(residency, material),
    );
    const usesTexcoord0 = geometry
      ? 'attributeBuffers' in geometry
        ? Boolean(geometry.attributeBuffers.TEXCOORD_0)
        : geometry.attributes.some((attribute) => attribute.semantic === 'TEXCOORD_0')
      : false;
    return {
      templateId: 'built-in:unlit-template',
      materialId: material?.id ?? 'built-in:default-unlit-material',
      alphaMode: policy.alphaMode,
      renderQueue: policy.renderQueue,
      doubleSided: policy.doubleSided,
      depthWrite: policy.depthWrite,
      usesBaseColorTexture,
      usesTexcoord0,
    };
  },
  prepareProgram: (variant) => prepareBuiltInUnlitTemplateProgram(variant),
  inspectProgram: (variant) => {
    const report = inspectBuiltInUnlitTemplateProgram(variant);
    return {
      templateId: builtInUnlitTemplateId,
      templateLabel: 'Built-in Unlit Template',
      variant,
      program: report.program,
      activeFeatureIds: report.activeFeatureIds,
      wgsl: report.spec.wgsl,
      bindings: report.program.materialBindings ?? [],
      programBindings: report.spec.bindings,
      vertexAttributes: report.spec.vertexAttributes,
    };
  },
};

const builtInLitProgramTemplate: MaterialProgramTemplate<BuiltInLitTemplateVariant> = {
  id: builtInLitTemplateId,
  label: 'Built-in Lit Template',
  resolveVariant: (
    material,
    _options,
    resolutionOptions,
  ): BuiltInLitTemplateVariant => {
    const policy = resolveMaterialRenderPolicy(material);
    const geometry = resolutionOptions.geometry;
    const residency = resolutionOptions.residency;
    const usesBaseColorTexture = Boolean(
      material &&
        residency &&
        getBaseColorTextureResidency(residency, material),
    );
    const usesMetallicRoughnessTexture = Boolean(
      material &&
        residency &&
        getMaterialTextureResidency(residency, material, 'metallicRoughness'),
    );
    const usesNormalTexture = Boolean(
      material &&
        residency &&
        getMaterialTextureResidency(residency, material, 'normal'),
    );
    const usesOcclusionTexture = Boolean(
      material &&
        residency &&
        getMaterialTextureResidency(residency, material, 'occlusion'),
    );
    const usesEmissiveTexture = Boolean(
      material &&
        residency &&
        getMaterialTextureResidency(residency, material, 'emissive'),
    );
    const usesTexcoord0 = geometry
      ? 'attributeBuffers' in geometry
        ? Boolean(geometry.attributeBuffers.TEXCOORD_0)
        : geometry.attributes.some((attribute) => attribute.semantic === 'TEXCOORD_0')
      : false;
    const usesTangent = geometry
      ? 'attributeBuffers' in geometry
        ? Boolean(geometry.attributeBuffers.TANGENT)
        : geometry.attributes.some((attribute) => attribute.semantic === 'TANGENT')
      : false;
    return {
      templateId: 'built-in:lit-template',
      materialId: material?.id ?? 'built-in:default-lit-material',
      alphaMode: policy.alphaMode,
      renderQueue: policy.renderQueue,
      doubleSided: policy.doubleSided,
      depthWrite: policy.depthWrite,
      usesBaseColorTexture,
      usesMetallicRoughnessTexture,
      usesNormalTexture,
      usesOcclusionTexture,
      usesEmissiveTexture,
      usesTangent,
      usesTexcoord0,
    };
  },
  prepareProgram: (variant) => prepareBuiltInLitTemplateProgram(variant),
  inspectProgram: (variant) => {
    const report = inspectBuiltInLitTemplateProgram(variant);
    return {
      templateId: builtInLitTemplateId,
      templateLabel: 'Built-in Lit Template',
      variant,
      program: report.program,
      activeFeatureIds: report.activeFeatureIds,
      wgsl: report.spec.wgsl,
      bindings: report.program.materialBindings ?? [],
      programBindings: report.spec.bindings,
      vertexAttributes: report.spec.vertexAttributes,
    };
  },
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

const builtInPostProcessBlitProgram: PostProcessProgram = {
  id: builtInPostProcessBlitProgramId,
  label: 'Built-in Post-Process Blit',
  wgsl: builtInPostProcessBlitShader,
  fragmentEntryPoint: 'fsMain',
};

const builtInEnvironmentBackgroundBlurProgram: PostProcessProgram = {
  id: 'built-in:environment-background-blur',
  label: 'Built-in Environment Background Blur',
  wgsl: builtInEnvironmentBackgroundBlurShader,
  fragmentEntryPoint: 'fsMain',
  usesUniformBuffer: true,
};

export const createBlitPostProcessPass = (
  id = 'post-process:blit',
  label = 'Blit',
): PostProcessPass => ({
  id,
  label,
  program: builtInPostProcessBlitProgram,
});

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
    [builtInTexturedLitProgramId, builtInTexturedLitProgram],
  ]),
  templates: new Map<string, RegisteredMaterialProgramTemplate>([
    [builtInUnlitTemplateId, eraseMaterialProgramTemplate(builtInUnlitProgramTemplate)],
    [builtInLitTemplateId, eraseMaterialProgramTemplate(builtInLitProgramTemplate)],
  ]),
});

export type ResolveMaterialProgramOptions = Readonly<{
  preferTexturedUnlit?: boolean;
  preferTexturedLit?: boolean;
}>;

type MaterialVariantResolutionOptions = Readonly<{
  geometry?:
    | NonNullable<RuntimeResidency['geometry'] extends Map<string, infer T> ? T : never>
    | NonNullable<EvaluatedScene['nodes'][number]['mesh']>;
  residency?: RuntimeResidency;
}>;

export const registerWgslMaterial = (
  registry: MaterialRegistry,
  program: MaterialProgram,
): MaterialRegistry => {
  registry.programs.set(program.id, program);
  return registry;
};

export const registerWgslMaterialTemplate = <TVariant extends BaseMaterialVariant>(
  registry: MaterialRegistry,
  template: MaterialProgramTemplate<TVariant>,
): MaterialRegistry => {
  registry.templates.set(template.id, eraseMaterialProgramTemplate(template));
  return registry;
};

export const inspectMaterialTemplateBake = <TVariant extends BaseMaterialVariant>(
  registry: MaterialRegistry,
  templateId: string,
  variant: TVariant,
): MaterialTemplateBakeReport<TVariant> => {
  const template = registry.templates.get(templateId) as
    | RegisteredMaterialProgramTemplate
    | undefined;
  if (!template) {
    throw new Error(`material template "${templateId}" is not registered`);
  }

  if (template.inspectProgram) {
    return template.inspectProgram(variant) as MaterialTemplateBakeReport<TVariant>;
  }

  const program = template.prepareProgram(variant);
  return {
    templateId: template.id,
    templateLabel: template.label,
    variant,
    program,
    activeFeatureIds: [],
    wgsl: program.wgsl,
    bindings: getMaterialBindingDescriptors(program),
    programBindings: getProgramBindingDescriptors(program),
    vertexAttributes: program.vertexAttributes,
  };
};

const resolveTemplateVariant = (
  template: RegisteredMaterialProgramTemplate,
  material: Material | undefined,
  options: ResolveMaterialProgramOptions,
  resolutionOptions: MaterialVariantResolutionOptions,
): RegisteredMaterialTemplateVariant => {
  if (template.resolveVariant) {
    return template.resolveVariant(material, options, resolutionOptions);
  }

  return resolveMaterialVariant(material, options, resolutionOptions);
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
    if (options.preferTexturedLit) {
      return registry.programs.get(builtInTexturedLitProgramId) ?? builtInTexturedLitProgram;
    }
    return registry.programs.get(builtInLitProgramId) ?? builtInLitProgram;
  }

  throw new Error(`material "${material.id}" uses unsupported kind "${material.kind}"`);
};

export const resolveMaterialVariant = (
  material?: Material,
  options: ResolveMaterialProgramOptions = {},
  resolutionOptions: MaterialVariantResolutionOptions = {},
): MaterialVariant => {
  const policy = resolveMaterialRenderPolicy(material);
  const geometry = resolutionOptions.geometry;
  const residency = resolutionOptions.residency;
  const usesBaseColorTexture = Boolean(
    material &&
      residency &&
      getBaseColorTextureResidency(residency, material),
  );
  const usesTexcoord0 = geometry
    ? 'attributeBuffers' in geometry
      ? Boolean(geometry.attributeBuffers.TEXCOORD_0)
      : geometry.attributes.some((attribute) => attribute.semantic === 'TEXCOORD_0')
    : false;
  const fallbackProgramId = options.preferTexturedLit
    ? builtInTexturedLitProgramId
    : options.preferTexturedUnlit
    ? builtInTexturedUnlitProgramId
    : material?.kind === 'lit'
    ? builtInLitProgramId
    : builtInUnlitProgramId;

  return {
    materialId: material?.id ?? 'built-in:default-unlit-material',
    programId: material?.shaderId ?? fallbackProgramId,
    shaderFamily: material?.shaderId ? 'custom' : material?.kind === 'lit' ? 'lit' : 'unlit',
    alphaMode: policy.alphaMode,
    renderQueue: policy.renderQueue,
    doubleSided: policy.doubleSided,
    depthWrite: policy.depthWrite,
    usesCustomShader: Boolean(material?.shaderId),
    usesBaseColorTexture,
    usesTexcoord0,
  };
};

const createPreparedMaterialProgramKey = (
  program: MaterialProgram,
  variant: Readonly<Record<string, unknown>>,
): string => {
  const templateId = typeof variant.templateId === 'string' ? variant.templateId : program.id;
  return `${templateId}:${
    hashString(JSON.stringify({
      variant,
      shader: {
        id: program.id,
        vertexEntryPoint: program.vertexEntryPoint,
        fragmentEntryPoint: program.fragmentEntryPoint,
        usesTransformBindings: program.usesTransformBindings ?? false,
        bindings: getMaterialBindingDescriptors(program),
        vertexAttributes: program.vertexAttributes,
        wgsl: program.wgsl,
      },
    }))
  }`;
};

export const invalidateTemplateProgramResidency = (
  residency: RuntimeResidency,
  templateId: string,
): RuntimeResidency => {
  const prefix = `${templateId}:`;
  for (const key of [...residency.shaderModules.keys()]) {
    if (key.startsWith(prefix)) {
      residency.shaderModules.delete(key);
    }
  }
  for (const key of [...residency.pipelines.keys()]) {
    if (key.startsWith(prefix)) {
      residency.pipelines.delete(key);
    }
  }
  return residency;
};

const prepareMaterialProgram = (
  registry: MaterialRegistry,
  material?: Material,
  options: ResolveMaterialProgramOptions = {},
  resolutionOptions: MaterialVariantResolutionOptions = {},
): PreparedMaterialProgram => {
  const directVariant = resolveMaterialVariant(material, options, resolutionOptions);
  const builtInTemplate = !material?.shaderId
    ? material?.kind === 'lit'
      ? registry.templates.get(builtInLitTemplateId)
      : registry.templates.get(builtInUnlitTemplateId)
    : undefined;
  const selectedTemplate = material?.shaderId
    ? registry.templates.get(material.shaderId)
    : builtInTemplate;
  if (selectedTemplate) {
    const variant = resolveTemplateVariant(selectedTemplate, material, options, resolutionOptions);
    const program = selectedTemplate.prepareProgram(variant);
    return {
      key: createPreparedMaterialProgramKey(program, variant),
      variant,
      program,
    };
  }

  const variant = directVariant;
  let program: MaterialProgram;
  if (material?.shaderId) {
    program = registry.programs.get(material.shaderId) ??
      resolveMaterialProgram(registry, material, options);
  } else {
    program = resolveMaterialProgram(registry, material, options);
  }
  return {
    key: createPreparedMaterialProgramKey(program, variant),
    variant,
    program,
  };
};

const createPreparedBuiltInProgram = (
  program: MaterialProgram,
  material?: Material,
  options: ResolveMaterialProgramOptions = {},
  resolutionOptions: MaterialVariantResolutionOptions = {},
): PreparedMaterialProgram => {
  const variant = resolveMaterialVariant(material, options, resolutionOptions) as Readonly<
    Record<string, unknown>
  >;
  return {
    key: createPreparedMaterialProgramKey(program, variant),
    variant,
    program,
  };
};

const getPreparedMaterialProgram = (
  preparedOrProgram: PreparedMaterialProgram | MaterialProgram,
): PreparedMaterialProgram =>
  'program' in preparedOrProgram
    ? preparedOrProgram
    : createPreparedBuiltInProgram(preparedOrProgram);

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

type MaterialRenderPolicy = Readonly<{
  alphaMode: 'opaque' | 'mask' | 'blend';
  alphaCutoff: number;
  depthWrite: boolean;
  doubleSided: boolean;
  renderQueue: 'opaque' | 'transparent';
}>;

type MaterialPipelineOptions = Readonly<{
  blend?: GPUBlendState;
  depthWriteEnabled?: boolean;
  cullMode?: GPUCullMode | 'none';
  msaaSampleCount?: number;
}>;

const resolveMaterialRenderPolicy = (material?: Material): MaterialRenderPolicy => {
  const alphaMode = material?.alphaMode === 'mask' || material?.alphaMode === 'blend'
    ? material.alphaMode
    : 'opaque';
  const renderQueue = material?.renderQueue === 'transparent' || alphaMode === 'blend'
    ? 'transparent'
    : 'opaque';

  return {
    alphaMode,
    alphaCutoff: material?.alphaCutoff ?? 0.5,
    depthWrite: material?.depthWrite ?? (alphaMode !== 'blend'),
    doubleSided: material?.doubleSided ?? false,
    renderQueue,
  };
};

const defaultMaterialBindings = [{
  kind: 'uniform',
  binding: 0,
}] as const satisfies readonly MaterialBindingDescriptor[];

const getProgramBindingGroup = (descriptor: MaterialBindingDescriptor): number =>
  descriptor.group ?? 1;

const getProgramBindingDescriptors = (
  program: MaterialProgram,
): readonly MaterialBindingDescriptor[] =>
  program.programBindings ?? program.materialBindings ??
    (program.usesMaterialBindings ? defaultMaterialBindings : []);

const hasExplicitFrameBindingDescriptor = (program: MaterialProgram): boolean =>
  getProgramBindingDescriptors(program).some((descriptor) =>
    getProgramBindingGroup(descriptor) === 0 && descriptor.binding === 1
  );

const getMaterialBindingDescriptors = (
  program: MaterialProgram,
): readonly MaterialBindingDescriptor[] =>
  program.materialBindings ??
    getProgramBindingDescriptors(program).filter((descriptor) =>
      getProgramBindingGroup(descriptor) === 1
    );

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
    case 'alpha-policy': {
      materialResidency.current ??= ensureMaterialResidency(context, residency, material);
      return {
        binding: descriptor.binding,
        resource: {
          buffer: materialResidency.current.alphaPolicyBuffer,
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

const resolveForwardPassBindingResource = (
  descriptor: MaterialBindingDescriptor,
  lightingBuffer: GPUBuffer,
  environment: ReturnType<typeof ensureForwardEnvironmentTexture>,
  environmentBrdfLut: ReturnType<typeof ensureForwardEnvironmentBrdfLut>,
): GPUBindGroupEntry => {
  switch (descriptor.kind) {
    case 'uniform':
    case 'alpha-policy':
      return {
        binding: descriptor.binding,
        resource: {
          buffer: lightingBuffer,
        },
      };
    case 'texture':
      if (descriptor.textureSemantic === 'environment') {
        return {
          binding: descriptor.binding,
          resource: environment.residency.view,
        };
      }
      if (descriptor.textureSemantic === 'brdfLut') {
        return {
          binding: descriptor.binding,
          resource: environmentBrdfLut.view,
        };
      }
      break;
    case 'sampler':
      if (descriptor.textureSemantic === 'environment') {
        return {
          binding: descriptor.binding,
          resource: environment.residency.sampler,
        };
      }
      if (descriptor.textureSemantic === 'brdfLut') {
        return {
          binding: descriptor.binding,
          resource: environmentBrdfLut.sampler,
        };
      }
      break;
  }

  throw new Error(
    `unsupported forward pass binding "${descriptor.kind}"${
      'textureSemantic' in descriptor ? `:${descriptor.textureSemantic}` : ''
    } in group ${getProgramBindingGroup(descriptor)}`,
  );
};

const createPostProcessPassPlans = (
  inputResource: string,
  postProcessPasses: readonly PostProcessPass[],
): readonly RenderPassPlan[] => {
  const passes: RenderPassPlan[] = [];
  let previousOutput = inputResource;

  for (const pass of postProcessPasses) {
    const output = `${pass.id}:output`;
    passes.push({
      id: pass.id,
      kind: 'post-process',
      reads: [previousOutput],
      writes: [output],
    });
    previousOutput = output;
  }

  return passes;
};

const getFinalPresentInputResource = (
  baseInputResource: string,
  postProcessPasses: readonly PostProcessPass[],
): string => {
  const lastPass = postProcessPasses.at(-1);
  return lastPass ? `${lastPass.id}:output` : baseInputResource;
};

export const createForwardRenderer = (
  label = 'forward',
  postProcessPasses: readonly PostProcessPass[] = [],
): Renderer => ({
  kind: 'forward',
  label,
  capabilities: {
    mesh: 'supported',
    light: 'supported',
    builtInMaterialKinds: ['unlit', 'lit'],
    customShaders: 'supported',
  },
  passes: [
    {
      id: 'mesh',
      kind: 'mesh',
      reads: ['scene'],
      writes: [postProcessPasses.length > 0 ? 'scene-color' : 'color', 'depth'],
    },
    ...createPostProcessPassPlans('scene-color', postProcessPasses),
    {
      id: 'present',
      kind: 'present',
      reads: [getFinalPresentInputResource('color', postProcessPasses)],
      writes: ['target'],
    },
  ],
});

export const createDeferredRenderer = (
  label = 'deferred',
  postProcessPasses: readonly PostProcessPass[] = [],
): Renderer => ({
  kind: 'deferred',
  label,
  capabilities: {
    mesh: 'supported',
    light: 'supported',
    builtInMaterialKinds: ['unlit', 'lit'],
    customShaders: 'supported',
  },
  passes: [
    { id: 'depth-prepass', kind: 'depth-prepass', reads: ['scene'], writes: ['depth'] },
    { id: 'gbuffer', kind: 'gbuffer', reads: ['scene', 'depth'], writes: ['gbuffer'] },
    {
      id: 'lighting',
      kind: 'lighting',
      reads: ['gbuffer', 'depth'],
      writes: [postProcessPasses.length > 0 ? 'scene-color' : 'color'],
    },
    ...createPostProcessPassPlans('scene-color', postProcessPasses),
    {
      id: 'present',
      kind: 'present',
      reads: [getFinalPresentInputResource('color', postProcessPasses)],
      writes: ['target'],
    },
  ],
});

export const createPathtracedRenderer = (
  label = 'pathtraced',
  postProcessPasses: readonly PostProcessPass[] = [],
): Renderer => ({
  kind: 'pathtraced',
  label,
  capabilities: {
    mesh: 'supported',
    light: 'supported',
    builtInMaterialKinds: ['unlit'],
    customShaders: 'unsupported',
  },
  passes: [
    {
      id: 'pathtrace',
      kind: 'pathtrace',
      reads: ['scene'],
      writes: [postProcessPasses.length > 0 ? 'scene-color' : 'color'],
    },
    ...createPostProcessPassPlans('scene-color', postProcessPasses),
    {
      id: 'present',
      kind: 'present',
      reads: [getFinalPresentInputResource('color', postProcessPasses)],
      writes: ['target'],
    },
  ],
});

export const createUberRenderer = (
  label = 'uber',
  postProcessPasses: readonly PostProcessPass[] = [],
): Renderer => ({
  kind: 'uber',
  label,
  capabilities: {
    mesh: 'supported',
    light: 'supported',
    builtInMaterialKinds: ['unlit', 'lit'],
    customShaders: 'supported',
  },
  passes: [
    { id: 'depth-prepass', kind: 'depth-prepass', reads: ['scene'], writes: ['depth'] },
    { id: 'gbuffer', kind: 'gbuffer', reads: ['scene', 'depth'], writes: ['gbuffer'] },
    {
      id: 'lighting',
      kind: 'lighting',
      reads: ['gbuffer', 'depth'],
      writes: [postProcessPasses.length > 0 ? 'scene-color' : 'color'],
    },
    {
      id: 'mesh-opaque',
      kind: 'mesh',
      reads: ['scene', 'depth', postProcessPasses.length > 0 ? 'scene-color' : 'color'],
      writes: [postProcessPasses.length > 0 ? 'scene-color' : 'color', 'depth'],
    },
    {
      id: 'mesh-transparent',
      kind: 'mesh',
      reads: ['scene', 'depth', postProcessPasses.length > 0 ? 'scene-color' : 'color'],
      writes: [postProcessPasses.length > 0 ? 'scene-color' : 'color'],
    },
    ...createPostProcessPassPlans('scene-color', postProcessPasses),
    {
      id: 'present',
      kind: 'present',
      reads: [getFinalPresentInputResource('color', postProcessPasses)],
      writes: ['target'],
    },
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
    passes: renderer.passes.filter((pass) => {
      if (pass.kind === 'pathtrace') {
        return counts.meshNodeCount > 0;
      }

      return true;
    }),
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
    const materialPolicy = resolveMaterialRenderPolicy(material);
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
      if (materialPolicy.renderQueue === 'transparent') {
        pushIssue(
          'material-binding',
          'render-queue:transparent',
          `renderer "${renderer.label}" cannot render transparent node "${node.node.id}" without the uber forward composition path`,
        );
      }
      if (!node.mesh.attributes.some((attribute) => attribute.semantic === 'NORMAL')) {
        pushIssue(
          'mesh',
          'vertex-attribute:NORMAL',
          `renderer "${renderer.label}" requires NORMAL vertex data on node "${node.node.id}" for deferred lighting`,
        );
      }
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
        let bindingDescriptors: readonly MaterialBindingDescriptor[] | undefined;
        try {
          const template = materialRegistry.templates.get(material.shaderId);
          if (template) {
            const variant = resolveTemplateVariant(template, material, {}, {
              geometry: node.mesh,
              residency,
            });
            bindingDescriptors = inspectMaterialTemplateBake(
              materialRegistry,
              material.shaderId,
              variant,
            ).bindings;
          } else {
            bindingDescriptors = getMaterialBindingDescriptors(
              prepareMaterialProgram(materialRegistry, material, {}, {
                geometry: node.mesh,
                residency,
              }).program,
            );
          }
        } catch {
          pushIssue(
            'material-binding',
            `shader:${material.shaderId}`,
            `renderer "${renderer.label}" cannot resolve custom shader "${material.shaderId}" for material "${material.id}"`,
          );
        }

        if (bindingDescriptors) {
          for (const descriptor of bindingDescriptors) {
            if (descriptor.kind === 'uniform' || descriptor.kind === 'alpha-policy') {
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

      if (node.mesh && !node.mesh.attributes.some((attribute) => attribute.semantic === 'NORMAL')) {
        pushIssue(
          'material-binding',
          'vertex-attribute:NORMAL',
          `renderer "${renderer.label}" cannot light node "${node.node.id}" because mesh "${node.mesh.id}" is missing NORMAL`,
        );
      }

      const bindingDescriptors = getMaterialBindingDescriptors(
        prepareMaterialProgram(materialRegistry, material, {}, {
          geometry: node.mesh,
          residency,
        }).program,
      );

      for (const descriptor of bindingDescriptors) {
        if (descriptor.kind === 'uniform' || descriptor.kind === 'alpha-policy') {
          continue;
        }

        const semantic = descriptor.textureSemantic;
        const textureRef = materialTextures.find((texture) => texture.semantic === semantic);
        if (!textureRef) {
          pushIssue(
            'material-binding',
            `texture-semantic:${semantic}`,
            `renderer "${renderer.label}" cannot satisfy "${semantic}" ${descriptor.kind} binding for built-in lit material "${material.id}"`,
          );
          continue;
        }

        if (node.mesh && !hasTexcoord0) {
          pushIssue(
            'material-binding',
            'vertex-attribute:TEXCOORD_0',
            `renderer "${renderer.label}" cannot sample "${semantic}" textures on lit node "${node.node.id}" because mesh "${node.mesh.id}" is missing TEXCOORD_0`,
          );
        } else if (residency && !residency.textures.get(textureRef.id)) {
          pushIssue(
            'material-binding',
            `texture-residency:${semantic}:${descriptor.kind}`,
            `renderer "${renderer.label}" cannot sample "${semantic}" textures for material "${material.id}" because texture "${textureRef.id}" is not resident`,
          );
        }
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
  _evaluatedScene: EvaluatedScene,
  _residency: RuntimeResidency,
): readonly VolumePassItem[] => [];

const getMatrixTranslation = (
  worldMatrix: readonly number[],
): readonly [number, number, number] => [
  worldMatrix[12] ?? 0,
  worldMatrix[13] ?? 0,
  worldMatrix[14] ?? 0,
];

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

const assertPositiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`"${name}" must be a positive integer`);
  }

  return value;
};

const defaultSdfWorldToLocalRotation = (): readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] => [
  1,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1,
];

const createPathtracedExtensionSdfPassItems = (
  extension?: PathtracedSceneExtension,
): readonly SdfPassItem[] =>
  extension?.sdfPrimitives?.map((primitive) => ({
    nodeId: primitive.id,
    sdfId: primitive.id,
    op: primitive.op,
    center: primitive.center,
    radius: primitive.op === 'sphere' ? primitive.radius ?? 0 : primitive.radius ?? 0,
    halfExtents: primitive.op === 'box'
      ? primitive.halfExtents ?? [0, 0, 0]
      : primitive.halfExtents ?? [0, 0, 0],
    color: primitive.color ?? [0.82, 0.82, 0.82, 0],
    worldToLocalRotation: primitive.worldToLocalRotation ?? defaultSdfWorldToLocalRotation(),
  })) ?? [];

const isMaterialRegistry = (value: unknown): value is MaterialRegistry =>
  typeof value === 'object' &&
  value !== null &&
  'programs' in value &&
  (value as { programs?: unknown }).programs instanceof Map;

const resolveForwardRenderOptions = (
  materialRegistryOrOptions?: MaterialRegistry | ForwardRenderOptions,
  postProcessPasses: readonly PostProcessPass[] = [],
): Required<ForwardRenderOptions> => {
  if (
    materialRegistryOrOptions === undefined ||
    isMaterialRegistry(materialRegistryOrOptions)
  ) {
    return {
      materialRegistry: materialRegistryOrOptions ?? createMaterialRegistry(),
      postProcessPasses,
      extension: {},
      clearColor: [0.02, 0.02, 0.03, 1],
      frameState: {},
    };
  }

  return {
    materialRegistry: materialRegistryOrOptions.materialRegistry ?? createMaterialRegistry(),
    postProcessPasses: materialRegistryOrOptions.postProcessPasses ?? [],
    extension: materialRegistryOrOptions.extension ?? {},
    clearColor: materialRegistryOrOptions.clearColor ?? [0.02, 0.02, 0.03, 1],
    frameState: materialRegistryOrOptions.frameState ?? {},
  };
};

const resolvePathtracedRenderOptions = (
  materialRegistryOrOptions?: MaterialRegistry | PathtracedRenderOptions,
  postProcessPasses: readonly PostProcessPass[] = [],
): Required<PathtracedRenderOptions> => {
  if (
    materialRegistryOrOptions === undefined ||
    isMaterialRegistry(materialRegistryOrOptions)
  ) {
    return {
      materialRegistry: materialRegistryOrOptions ?? createMaterialRegistry(),
      postProcessPasses,
      extension: {},
    };
  }

  return {
    materialRegistry: materialRegistryOrOptions.materialRegistry ?? createMaterialRegistry(),
    postProcessPasses: materialRegistryOrOptions.postProcessPasses ?? [],
    extension: materialRegistryOrOptions.extension ?? {},
  };
};

const getMeshPositionValues = (
  attributes: readonly { semantic: string; values: readonly number[] }[],
) => attributes.find((attribute) => attribute.semantic === 'POSITION')?.values;

const getMeshNormalValues = (
  attributes: readonly { semantic: string; values: readonly number[] }[],
) => attributes.find((attribute) => attribute.semantic === 'NORMAL')?.values;

const getMeshTexcoord0Values = (
  attributes: readonly { semantic: string; values: readonly number[] }[],
) => attributes.find((attribute) => attribute.semantic === 'TEXCOORD_0')?.values;

const createPathtracedMeshTriangles = (
  attributes: readonly { semantic: string; values: readonly number[] }[],
  indices: readonly number[] | undefined,
): readonly PathtracedMeshTriangle[] => {
  const positions = getMeshPositionValues(attributes);
  const normals = getMeshNormalValues(attributes);
  const texcoords = getMeshTexcoord0Values(attributes);
  if (!positions || positions.length === 0 || positions.length % 3 !== 0) {
    return [];
  }

  const vertexCount = positions.length / 3;
  const triangleIndices = indices && indices.length > 0
    ? indices
    : Array.from({ length: vertexCount }, (_, index) => index);
  if (triangleIndices.length % 3 !== 0) {
    return [];
  }

  const triangles: PathtracedMeshTriangle[] = [];
  for (let index = 0; index < triangleIndices.length; index += 3) {
    const aIndex = triangleIndices[index] ?? -1;
    const bIndex = triangleIndices[index + 1] ?? -1;
    const cIndex = triangleIndices[index + 2] ?? -1;
    if (
      aIndex < 0 || aIndex >= vertexCount || bIndex < 0 || bIndex >= vertexCount ||
      cIndex < 0 || cIndex >= vertexCount
    ) {
      continue;
    }

    triangles.push({
      a: [
        positions[aIndex * 3] ?? 0,
        positions[(aIndex * 3) + 1] ?? 0,
        positions[(aIndex * 3) + 2] ?? 0,
      ],
      b: [
        positions[bIndex * 3] ?? 0,
        positions[(bIndex * 3) + 1] ?? 0,
        positions[(bIndex * 3) + 2] ?? 0,
      ],
      c: [
        positions[cIndex * 3] ?? 0,
        positions[(cIndex * 3) + 1] ?? 0,
        positions[(cIndex * 3) + 2] ?? 0,
      ],
      na: normals
        ? [
          normals[aIndex * 3] ?? 0,
          normals[(aIndex * 3) + 1] ?? 0,
          normals[(aIndex * 3) + 2] ?? 0,
        ]
        : [0, 0, 0],
      nb: normals
        ? [
          normals[bIndex * 3] ?? 0,
          normals[(bIndex * 3) + 1] ?? 0,
          normals[(bIndex * 3) + 2] ?? 0,
        ]
        : [0, 0, 0],
      nc: normals
        ? [
          normals[cIndex * 3] ?? 0,
          normals[(cIndex * 3) + 1] ?? 0,
          normals[(cIndex * 3) + 2] ?? 0,
        ]
        : [0, 0, 0],
      ta: texcoords
        ? [
          texcoords[aIndex * 2] ?? 0,
          texcoords[(aIndex * 2) + 1] ?? 0,
        ]
        : [0, 0],
      tb: texcoords
        ? [
          texcoords[bIndex * 2] ?? 0,
          texcoords[(bIndex * 2) + 1] ?? 0,
        ]
        : [0, 0],
      tc: texcoords
        ? [
          texcoords[cIndex * 2] ?? 0,
          texcoords[(cIndex * 2) + 1] ?? 0,
        ]
        : [0, 0],
    });
  }

  return triangles;
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
  _evaluatedScene: EvaluatedScene,
): readonly SdfPassItem[] => [];

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
  cameraPosition: readonly [number, number, number] = [0, 0, 0],
  environmentIntensity = 0,
  debugView: ForwardDebugView = 'none',
): Float32Array => {
  const uniformData = new Float32Array((maxDirectionalLights * 8) + 8);
  const clampedLights = lights.slice(0, maxDirectionalLights);

  for (let index = 0; index < clampedLights.length; index += 1) {
    const light = clampedLights[index];
    const baseIndex = index * 4;
    uniformData.set(light.direction, baseIndex);
    uniformData.set(light.color, (maxDirectionalLights * 4) + baseIndex);
    uniformData[(maxDirectionalLights * 4) + baseIndex + 3] = light.intensity;
  }

  const settingsOffset = maxDirectionalLights * 8;
  const debugViewCode = debugView === 'normal-world-geometric'
    ? 1
    : debugView === 'normal-tangent-sampled'
    ? 2
    : debugView === 'normal-tangent-sampled-raw'
    ? 8
    : debugView === 'normal-world-mapped'
    ? 3
    : debugView === 'normal-view-mapped'
    ? 4
    : debugView === 'tangent-world'
    ? 5
    : debugView === 'bitangent-world'
    ? 6
    : debugView === 'tangent-handedness'
    ? 7
    : debugView === 'uv'
    ? 9
    : 0;
  uniformData[settingsOffset] = clampedLights.length;
  uniformData[settingsOffset + 1] = defaultAmbientLight;
  uniformData[settingsOffset + 2] = debugViewCode;
  uniformData[settingsOffset + 4] = cameraPosition[0];
  uniformData[settingsOffset + 5] = cameraPosition[1];
  uniformData[settingsOffset + 6] = cameraPosition[2];
  uniformData[settingsOffset + 7] = environmentIntensity;
  return uniformData;
};

const createDefaultEnvironmentPixels = (): Uint16Array => {
  const toFloat16Bits = (value: number): number => {
    const floatView = new Float32Array([value]);
    const intView = new Uint32Array(floatView.buffer);
    const x = intView[0] ?? 0;
    const sign = (x >> 16) & 0x8000;
    const mantissa = x & 0x007fffff;
    const exponent = (x >> 23) & 0xff;

    if (exponent === 0xff) {
      return sign | (mantissa !== 0 ? 0x7e00 : 0x7c00);
    }
    if (exponent > 142) {
      return sign | 0x7c00;
    }
    if (exponent < 113) {
      if (exponent < 103) {
        return sign;
      }
      const shiftedMantissa = mantissa | 0x00800000;
      const shift = 125 - exponent;
      const rounded = (shiftedMantissa >> shift) + ((shiftedMantissa >> (shift - 1)) & 1);
      return sign | rounded;
    }

    const halfExponent = exponent - 112;
    const halfMantissa = mantissa >> 13;
    const roundedMantissa = halfMantissa + ((mantissa >> 12) & 1);
    return sign | (halfExponent << 10) | (roundedMantissa & 0x03ff);
  };

  return new Uint16Array([
    toFloat16Bits(0.9),
    toFloat16Bits(0.94),
    toFloat16Bits(1.0),
    toFloat16Bits(1.0),
  ]);
};

const decodeEnvironmentImageAsset = (
  image: ImageAsset,
): Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}> => {
  if (
    image.mimeType !== 'image/exr' &&
    image.mimeType !== 'image/x-exr' &&
    image.mimeType !== 'application/x-exr'
  ) {
    throw new Error(
      `environment map "${image.id}" must be EXR, received "${image.mimeType}"`,
    );
  }

  const parsed = exrLoader.parse(
    image.bytes.buffer.slice(
      image.bytes.byteOffset,
      image.bytes.byteOffset + image.bytes.byteLength,
    ),
  ) as {
    width: number;
    height: number;
    data: Uint16Array;
  };

  return {
    width: parsed.width,
    height: parsed.height,
    data: parsed.data,
  };
};

const halfFloatScratchBuffer = new ArrayBuffer(4);
const halfFloatScratchView = new DataView(halfFloatScratchBuffer);

const decodeHalfFloat = (value: number): number => {
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  const sign = (value & 0x8000) << 16;

  if (exponent === 0) {
    if (fraction === 0) {
      halfFloatScratchView.setUint32(0, sign);
      return halfFloatScratchView.getFloat32(0);
    }

    let mantissa = fraction;
    let adjustedExponent = -14;
    while ((mantissa & 0x0400) === 0) {
      mantissa <<= 1;
      adjustedExponent -= 1;
    }
    mantissa &= 0x03ff;
    const bits = sign | (((adjustedExponent + 127) & 0xff) << 23) | (mantissa << 13);
    halfFloatScratchView.setUint32(0, bits);
    return halfFloatScratchView.getFloat32(0);
  }

  if (exponent === 0x1f) {
    const bits = sign | 0x7f800000 | (fraction << 13);
    halfFloatScratchView.setUint32(0, bits);
    return halfFloatScratchView.getFloat32(0);
  }

  const bits = sign | ((exponent + 112) << 23) | (fraction << 13);
  halfFloatScratchView.setUint32(0, bits);
  return halfFloatScratchView.getFloat32(0);
};

const encodeHalfFloat = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0x7e00;
  }
  if (value === Infinity) {
    return 0x7c00;
  }
  if (value === -Infinity) {
    return 0xfc00;
  }

  halfFloatScratchView.setFloat32(0, value);
  const bits = halfFloatScratchView.getUint32(0);
  const sign = (bits >> 16) & 0x8000;
  const exponent = (bits >> 23) & 0xff;
  const mantissa = bits & 0x7fffff;

  if (exponent <= 112) {
    if (exponent < 103) {
      return sign;
    }

    const shiftedMantissa = (mantissa | 0x800000) >> (126 - exponent);
    return sign | ((shiftedMantissa + 0x1000) >> 13);
  }

  if (exponent >= 143) {
    return sign | 0x7c00;
  }

  return sign | ((exponent - 112) << 10) | ((mantissa + 0x1000) >> 13);
};

const radicalInverseVdc = (bits: number): number => {
  let value = bits >>> 0;
  value = ((value << 16) | (value >>> 16)) >>> 0;
  value = (((value & 0x55555555) << 1) | ((value & 0xaaaaaaaa) >>> 1)) >>> 0;
  value = (((value & 0x33333333) << 2) | ((value & 0xcccccccc) >>> 2)) >>> 0;
  value = (((value & 0x0f0f0f0f) << 4) | ((value & 0xf0f0f0f0) >>> 4)) >>> 0;
  value = (((value & 0x00ff00ff) << 8) | ((value & 0xff00ff00) >>> 8)) >>> 0;
  return value * 2.3283064365386963e-10;
};

const hammersley = (index: number, sampleCount: number): readonly [number, number] => [
  index / sampleCount,
  radicalInverseVdc(index),
];

const normalizeEnvironmentVector = (
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};

const buildEnvironmentBasis = (
  x: number,
  y: number,
  z: number,
): Readonly<{
  tangent: readonly [number, number, number];
  bitangent: readonly [number, number, number];
  normal: readonly [number, number, number];
}> => {
  const normal = normalizeEnvironmentVector(x, y, z);
  const referenceUp = Math.abs(normal[1]) > 0.92 ? [1, 0, 0] as const : [0, 1, 0] as const;
  const tangent = normalizeEnvironmentVector(
    (referenceUp[1] * normal[2]) - (referenceUp[2] * normal[1]),
    (referenceUp[2] * normal[0]) - (referenceUp[0] * normal[2]),
    (referenceUp[0] * normal[1]) - (referenceUp[1] * normal[0]),
  );
  const bitangent = normalizeEnvironmentVector(
    (normal[1] * tangent[2]) - (normal[2] * tangent[1]),
    (normal[2] * tangent[0]) - (normal[0] * tangent[2]),
    (normal[0] * tangent[1]) - (normal[1] * tangent[0]),
  );
  return { tangent, bitangent, normal };
};

const sampleEnvironmentBilinear = (
  width: number,
  height: number,
  data: Float32Array,
  direction: readonly [number, number, number],
): readonly [number, number, number] => {
  const [x, y, z] = normalizeEnvironmentVector(direction[0], direction[1], direction[2]);
  const longitude = Math.atan2(z, x);
  const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
  const u = longitude / (2 * Math.PI) + 0.5;
  const v = Math.max(0, Math.min(1, 0.5 + (latitude / Math.PI)));
  const wrappedU = u - Math.floor(u);
  const fx = wrappedU * Math.max(width - 1, 1);
  const fy = v * Math.max(height - 1, 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = (x0 + 1) % width;
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const sample = (sampleX: number, sampleY: number, channel: number): number =>
    data[(((sampleY * width) + sampleX) * 4) + channel] ?? 0;

  const lerp = (a: number, b: number, t: number): number => a + ((b - a) * t);
  const c00 = [sample(x0, y0, 0), sample(x0, y0, 1), sample(x0, y0, 2)] as const;
  const c10 = [sample(x1, y0, 0), sample(x1, y0, 1), sample(x1, y0, 2)] as const;
  const c01 = [sample(x0, y1, 0), sample(x0, y1, 1), sample(x0, y1, 2)] as const;
  const c11 = [sample(x1, y1, 0), sample(x1, y1, 1), sample(x1, y1, 2)] as const;
  return [
    lerp(lerp(c00[0], c10[0], tx), lerp(c01[0], c11[0], tx), ty),
    lerp(lerp(c00[1], c10[1], tx), lerp(c01[1], c11[1], tx), ty),
    lerp(lerp(c00[2], c10[2], tx), lerp(c01[2], c11[2], tx), ty),
  ];
};

const importanceSampleGgx = (
  xi: readonly [number, number],
  roughness: number,
  normal: readonly [number, number, number],
): readonly [number, number, number] => {
  const alpha = roughness * roughness;
  const phi = 2 * Math.PI * xi[0];
  const cosTheta = Math.sqrt((1 - xi[1]) / Math.max(1 + ((alpha * alpha) - 1) * xi[1], 1e-6));
  const sinTheta = Math.sqrt(Math.max(0, 1 - (cosTheta * cosTheta)));
  const halfVectorTangent = [
    Math.cos(phi) * sinTheta,
    Math.sin(phi) * sinTheta,
    cosTheta,
  ] as const;
  const basis = buildEnvironmentBasis(normal[0], normal[1], normal[2]);
  return normalizeEnvironmentVector(
    (basis.tangent[0] * halfVectorTangent[0]) +
      (basis.bitangent[0] * halfVectorTangent[1]) +
      (basis.normal[0] * halfVectorTangent[2]),
    (basis.tangent[1] * halfVectorTangent[0]) +
      (basis.bitangent[1] * halfVectorTangent[1]) +
      (basis.normal[1] * halfVectorTangent[2]),
    (basis.tangent[2] * halfVectorTangent[0]) +
      (basis.bitangent[2] * halfVectorTangent[1]) +
      (basis.normal[2] * halfVectorTangent[2]),
  );
};

const importanceSampleGgxVndf = (
  xi: readonly [number, number],
  roughness: number,
  normal: readonly [number, number, number],
): readonly [number, number, number] => {
  const alpha = roughness * roughness;
  const r = Math.sqrt(xi[0]);
  const phi = 2 * Math.PI * xi[1];
  const t1 = r * Math.cos(phi);
  const t2 = r * Math.sin(phi);
  const nhZ = Math.sqrt(Math.max(0, 1 - (t1 * t1) - (t2 * t2)));
  const halfVectorTangent = normalizeEnvironmentVector(alpha * t1, alpha * t2, Math.max(0, nhZ));
  const basis = buildEnvironmentBasis(normal[0], normal[1], normal[2]);
  return normalizeEnvironmentVector(
    (basis.tangent[0] * halfVectorTangent[0]) +
      (basis.bitangent[0] * halfVectorTangent[1]) +
      (basis.normal[0] * halfVectorTangent[2]),
    (basis.tangent[1] * halfVectorTangent[0]) +
      (basis.bitangent[1] * halfVectorTangent[1]) +
      (basis.normal[1] * halfVectorTangent[2]),
    (basis.tangent[2] * halfVectorTangent[0]) +
      (basis.bitangent[2] * halfVectorTangent[1]) +
      (basis.normal[2] * halfVectorTangent[2]),
  );
};

const dotEnvironment = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number => (left[0] * right[0]) + (left[1] * right[1]) + (left[2] * right[2]);

const reflectEnvironment = (
  vector: readonly [number, number, number],
  normal: readonly [number, number, number],
): readonly [number, number, number] => {
  const scale = 2 * dotEnvironment(normal, vector);
  return normalizeEnvironmentVector(
    (scale * normal[0]) - vector[0],
    (scale * normal[1]) - vector[1],
    (scale * normal[2]) - vector[2],
  );
};

const createFloatEnvironmentData = (decoded: Uint16Array): Float32Array => {
  const floatData = new Float32Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    floatData[index] = decodeHalfFloat(decoded[index] ?? 0);
  }
  return floatData;
};

const environmentPrefilterRoughnessForMip = (
  mipLevel: number,
  maxMipLevel: number,
): number => {
  if (maxMipLevel <= 0) {
    return 0;
  }
  const normalizedLod = Math.max(0, Math.min(1, mipLevel / maxMipLevel));
  return normalizedLod * normalizedLod;
};

const createPrefilteredEnvironmentMipChain = (
  width: number,
  height: number,
  data: Uint16Array,
): readonly Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}>[] => {
  const source = createFloatEnvironmentData(data);
  const levels: Array<Readonly<{ width: number; height: number; data: Uint16Array }>> = [{
    width,
    height,
    data,
  }];
  const maxMipLevel = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const maxPrefilterMip = Math.max(maxMipLevel - 1, 1);

  for (let mipLevel = 1; mipLevel < maxMipLevel; mipLevel += 1) {
    const levelWidth = Math.max(1, width >> mipLevel);
    const levelHeight = Math.max(1, height >> mipLevel);
    const levelData = new Uint16Array(levelWidth * levelHeight * 4);
    const roughness = environmentPrefilterRoughnessForMip(mipLevel, maxPrefilterMip);
    const sampleCount = Math.max(16, 64 - (mipLevel * 4));

    for (let y = 0; y < levelHeight; y += 1) {
      for (let x = 0; x < levelWidth; x += 1) {
        const u = (x + 0.5) / levelWidth;
        const v = (y + 0.5) / levelHeight;
        const longitude = (u - 0.5) * 2 * Math.PI;
        const latitude = (v - 0.5) * Math.PI;
        const normal = normalizeEnvironmentVector(
          Math.cos(latitude) * Math.cos(longitude),
          Math.sin(latitude),
          Math.cos(latitude) * Math.sin(longitude),
        );
        const view = normal;
        const offset = ((y * levelWidth) + x) * 4;
        if (roughness < 0.001) {
          const sample = sampleEnvironmentBilinear(width, height, source, normal);
          levelData[offset] = encodeHalfFloat(sample[0]);
          levelData[offset + 1] = encodeHalfFloat(sample[1]);
          levelData[offset + 2] = encodeHalfFloat(sample[2]);
          levelData[offset + 3] = encodeHalfFloat(1);
          continue;
        }
        let red = 0;
        let green = 0;
        let blue = 0;
        let weight = 0;

        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
          const halfVector = importanceSampleGgxVndf(
            hammersley(sampleIndex, sampleCount),
            roughness,
            normal,
          );
          const light = reflectEnvironment(view, halfVector);
          const nDotL = Math.max(dotEnvironment(normal, light), 0);
          if (nDotL <= 1e-4) {
            continue;
          }
          const sample = sampleEnvironmentBilinear(width, height, source, light);
          red += sample[0] * nDotL;
          green += sample[1] * nDotL;
          blue += sample[2] * nDotL;
          weight += nDotL;
        }

        levelData[offset] = encodeHalfFloat(red / Math.max(weight, 1e-4));
        levelData[offset + 1] = encodeHalfFloat(green / Math.max(weight, 1e-4));
        levelData[offset + 2] = encodeHalfFloat(blue / Math.max(weight, 1e-4));
        levelData[offset + 3] = encodeHalfFloat(1);
      }
    }

    levels.push({
      width: levelWidth,
      height: levelHeight,
      data: levelData,
    });
  }

  return levels;
};

const geometrySchlickGgxBrdf = (nDotValue: number, roughness: number): number => {
  const k = (roughness * roughness) / 2;
  return nDotValue / Math.max((nDotValue * (1 - k)) + k, 1e-6);
};

const geometrySmithBrdf = (nDotV: number, nDotL: number, roughness: number): number =>
  geometrySchlickGgxBrdf(nDotV, roughness) * geometrySchlickGgxBrdf(nDotL, roughness);

const createEnvironmentBrdfLutData = (
  size = 128,
  sampleCount = 256,
): Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}> => {
  const data = new Uint16Array(size * size * 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const roughness = (x + 0.5) / size;
      const nDotV = Math.max((y + 0.5) / size, 1e-4);
      const view = [Math.sqrt(Math.max(0, 1 - (nDotV * nDotV))), 0, nDotV] as const;
      const normal = [0, 0, 1] as const;
      let scale = 0;
      let bias = 0;

      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const halfVector = importanceSampleGgx(
          hammersley(sampleIndex, sampleCount),
          roughness,
          normal,
        );
        const light = reflectEnvironment(view, halfVector);
        const nDotL = Math.max(light[2], 0);
        const nDotH = Math.max(halfVector[2], 0);
        const vDotH = Math.max(dotEnvironment(view, halfVector), 0);
        if (nDotL <= 1e-4 || nDotH <= 1e-4 || vDotH <= 1e-4) {
          continue;
        }

        const geometry = geometrySmithBrdf(nDotV, nDotL, roughness);
        const visibility = (geometry * vDotH) / Math.max(nDotH * nDotV, 1e-6);
        const fresnel = Math.pow(1 - vDotH, 5);
        scale += (1 - fresnel) * visibility;
        bias += fresnel * visibility;
      }

      const offset = ((y * size) + x) * 2;
      data[offset] = encodeHalfFloat(scale / sampleCount);
      data[offset + 1] = encodeHalfFloat(bias / sampleCount);
    }
  }

  return {
    width: size,
    height: size,
    data,
  };
};

const forwardEnvironmentBrdfLutSize = 128;
const forwardEnvironmentBrdfLutAssetByteLength = forwardEnvironmentBrdfLutSize *
  forwardEnvironmentBrdfLutSize * 2 * 2;

const resolveForwardEnvironmentBrdfLutData = (): Readonly<{
  width: number;
  height: number;
  data: Uint16Array;
}> => {
  if (forwardEnvironmentBrdfLutBytes.byteLength === forwardEnvironmentBrdfLutAssetByteLength) {
    return {
      width: forwardEnvironmentBrdfLutSize,
      height: forwardEnvironmentBrdfLutSize,
      data: new Uint16Array(
        forwardEnvironmentBrdfLutBytes.buffer,
        forwardEnvironmentBrdfLutBytes.byteOffset,
        forwardEnvironmentBrdfLutBytes.byteLength / 2,
      ),
    };
  }

  return createEnvironmentBrdfLutData(forwardEnvironmentBrdfLutSize);
};

const uploadForwardEnvironmentTexture = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  cacheId: string,
  decoded:
    | Readonly<{
      width: number;
      height: number;
      data: Uint16Array;
    }>
    | Readonly<{
      width: number;
      height: number;
      levels: readonly ForwardEnvironmentPrefilterLevel[];
    }>,
): TextureResidency => {
  if (!context.queue.writeTexture) {
    throw new Error('forward environment map upload requires GPUQueue.writeTexture support');
  }

  const mipChain = 'levels' in decoded
    ? decoded.levels
    : createPrefilteredEnvironmentMipChain(decoded.width, decoded.height, decoded.data);

  const texture = context.device.createTexture({
    label: cacheId,
    size: { width: decoded.width, height: decoded.height, depthOrArrayLayers: 1 },
    format: 'rgba16float',
    mipLevelCount: mipChain.length,
    usage: textureBindingUsage | textureCopyDstUsage,
  });
  for (let mipLevel = 0; mipLevel < mipChain.length; mipLevel += 1) {
    const level = mipChain[mipLevel];
    context.queue.writeTexture(
      { texture, mipLevel },
      toBufferSource(level.data),
      {
        offset: 0,
        bytesPerRow: level.width * 8,
        rowsPerImage: level.height,
      },
      {
        width: level.width,
        height: level.height,
        depthOrArrayLayers: 1,
      },
    );
  }

  const uploaded: TextureResidency = {
    textureId: cacheId,
    texture,
    view: texture.createView({
      label: `${cacheId}:view`,
    }),
    sampler: context.device.createSampler({
      label: `${cacheId}:sampler`,
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
      lodMaxClamp: Math.max(0, mipChain.length - 1),
    }),
    width: decoded.width,
    height: decoded.height,
    format: 'rgba16float',
  };
  residency.textures.set(cacheId, uploaded);
  return uploaded;
};

const ensureForwardEnvironmentTexture = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  environmentMap?: ForwardEnvironmentMap,
): Readonly<{
  residency: TextureResidency;
  intensity: number;
  ready: boolean;
}> => {
  const cacheId = environmentMap
    ? `__forward-environment:${environmentMap.id}`
    : '__forward-environment:default';
  const cached = residency.textures.get(cacheId);
  if (cached) {
    return {
      residency: cached,
      intensity: environmentMap?.intensity ?? 0,
      ready: true,
    };
  }

  if (!environmentMap) {
    const uploaded = uploadForwardEnvironmentTexture(context, residency, cacheId, {
      width: 1,
      height: 1,
      data: createDefaultEnvironmentPixels(),
    });
    return {
      residency: uploaded,
      intensity: 0,
      ready: true,
    };
  }

  const pendingState = forwardEnvironmentPrefilterStates.get(cacheId);
  if (pendingState?.status === 'ready') {
    const uploaded = uploadForwardEnvironmentTexture(context, residency, cacheId, pendingState);
    forwardEnvironmentPrefilterStates.delete(cacheId);
    return {
      residency: uploaded,
      intensity: environmentMap.intensity ?? 0,
      ready: true,
    };
  }

  if (pendingState?.status !== 'pending') {
    const queued = queueForwardEnvironmentPrefilter(cacheId, environmentMap);
    if (!queued || pendingState?.status === 'error') {
      const decoded = decodeEnvironmentImageAsset(environmentMap.image);
      const uploaded = uploadForwardEnvironmentTexture(context, residency, cacheId, decoded);
      forwardEnvironmentPrefilterStates.delete(cacheId);
      return {
        residency: uploaded,
        intensity: environmentMap.intensity ?? 0,
        ready: true,
      };
    }
  }

  const fallback = ensureForwardEnvironmentTexture(context, residency);
  return {
    residency: fallback.residency,
    intensity: 0,
    ready: false,
  };
};

const ensureForwardEnvironmentBrdfLut = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
): TextureResidency => {
  const cacheId = '__forward-environment-brdf-lut';
  const cached = residency.textures.get(cacheId);
  if (cached) {
    return cached;
  }

  if (!context.queue.writeTexture) {
    throw new Error('forward BRDF LUT upload requires GPUQueue.writeTexture support');
  }

  const lut = resolveForwardEnvironmentBrdfLutData();
  const texture = context.device.createTexture({
    label: cacheId,
    size: { width: lut.width, height: lut.height, depthOrArrayLayers: 1 },
    format: 'rg16float',
    usage: textureBindingUsage | textureCopyDstUsage,
  });
  context.queue.writeTexture(
    { texture },
    toBufferSource(lut.data),
    {
      offset: 0,
      bytesPerRow: lut.width * 4,
      rowsPerImage: lut.height,
    },
    {
      width: lut.width,
      height: lut.height,
      depthOrArrayLayers: 1,
    },
  );

  const uploaded: TextureResidency = {
    textureId: cacheId,
    texture,
    view: texture.createView({
      label: `${cacheId}:view`,
    }),
    sampler: context.device.createSampler({
      label: `${cacheId}:sampler`,
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    }),
    width: lut.width,
    height: lut.height,
    format: 'rg16float',
  };
  residency.textures.set(cacheId, uploaded);
  return uploaded;
};

const createEnvironmentBackgroundUniformData = (
  binding: RenderContextBinding,
  activeCamera?: EvaluatedCamera,
): Float32Array => {
  const aspect = binding.target.width / binding.target.height;
  if (!activeCamera || activeCamera.camera.type !== 'perspective') {
    return Float32Array.from([
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
      -1,
      0,
      aspect,
      Math.tan(Math.PI / 6),
      0.7,
      0,
    ]);
  }

  const perspectiveCamera = activeCamera.camera;
  const worldMatrix = activeCamera.worldMatrix;
  const rightAxis = normalizeVector3(
    worldMatrix[0] ?? 1,
    worldMatrix[1] ?? 0,
    worldMatrix[2] ?? 0,
  );
  const upAxis = normalizeVector3(
    worldMatrix[4] ?? 0,
    worldMatrix[5] ?? 1,
    worldMatrix[6] ?? 0,
  );
  const forwardAxis = normalizeVector3(
    -(worldMatrix[8] ?? 0),
    -(worldMatrix[9] ?? 0),
    -(worldMatrix[10] ?? 1),
  );

  return Float32Array.from([
    ...rightAxis,
    0,
    ...upAxis,
    0,
    ...forwardAxis,
    0,
    aspect,
    Math.tan((perspectiveCamera.yfov ?? Math.PI / 3) / 2),
    0.7,
    0,
  ]);
};

const renderForwardEnvironmentBackground = (
  context: GpuRenderExecutionContext,
  pass: GPURenderPassEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  activeCamera: EvaluatedCamera | undefined,
  environment: Readonly<{
    residency: TextureResidency;
  }>,
  transientBuffers: GPUBuffer[],
): void => {
  const pipeline = ensureEnvironmentBackgroundPipeline(
    context,
    residency,
    binding.target.format,
    getRenderTargetMsaaSampleCount(binding),
  );
  const uniformData = createEnvironmentBackgroundUniformData(binding, activeCamera);
  const uniformBuffer = context.device.createBuffer({
    label: 'forward-environment-background',
    size: uniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  transientBuffers.push(uniformBuffer);
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));

  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    context.device.createBindGroup({
      label: 'forward-environment-background:bind-group',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: environment.residency.view,
        },
        {
          binding: 1,
          resource: environment.residency.sampler,
        },
        {
          binding: 2,
          resource: {
            buffer: uniformBuffer,
          },
        },
      ],
    }),
  );
  pass.draw(3, 1, 0, 0);
};

const renderEnvironmentBackgroundBlurPasses = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  inputView: GPUTextureView,
  outputView: GPUTextureView,
  transientTextures: GPUTexture[],
  transientBuffers: GPUBuffer[],
): number => {
  const sampler = context.device.createSampler({
    label: 'environment-background-blur-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const blurTempTexture = createTransientRenderTexture(
    context,
    binding,
    'environment-background-blur-temp',
    binding.target.format,
  );
  transientTextures.push(blurTempTexture);
  const blurTempView = blurTempTexture.createView();
  const blurPasses = [
    {
      id: 'environment-background-blur-horizontal',
      targetView: blurTempView,
      sampleCount: 1,
      uniformData: Float32Array.from([
        1 / Math.max(binding.target.width, 1),
        0,
        10,
        5,
      ]),
    },
    {
      id: 'environment-background-blur-vertical',
      targetView: outputView,
      sampleCount: getRenderTargetMsaaSampleCount(binding),
      uniformData: Float32Array.from([
        0,
        1 / Math.max(binding.target.height, 1),
        10,
        5,
      ]),
    },
  ] as const;

  let sourceView = inputView;
  let drawCount = 0;
  for (const blurPass of blurPasses) {
    const pipeline = ensurePostProcessPipeline(
      context,
      residency,
      builtInEnvironmentBackgroundBlurProgram,
      binding.target.format,
      blurPass.sampleCount,
    );
    const uniformBuffer = context.device.createBuffer({
      label: `${blurPass.id}:uniforms`,
      size: blurPass.uniformData.byteLength,
      usage: uniformUsage | bufferCopyDstUsage,
    });
    transientBuffers.push(uniformBuffer);
    context.queue.writeBuffer(uniformBuffer, 0, blurPass.uniformData);
    const bindGroup = context.device.createBindGroup({
      label: `${blurPass.id}:bind-group`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: sampler },
        {
          binding: 2,
          resource: {
            buffer: uniformBuffer,
          },
        },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: blurPass.targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
    sourceView = blurPass.targetView;
    drawCount += 1;
  }

  return drawCount;
};

const usesLitMaterialProgram = (program: MaterialProgram): boolean =>
  program.id === builtInLitProgramId ||
  program.id === builtInTexturedLitProgramId ||
  program.id.startsWith(`${builtInLitProgramId}+`);

const prefersTexturedMaterialProgram = (
  program: MaterialProgram,
  material: Material,
  geometry: NonNullable<RuntimeResidency['geometry'] extends Map<string, infer T> ? T : never>,
  residency: RuntimeResidency,
): ResolveMaterialProgramOptions => {
  const baseColorTexture = getBaseColorTextureResidency(residency, material);
  if (!baseColorTexture || !geometry.attributeBuffers.TEXCOORD_0) {
    return {};
  }

  if (program.id === builtInUnlitProgramId) {
    return { preferTexturedUnlit: true };
  }

  if (program.id === builtInLitProgramId) {
    return { preferTexturedLit: true };
  }

  return {};
};

const createMaterialPipelineOptions = (
  material: Material | undefined,
  passKind: 'opaque' | 'transparent',
  msaaSampleCount = 1,
): MaterialPipelineOptions => {
  const policy = resolveMaterialRenderPolicy(material);
  return {
    blend: passKind === 'transparent' ? alphaBlendState : undefined,
    depthWriteEnabled: passKind === 'transparent' ? policy.depthWrite : true,
    cullMode: policy.doubleSided ? 'none' : 'back',
    msaaSampleCount,
  };
};

const isDeferredEligibleMeshNode = (
  node: EvaluatedScene['nodes'][number],
  residency: RuntimeResidency,
): boolean => {
  if (!node.mesh) {
    return false;
  }

  const material = node.material;
  const policy = resolveMaterialRenderPolicy(material);
  if (policy.renderQueue !== 'opaque' || policy.alphaMode === 'blend') {
    return false;
  }

  const geometry = residency.geometry.get(node.mesh.id);
  if (!geometry) {
    return false;
  }

  if (material?.shaderId && policy.alphaMode !== 'opaque') {
    return false;
  }

  return !(
    material?.kind === 'lit' &&
    getBaseColorTextureResidency(residency, material) &&
    geometry.attributeBuffers.TEXCOORD_0
  );
};

const partitionUberMeshNodes = (
  evaluatedScene: EvaluatedScene,
  residency: RuntimeResidency,
): Readonly<{
  deferredOpaque: readonly EvaluatedScene['nodes'][number][];
  forwardOpaque: readonly EvaluatedScene['nodes'][number][];
  forwardTransparent: readonly EvaluatedScene['nodes'][number][];
}> => {
  const deferredOpaque: EvaluatedScene['nodes'][number][] = [];
  const forwardOpaque: EvaluatedScene['nodes'][number][] = [];
  const forwardTransparent: EvaluatedScene['nodes'][number][] = [];

  for (const node of evaluatedScene.nodes) {
    if (!node.mesh) {
      continue;
    }

    const policy = resolveMaterialRenderPolicy(node.material);
    if (policy.renderQueue === 'transparent') {
      forwardTransparent.push(node);
      continue;
    }

    if (isDeferredEligibleMeshNode(node, residency)) {
      deferredOpaque.push(node);
      continue;
    }

    forwardOpaque.push(node);
  }

  return {
    deferredOpaque,
    forwardOpaque,
    forwardTransparent,
  };
};

const renderForwardMeshPass = (
  context: GpuRenderExecutionContext,
  pass: GPURenderPassEncoder,
  residency: RuntimeResidency,
  frameState: FrameState,
  nodes: readonly EvaluatedScene['nodes'][number][],
  materialRegistry: MaterialRegistry,
  format: GPUTextureFormat,
  viewProjectionMatrix: readonly number[],
  viewMatrix: readonly number[],
  inverseViewMatrix: readonly number[],
  directionalLights: readonly DirectionalLightItem[],
  cameraPosition: readonly [number, number, number],
  environment: ReturnType<typeof ensureForwardEnvironmentTexture>,
  extension: ForwardSceneExtension,
  transientBuffers: GPUBuffer[],
  msaaSampleCount: number,
  passKind: 'opaque' | 'transparent' = 'opaque',
): number => {
  let drawCount = 0;
  const environmentBrdfLut = ensureForwardEnvironmentBrdfLut(context, residency);
  const frameUniformData = createFrameUniformData(frameState);
  const frameUniformBuffer = context.device.createBuffer({
    label: `forward-frame-uniforms:${passKind}`,
    size: frameUniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  transientBuffers.push(frameUniformBuffer);
  context.queue.writeBuffer(frameUniformBuffer, 0, toBufferSource(frameUniformData));

  for (const node of nodes) {
    const mesh = node.mesh;
    if (!mesh) {
      continue;
    }

    const geometry = residency.geometry.get(mesh.id);
    if (!geometry) {
      continue;
    }
    const material = node.material ?? createDefaultMaterial();
    const resolvedPreparedProgram = prepareMaterialProgram(materialRegistry, node.material, {}, {
      geometry,
      residency,
    });
    const programOptions = prefersTexturedMaterialProgram(
      resolvedPreparedProgram.program,
      material,
      geometry,
      residency,
    );
    const preparedProgram = Object.keys(programOptions).length > 0
      ? prepareMaterialProgram(materialRegistry, node.material, programOptions, {
        geometry,
        residency,
      })
      : resolvedPreparedProgram;
    const program = preparedProgram.program;
    const pipeline = ensureMaterialPipeline(
      context,
      residency,
      preparedProgram,
      format,
      createMaterialPipelineOptions(material, passKind, msaaSampleCount),
    );

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
        ? createForwardLitMeshTransformUniformData(
          node.worldMatrix,
          viewProjectionMatrix,
          viewMatrix,
          inverseViewMatrix,
        )
        : createForwardMeshTransformUniformData(node.worldMatrix, viewProjectionMatrix);
      const transformBuffer = context.device.createBuffer({
        label: `${node.node.id}:mesh-transform`,
        size: transformData.byteLength,
        usage: uniformUsage | bufferCopyDstUsage,
      });
      transientBuffers.push(transformBuffer);
      context.queue.writeBuffer(transformBuffer, 0, toBufferSource(transformData));
      const transformBindGroup = context.device.createBindGroup({
        label: `${node.node.id}:transform-bind-group`,
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: transformBuffer,
            },
          },
          ...(program.usesFrameBindings
            ? [{
              binding: 1,
              resource: {
                buffer: frameUniformBuffer,
              },
            }]
            : []),
        ],
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
        label: `${node.node.id}:material-bind-group`,
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
      const lightingBindings = getProgramBindingDescriptors(program).filter((descriptor) =>
        getProgramBindingGroup(descriptor) === 2
      );
      const environmentBindings = getProgramBindingDescriptors(program).filter((descriptor) =>
        getProgramBindingGroup(descriptor) === 3
      );
      const lightingData = createDirectionalLightUniformData(
        directionalLights,
        cameraPosition,
        environment.intensity,
        extension.debugView ?? 'none',
      );
      const lightingBuffer = context.device.createBuffer({
        label: `${node.node.id}:lighting`,
        size: lightingData.byteLength,
        usage: uniformUsage | bufferCopyDstUsage,
      });
      transientBuffers.push(lightingBuffer);
      context.queue.writeBuffer(lightingBuffer, 0, toBufferSource(lightingData));
      if (lightingBindings.length > 0) {
        pass.setBindGroup(
          2,
          context.device.createBindGroup({
            label: `${node.node.id}:lighting-bind-group`,
            layout: pipeline.getBindGroupLayout(2),
            entries: lightingBindings.map((descriptor) =>
              resolveForwardPassBindingResource(
                descriptor,
                lightingBuffer,
                environment,
                environmentBrdfLut,
              )
            ),
          }),
        );
      }
      if (environmentBindings.length > 0) {
        pass.setBindGroup(
          3,
          context.device.createBindGroup({
            label: `${node.node.id}:environment-bind-group`,
            layout: pipeline.getBindGroupLayout(3),
            entries: environmentBindings.map((descriptor) =>
              resolveForwardPassBindingResource(
                descriptor,
                lightingBuffer,
                environment,
                environmentBrdfLut,
              )
            ),
          }),
        );
      }
    }

    if (geometry.indexBuffer && geometry.indexCount > 0) {
      pass.setIndexBuffer(geometry.indexBuffer, 'uint32');
      pass.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
    } else {
      pass.draw(geometry.vertexCount, 1, 0, 0);
    }

    drawCount += 1;
  }

  return drawCount;
};

export const ensureBuiltInForwardPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  return ensureMaterialPipeline(context, residency, builtInUnlitProgram, format);
};

const ensureShaderModule = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  key: string,
  code: string,
): GPUShaderModule => {
  const cached = residency.shaderModules.get(key);
  if (cached) {
    return cached;
  }

  const shader = context.device.createShaderModule({
    label: key,
    code,
  });
  residency.shaderModules.set(key, shader);
  return shader;
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

  const shader = ensureShaderModule(
    context,
    residency,
    builtInNodePickProgramId,
    builtInNodePickShader,
  );
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
  options: MaterialPipelineOptions = {},
): GPURenderPipeline => {
  const cullMode = options.cullMode === 'none' ? 'none' : options.cullMode ?? 'back';
  const cacheKey = `${builtInDeferredDepthPrepassProgramId}:${deferredDepthFormat}:${cullMode}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    builtInDeferredDepthPrepassProgramId,
    builtInDeferredDepthPrepassShader,
  );
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
      cullMode: cullMode === 'none' ? undefined : cullMode,
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
  program: MaterialProgram | PreparedMaterialProgram = builtInDeferredGbufferUnlitProgram,
  options: MaterialPipelineOptions = {},
): GPURenderPipeline => {
  const preparedProgram = getPreparedMaterialProgram(program);
  const cullMode = options.cullMode === 'none' ? 'none' : options.cullMode ?? 'back';
  const cacheKey = `${preparedProgram.key}:${format}:${cullMode}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    preparedProgram.key,
    preparedProgram.program.wgsl,
  );
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: preparedProgram.program.vertexEntryPoint,
      buffers: createVertexBufferLayouts(preparedProgram.program.vertexAttributes),
    },
    fragment: {
      module: shader,
      entryPoint: preparedProgram.program.fragmentEntryPoint,
      targets: [{ format }, { format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: cullMode === 'none' ? undefined : cullMode,
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

  const shader = ensureShaderModule(
    context,
    residency,
    builtInDeferredLightingProgramId,
    builtInDeferredLightingShader,
  );
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
  program: MaterialProgram | PreparedMaterialProgram,
  format: GPUTextureFormat,
  options: MaterialPipelineOptions = {},
): GPURenderPipeline => {
  const preparedProgram = getPreparedMaterialProgram(program);
  const blendKey = options.blend ? 'alpha-blend' : 'opaque';
  const depthWriteEnabled = options.depthWriteEnabled ?? true;
  const cullMode = options.cullMode === 'none' ? 'none' : options.cullMode ?? 'back';
  const msaaSampleCount = options.msaaSampleCount ?? 1;
  const cacheKey = `${preparedProgram.key}:${format}:${blendKey}:${
    depthWriteEnabled ? 'depth' : 'nodepth'
  }:${cullMode}:msaa${msaaSampleCount}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    preparedProgram.key,
    preparedProgram.program.wgsl,
  );
  const programBindings = getProgramBindingDescriptors(preparedProgram.program);
  const bindGroupDescriptors = new Map<number, MaterialBindingDescriptor[]>();
  if (preparedProgram.program.usesTransformBindings) {
    bindGroupDescriptors.set(0, [
      { kind: 'uniform', group: 0, binding: 0 },
      ...((preparedProgram.program.usesFrameBindings &&
          !hasExplicitFrameBindingDescriptor(preparedProgram.program))
        ? [{ kind: 'uniform', group: 0, binding: 1 } as const]
        : []),
    ]);
  }
  for (const descriptor of programBindings) {
    const group = getProgramBindingGroup(descriptor);
    const groupDescriptors = bindGroupDescriptors.get(group) ?? [];
    groupDescriptors.push(descriptor);
    bindGroupDescriptors.set(group, groupDescriptors);
  }
  const canCreateExplicitLayouts = 'createBindGroupLayout' in context.device &&
    typeof context.device.createBindGroupLayout === 'function' &&
    'createPipelineLayout' in context.device &&
    typeof context.device.createPipelineLayout === 'function';
  const explicitLayout = canCreateExplicitLayouts
    ? context.device.createPipelineLayout({
      label: `${cacheKey}:layout`,
      bindGroupLayouts: Array.from(
        { length: Math.max(...bindGroupDescriptors.keys(), 0) + 1 },
        (_value, group) => {
          const descriptors = bindGroupDescriptors.get(group) ?? [];
          return context.device.createBindGroupLayout({
            label: `${cacheKey}:group-${group}`,
            entries: descriptors
              .slice()
              .sort((left, right) => left.binding - right.binding)
              .map((descriptor) => {
                switch (descriptor.kind) {
                  case 'uniform':
                  case 'alpha-policy':
                    return {
                      binding: descriptor.binding,
                      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                      buffer: { type: 'uniform' as const },
                    };
                  case 'texture':
                    return {
                      binding: descriptor.binding,
                      visibility: GPUShaderStage.FRAGMENT,
                      texture: { sampleType: 'float' as const },
                    };
                  case 'sampler':
                    return {
                      binding: descriptor.binding,
                      visibility: GPUShaderStage.FRAGMENT,
                      sampler: { type: 'filtering' as const },
                    };
                }
              }),
          });
        },
      ),
    })
    : 'auto';
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: explicitLayout,
    vertex: {
      module: shader,
      entryPoint: preparedProgram.program.vertexEntryPoint,
      buffers: createVertexBufferLayouts(preparedProgram.program.vertexAttributes),
    },
    fragment: {
      module: shader,
      entryPoint: preparedProgram.program.fragmentEntryPoint,
      targets: [{
        format,
        blend: options.blend,
      }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: cullMode === 'none' ? undefined : cullMode,
    },
    depthStencil: {
      format: depthTextureFormat,
      depthWriteEnabled,
      depthCompare: 'less',
    },
    multisample: {
      count: msaaSampleCount,
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

  const shader = ensureShaderModule(
    context,
    residency,
    builtInSdfRaymarchProgramId,
    builtInSdfRaymarchShader,
  );
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

export const ensurePathtracedSdfPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInPathtracedSdfProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    builtInPathtracedSdfProgramId,
    builtInPathtracedSdfShader,
  );
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

export const ensurePathtracedMeshPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInPathtracedMeshProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    builtInPathtracedMeshProgramId,
    builtInPathtracedMeshShader,
  );
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

export const ensurePathtracedAccumulatePipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInPathtracedAccumulateProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    builtInPathtracedAccumulateProgramId,
    builtInPathtracedAccumulateShader,
  );
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

export const ensurePathtracedPresentPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
): GPURenderPipeline => {
  const cacheKey = `${builtInPathtracedPresentProgramId}:${format}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    builtInPathtracedPresentProgramId,
    builtInPathtracedPresentShader,
  );
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

  const shader = ensureShaderModule(
    context,
    residency,
    builtInVolumeRaymarchProgramId,
    builtInVolumeRaymarchShader,
  );
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

export const ensureEnvironmentBackgroundPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
  sampleCount = 1,
): GPURenderPipeline => {
  const cacheKey = `environment-background:${format}:${sampleCount}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    cacheKey,
    builtInEnvironmentBackgroundShader,
  );
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
    multisample: {
      count: sampleCount,
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

export const ensurePostProcessPipeline = (
  context: GpuRenderExecutionContext,
  residency: RuntimeResidency,
  program: PostProcessProgram,
  format: GPUTextureFormat,
  sampleCount = 1,
): GPURenderPipeline => {
  const programSignature = hashString(
    `${program.wgsl}\n${program.fragmentEntryPoint}\n${
      program.usesUniformBuffer ? 'uniform' : 'nouniform'
    }`,
  );
  const cacheKey = `${program.id}:${format}:${sampleCount}:${programSignature}`;
  const cached = residency.pipelines.get(cacheKey);
  if (cached) {
    return cached as GPURenderPipeline;
  }

  const shader = ensureShaderModule(
    context,
    residency,
    `${program.id}:${programSignature}`,
    program.wgsl,
  );
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: 'vsMain',
    },
    fragment: {
      module: shader,
      entryPoint: program.fragmentEntryPoint,
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
    multisample: {
      count: sampleCount,
    },
  });

  residency.pipelines.set(cacheKey, pipeline);
  return pipeline;
};

const createSdfUniformData = (
  items: readonly SdfPassItem[],
  camera: RaymarchCamera = defaultRaymarchCamera,
  frameIndex = 0,
): Float32Array => {
  const floatsPerItem = 24;
  const headerFloats = 20;
  const uniformData = new Float32Array(headerFloats + (maxSdfPassItems * floatsPerItem));
  uniformData[0] = Math.min(items.length, maxSdfPassItems);
  uniformData[1] = frameIndex;
  uniformData.set(camera.origin, 4);
  uniformData.set([...camera.right, 0], 8);
  uniformData.set([...camera.up, 0], 12);
  uniformData.set([...camera.forward, camera.projection === 'orthographic' ? 1 : 0], 16);

  items.slice(0, maxSdfPassItems).forEach((item, index) => {
    const offset = headerFloats + (index * floatsPerItem);
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

const createForwardMeshTransformUniformData = (
  worldMatrix: readonly number[],
  viewProjectionMatrix: readonly number[],
): Float32Array =>
  Float32Array.from([
    ...worldMatrix.slice(0, 16),
    ...viewProjectionMatrix.slice(0, 16),
  ]);

const createFrameUniformData = (frameState: FrameState = {}): Float32Array =>
  Float32Array.from([
    typeof frameState.timeMs === 'number' ? frameState.timeMs : 0,
    typeof frameState.deltaTimeMs === 'number' ? frameState.deltaTimeMs : 0,
    typeof frameState.frameIndex === 'number' ? frameState.frameIndex : 0,
    0,
  ]);

const createForwardLitMeshTransformUniformData = (
  worldMatrix: readonly number[],
  viewProjectionMatrix: readonly number[],
  viewMatrix: readonly number[],
  inverseViewMatrix: readonly number[],
): Float32Array =>
  Float32Array.from([
    ...worldMatrix.slice(0, 16),
    ...viewProjectionMatrix.slice(0, 16),
    ...viewMatrix.slice(0, 16),
    ...inverseViewMatrix.slice(0, 16),
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

const assertCubemapCaptureFormat = (format: GPUTextureFormat): GPUTextureFormat => {
  if (format !== defaultCubemapFormat) {
    throw new Error(
      `cubemap capture readback currently requires ${defaultCubemapFormat}, received "${format}"`,
    );
  }

  return format;
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
  _context: GpuRenderExecutionContext,
  _encoder: GPUCommandEncoder,
  _binding: RenderContextBinding,
  _residency: RuntimeResidency,
  _evaluatedScene: EvaluatedScene,
  _targetView = acquireColorAttachmentView(_context, _binding),
  _targetFormat = _binding.target.format,
  _camera: RaymarchCamera = defaultRaymarchCamera,
): number => 0;

export const renderPathtracedSdfPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  items: readonly SdfPassItem[],
  targetView = acquireColorAttachmentView(context, binding),
  targetFormat = binding.target.format,
  camera: RaymarchCamera = defaultRaymarchCamera,
  frameIndex = 0,
): number => {
  if (items.length === 0) {
    return 0;
  }

  const pipeline = ensurePathtracedSdfPipeline(context, residency, targetFormat);
  const uniformData = createSdfUniformData(items, camera, frameIndex);
  const lightingData = createDirectionalLightUniformData([]);
  const uniformBuffer = context.device.createBuffer({
    label: 'pathtraced-sdf-uniforms',
    size: uniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));
  const lightingBuffer = context.device.createBuffer({
    label: 'pathtraced-sdf-lighting',
    size: lightingData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(lightingBuffer, 0, toBufferSource(lightingData));
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
        resource: {
          buffer: lightingBuffer,
        },
      },
    ],
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: targetView,
      clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6, 1, 0, 0);
  pass.end();

  return 1;
};

const destroyPathtracedMeshSceneState = (state: PathtracedMeshSceneState): void => {
  state.triangleBuffer.destroy?.();
  state.bvhBuffer.destroy?.();
};

const createPathtracedMeshTriangleBufferData = (
  triangles: readonly PathtracedMeshTriangle[],
  triangleIndices: readonly number[],
): Float32Array => {
  const data = new Float32Array(triangleIndices.length * 36);

  triangleIndices.forEach((triangleIndex, outputIndex) => {
    const triangle = triangles[triangleIndex];
    const baseIndex = outputIndex * 36;
    data.set([...triangle.a, 1], baseIndex);
    data.set([...triangle.b, 1], baseIndex + 4);
    data.set([...triangle.c, 1], baseIndex + 8);
    data.set([...triangle.na, 0], baseIndex + 12);
    data.set([...triangle.nb, 0], baseIndex + 16);
    data.set([...triangle.nc, 0], baseIndex + 20);
    data.set([...triangle.ta, 0, 0], baseIndex + 24);
    data.set([...triangle.tb, 0, 0], baseIndex + 28);
    data.set([...triangle.tc, 0, 0], baseIndex + 32);
  });

  return data;
};

const createPathtracedMeshBvhBufferData = (
  nodes: readonly BvhNode[],
  nodeOffset: number,
  triangleOffset: number,
): Float32Array => {
  const data = new Float32Array(nodes.length * 12);

  nodes.forEach((node, index) => {
    const baseIndex = index * 12;
    data.set([...node.boundsMin, 0], baseIndex);
    data.set([...node.boundsMax, 0], baseIndex + 4);
    data.set(
      [
        node.leftChild >= 0 ? node.leftChild + nodeOffset : -1,
        node.rightChild >= 0 ? node.rightChild + nodeOffset : -1,
        node.triangleOffset >= 0 ? node.triangleOffset + triangleOffset : -1,
        node.triangleCount,
      ],
      baseIndex + 8,
    );
  });

  return data;
};

const createPathtracedMeshInstances = (
  evaluatedScene: EvaluatedScene,
  meshAssets: ReadonlyMap<string, PathtracedMeshAsset>,
  textureSlots: ReadonlyMap<string, number>,
): readonly PathtracedMeshInstance[] =>
  evaluatedScene.nodes.flatMap((node) => {
    if (!node.mesh) {
      return [];
    }

    const asset = meshAssets.get(node.mesh.id);
    if (!asset) {
      return [];
    }

    const color = node.material?.parameters.color ?? { x: 0.82, y: 0.82, z: 0.82, w: 1 };
    const emissive = node.material?.parameters.emissive ?? { x: 0, y: 0, z: 0, w: 1 };
    const metallicRoughness = node.material?.parameters.metallicRoughness ?? {
      x: 1,
      y: 1,
      z: 1,
      w: 1,
    };
    const getTextureSlot = (semantic: string): number => {
      const textureId = node.material?.textures.find((texture) => texture.semantic === semantic)
        ?.id;
      return textureId ? textureSlots.get(textureId) ?? -1 : -1;
    };
    return [{
      rootNodeIndex: asset.rootNodeIndex,
      baseColorTextureSlot: getTextureSlot('baseColor'),
      metallicRoughnessTextureSlot: getTextureSlot('metallicRoughness'),
      normalTextureSlot: getTextureSlot('normal'),
      emissiveTextureSlot: getTextureSlot('emissive'),
      occlusionTextureSlot: getTextureSlot('occlusion'),
      localToWorld: node.worldMatrix,
      worldToLocal: invertAffineMatrix(node.worldMatrix),
      albedo: [color.x, color.y, color.z],
      emissive: [emissive.x, emissive.y, emissive.z],
      metallic: metallicRoughness.x,
      roughness: metallicRoughness.y,
      occlusionStrength: metallicRoughness.z,
      normalScale: metallicRoughness.w,
    }];
  });

const createPathtracedMeshInstanceBufferData = (
  instances: readonly PathtracedMeshInstance[],
): Float32Array => {
  const data = new Float32Array(instances.length * 52);

  instances.forEach((instance, index) => {
    const baseIndex = index * 52;
    data.set(instance.localToWorld.slice(0, 16), baseIndex);
    data.set(instance.worldToLocal.slice(0, 16), baseIndex + 16);
    data.set(
      [
        instance.rootNodeIndex,
        instance.baseColorTextureSlot,
        instance.metallicRoughnessTextureSlot,
        instance.normalTextureSlot,
      ],
      baseIndex + 32,
    );
    data.set([...instance.albedo, 0], baseIndex + 36);
    data.set(
      [
        instance.metallic,
        instance.roughness,
        instance.emissiveTextureSlot,
        instance.occlusionTextureSlot,
      ],
      baseIndex + 40,
    );
    data.set([...instance.emissive, instance.normalScale], baseIndex + 44);
    data.set([instance.occlusionStrength, 0, 0, 0], baseIndex + 48);
  });

  return data;
};

const collectPathtracedMaterialTextures = (
  evaluatedScene: EvaluatedScene,
  residency: RuntimeResidency,
): Readonly<{
  slots: ReadonlyMap<string, number>;
  textures: readonly TextureResidency[];
}> => {
  const slots = new Map<string, number>();
  const textures: TextureResidency[] = [];

  for (const node of evaluatedScene.nodes) {
    const material = node.material;
    if (!material) {
      continue;
    }

    for (const texture of material.textures) {
      const residencyTexture = residency.textures.get(texture.id);
      if (!residencyTexture || slots.has(residencyTexture.textureId)) {
        continue;
      }

      if (textures.length >= maxPathtracedMaterialTextures) {
        break;
      }

      slots.set(residencyTexture.textureId, textures.length);
      textures.push(residencyTexture);
    }
  }

  return { slots, textures };
};

const createFallbackPathtracedTextureBinding = (
  context: GpuRenderExecutionContext,
): Readonly<{ texture: GPUTexture; textureView: GPUTextureView; sampler: GPUSampler }> => {
  const cached = pathtracedFallbackTextureBindings.get(context.device);
  if (cached) {
    return cached;
  }

  const texture = context.device.createTexture({
    label: 'pathtraced-fallback-base-color',
    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: textureBindingUsage | textureCopyDstUsage,
  });
  context.queue.writeTexture?.(
    { texture },
    new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: 4, rowsPerImage: 1 },
    { width: 1, height: 1, depthOrArrayLayers: 1 },
  );
  const binding = {
    textureView: texture.createView(),
    texture,
    sampler: context.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    }),
  };
  pathtracedFallbackTextureBindings.set(context.device, binding);
  return binding;
};

const ensurePathtracedMeshSceneState = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  evaluatedScene: EvaluatedScene,
  meshCacheKey: string,
): PathtracedMeshSceneState | undefined => {
  const cached = pathtracedMeshSceneStates.get(binding);
  if (cached?.meshCacheKey === meshCacheKey) {
    return cached;
  }

  if (cached) {
    destroyPathtracedMeshSceneState(cached);
    pathtracedMeshSceneStates.delete(binding);
  }

  const meshEntries = [
    ...new Map(
      evaluatedScene.nodes
        .filter((node): node is typeof node & { mesh: NonNullable<typeof node.mesh> } =>
          !!node.mesh
        )
        .map((node) => [node.mesh.id, node.mesh]),
    ).values(),
  ];
  if (meshEntries.length === 0) {
    return undefined;
  }

  const triangleDataParts: Float32Array[] = [];
  const bvhDataParts: Float32Array[] = [];
  const meshAssets = new Map<string, PathtracedMeshAsset>();
  let triangleOffset = 0;
  let nodeOffset = 0;

  for (const mesh of meshEntries) {
    const triangles = createPathtracedMeshTriangles(mesh.attributes, mesh.indices);
    if (triangles.length === 0) {
      continue;
    }

    const bvh = buildBvh(
      triangles.map<RaytraceTriangle>((triangle) => ({
        a: triangle.a,
        b: triangle.b,
        c: triangle.c,
      })),
    );
    triangleDataParts.push(createPathtracedMeshTriangleBufferData(triangles, bvh.triangleIndices));
    bvhDataParts.push(createPathtracedMeshBvhBufferData(bvh.nodes, nodeOffset, triangleOffset));
    meshAssets.set(mesh.id, {
      meshId: mesh.id,
      rootNodeIndex: nodeOffset,
    });
    triangleOffset += bvh.triangleIndices.length;
    nodeOffset += bvh.nodes.length;
  }

  if (triangleDataParts.length === 0 || bvhDataParts.length === 0) {
    return undefined;
  }

  const triangleData = Float32Array.from(triangleDataParts.flatMap((part) => Array.from(part)));
  const triangleBuffer = context.device.createBuffer({
    label: 'pathtraced-mesh-triangles',
    size: triangleData.byteLength,
    usage: storageUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(triangleBuffer, 0, toBufferSource(triangleData));

  const bvhData = Float32Array.from(bvhDataParts.flatMap((part) => Array.from(part)));
  const bvhBuffer = context.device.createBuffer({
    label: 'pathtraced-mesh-bvh',
    size: bvhData.byteLength,
    usage: storageUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(bvhBuffer, 0, toBufferSource(bvhData));

  const state: PathtracedMeshSceneState = {
    meshCacheKey,
    triangleBuffer,
    bvhBuffer,
    meshAssets,
  };
  pathtracedMeshSceneStates.set(binding, state);
  return state;
};

const createPathtracedMeshUniformData = (
  instanceCount: number,
  camera: RaymarchCamera,
  frameIndex: number,
): Float32Array =>
  Float32Array.from([
    instanceCount,
    frameIndex,
    0,
    0,
    ...camera.origin,
    0,
    ...camera.right,
    camera.projection === 'orthographic' ? 1 : 0,
    ...camera.up,
    0,
    ...camera.forward,
    camera.projection === 'orthographic' ? 1 : 0,
  ]);

export const renderPathtracedMeshPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  meshCacheKey: string,
  sdfItems: readonly SdfPassItem[] = [],
  targetView = acquireColorAttachmentView(context, binding),
  targetFormat = binding.target.format,
  camera: RaymarchCamera = defaultRaymarchCamera,
  frameIndex = 0,
): number => {
  const sceneState = ensurePathtracedMeshSceneState(
    context,
    binding,
    evaluatedScene,
    meshCacheKey,
  );
  if (!sceneState) {
    return 0;
  }
  const textureBindings = collectPathtracedMaterialTextures(evaluatedScene, residency);
  const instances = createPathtracedMeshInstances(
    evaluatedScene,
    sceneState.meshAssets,
    textureBindings.slots,
  );
  if (instances.length === 0) {
    return 0;
  }

  const pipeline = ensurePathtracedMeshPipeline(context, residency, targetFormat);
  const uniformData = createPathtracedMeshUniformData(instances.length, camera, frameIndex);
  const sdfUniformData = createSdfUniformData(sdfItems, camera, frameIndex);
  const lightingData = createDirectionalLightUniformData(
    extractDirectionalLightItems(evaluatedScene),
  );
  const uniformBuffer = context.device.createBuffer({
    label: 'pathtraced-mesh-uniforms',
    size: uniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));
  const sdfUniformBuffer = context.device.createBuffer({
    label: 'pathtraced-mesh-sdf-uniforms',
    size: sdfUniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(sdfUniformBuffer, 0, toBufferSource(sdfUniformData));
  const lightingBuffer = context.device.createBuffer({
    label: 'pathtraced-mesh-lighting',
    size: lightingData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(lightingBuffer, 0, toBufferSource(lightingData));
  const instanceData = createPathtracedMeshInstanceBufferData(instances);
  const instanceBuffer = context.device.createBuffer({
    label: 'pathtraced-mesh-instances',
    size: instanceData.byteLength,
    usage: storageUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(instanceBuffer, 0, toBufferSource(instanceData));
  const fallbackTextureBinding = createFallbackPathtracedTextureBinding(context);
  const boundTextures = Array.from(
    { length: maxPathtracedMaterialTextures },
    (_, index) => textureBindings.textures[index],
  );

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
        resource: {
          buffer: sceneState.triangleBuffer,
        },
      },
      {
        binding: 2,
        resource: {
          buffer: sceneState.bvhBuffer,
        },
      },
      {
        binding: 3,
        resource: {
          buffer: instanceBuffer,
        },
      },
      {
        binding: 4,
        resource: {
          buffer: sdfUniformBuffer,
        },
      },
      {
        binding: 5,
        resource: {
          buffer: lightingBuffer,
        },
      },
      {
        binding: 6,
        resource: boundTextures[0]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 7,
        resource: boundTextures[0]?.sampler ?? fallbackTextureBinding.sampler,
      },
      {
        binding: 8,
        resource: boundTextures[1]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 9,
        resource: boundTextures[1]?.sampler ?? fallbackTextureBinding.sampler,
      },
      {
        binding: 10,
        resource: boundTextures[2]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 11,
        resource: boundTextures[2]?.sampler ?? fallbackTextureBinding.sampler,
      },
      {
        binding: 12,
        resource: boundTextures[3]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 13,
        resource: boundTextures[3]?.sampler ?? fallbackTextureBinding.sampler,
      },
      {
        binding: 14,
        resource: boundTextures[4]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 15,
        resource: boundTextures[4]?.sampler ?? fallbackTextureBinding.sampler,
      },
      {
        binding: 16,
        resource: boundTextures[5]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 17,
        resource: boundTextures[5]?.sampler ?? fallbackTextureBinding.sampler,
      },
      {
        binding: 18,
        resource: boundTextures[6]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 19,
        resource: boundTextures[6]?.sampler ?? fallbackTextureBinding.sampler,
      },
      {
        binding: 20,
        resource: boundTextures[7]?.view ?? fallbackTextureBinding.textureView,
      },
      {
        binding: 21,
        resource: boundTextures[7]?.sampler ?? fallbackTextureBinding.sampler,
      },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: targetView,
      clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6, 1, 0, 0);
  pass.end();

  return 1;
};

const renderPathtracedAccumulationPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  residency: RuntimeResidency,
  currentSampleView: GPUTextureView,
  previousAccumulationView: GPUTextureView,
  targetView: GPUTextureView,
  sampleCount: number,
): number => {
  const pipeline = ensurePathtracedAccumulatePipeline(
    context,
    residency,
    pathtracedAccumulationFormat,
  );
  const sampler = context.device.createSampler({
    label: 'pathtraced-accumulation-sampler',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
  const uniformData = new Float32Array([sampleCount, 0, 0, 0]);
  const uniformBuffer = context.device.createBuffer({
    label: 'pathtraced-accumulation-uniforms',
    size: uniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));
  const bindGroup = context.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: previousAccumulationView,
      },
      {
        binding: 1,
        resource: sampler,
      },
      {
        binding: 2,
        resource: currentSampleView,
      },
      {
        binding: 3,
        resource: sampler,
      },
      {
        binding: 4,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: targetView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6, 1, 0, 0);
  pass.end();

  return 1;
};

const renderPathtracedPresentPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  residency: RuntimeResidency,
  format: GPUTextureFormat,
  inputView: GPUTextureView,
  targetView: GPUTextureView,
): number => {
  const pipeline = ensurePathtracedPresentPipeline(context, residency, format);
  const sampler = context.device.createSampler({
    label: 'pathtraced-present-sampler',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
  const uniformData = new Float32Array([1.0, 0, 0, 0, 0, 0, 0, 0]);
  const uniformBuffer = context.device.createBuffer({
    label: 'pathtraced-present-uniforms',
    size: uniformData.byteLength,
    usage: uniformUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(uniformData));
  const bindGroup = context.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: inputView,
      },
      {
        binding: 1,
        resource: sampler,
      },
      {
        binding: 2,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: targetView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
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
  _context: GpuRenderExecutionContext,
  _encoder: GPUCommandEncoder,
  _binding: RenderContextBinding,
  _residency: RuntimeResidency,
  _evaluatedScene: EvaluatedScene,
  _targetView = acquireColorAttachmentView(_context, _binding),
  _targetFormat = _binding.target.format,
  _camera: RaymarchCamera = defaultRaymarchCamera,
): number => 0;

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
): PreparedMaterialProgram => {
  if (material.shaderId) {
    return prepareMaterialProgram(materialRegistry, material, {}, { geometry, residency });
  }

  if (material.kind === 'lit') {
    return createPreparedBuiltInProgram(builtInDeferredGbufferLitProgram, material, {}, {
      geometry,
      residency,
    });
  }

  const baseColorTexture = getBaseColorTextureResidency(residency, material);
  return baseColorTexture && geometry.attributeBuffers.TEXCOORD_0
    ? createPreparedBuiltInProgram(
      builtInDeferredGbufferTexturedUnlitProgram,
      material,
      { preferTexturedUnlit: true },
      { geometry, residency },
    )
    : createPreparedBuiltInProgram(builtInDeferredGbufferUnlitProgram, material, {}, {
      geometry,
      residency,
    });
};

export const renderForwardFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  frameState: FrameState,
  evaluatedScene: EvaluatedScene,
  materialRegistryOrOptions: MaterialRegistry | ForwardRenderOptions = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): ForwardRenderResult => {
  const options = resolveForwardRenderOptions(materialRegistryOrOptions, postProcessPasses);
  return renderForwardFrameInternal(
    context,
    binding,
    residency,
    frameState,
    evaluatedScene,
    options.materialRegistry,
    options.postProcessPasses,
    {
      clearColor: options.clearColor,
      extension: options.extension,
      frameState: options.frameState ?? frameState,
    },
  );
};

const renderForwardFrameInternal = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  frameState: FrameState,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
  options: Readonly<{
    viewProjectionMatrix?: readonly number[];
    viewMatrix?: readonly number[];
    includeRaymarchPasses?: boolean;
    raymarchCamera?: RaymarchCamera;
    extension?: ForwardSceneExtension;
    clearColor?: readonly [number, number, number, number];
    frameState?: FrameState;
  }> = {},
): ForwardRenderResult => {
  assertRendererSceneCapabilities(
    createForwardRenderer('forward', postProcessPasses),
    evaluatedScene,
    materialRegistry,
    residency,
  );
  const renderTargetSampleCount = getRenderTargetMsaaSampleCount(binding);
  const needsIntermediateSceneColor = postProcessPasses.length > 0 || renderTargetSampleCount > 1;
  const sceneColorTexture = needsIntermediateSceneColor
    ? createTransientRenderTexture(
      context,
      binding,
      'forward-scene-color',
      binding.target.format,
      renderAttachmentUsage | textureBindingUsage,
      renderTargetSampleCount,
    )
    : undefined;
  const sceneColorResolveTexture = renderTargetSampleCount > 1 && postProcessPasses.length > 0
    ? createTransientRenderTexture(
      context,
      binding,
      'forward-scene-color-resolve',
      binding.target.format,
      renderAttachmentUsage | textureBindingUsage,
    )
    : undefined;
  const sceneColorView = sceneColorTexture?.createView();
  const sceneColorResolveView = sceneColorResolveTexture?.createView();
  const finalColorView = acquireColorAttachmentView(context, binding);
  const colorView = sceneColorView ?? finalColorView;
  const colorResolveTarget = renderTargetSampleCount > 1
    ? sceneColorResolveView ?? finalColorView
    : undefined;
  const resolvedSceneColorView = sceneColorResolveView ?? sceneColorView ?? finalColorView;
  const viewProjectionMatrix = options.viewProjectionMatrix ??
    createViewProjectionMatrix(binding, evaluatedScene.activeCamera);
  const encoder = context.device.createCommandEncoder({
    label: 'forward-frame',
  });
  const transientTextures: GPUTexture[] = [];
  const transientBuffers: GPUBuffer[] = [];
  if (sceneColorTexture) {
    transientTextures.push(sceneColorTexture);
  }
  if (sceneColorResolveTexture) {
    transientTextures.push(sceneColorResolveTexture);
  }
  const forwardEnvironment = ensureForwardEnvironmentTexture(
    context,
    residency,
    options.extension?.environmentMap,
  );
  const clearColor = options.clearColor
    ? {
      r: options.clearColor[0],
      g: options.clearColor[1],
      b: options.clearColor[2],
      a: options.clearColor[3],
    }
    : { r: 0.02, g: 0.02, b: 0.03, a: 1 };
  const hasEnvironmentBackground = Boolean(options.extension?.environmentMap) &&
    forwardEnvironment.ready;
  if (hasEnvironmentBackground) {
    const backgroundSourceTexture = createTransientRenderTexture(
      context,
      binding,
      'forward-environment-background-source',
      binding.target.format,
    );
    transientTextures.push(backgroundSourceTexture);
    const backgroundSourceView = backgroundSourceTexture.createView();
    const backgroundPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: backgroundSourceView,
        clearValue: clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderForwardEnvironmentBackground(
      context,
      backgroundPass,
      binding,
      residency,
      evaluatedScene.activeCamera,
      forwardEnvironment,
      transientBuffers,
    );
    backgroundPass.end();
    renderEnvironmentBackgroundBlurPasses(
      context,
      encoder,
      binding,
      residency,
      backgroundSourceView,
      colorView,
      transientTextures,
      transientBuffers,
    );
  }
  const forwardOpaqueNodes = evaluatedScene.nodes.filter((node) =>
    node.mesh && resolveMaterialRenderPolicy(node.material).renderQueue === 'opaque'
  );
  const forwardTransparentNodes = evaluatedScene.nodes.filter((node) =>
    node.mesh && resolveMaterialRenderPolicy(node.material).renderQueue === 'transparent'
  );
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: colorView,
      resolveTarget: colorResolveTarget,
      clearValue: clearColor,
      loadOp: hasEnvironmentBackground ? 'load' : 'clear',
      storeOp: 'store',
    }],
    depthStencilAttachment: {
      view: acquireDepthAttachmentView(binding),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  const directionalLights = extractDirectionalLightItems(evaluatedScene);
  const viewMatrix = options.viewMatrix ?? evaluatedScene.activeCamera?.viewMatrix ??
    identityMat4();
  const inverseViewMatrix = evaluatedScene.activeCamera?.worldMatrix ?? identityMat4();
  const cameraPosition = evaluatedScene.activeCamera
    ? getMatrixTranslation(evaluatedScene.activeCamera.worldMatrix)
    : [0, 0, 0] as const;
  let drawCount = hasEnvironmentBackground ? 3 : 0;
  drawCount += renderForwardMeshPass(
    context,
    pass,
    residency,
    options.frameState ?? frameState,
    forwardOpaqueNodes,
    materialRegistry,
    binding.target.format,
    viewProjectionMatrix,
    viewMatrix,
    inverseViewMatrix,
    directionalLights,
    cameraPosition,
    forwardEnvironment,
    options.extension ?? {},
    transientBuffers,
    renderTargetSampleCount,
    'opaque',
  );

  pass.end();

  if (forwardTransparentNodes.length > 0) {
    const transparentPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        resolveTarget: colorResolveTarget,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: acquireDepthAttachmentView(binding),
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });
    drawCount += renderForwardMeshPass(
      context,
      transparentPass,
      residency,
      options.frameState ?? frameState,
      forwardTransparentNodes,
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      viewMatrix,
      inverseViewMatrix,
      directionalLights,
      cameraPosition,
      forwardEnvironment,
      options.extension ?? {},
      transientBuffers,
      renderTargetSampleCount,
      'transparent',
    );
    transparentPass.end();
  }

  if (sceneColorView) {
    drawCount += renderPostProcessPasses(
      context,
      encoder,
      binding,
      residency,
      postProcessPasses,
      resolvedSceneColorView,
    );
  }

  const commandBuffer = encoder.finish();
  context.queue.submit([commandBuffer]);
  for (const buffer of transientBuffers) {
    buffer.destroy();
  }
  for (const texture of transientTextures) {
    texture.destroy();
  }

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
  msaaSampleCount = 1,
): GPUTexture =>
  context.device.createTexture({
    label,
    size: {
      width: binding.target.width,
      height: binding.target.height,
      depthOrArrayLayers: 1,
    },
    format,
    sampleCount: msaaSampleCount,
    usage,
  });

const createPathtracedAccumulationTexture = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  label: string,
): GPUTexture =>
  context.device.createTexture({
    label,
    size: {
      width: binding.target.width,
      height: binding.target.height,
      depthOrArrayLayers: 1,
    },
    format: pathtracedAccumulationFormat,
    sampleCount: 1,
    usage: renderAttachmentUsage | textureBindingUsage,
  });

const getRenderTargetMsaaSampleCount = (binding: RenderContextBinding): number =>
  'msaaSampleCount' in binding.target ? (binding.target.msaaSampleCount ?? 1) : 1;

const createPathtracedSceneKey = (
  evaluatedScene: EvaluatedScene,
  extension?: PathtracedSceneExtension,
): string => {
  const activeCamera = evaluatedScene.activeCamera;
  const cameraKey = activeCamera
    ? [
      activeCamera.camera.id,
      activeCamera.camera.type,
      activeCamera.camera.type === 'perspective'
        ? activeCamera.camera.yfov ?? ''
        : `${activeCamera.camera.xmag ?? ''},${activeCamera.camera.ymag ?? ''}`,
      activeCamera.camera.znear,
      activeCamera.camera.zfar,
      activeCamera.worldMatrix.join(','),
      activeCamera.viewMatrix.join(','),
    ].join('|')
    : 'default-camera';
  const meshKey = evaluatedScene.nodes
    .filter((node) => node.mesh)
    .map((node) => [node.node.id, node.worldMatrix.join(',')].join('|'))
    .join('::');
  const sdfKey = extension?.sdfPrimitives?.map((primitive) =>
    [
      primitive.id,
      primitive.op,
      primitive.center.join(','),
      primitive.radius ?? '',
      primitive.halfExtents?.join(',') ?? '',
      primitive.color?.join(',') ?? '',
      primitive.worldToLocalRotation?.join(',') ?? '',
    ].join('|')
  ).join('::') ?? '';

  return hashString(`${cameraKey}::${meshKey}::${sdfKey}`);
};

const createPathtracedMeshCacheKey = (evaluatedScene: EvaluatedScene): string =>
  hashString(
    [
      ...new Map(
        evaluatedScene.nodes
          .filter((node): node is typeof node & { mesh: NonNullable<typeof node.mesh> } =>
            !!node.mesh
          )
          .map((node) => [node.mesh.id, node.mesh]),
      ).values(),
    ]
      .map((mesh) =>
        [
          mesh.id,
          mesh.indices?.join(',') ?? '',
          getMeshPositionValues(mesh.attributes)?.join(',') ?? '',
        ]
          .join('|')
      )
      .join('::'),
  );
const ensurePathtracedAccumulationState = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  sceneKey: string,
): PathtracedAccumulationState => {
  const cached = pathtracedAccumulationStates.get(binding);
  if (
    cached &&
    cached.width === binding.target.width &&
    cached.height === binding.target.height &&
    cached.format === binding.target.format
  ) {
    if (cached.sceneKey !== sceneKey) {
      cached.sceneKey = sceneKey;
      cached.sampleCount = 0;
      cached.frameIndex = 0;
      cached.swap = false;
    }
    return cached;
  }

  const state: PathtracedAccumulationState = {
    width: binding.target.width,
    height: binding.target.height,
    format: binding.target.format,
    sceneKey,
    sampleCount: 0,
    currentSampleTexture: createPathtracedAccumulationTexture(
      context,
      binding,
      'pathtraced-current',
    ),
    accumulationA: createPathtracedAccumulationTexture(context, binding, 'pathtraced-accum-a'),
    accumulationB: createPathtracedAccumulationTexture(context, binding, 'pathtraced-accum-b'),
    frameIndex: 0,
    swap: false,
  };
  pathtracedAccumulationStates.set(binding, state);
  return state;
};

const renderPostProcessPasses = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  postProcessPasses: readonly PostProcessPass[],
  inputView: GPUTextureView,
): number => {
  if (postProcessPasses.length === 0) {
    return 0;
  }

  const sampler = context.device.createSampler({
    label: 'post-process-input-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const intermediateTextures = postProcessPasses.length > 1
    ? [
      createTransientRenderTexture(context, binding, 'post-process-temp-a', binding.target.format),
      createTransientRenderTexture(context, binding, 'post-process-temp-b', binding.target.format),
    ]
    : [];
  const intermediateViews = intermediateTextures.map((texture) => texture.createView());
  let sourceView = inputView;
  let drawCount = 0;

  for (let index = 0; index < postProcessPasses.length; index += 1) {
    const postProcessPass = postProcessPasses[index];
    const isLastPass = index === postProcessPasses.length - 1;
    const pipeline = ensurePostProcessPipeline(
      context,
      residency,
      postProcessPass.program,
      binding.target.format,
      isLastPass ? getRenderTargetMsaaSampleCount(binding) : 1,
    );
    const targetView = isLastPass
      ? acquireColorAttachmentView(context, binding)
      : intermediateViews[index % intermediateViews.length];
    const entries: GPUBindGroupEntry[] = [
      {
        binding: 0,
        resource: sourceView,
      },
      {
        binding: 1,
        resource: sampler,
      },
    ];

    if (postProcessPass.program.usesUniformBuffer) {
      const uniformBytes = postProcessPass.uniformData
        ? toBufferSource(postProcessPass.uniformData)
        : new Uint8Array(0);
      const uniformBuffer = context.device.createBuffer({
        label: `${postProcessPass.id}:post-process-uniforms`,
        size: Math.max(uniformBytes.byteLength, 16),
        usage: uniformUsage | bufferCopyDstUsage,
      });
      if (uniformBytes.byteLength > 0) {
        context.queue.writeBuffer(uniformBuffer, 0, uniformBytes);
      }
      entries.push({
        binding: 2,
        resource: {
          buffer: uniformBuffer,
        },
      });
    }

    const bindGroup = context.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries,
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
    sourceView = targetView;
    drawCount += 1;
  }

  return drawCount;
};

export const renderDeferredFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): DeferredRenderResult => {
  assertRendererSceneCapabilities(
    createDeferredRenderer('deferred', postProcessPasses),
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
  const sceneColorTexture = postProcessPasses.length > 0
    ? createTransientRenderTexture(
      context,
      binding,
      'deferred-scene-color',
      binding.target.format,
      renderAttachmentUsage | textureBindingUsage,
      getRenderTargetMsaaSampleCount(binding),
    )
    : undefined;
  const sceneColorView = sceneColorTexture?.createView();
  const lightingOutputView = sceneColorView ?? acquireColorAttachmentView(context, binding);
  const encoder = context.device.createCommandEncoder({
    label: 'deferred-frame',
  });
  const lightingPipeline = ensureDeferredLightingPipeline(
    context,
    residency,
    binding.target.format,
  );
  const directionalLights = extractDirectionalLightItems(evaluatedScene);
  const viewProjectionMatrix = createViewProjectionMatrix(binding, evaluatedScene.activeCamera);
  const viewMatrix = evaluatedScene.activeCamera?.viewMatrix ?? identityMat4();
  const inverseViewMatrix = evaluatedScene.activeCamera?.worldMatrix ?? identityMat4();
  const cameraPosition = evaluatedScene.activeCamera
    ? getMatrixTranslation(evaluatedScene.activeCamera.worldMatrix)
    : [0, 0, 0] as const;
  const forwardFallbackNodeIds = new Set(
    evaluatedScene.nodes.filter((node) => {
      const material = node.material;
      const mesh = node.mesh;
      if (!material || material.kind !== 'lit' || !mesh) {
        return false;
      }

      const geometry = residency.geometry.get(mesh.id);
      return Boolean(
        geometry &&
          getBaseColorTextureResidency(residency, material) &&
          geometry.attributeBuffers.TEXCOORD_0,
      );
    }).map((node) => node.node.id),
  );

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
  for (const node of evaluatedScene.nodes) {
    const mesh = node.mesh;
    if (!mesh) {
      continue;
    }

    const geometry = residency.geometry.get(mesh.id);
    const positionBuffer = geometry?.attributeBuffers.POSITION;
    if (!geometry || !positionBuffer || forwardFallbackNodeIds.has(node.node.id)) {
      continue;
    }

    const depthPipeline = ensureDeferredDepthPrepassPipeline(context, residency, {
      cullMode: resolveMaterialRenderPolicy(node.material).doubleSided ? 'none' : 'back',
    });
    depthPass.setPipeline(depthPipeline);
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
    if (!geometry || forwardFallbackNodeIds.has(node.node.id)) {
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
      {
        cullMode: resolveMaterialRenderPolicy(material).doubleSided ? 'none' : 'back',
      },
    );
    const materialProgram = gbufferProgram.program;

    let isDrawable = true;
    for (let index = 0; index < materialProgram.vertexAttributes.length; index += 1) {
      const attribute = materialProgram.vertexAttributes[index];
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

    const materialBindings = getMaterialBindingDescriptors(materialProgram);
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
      view: lightingOutputView,
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

  if (forwardFallbackNodeIds.size > 0) {
    const forwardLitPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: lightingOutputView,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });
    drawCount += renderForwardMeshPass(
      context,
      forwardLitPass,
      residency,
      { timeMs: evaluatedScene.timeMs },
      evaluatedScene.nodes.filter((node) => forwardFallbackNodeIds.has(node.node.id)),
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      viewMatrix,
      inverseViewMatrix,
      directionalLights,
      cameraPosition,
      ensureForwardEnvironmentTexture(context, residency),
      {},
      [],
      getRenderTargetMsaaSampleCount(binding),
    );
    forwardLitPass.end();
  }

  if (sceneColorView) {
    drawCount += renderPostProcessPasses(
      context,
      encoder,
      binding,
      residency,
      postProcessPasses,
      sceneColorView,
    );
  }

  const commandBuffer = encoder.finish();
  context.queue.submit([commandBuffer]);

  return {
    drawCount,
    submittedCommandBufferCount: 1,
  };
};

export const renderPathtracedFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistryOrOptions: MaterialRegistry | PathtracedRenderOptions = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): PathtracedRenderResult => {
  const options = resolvePathtracedRenderOptions(materialRegistryOrOptions, postProcessPasses);
  assertRendererSceneCapabilities(
    createPathtracedRenderer('pathtraced', options.postProcessPasses),
    evaluatedScene,
    options.materialRegistry,
    residency,
  );

  const hasMeshScene = evaluatedScene.nodes.some((node) => node.mesh);
  const sdfItems = createPathtracedExtensionSdfPassItems(options.extension);
  const hasSdfScene = sdfItems.length > 0;
  const sceneKey = createPathtracedSceneKey(evaluatedScene, options.extension);
  const meshCacheKey = hasMeshScene ? createPathtracedMeshCacheKey(evaluatedScene) : '';
  const accumulationState = ensurePathtracedAccumulationState(context, binding, sceneKey);
  const currentSampleView = accumulationState.currentSampleTexture.createView();
  const previousAccumulationTexture = accumulationState.swap
    ? accumulationState.accumulationB
    : accumulationState.accumulationA;
  const nextAccumulationTexture = accumulationState.swap
    ? accumulationState.accumulationA
    : accumulationState.accumulationB;
  const previousAccumulationView = previousAccumulationTexture.createView();
  const nextAccumulationView = nextAccumulationTexture.createView();
  const resolvedSceneTexture = options.postProcessPasses.length > 0
    ? createTransientRenderTexture(
      context,
      binding,
      'pathtraced-resolved-scene',
      binding.target.format,
    )
    : undefined;
  const resolvedSceneView = resolvedSceneTexture?.createView();
  const presentPasses = options.postProcessPasses.length > 0 ? options.postProcessPasses : [];
  const encoder = context.device.createCommandEncoder({
    label: 'pathtraced-frame',
  });
  const raymarchCamera = createRaymarchCameraFromEvaluatedCamera(
    binding,
    evaluatedScene.activeCamera,
  );

  let drawCount = 0;
  drawCount += hasMeshScene
    ? renderPathtracedMeshPass(
      context,
      encoder,
      binding,
      residency,
      evaluatedScene,
      meshCacheKey,
      sdfItems,
      currentSampleView,
      pathtracedAccumulationFormat,
      raymarchCamera,
      accumulationState.frameIndex,
    )
    : hasSdfScene
    ? renderPathtracedSdfPass(
      context,
      encoder,
      binding,
      residency,
      sdfItems,
      currentSampleView,
      pathtracedAccumulationFormat,
      raymarchCamera,
      accumulationState.frameIndex,
    )
    : 0;
  drawCount += renderPathtracedAccumulationPass(
    context,
    encoder,
    residency,
    currentSampleView,
    previousAccumulationView,
    nextAccumulationView,
    accumulationState.sampleCount,
  );
  drawCount += renderPathtracedPresentPass(
    context,
    encoder,
    residency,
    binding.target.format,
    nextAccumulationView,
    resolvedSceneView ?? acquireColorAttachmentView(context, binding),
  );
  if (resolvedSceneView) {
    drawCount += renderPostProcessPasses(
      context,
      encoder,
      binding,
      residency,
      presentPasses,
      resolvedSceneView,
    );
  }

  const commandBuffer = encoder.finish();
  context.queue.submit([commandBuffer]);
  accumulationState.frameIndex += 1;
  accumulationState.sampleCount += 1;
  accumulationState.swap = !accumulationState.swap;

  return {
    drawCount,
    submittedCommandBufferCount: 1,
  };
};

export const renderUberFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): UberRenderResult => {
  const partitions = partitionUberMeshNodes(evaluatedScene, residency);
  const deferredNodeIds = new Set(partitions.deferredOpaque.map((node) => node.node.id));
  const forwardNodeIds = new Set(
    [...partitions.forwardOpaque, ...partitions.forwardTransparent].map((node) => node.node.id),
  );
  const deferredScene = {
    ...evaluatedScene,
    nodes: evaluatedScene.nodes.filter((node) => !node.mesh || deferredNodeIds.has(node.node.id)),
  };
  const forwardScene = {
    ...evaluatedScene,
    nodes: evaluatedScene.nodes.filter((node) => !node.mesh || forwardNodeIds.has(node.node.id)),
  };

  assertRendererSceneCapabilities(
    createDeferredRenderer('uber-deferred'),
    deferredScene,
    materialRegistry,
    residency,
  );
  assertRendererSceneCapabilities(
    createForwardRenderer('uber-forward'),
    forwardScene,
    materialRegistry,
    residency,
  );

  const depthTexture = createTransientRenderTexture(
    context,
    binding,
    'uber-depth',
    deferredDepthFormat,
    renderAttachmentUsage | textureBindingUsage,
  );
  const depthView = depthTexture.createView();
  const gbufferAlbedoTexture = createTransientRenderTexture(
    context,
    binding,
    'uber-gbuffer-albedo',
    binding.target.format,
  );
  const gbufferNormalTexture = createTransientRenderTexture(
    context,
    binding,
    'uber-gbuffer-normal',
    binding.target.format,
  );
  const gbufferAlbedoView = gbufferAlbedoTexture.createView();
  const gbufferNormalView = gbufferNormalTexture.createView();
  const sceneColorTexture = postProcessPasses.length > 0
    ? createTransientRenderTexture(
      context,
      binding,
      'uber-scene-color',
      binding.target.format,
      renderAttachmentUsage | textureBindingUsage,
      getRenderTargetMsaaSampleCount(binding),
    )
    : undefined;
  const sceneColorView = sceneColorTexture?.createView();
  const lightingOutputView = sceneColorView ?? acquireColorAttachmentView(context, binding);
  const encoder = context.device.createCommandEncoder({
    label: 'uber-frame',
  });
  const lightingPipeline = ensureDeferredLightingPipeline(
    context,
    residency,
    binding.target.format,
  );
  const directionalLights = extractDirectionalLightItems(evaluatedScene);
  const viewProjectionMatrix = createViewProjectionMatrix(binding, evaluatedScene.activeCamera);
  const viewMatrix = evaluatedScene.activeCamera?.viewMatrix ?? identityMat4();
  const inverseViewMatrix = evaluatedScene.activeCamera?.worldMatrix ?? identityMat4();
  const cameraPosition = evaluatedScene.activeCamera
    ? getMatrixTranslation(evaluatedScene.activeCamera.worldMatrix)
    : [0, 0, 0] as const;
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
  for (const node of partitions.deferredOpaque) {
    const mesh = node.mesh;
    if (!mesh) {
      continue;
    }

    const geometry = residency.geometry.get(mesh.id);
    const positionBuffer = geometry?.attributeBuffers.POSITION;
    if (!geometry || !positionBuffer) {
      continue;
    }

    const depthPipeline = ensureDeferredDepthPrepassPipeline(context, residency, {
      cullMode: resolveMaterialRenderPolicy(node.material).doubleSided ? 'none' : 'back',
    });
    depthPass.setPipeline(depthPipeline);
    depthPass.setVertexBuffer(0, positionBuffer);
    const transformData = createWorldTransformUniformData(node.worldMatrix);
    const transformBuffer = context.device.createBuffer({
      label: `${node.node.id}:uber-depth-transform`,
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
  for (const node of partitions.deferredOpaque) {
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
      {
        cullMode: resolveMaterialRenderPolicy(material).doubleSided ? 'none' : 'back',
      },
    );
    const materialProgram = gbufferProgram.program;

    let isDrawable = true;
    for (let index = 0; index < materialProgram.vertexAttributes.length; index += 1) {
      const attribute = materialProgram.vertexAttributes[index];
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
      label: `${node.node.id}:uber-gbuffer-transform`,
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

    const materialBindings = getMaterialBindingDescriptors(materialProgram);
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
      view: lightingOutputView,
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
    label: 'uber-lighting',
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

  if (partitions.forwardOpaque.length > 0) {
    const forwardOpaquePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: lightingOutputView,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });
    drawCount += renderForwardMeshPass(
      context,
      forwardOpaquePass,
      residency,
      { timeMs: evaluatedScene.timeMs },
      partitions.forwardOpaque,
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      viewMatrix,
      inverseViewMatrix,
      directionalLights,
      cameraPosition,
      ensureForwardEnvironmentTexture(context, residency),
      {},
      [],
      getRenderTargetMsaaSampleCount(binding),
      'opaque',
    );
    forwardOpaquePass.end();
  }

  if (partitions.forwardTransparent.length > 0) {
    const forwardTransparentPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: lightingOutputView,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });
    drawCount += renderForwardMeshPass(
      context,
      forwardTransparentPass,
      residency,
      { timeMs: evaluatedScene.timeMs },
      partitions.forwardTransparent,
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      viewMatrix,
      inverseViewMatrix,
      directionalLights,
      cameraPosition,
      ensureForwardEnvironmentTexture(context, residency),
      {},
      [],
      getRenderTargetMsaaSampleCount(binding),
      'transparent',
    );
    forwardTransparentPass.end();
  }

  if (sceneColorView) {
    drawCount += renderPostProcessPasses(
      context,
      encoder,
      binding,
      residency,
      postProcessPasses,
      sceneColorView,
    );
  }

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
      view: acquireColorAttachmentView(context, binding),
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
  const pickBinding = createOffscreenBinding({
    device: context.device as GPUDevice,
    target: {
      kind: 'offscreen',
      width: binding.target.width,
      height: binding.target.height,
      format: nodePickTargetFormat,
      msaaSampleCount: 1,
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
  postProcessPasses: readonly PostProcessPass[] = [],
): Promise<ForwardSnapshotResult> => {
  const frame = renderForwardFrame(
    context,
    binding,
    residency,
    { timeMs: evaluatedScene.timeMs },
    evaluatedScene,
    materialRegistry,
    postProcessPasses,
  );
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
  postProcessPasses: readonly PostProcessPass[] = [],
): Promise<DeferredSnapshotResult> => {
  const frame = renderDeferredFrame(
    context,
    binding,
    residency,
    evaluatedScene,
    materialRegistry,
    postProcessPasses,
  );
  const snapshot = await readOffscreenSnapshot(context, binding);

  return {
    ...frame,
    width: snapshot.width,
    height: snapshot.height,
    bytes: snapshot.bytes,
  };
};

export const renderPathtracedSnapshot = async (
  context: GpuRenderExecutionContext & GpuReadbackContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistryOrOptions: MaterialRegistry | PathtracedRenderOptions = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): Promise<PathtracedSnapshotResult> => {
  const frame = renderPathtracedFrame(
    context,
    binding,
    residency,
    evaluatedScene,
    materialRegistryOrOptions,
    postProcessPasses,
  );
  const snapshot = await readOffscreenSnapshot(context, binding);

  return {
    ...frame,
    width: snapshot.width,
    height: snapshot.height,
    bytes: snapshot.bytes,
  };
};

export const renderUberSnapshot = async (
  context: GpuRenderExecutionContext & GpuReadbackContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): Promise<UberSnapshotResult> => {
  const frame = renderUberFrame(
    context,
    binding,
    residency,
    evaluatedScene,
    materialRegistry,
    postProcessPasses,
  );
  const snapshot = await readOffscreenSnapshot(context, binding);

  return {
    ...frame,
    width: snapshot.width,
    height: snapshot.height,
    bytes: snapshot.bytes,
  };
};

export const renderForwardCubemapSnapshot = async (
  context: GpuRenderExecutionContext & GpuReadbackContext,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  options: CubemapCaptureOptions,
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): Promise<CubemapSnapshotResult> => {
  const size = assertPositiveInteger('size', options.size);
  const format = assertCubemapCaptureFormat(options.format ?? defaultCubemapFormat);
  const origin = options.position ??
    (evaluatedScene.activeCamera
      ? getMatrixTranslation(evaluatedScene.activeCamera.worldMatrix)
      : [0, 0, 0] as const);
  const cubemapCamera: EvaluatedCamera['camera'] & { type: 'perspective' } = {
    id: 'cubemap-capture-camera',
    type: 'perspective',
    yfov: Math.PI / 2,
    znear: options.znear ?? evaluatedScene.activeCamera?.camera.znear ?? defaultCubemapZnear,
    zfar: options.zfar ?? evaluatedScene.activeCamera?.camera.zfar ?? defaultCubemapZfar,
  };
  const projectionMatrix = createPerspectiveProjection(cubemapCamera, 1);
  const faces: CubemapFaceSnapshotResult[] = [];
  let drawCount = 0;
  let submittedCommandBufferCount = 0;

  for (const descriptor of cubemapFaceDescriptors) {
    const binding = createOffscreenBinding({
      device: context.device as GPUDevice,
      target: {
        kind: 'offscreen',
        width: size,
        height: size,
        format,
        msaaSampleCount: 1,
      },
    });
    const target = [
      origin[0] + descriptor.direction[0],
      origin[1] + descriptor.direction[1],
      origin[2] + descriptor.direction[2],
    ] as const;
    const viewMatrix = createLookAtViewMatrix(origin, target, descriptor.up);
    const raymarchCamera = createRaymarchCamera(origin, descriptor.direction, descriptor.up);
    const frame = renderForwardFrameInternal(
      context,
      binding,
      residency,
      { timeMs: evaluatedScene.timeMs },
      evaluatedScene,
      materialRegistry,
      postProcessPasses,
      {
        viewProjectionMatrix: multiplyMat4(projectionMatrix, viewMatrix),
        viewMatrix,
        raymarchCamera,
      },
    );
    const snapshot = await readOffscreenSnapshot(context, binding);
    faces.push({
      face: descriptor.face,
      width: snapshot.width,
      height: snapshot.height,
      bytes: snapshot.bytes,
      viewMatrix,
      projectionMatrix,
    });
    drawCount += frame.drawCount;
    submittedCommandBufferCount += frame.submittedCommandBufferCount;
  }

  return {
    drawCount,
    submittedCommandBufferCount,
    size,
    faces,
  };
};

const exportCubemapStrip = (
  snapshot: CubemapSnapshotResult,
  dimensions: CubemapExportDimensions,
  sampling: CubemapExportSampling,
): CubemapExportResult => {
  const lookup = createCubemapFaceLookup(snapshot);
  const faceSize = dimensions.faceSize ?? snapshot.size;
  const width = dimensions.width;
  const height = dimensions.height;
  const bytes = createRgbaBuffer(width, height);

  lookup.orderedFaces.forEach((face, index) => {
    blitCubemapFace(face, bytes, width, height, index * faceSize, 0, faceSize, sampling);
  });

  return {
    layout: 'strip',
    width,
    height,
    bytes,
  };
};

const exportCubemapCross = (
  snapshot: CubemapSnapshotResult,
  dimensions: CubemapExportDimensions,
  sampling: CubemapExportSampling,
): CubemapExportResult => {
  const lookup = createCubemapFaceLookup(snapshot);
  const faceSize = dimensions.faceSize ?? snapshot.size;
  const width = dimensions.width;
  const height = dimensions.height;
  const bytes = createRgbaBuffer(width, height);

  blitCubemapFace(
    lookup.faceMap.get('negative-y')!,
    bytes,
    width,
    height,
    faceSize,
    0,
    faceSize,
    sampling,
  );
  blitCubemapFace(
    lookup.faceMap.get('negative-x')!,
    bytes,
    width,
    height,
    0,
    faceSize,
    faceSize,
    sampling,
  );
  blitCubemapFace(
    lookup.faceMap.get('positive-z')!,
    bytes,
    width,
    height,
    faceSize,
    faceSize,
    faceSize,
    sampling,
  );
  blitCubemapFace(
    lookup.faceMap.get('positive-x')!,
    bytes,
    width,
    height,
    faceSize * 2,
    faceSize,
    faceSize,
    sampling,
  );
  blitCubemapFace(
    lookup.faceMap.get('negative-z')!,
    bytes,
    width,
    height,
    faceSize * 3,
    faceSize,
    faceSize,
    sampling,
  );
  blitCubemapFace(
    lookup.faceMap.get('positive-y')!,
    bytes,
    width,
    height,
    faceSize,
    faceSize * 2,
    faceSize,
    sampling,
  );

  return {
    layout: 'cross',
    width,
    height,
    bytes,
  };
};

const exportCubemapEquirectangular = (
  snapshot: CubemapSnapshotResult,
  dimensions: CubemapExportDimensions,
  sampling: CubemapExportSampling,
): CubemapExportResult => {
  const lookup = createCubemapFaceLookup(snapshot);
  const width = dimensions.width;
  const height = dimensions.height;
  const bytes = createRgbaBuffer(width, height);

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const latitude = (0.5 - v) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const sinLatitude = Math.sin(latitude);

    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const longitude = (u * Math.PI * 2) - Math.PI;
      const direction: readonly [number, number, number] = [
        cosLatitude * Math.sin(longitude),
        sinLatitude,
        cosLatitude * Math.cos(longitude),
      ];
      writeRgbaPixel(bytes, width, x, y, sampleCubemapDirection(lookup, direction, sampling));
    }
  }

  return {
    layout: 'equirectangular',
    width,
    height,
    bytes,
  };
};

const exportCubemapAngular = (
  snapshot: CubemapSnapshotResult,
  dimensions: CubemapExportDimensions,
  sampling: CubemapExportSampling,
): CubemapExportResult => {
  const lookup = createCubemapFaceLookup(snapshot);
  const width = dimensions.width;
  const height = dimensions.height;
  const bytes = createRgbaBuffer(width, height);

  for (let y = 0; y < height; y += 1) {
    const normalizedY = 1 - (((y + 0.5) / height) * 2);

    for (let x = 0; x < width; x += 1) {
      const normalizedX = (((x + 0.5) / width) * 2) - 1;
      const radius = Math.hypot(normalizedX, normalizedY);

      if (radius > 1) {
        continue;
      }

      const azimuth = Math.atan2(normalizedY, normalizedX);
      const polar = radius * Math.PI;
      const sinPolar = Math.sin(polar);
      const direction: readonly [number, number, number] = [
        sinPolar * Math.cos(azimuth),
        sinPolar * Math.sin(azimuth),
        Math.cos(polar),
      ];
      writeRgbaPixel(bytes, width, x, y, sampleCubemapDirection(lookup, direction, sampling));
    }
  }

  return {
    layout: 'angular',
    width,
    height,
    bytes,
  };
};

export const exportCubemapSnapshot = (
  snapshot: CubemapSnapshotResult,
  options: CubemapExportOptions,
): CubemapExportResult => {
  const dimensions = resolveCubemapExportDimensions(snapshot, options);
  const sampling = options.sampling ?? 'nearest';

  switch (options.layout) {
    case 'strip':
      return exportCubemapStrip(snapshot, dimensions, sampling);
    case 'cross':
      return exportCubemapCross(snapshot, dimensions, sampling);
    case 'equirectangular':
      return exportCubemapEquirectangular(snapshot, dimensions, sampling);
    case 'angular':
      return exportCubemapAngular(snapshot, dimensions, sampling);
  }
};
