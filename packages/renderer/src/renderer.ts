import type { EvaluatedCamera, EvaluatedScene } from '@rieul3d/core';
import type { Material } from '@rieul3d/ir';
import { buildBvh, type BvhNode, type RaytraceTriangle } from '@rieul3d/raytrace';
import {
  acquireColorAttachmentView,
  acquireDepthAttachmentView,
  createOffscreenBinding,
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
import builtInSdfRaymarchShader from './shaders/built_in_sdf_raymarch.wgsl' with { type: 'text' };
import builtInVolumeRaymarchShader from './shaders/built_in_volume_raymarch.wgsl' with {
  type: 'text',
};
import builtInNodePickShader from './shaders/built_in_node_pick.wgsl' with { type: 'text' };
import builtInPostProcessBlitShader from './shaders/built_in_post_process_blit.wgsl' with {
  type: 'text',
};

export type RendererKind = 'forward' | 'deferred' | 'pathtraced' | 'uber';
export type PassKind =
  | 'depth-prepass'
  | 'gbuffer'
  | 'lighting'
  | 'mesh'
  | 'pathtrace'
  | 'post-process'
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
  localToWorld: readonly number[];
  worldToLocal: readonly number[];
  albedo: readonly [number, number, number];
  emission: number;
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
  materialBindings?: readonly MaterialBindingDescriptor[];
}>;

export type MaterialBindingDescriptor = Readonly<
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

export type MaterialRegistry = Readonly<{
  programs: Map<string, MaterialProgram>;
}>;

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
const builtInTexturedLitProgramId = 'built-in:lit-textured';
const builtInDeferredDepthPrepassProgramId = 'built-in:deferred-depth-prepass';
const builtInDeferredGbufferUnlitProgramId = 'built-in:deferred-gbuffer-unlit';
const builtInDeferredGbufferTexturedUnlitProgramId = 'built-in:deferred-gbuffer-unlit-textured';
const builtInDeferredGbufferLitProgramId = 'built-in:deferred-gbuffer-lit';
const builtInDeferredLightingProgramId = 'built-in:deferred-lighting';
const builtInPathtracedAccumulateProgramId = 'built-in:pathtraced-accumulate';
const builtInPathtracedMeshProgramId = 'built-in:pathtraced-mesh';
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
const deferredDepthFormat = 'depth24plus';
const maxSdfPassItems = 16;
const depthTextureFormat = 'depth24plus';
const maxDirectionalLights = 4;
const defaultAmbientLight = 0.2;
const defaultCubemapFormat = 'rgba8unorm';
const defaultCubemapZnear = 0.1;
const defaultCubemapZfar = 100;
const pathtracedAccumulationStates = new WeakMap<
  RenderContextBinding,
  PathtracedAccumulationState
>();
const pathtracedMeshSceneStates = new WeakMap<RenderContextBinding, PathtracedMeshSceneState>();
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

const builtInTexturedLitProgram: MaterialProgram = {
  id: builtInTexturedLitProgramId,
  label: 'Built-in Lit (Textured)',
  wgsl: builtInForwardTexturedLitShader,
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
  ]),
});

export type ResolveMaterialProgramOptions = Readonly<{
  preferTexturedUnlit?: boolean;
  preferTexturedLit?: boolean;
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
    if (options.preferTexturedLit) {
      return registry.programs.get(builtInTexturedLitProgramId) ?? builtInTexturedLitProgram;
    }
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
    sdf: 'supported',
    volume: 'supported',
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
    {
      id: 'raymarch',
      kind: 'raymarch',
      reads: ['scene', 'depth'],
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

export const createDeferredRenderer = (
  label = 'deferred',
  postProcessPasses: readonly PostProcessPass[] = [],
): Renderer => ({
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
    {
      id: 'lighting',
      kind: 'lighting',
      reads: ['gbuffer', 'depth'],
      writes: [postProcessPasses.length > 0 ? 'scene-color' : 'color'],
    },
    {
      id: 'raymarch',
      kind: 'raymarch',
      reads: ['scene', postProcessPasses.length > 0 ? 'scene-color' : 'color'],
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
    sdf: 'supported',
    volume: 'unsupported',
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
    sdf: 'supported',
    volume: 'supported',
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
    {
      id: 'raymarch',
      kind: 'raymarch',
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
    sdfNodeCount: counts.sdfNodeCount,
    volumeNodeCount: counts.volumeNodeCount,
    passes: renderer.passes.filter((pass) => {
      if (pass.kind === 'raymarch') {
        return counts.sdfNodeCount > 0 || counts.volumeNodeCount > 0;
      }

      if (pass.kind === 'pathtrace') {
        return counts.sdfNodeCount > 0;
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

      const unsupportedLitTexture = materialTextures.find((texture) =>
        texture.semantic !== 'baseColor'
      );
      if (unsupportedLitTexture) {
        pushIssue(
          'material-binding',
          `texture-semantic:${unsupportedLitTexture.semantic}`,
          `renderer "${renderer.label}" does not support "${unsupportedLitTexture.semantic}" textures on built-in lit material "${material.id}"`,
        );
      }

      if (node.mesh && !node.mesh.attributes.some((attribute) => attribute.semantic === 'NORMAL')) {
        pushIssue(
          'material-binding',
          'vertex-attribute:NORMAL',
          `renderer "${renderer.label}" cannot light node "${node.node.id}" because mesh "${node.mesh.id}" is missing NORMAL`,
        );
      }

      const baseColorTexture = materialTextures.find((texture) => texture.semantic === 'baseColor');
      if (baseColorTexture) {
        if (node.mesh && !hasTexcoord0) {
          pushIssue(
            'material-binding',
            'vertex-attribute:TEXCOORD_0',
            `renderer "${renderer.label}" cannot sample baseColor textures on lit node "${node.node.id}" because mesh "${node.mesh.id}" is missing TEXCOORD_0`,
          );
        } else if (residency && !residency.textures.get(baseColorTexture.id)) {
          pushIssue(
            'material-binding',
            'texture-residency:baseColor:texture',
            `renderer "${renderer.label}" cannot sample baseColor textures for material "${material.id}" because texture "${baseColorTexture.id}" is not resident`,
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

const assertPositiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`"${name}" must be a positive integer`);
  }

  return value;
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

const getMeshPositionValues = (
  attributes: readonly { semantic: string; values: readonly number[] }[],
) => attributes.find((attribute) => attribute.semantic === 'POSITION')?.values;

const getMeshNormalValues = (
  attributes: readonly { semantic: string; values: readonly number[] }[],
) => attributes.find((attribute) => attribute.semantic === 'NORMAL')?.values;

const createPathtracedMeshTriangles = (
  attributes: readonly { semantic: string; values: readonly number[] }[],
  indices: readonly number[] | undefined,
): readonly PathtracedMeshTriangle[] => {
  const positions = getMeshPositionValues(attributes);
  const normals = getMeshNormalValues(attributes);
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
  program.id === builtInLitProgramId || program.id === builtInTexturedLitProgramId;

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
): MaterialPipelineOptions => {
  const policy = resolveMaterialRenderPolicy(material);
  return {
    blend: passKind === 'transparent' ? alphaBlendState : undefined,
    depthWriteEnabled: passKind === 'transparent' ? policy.depthWrite : true,
    cullMode: policy.doubleSided ? 'none' : 'back',
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
  nodes: readonly EvaluatedScene['nodes'][number][],
  materialRegistry: MaterialRegistry,
  format: GPUTextureFormat,
  viewProjectionMatrix: readonly number[],
  directionalLights: readonly DirectionalLightItem[],
  passKind: 'opaque' | 'transparent' = 'opaque',
): number => {
  let drawCount = 0;

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
    const resolvedProgram = resolveMaterialProgram(materialRegistry, node.material);
    const programOptions = prefersTexturedMaterialProgram(
      resolvedProgram,
      material,
      geometry,
      residency,
    );
    const program = Object.keys(programOptions).length > 0
      ? resolveMaterialProgram(materialRegistry, node.material, programOptions)
      : resolvedProgram;
    const pipeline = ensureMaterialPipeline(
      context,
      residency,
      program,
      format,
      createMaterialPipelineOptions(material, passKind),
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

  return drawCount;
};

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
  options: MaterialPipelineOptions = {},
): GPURenderPipeline => {
  const cullMode = options.cullMode === 'none' ? 'none' : options.cullMode ?? 'back';
  const cacheKey = `${builtInDeferredDepthPrepassProgramId}:${deferredDepthFormat}:${cullMode}`;
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
  program: MaterialProgram = builtInDeferredGbufferUnlitProgram,
  options: MaterialPipelineOptions = {},
): GPURenderPipeline => {
  const cullMode = options.cullMode === 'none' ? 'none' : options.cullMode ?? 'back';
  const cacheKey = `${program.id}:${format}:${cullMode}`;
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
  options: MaterialPipelineOptions = {},
): GPURenderPipeline => {
  const blendKey = options.blend ? 'alpha-blend' : 'opaque';
  const depthWriteEnabled = options.depthWriteEnabled ?? true;
  const cullMode = options.cullMode === 'none' ? 'none' : options.cullMode ?? 'back';
  const cacheKey = `${program.id}:${format}:${blendKey}:${
    depthWriteEnabled ? 'depth' : 'nodepth'
  }:${cullMode}`;
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

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInPathtracedSdfShader,
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

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInPathtracedMeshShader,
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

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: builtInPathtracedAccumulateShader,
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

  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: program.wgsl,
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

const createVolumeUniformData = (
  item: VolumePassItem,
  camera: RaymarchCamera = defaultRaymarchCamera,
): Float32Array =>
  Float32Array.from([
    ...invertAffineMatrix(item.worldMatrix),
    ...camera.origin,
    0,
    ...camera.right,
    0,
    ...camera.up,
    0,
    ...camera.forward,
    camera.projection === 'orthographic' ? 1 : 0,
  ]);

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
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  targetView = acquireColorAttachmentView(context, binding),
  targetFormat = binding.target.format,
  camera: RaymarchCamera = defaultRaymarchCamera,
): number => {
  const items = extractSdfPassItems(evaluatedScene);
  if (items.length === 0) {
    return 0;
  }

  const pipeline = ensureSdfRaymarchPipeline(context, residency, targetFormat);
  const uniformData = createSdfUniformData(items, camera);
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
      view: targetView,
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

export const renderPathtracedSdfPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  targetView = acquireColorAttachmentView(context, binding),
  targetFormat = binding.target.format,
  camera: RaymarchCamera = defaultRaymarchCamera,
  frameIndex = 0,
): number => {
  const items = extractSdfPassItems(evaluatedScene);
  if (items.length === 0) {
    return 0;
  }

  const pipeline = ensurePathtracedSdfPipeline(context, residency, targetFormat);
  const uniformData = createSdfUniformData(items, camera, frameIndex);
  const uniformBuffer = context.device.createBuffer({
    label: 'pathtraced-sdf-uniforms',
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
  const data = new Float32Array(triangleIndices.length * 24);

  triangleIndices.forEach((triangleIndex, outputIndex) => {
    const triangle = triangles[triangleIndex];
    const baseIndex = outputIndex * 24;
    data.set([...triangle.a, 1], baseIndex);
    data.set([...triangle.b, 1], baseIndex + 4);
    data.set([...triangle.c, 1], baseIndex + 8);
    data.set([...triangle.na, 0], baseIndex + 12);
    data.set([...triangle.nb, 0], baseIndex + 16);
    data.set([...triangle.nc, 0], baseIndex + 20);
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
    return [{
      rootNodeIndex: asset.rootNodeIndex,
      localToWorld: node.worldMatrix,
      worldToLocal: invertAffineMatrix(node.worldMatrix),
      albedo: [color.x, color.y, color.z],
      emission: 0,
    }];
  });

const createPathtracedMeshInstanceBufferData = (
  instances: readonly PathtracedMeshInstance[],
): Float32Array => {
  const data = new Float32Array(instances.length * 40);

  instances.forEach((instance, index) => {
    const baseIndex = index * 40;
    data.set(instance.localToWorld.slice(0, 16), baseIndex);
    data.set(instance.worldToLocal.slice(0, 16), baseIndex + 16);
    data.set([instance.rootNodeIndex, 0, 0, 0], baseIndex + 32);
    data.set([...instance.albedo, instance.emission], baseIndex + 36);
  });

  return data;
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
  const instances = createPathtracedMeshInstances(evaluatedScene, sceneState.meshAssets);
  if (instances.length === 0) {
    return 0;
  }

  const pipeline = ensurePathtracedMeshPipeline(context, residency, targetFormat);
  const uniformData = createPathtracedMeshUniformData(instances.length, camera, frameIndex);
  const sdfItems = extractSdfPassItems(evaluatedScene);
  const sdfUniformData = createSdfUniformData(sdfItems, camera, frameIndex);
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
  const instanceData = createPathtracedMeshInstanceBufferData(instances);
  const instanceBuffer = context.device.createBuffer({
    label: 'pathtraced-mesh-instances',
    size: instanceData.byteLength,
    usage: storageUsage | bufferCopyDstUsage,
  });
  context.queue.writeBuffer(instanceBuffer, 0, toBufferSource(instanceData));

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
  format: GPUTextureFormat,
  currentSampleView: GPUTextureView,
  previousAccumulationView: GPUTextureView,
  targetView: GPUTextureView,
  sampleCount: number,
): number => {
  const pipeline = ensurePathtracedAccumulatePipeline(context, residency, format);
  const sampler = context.device.createSampler({
    label: 'pathtraced-accumulation-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
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

export const renderVolumeRaymarchPass = (
  context: GpuRenderExecutionContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  targetView = acquireColorAttachmentView(context, binding),
  targetFormat = binding.target.format,
  camera: RaymarchCamera = defaultRaymarchCamera,
): number => {
  const items = extractVolumePassItems(evaluatedScene, residency);
  if (items.length === 0) {
    return 0;
  }

  const pipeline = ensureVolumeRaymarchPipeline(context, residency, targetFormat);
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: targetView,
      loadOp: 'load',
      storeOp: 'store',
    }],
  });

  pass.setPipeline(pipeline);
  for (const item of items) {
    const uniformData = createVolumeUniformData(item, camera);
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
  postProcessPasses: readonly PostProcessPass[] = [],
): ForwardRenderResult =>
  renderForwardFrameInternal(
    context,
    binding,
    residency,
    evaluatedScene,
    materialRegistry,
    postProcessPasses,
  );

const renderForwardFrameInternal = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
  options: Readonly<{
    viewProjectionMatrix?: readonly number[];
    includeRaymarchPasses?: boolean;
    raymarchCamera?: RaymarchCamera;
  }> = {},
): ForwardRenderResult => {
  assertRendererSceneCapabilities(
    createForwardRenderer('forward', postProcessPasses),
    evaluatedScene,
    materialRegistry,
    residency,
  );
  const sceneColorTexture = postProcessPasses.length > 0
    ? createTransientRenderTexture(
      context,
      binding,
      'forward-scene-color',
      binding.target.format,
      renderAttachmentUsage | textureBindingUsage,
      getRenderTargetSampleCount(binding),
    )
    : undefined;
  const sceneColorView = sceneColorTexture?.createView();
  const colorView = sceneColorView ?? acquireColorAttachmentView(context, binding);
  const viewProjectionMatrix = options.viewProjectionMatrix ??
    createViewProjectionMatrix(binding, evaluatedScene.activeCamera);
  const encoder = context.device.createCommandEncoder({
    label: 'forward-frame',
  });
  const forwardOpaqueNodes = evaluatedScene.nodes.filter((node) =>
    node.mesh && resolveMaterialRenderPolicy(node.material).renderQueue === 'opaque'
  );
  const forwardTransparentNodes = evaluatedScene.nodes.filter((node) =>
    node.mesh && resolveMaterialRenderPolicy(node.material).renderQueue === 'transparent'
  );
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: colorView,
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

  const directionalLights = extractDirectionalLightItems(evaluatedScene);
  let drawCount = renderForwardMeshPass(
    context,
    pass,
    residency,
    forwardOpaqueNodes,
    materialRegistry,
    binding.target.format,
    viewProjectionMatrix,
    directionalLights,
    'opaque',
  );

  pass.end();

  if (forwardTransparentNodes.length > 0) {
    const transparentPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
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
      forwardTransparentNodes,
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      directionalLights,
      'transparent',
    );
    transparentPass.end();
  }

  if (options.includeRaymarchPasses !== false) {
    drawCount += renderSdfRaymarchPass(
      context,
      encoder,
      binding,
      residency,
      evaluatedScene,
      colorView,
      binding.target.format,
      options.raymarchCamera,
    );
    drawCount += renderVolumeRaymarchPass(
      context,
      encoder,
      binding,
      residency,
      evaluatedScene,
      colorView,
      binding.target.format,
      options.raymarchCamera,
    );
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

const createTransientRenderTexture = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  label: string,
  format: GPUTextureFormat,
  usage = renderAttachmentUsage | textureBindingUsage,
  sampleCount = 1,
): GPUTexture =>
  context.device.createTexture({
    label,
    size: {
      width: binding.target.width,
      height: binding.target.height,
      depthOrArrayLayers: 1,
    },
    format,
    sampleCount,
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
    format: binding.target.format,
    sampleCount: 1,
    usage: renderAttachmentUsage | textureBindingUsage,
  });

const getRenderTargetSampleCount = (binding: RenderContextBinding): number =>
  'sampleCount' in binding.target ? binding.target.sampleCount : 1;

const createPathtracedSceneKey = (
  evaluatedScene: EvaluatedScene,
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
  const sdfKey = extractSdfPassItems(evaluatedScene)
    .map((item) =>
      [
        item.nodeId,
        item.sdfId,
        item.op,
        item.center.join(','),
        item.radius,
        item.halfExtents.join(','),
        item.color.join(','),
        item.worldToLocalRotation.join(','),
      ].join('|')
    )
    .join('::');
  const meshKey = evaluatedScene.nodes
    .filter((node) => node.mesh)
    .map((node) => [node.node.id, node.worldMatrix.join(',')].join('|'))
    .join('::');

  return hashString(`${cameraKey}::${sdfKey}::${meshKey}`);
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
      isLastPass ? getRenderTargetSampleCount(binding) : 1,
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
      getRenderTargetSampleCount(binding),
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
      evaluatedScene.nodes.filter((node) => forwardFallbackNodeIds.has(node.node.id)),
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      directionalLights,
    );
    forwardLitPass.end();
  }

  drawCount += renderSdfRaymarchPass(
    context,
    encoder,
    binding,
    residency,
    evaluatedScene,
    lightingOutputView,
    binding.target.format,
  );
  drawCount += renderVolumeRaymarchPass(
    context,
    encoder,
    binding,
    residency,
    evaluatedScene,
    lightingOutputView,
    binding.target.format,
  );
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
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): PathtracedRenderResult => {
  assertRendererSceneCapabilities(
    createPathtracedRenderer('pathtraced', postProcessPasses),
    evaluatedScene,
    materialRegistry,
    residency,
  );

  const hasMeshScene = evaluatedScene.nodes.some((node) => node.mesh);
  const sceneKey = createPathtracedSceneKey(evaluatedScene);
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
  const presentPasses = postProcessPasses.length > 0
    ? postProcessPasses
    : [createBlitPostProcessPass()];
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
      currentSampleView,
      binding.target.format,
      raymarchCamera,
      accumulationState.frameIndex,
    )
    : renderPathtracedSdfPass(
      context,
      encoder,
      binding,
      residency,
      evaluatedScene,
      currentSampleView,
      binding.target.format,
      raymarchCamera,
      accumulationState.frameIndex,
    );
  drawCount += renderPathtracedAccumulationPass(
    context,
    encoder,
    residency,
    binding.target.format,
    currentSampleView,
    previousAccumulationView,
    nextAccumulationView,
    accumulationState.sampleCount,
  );
  drawCount += renderPostProcessPasses(
    context,
    encoder,
    binding,
    residency,
    presentPasses,
    nextAccumulationView,
  );

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
      getRenderTargetSampleCount(binding),
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
      partitions.forwardOpaque,
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      directionalLights,
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
      partitions.forwardTransparent,
      materialRegistry,
      binding.target.format,
      viewProjectionMatrix,
      directionalLights,
      'transparent',
    );
    forwardTransparentPass.end();
  }

  drawCount += renderSdfRaymarchPass(
    context,
    encoder,
    binding,
    residency,
    evaluatedScene,
    lightingOutputView,
    binding.target.format,
  );
  drawCount += renderVolumeRaymarchPass(
    context,
    encoder,
    binding,
    residency,
    evaluatedScene,
    lightingOutputView,
    binding.target.format,
  );
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
  postProcessPasses: readonly PostProcessPass[] = [],
): Promise<ForwardSnapshotResult> => {
  const frame = renderForwardFrame(
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
  materialRegistry = createMaterialRegistry(),
  postProcessPasses: readonly PostProcessPass[] = [],
): Promise<PathtracedSnapshotResult> => {
  const frame = renderPathtracedFrame(
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
        sampleCount: 1,
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
      evaluatedScene,
      materialRegistry,
      postProcessPasses,
      {
        viewProjectionMatrix: multiplyMat4(projectionMatrix, viewMatrix),
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
