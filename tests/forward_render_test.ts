import { assertAlmostEquals, assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createOffscreenContext, createRuntimeResidency } from '@rieul3d/gpu';
import {
  appendLight,
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
} from '@rieul3d/ir';
import {
  createBlitPostProcessPass,
  createMaterialRegistry,
  ensureBuiltInForwardPipeline,
  ensureMaterialPipeline,
  type GpuRenderExecutionContext,
  registerWgslMaterial,
  renderDeferredFrame,
  renderForwardFrame,
  resolveMaterialProgram,
} from '@rieul3d/renderer';
import { createHeadlessTarget } from '@rieul3d/platform';

type MockBuffer = Readonly<{ id: number }>;
type MockBindGroup = Readonly<{ id: number }>;
type MockBindGroupEntry = GPUBindGroupEntry;
type MockWriteBufferCall = Readonly<{
  buffer: MockBuffer;
  bytes: Uint8Array;
}>;
type MockPipeline = Readonly<{
  id: number;
  descriptor: GPURenderPipelineDescriptor;
  getBindGroupLayout: (index: number) => GPUBindGroupLayout;
}>;
type MockShader = Readonly<{ code: string }>;
type MockPassAction =
  | Readonly<{ type: 'setPipeline'; pipeline: MockPipeline }>
  | Readonly<{ type: 'setBindGroup'; index: number; bindGroup: MockBindGroup }>
  | Readonly<{ type: 'setVertexBuffer'; slot: number; buffer: MockBuffer }>
  | Readonly<{ type: 'setIndexBuffer'; buffer: MockBuffer; format: GPUIndexFormat }>
  | Readonly<{ type: 'draw'; vertexCount: number }>
  | Readonly<{ type: 'drawIndexed'; indexCount: number }>
  | Readonly<{ type: 'end' }>;

const createDeferredTexturedCustomProgram = () => ({
  id: 'shader:deferred-textured-custom',
  label: 'Deferred Textured Custom',
  wgsl: `
// Deferred Textured Custom
struct MeshTransform {
  world: mat4x4<f32>,
  normal: mat4x4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct FsOut {
  @location(0) albedo: vec4<f32>,
  @location(1) encodedNormal: vec4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var customTexture: texture_2d<f32>;
@group(1) @binding(1) var customSampler: sampler;

@vertex
fn vsMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.world * vec4<f32>(position, 1.0);
  out.normal = normalize((meshTransform.normal * vec4<f32>(normal, 0.0)).xyz);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> FsOut {
  var out: FsOut;
  out.albedo = textureSample(customTexture, customSampler, in.uv);
  out.encodedNormal = vec4<f32>((normalize(in.normal) * 0.5) + vec3<f32>(0.5), 1.0);
  return out;
}
`,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3' as const,
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'NORMAL',
      shaderLocation: 1,
      format: 'float32x3' as const,
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'TEXCOORD_0',
      shaderLocation: 2,
      format: 'float32x2' as const,
      offset: 0,
      arrayStride: 8,
    },
  ],
  usesTransformBindings: true,
  materialBindings: [
    {
      kind: 'texture' as const,
      binding: 0,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'sampler' as const,
      binding: 1,
      textureSemantic: 'baseColor',
    },
  ],
});

const createRenderMocks = () => {
  const pipelines: MockPipeline[] = [];
  const shaders: MockShader[] = [];
  const buffers: MockBuffer[] = [];
  const bindGroups: MockBindGroup[] = [];
  const samplers: Readonly<{ id: number }>[] = [];
  const bindGroupEntries: MockBindGroupEntry[][] = [];
  const writeBufferCalls: MockWriteBufferCall[] = [];
  const submits: unknown[][] = [];
  const passActions: MockPassAction[] = [];
  const renderPassCount = { current: 0 };

  const device = {
    createShaderModule: ({ code }: GPUShaderModuleDescriptor) => {
      const shader = { code };
      shaders.push(shader);
      return shader as unknown as GPUShaderModule;
    },
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      const pipeline: MockPipeline = {
        id: pipelines.length,
        descriptor,
        getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
      };
      pipelines.push(pipeline);
      return pipeline as unknown as GPURenderPipeline;
    },
    createBuffer: () => {
      const buffer = { id: buffers.length };
      buffers.push(buffer);
      return buffer as unknown as GPUBuffer;
    },
    createBindGroup: ({ entries }: GPUBindGroupDescriptor) => {
      const bindGroup = { id: bindGroups.length };
      bindGroups.push(bindGroup);
      bindGroupEntries.push([...entries]);
      return bindGroup as unknown as GPUBindGroup;
    },
    createSampler: () => {
      const sampler = { id: samplers.length };
      samplers.push(sampler);
      return sampler as unknown as GPUSampler;
    },
    createCommandEncoder: () => ({
      beginRenderPass: () => {
        renderPassCount.current += 1;
        return ({
          setPipeline: (pipeline: GPURenderPipeline) => {
            passActions.push({
              type: 'setPipeline',
              pipeline: pipeline as unknown as MockPipeline,
            });
          },
          setBindGroup: (index: number, bindGroup: GPUBindGroup) => {
            passActions.push({
              type: 'setBindGroup',
              index,
              bindGroup: bindGroup as unknown as MockBindGroup,
            });
          },
          setVertexBuffer: (slot: number, buffer: GPUBuffer) => {
            passActions.push({
              type: 'setVertexBuffer',
              slot,
              buffer: buffer as unknown as MockBuffer,
            });
          },
          setIndexBuffer: (buffer: GPUBuffer, format: GPUIndexFormat) => {
            passActions.push({
              type: 'setIndexBuffer',
              buffer: buffer as unknown as MockBuffer,
              format,
            });
          },
          draw: (vertexCount: number) => {
            passActions.push({ type: 'draw', vertexCount });
          },
          drawIndexed: (indexCount: number) => {
            passActions.push({ type: 'drawIndexed', indexCount });
          },
          end: () => {
            passActions.push({ type: 'end' });
          },
        });
      },
      finish: () => ({}) as GPUCommandBuffer,
    }),
    createTexture: () => ({
      createView: () => ({ textureId: 0 } as unknown as GPUTextureView),
    } as GPUTexture),
  };

  const queue = {
    writeBuffer: (buffer: GPUBuffer, _offset: number, data: BufferSource) => {
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data.slice(0))
        : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      writeBufferCalls.push({
        buffer: buffer as unknown as MockBuffer,
        bytes,
      });
    },
    submit: (buffers: readonly GPUCommandBuffer[]) => {
      submits.push([...buffers]);
    },
  };

  return {
    device,
    queue,
    pipelines,
    shaders,
    buffers,
    bindGroups,
    samplers,
    bindGroupEntries,
    writeBufferCalls,
    submits,
    passActions,
    renderPassCount,
  };
};

Deno.test('ensureBuiltInForwardPipeline caches the generated pipeline', () => {
  const runtimeResidency = createRuntimeResidency();
  const mocks = createRenderMocks();

  const first = ensureBuiltInForwardPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    runtimeResidency,
    'rgba8unorm',
  );
  const second = ensureBuiltInForwardPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    runtimeResidency,
    'rgba8unorm',
  );

  assertStrictEquals(first, second);
  assertEquals(mocks.pipelines.length, 1);
  assertEquals(mocks.shaders.length, 1);
});

Deno.test('renderForwardFrame encodes indexed and non-indexed draws from mesh residency', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-indexed',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
    indices: [0, 1, 2],
  });
  scene = appendMesh(scene, {
    id: 'mesh-plain',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, -1, 0, 0, 0, -1, 0] }],
  });
  scene = appendNode(scene, createNode('node-indexed', { meshId: 'mesh-indexed' }));
  scene = appendNode(scene, createNode('node-plain', { meshId: 'mesh-plain' }));

  runtimeResidency.geometry.set('mesh-indexed', {
    meshId: 'mesh-indexed',
    attributeBuffers: { POSITION: { id: 0 } as unknown as GPUBuffer },
    indexBuffer: { id: 1 } as unknown as GPUBuffer,
    vertexCount: 3,
    indexCount: 3,
  });
  runtimeResidency.geometry.set('mesh-plain', {
    meshId: 'mesh-plain',
    attributeBuffers: { POSITION: { id: 2 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 2);
  assertEquals(result.submittedCommandBufferCount, 1);
  assertEquals(mocks.submits.length, 1);
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'drawIndexed').length,
    1,
  );
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'draw').length,
    1,
  );
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'setBindGroup').length,
    4,
  );
  assertEquals(mocks.bindGroupEntries.length, 4);
  assertEquals(
    mocks.writeBufferCalls
      .filter((call) => call.bytes.byteLength === 128)
      .map((call) => Array.from(new Float32Array(call.bytes.buffer.slice(0)))),
    [
      [
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
      ],
      [
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
      ],
    ],
  );
});

Deno.test('renderDeferredFrame encodes depth, gbuffer, and lighting passes for minimal mesh/unlit scenes', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-deferred',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(
    scene,
    createNode('node-deferred', {
      meshId: 'mesh-deferred',
      transform: {
        translation: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 2, y: 3, z: 4 },
      },
    }),
  );

  runtimeResidency.geometry.set('mesh-deferred', {
    meshId: 'mesh-deferred',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderDeferredFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 3);
  assertEquals(result.submittedCommandBufferCount, 1);
  assertEquals(mocks.renderPassCount.current, 3);
  assertEquals(mocks.pipelines.length, 3);
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'draw').length,
    3,
  );
  assertEquals(mocks.bindGroupEntries.length, 5);
  assertEquals(mocks.samplers.length, 1);
  const deferredGbufferPipeline = mocks.pipelines.find((pipeline) =>
    pipeline.descriptor.fragment?.targets?.length === 2
  );
  assertEquals(deferredGbufferPipeline?.descriptor.fragment?.targets?.length, 2);
  const deferredVertexBuffers = deferredGbufferPipeline?.descriptor.vertex?.buffers ?? [];
  assertEquals(deferredVertexBuffers.length, 2);
  assertEquals(
    deferredVertexBuffers.map((buffer) => buffer?.attributes.length ?? 0),
    [1, 1],
  );
  const depthTransformWrite = mocks.writeBufferCalls.find((call) => call.bytes.byteLength === 64);
  const gbufferTransformWrite = mocks.writeBufferCalls.find((call) =>
    call.bytes.byteLength === 128
  );
  assertEquals(
    Array.from(new Float32Array(depthTransformWrite?.bytes.buffer.slice(0) ?? new ArrayBuffer(0))),
    [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1],
  );
  const expectedDeferredTransform = Float32Array.from([
    2,
    0,
    0,
    0,
    0,
    3,
    0,
    0,
    0,
    0,
    4,
    0,
    0,
    0,
    0,
    1,
    0.5,
    0,
    0,
    0,
    0,
    1 / 3,
    0,
    0,
    0,
    0,
    0.25,
    0,
    0,
    0,
    0,
    1,
  ]);
  assertEquals(
    Array.from(
      new Float32Array(gbufferTransformWrite?.bytes.buffer.slice(0) ?? new ArrayBuffer(0)),
    ),
    Array.from(expectedDeferredTransform),
  );
});

Deno.test('renderForwardFrame runs a post-process pass after scene rendering when requested', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-post',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('node-post', { meshId: 'mesh-post' }));

  runtimeResidency.geometry.set('mesh-post', {
    meshId: 'mesh-post',
    attributeBuffers: { POSITION: { id: 0 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
    createMaterialRegistry(),
    [createBlitPostProcessPass()],
  );

  assertEquals(result.drawCount, 2);
  assertEquals(mocks.renderPassCount.current, 2);
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'draw').length,
    2,
  );
  assertEquals(mocks.samplers.length, 1);
});

Deno.test('renderDeferredFrame runs a post-process pass after deferred lighting when requested', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-post',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node-post', { meshId: 'mesh-post' }));

  runtimeResidency.geometry.set('mesh-post', {
    meshId: 'mesh-post',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderDeferredFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
    createMaterialRegistry(),
    [createBlitPostProcessPass()],
  );

  assertEquals(result.drawCount, 4);
  assertEquals(mocks.renderPassCount.current, 4);
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'draw').length,
    4,
  );
  assertEquals(mocks.samplers.length, 2);
});

Deno.test('renderDeferredFrame binds base-color textures for textured deferred unlit materials', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-textured',
    kind: 'unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-textured-deferred',
    materialId: 'material-textured',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(
    scene,
    createNode('node-textured-deferred', { meshId: 'mesh-textured-deferred' }),
  );

  runtimeResidency.geometry.set('mesh-textured-deferred', {
    meshId: 'mesh-textured-deferred',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
      TEXCOORD_0: { id: 2 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });
  runtimeResidency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: { id: 0 } as unknown as GPUTexture,
    view: { id: 0 } as unknown as GPUTextureView,
    sampler: { id: 0 } as unknown as GPUSampler,
    width: 2,
    height: 2,
    format: 'rgba8unorm-srgb',
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderDeferredFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 3);
  assertEquals(mocks.pipelines.length, 3);
  const deferredGbufferPipeline = mocks.pipelines.find((pipeline) =>
    pipeline.descriptor.fragment?.targets?.length === 2
  );
  assertEquals(deferredGbufferPipeline?.descriptor.fragment?.targets?.length, 2);
  const deferredVertexBuffers = deferredGbufferPipeline?.descriptor.vertex?.buffers ?? [];
  assertEquals(deferredVertexBuffers.length, 3);
  assertEquals(
    deferredVertexBuffers.map((buffer) => buffer?.attributes[0]?.shaderLocation ?? -1),
    [0, 1, 2],
  );
  assertEquals(mocks.bindGroupEntries.length, 5);
  assertEquals(mocks.bindGroupEntries[2].map((entry) => entry.binding), [0, 1, 2]);
  assertEquals(mocks.bindGroupEntries[4].map((entry) => entry.binding), [0]);
});

Deno.test('renderDeferredFrame uses registered custom WGSL gbuffer programs', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  const registry = createMaterialRegistry();
  registerWgslMaterial(registry, createDeferredTexturedCustomProgram());
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:deferred-textured-custom',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-custom-deferred',
    materialId: 'material-custom',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node-custom-deferred', { meshId: 'mesh-custom-deferred' }));

  runtimeResidency.geometry.set('mesh-custom-deferred', {
    meshId: 'mesh-custom-deferred',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
      TEXCOORD_0: { id: 2 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });
  runtimeResidency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: { id: 0 } as unknown as GPUTexture,
    view: { id: 1 } as unknown as GPUTextureView,
    sampler: { id: 2 } as unknown as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderDeferredFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
    registry,
  );

  assertEquals(result.drawCount, 3);
  assertEquals(
    mocks.shaders.some((shader) => shader.code.includes('Deferred Textured Custom')),
    true,
  );
  const deferredGbufferPipeline = mocks.pipelines.find((pipeline) =>
    pipeline.descriptor.fragment?.targets?.length === 2 &&
    (pipeline.descriptor.vertex?.buffers?.length ?? 0) === 3
  );
  assertEquals(deferredGbufferPipeline?.descriptor.fragment?.targets?.length, 2);
  assertEquals(mocks.bindGroupEntries[2].map((entry) => entry.binding), [0, 1]);
  assertEquals(mocks.bindGroupEntries[4].map((entry) => entry.binding), [0]);
});

Deno.test('renderDeferredFrame binds scene lighting uniforms for built-in lit materials', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendLight(scene, {
    id: 'light-directional',
    kind: 'directional',
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  });
  scene = appendMaterial(scene, {
    id: 'material-lit',
    kind: 'lit',
    textures: [],
    parameters: {
      color: { x: 0.7, y: 0.5, z: 0.3, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-lit-deferred',
    materialId: 'material-lit',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('light-node', { lightId: 'light-directional' }));
  scene = appendNode(scene, createNode('mesh-lit-node', { meshId: 'mesh-lit-deferred' }));

  runtimeResidency.geometry.set('mesh-lit-deferred', {
    meshId: 'mesh-lit-deferred',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderDeferredFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 3);
  assertEquals(mocks.bindGroupEntries.length, 5);
  assertEquals(mocks.bindGroupEntries[4].map((entry) => entry.binding), [0]);
  const lightingWrite = mocks.writeBufferCalls.find((call) => call.bytes.byteLength === 144);
  assertEquals(Boolean(lightingWrite), true);
  assertEquals(
    Array.from(new Float32Array(lightingWrite?.bytes.buffer.slice(0, 16) ?? new ArrayBuffer(0))),
    [0, 0, -1, 0],
  );
  const lightingColor = Array.from(
    new Float32Array(
      lightingWrite?.bytes.buffer.slice(64, 80) ?? new ArrayBuffer(0),
    ),
  );
  assertAlmostEquals(lightingColor[0], 1, 1e-6);
  assertAlmostEquals(lightingColor[1], 0.95, 1e-6);
  assertAlmostEquals(lightingColor[2], 0.9, 1e-6);
  assertAlmostEquals(lightingColor[3], 1.5, 1e-6);
});

Deno.test('renderForwardFrame encodes a dedicated sdf raymarch pass for supported sphere and box nodes', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [
      {
        id: 'sdf-sphere',
        op: 'sphere',
        parameters: {
          radius: { x: 0.75, y: 0, z: 0, w: 0 },
        },
      },
      {
        id: 'sdf-box',
        op: 'box',
        parameters: {
          size: { x: 0.3, y: 0.4, z: 0.5, w: 0 },
        },
      },
    ],
  };
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-sphere' }));
  scene = appendNode(
    scene,
    createNode('box-node', {
      sdfId: 'sdf-box',
      transform: {
        translation: { x: 0.5, y: 0.25, z: -0.5 },
        rotation: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
        scale: { x: 2, y: 1.5, z: 1 },
      },
    }),
  );

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 1);
  assertEquals(result.submittedCommandBufferCount, 1);
  assertEquals(mocks.renderPassCount.current, 2);
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'draw').length,
    1,
  );
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'setBindGroup').length,
    1,
  );
});

Deno.test('renderForwardFrame keeps rotated volume nodes in local raymarch space', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(
    scene,
    createNode('volume-node', {
      volumeId: 'volume-0',
      transform: {
        translation: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
        scale: { x: 2, y: 4, z: 6 },
      },
    }),
  );

  runtimeResidency.volumes.set('volume-0', {
    volumeId: 'volume-0',
    texture: {} as GPUTexture,
    view: { textureId: 0 } as unknown as GPUTextureView,
    sampler: { id: 0 } as unknown as GPUSampler,
    width: 4,
    height: 4,
    depth: 4,
    format: 'r8unorm',
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 1);
  assertEquals(result.submittedCommandBufferCount, 1);
  assertEquals(mocks.renderPassCount.current, 2);
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'draw').length,
    1,
  );
  assertEquals(mocks.bindGroupEntries.length, 1);
  assertEquals(mocks.bindGroupEntries[0].map((entry) => entry.binding), [0, 1, 2]);
  const volumeUniformData = mocks.writeBufferCalls
    .filter((call) => call.bytes.byteLength === 64)
    .map((call) => new Float32Array(call.bytes.buffer.slice(0)));
  assertEquals(volumeUniformData.length, 1);
  const expected = [
    0,
    -0.25,
    0,
    0,
    0.5,
    0,
    0,
    0,
    0,
    0,
    1 / 6,
    0,
    -1,
    0.25,
    -0.5,
    1,
  ];
  volumeUniformData[0].forEach((value, index) => {
    assertAlmostEquals(value, expected[index], 1e-5);
  });
});

Deno.test('material registry resolves built-in and custom WGSL programs', () => {
  const registry = createMaterialRegistry();
  const customProgram = {
    id: 'shader:flat-red',
    label: 'Flat Red',
    wgsl: `
struct VsOut {
  @builtin(position) position: vec4<f32>,
};

struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`,
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
    usesTransformBindings: true,
    vertexAttributes: [{
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3' as GPUVertexFormat,
      offset: 0,
      arrayStride: 12,
    }],
  };

  registerWgslMaterial(registry, customProgram);

  assertEquals(resolveMaterialProgram(registry).id, 'built-in:unlit');
  assertEquals(
    resolveMaterialProgram(registry, {
      id: 'material-lit',
      kind: 'lit',
      textures: [],
      parameters: {},
    }).id,
    'built-in:lit',
  );
  assertEquals(
    resolveMaterialProgram(
      registry,
      {
        id: 'material-textured',
        kind: 'unlit',
        textures: [{
          id: 'texture-0',
          assetId: 'image-0',
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'linear-repeat',
        }],
        parameters: {},
      },
      { preferTexturedUnlit: true },
    ).id,
    'built-in:unlit-textured',
  );
  assertEquals(
    resolveMaterialProgram(registry, {
      id: 'material-custom',
      kind: 'custom',
      shaderId: 'shader:flat-red',
      textures: [],
      parameters: {},
    }).id,
    'shader:flat-red',
  );
});

Deno.test('ensureMaterialPipeline caches custom WGSL pipelines and renderForwardFrame uses them', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  const registry = createMaterialRegistry();
  const customProgram = {
    id: 'shader:flat-red',
    label: 'Flat Red',
    wgsl: `
struct VsOut {
  @builtin(position) position: vec4<f32>,
};

struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`,
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
    usesTransformBindings: true,
    vertexAttributes: [{
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3' as GPUVertexFormat,
      offset: 0,
      arrayStride: 12,
    }],
  };
  registerWgslMaterial(registry, customProgram);

  const first = ensureMaterialPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    runtimeResidency,
    customProgram,
    'rgba8unorm',
  );
  const second = ensureMaterialPipeline(
    mocks as unknown as GpuRenderExecutionContext,
    runtimeResidency,
    customProgram,
    'rgba8unorm',
  );

  assertStrictEquals(first, second);
  assertEquals(mocks.pipelines.length, 1);

  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:flat-red',
    textures: [],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-custom',
    materialId: 'material-custom',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('node-custom', { meshId: 'mesh-custom' }));

  runtimeResidency.geometry.set('mesh-custom', {
    meshId: 'mesh-custom',
    attributeBuffers: { POSITION: { id: 3 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenContext({
      device: mocks.device as unknown as GPUDevice,
      target: createHeadlessTarget(32, 32),
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
    registry,
  );

  assertEquals(mocks.pipelines.length, 1);
  assertEquals(mocks.shaders.length, 1);
  assertEquals(mocks.bindGroupEntries.length, 1);
  assertEquals(mocks.bindGroupEntries[0].map((entry) => entry.binding), [0]);
});

Deno.test('renderForwardFrame binds base-color textures for textured built-in unlit materials', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-textured',
    kind: 'unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-textured',
    materialId: 'material-textured',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node-textured', { meshId: 'mesh-textured' }));

  runtimeResidency.geometry.set('mesh-textured', {
    meshId: 'mesh-textured',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      TEXCOORD_0: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });
  runtimeResidency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: {} as GPUTexture,
    view: { textureId: 0 } as unknown as GPUTextureView,
    sampler: { id: 0 } as unknown as GPUSampler,
    width: 2,
    height: 2,
    format: 'rgba8unorm',
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 1);
  assertEquals(mocks.bindGroupEntries.length, 2);
  assertEquals(mocks.bindGroupEntries[0].map((entry) => entry.binding), [0]);
  assertEquals(mocks.bindGroupEntries[1].map((entry) => entry.binding), [0, 1, 2]);
  const vertexBufferLayouts = mocks.pipelines[0].descriptor.vertex?.buffers ?? [];
  assertEquals(
    vertexBufferLayouts.map((buffer) => buffer?.arrayStride ?? 0),
    [12, 8],
  );
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'setVertexBuffer').length,
    2,
  );
});

Deno.test('renderForwardFrame binds lighting uniforms for built-in lit materials', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendLight(scene, {
    id: 'light-directional',
    kind: 'directional',
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  });
  scene = appendMaterial(scene, {
    id: 'material-lit',
    kind: 'lit',
    textures: [],
    parameters: {
      color: { x: 0.7, y: 0.5, z: 0.3, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-lit',
    materialId: 'material-lit',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('light-node', { lightId: 'light-directional' }));
  scene = appendNode(scene, createNode('mesh-lit-node', { meshId: 'mesh-lit' }));

  runtimeResidency.geometry.set('mesh-lit', {
    meshId: 'mesh-lit',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 1);
  assertEquals(mocks.bindGroupEntries.length, 3);
  assertEquals(mocks.bindGroupEntries[0].map((entry) => entry.binding), [0]);
  assertEquals(mocks.bindGroupEntries[1].map((entry) => entry.binding), [0]);
  assertEquals(mocks.bindGroupEntries[2].map((entry) => entry.binding), [0]);
  const litVertexBuffers = mocks.pipelines[0].descriptor.vertex?.buffers ?? [];
  assertEquals(litVertexBuffers.length, 2);
  assertEquals(
    litVertexBuffers.map((buffer) => buffer?.arrayStride ?? 0),
    [12, 12],
  );
  const litTransformWrite = mocks.writeBufferCalls.find((call) => call.bytes.byteLength === 192);
  const lightingWrite = mocks.writeBufferCalls.find((call) => call.bytes.byteLength === 144);
  assertEquals(Boolean(litTransformWrite), true);
  assertEquals(
    Array.from(new Float32Array(lightingWrite?.bytes.buffer.slice(0, 16) ?? new ArrayBuffer(0))),
    [0, 0, -1, 0],
  );
  const lightingColor = Array.from(
    new Float32Array(
      lightingWrite?.bytes.buffer.slice(64, 80) ?? new ArrayBuffer(0),
    ),
  );
  assertAlmostEquals(lightingColor[0], 1, 1e-6);
  assertAlmostEquals(lightingColor[1], 0.95, 1e-6);
  assertAlmostEquals(lightingColor[2], 0.9, 1e-6);
  assertAlmostEquals(lightingColor[3], 1.5, 1e-6);
});

Deno.test('renderForwardFrame does not append texture bindings for shader-selected unlit programs', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-shader-unlit',
    kind: 'unlit',
    shaderId: 'built-in:unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-shader-unlit',
    materialId: 'material-shader-unlit',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node-shader-unlit', { meshId: 'mesh-shader-unlit' }));

  runtimeResidency.geometry.set('mesh-shader-unlit', {
    meshId: 'mesh-shader-unlit',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      TEXCOORD_0: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });
  runtimeResidency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: {} as GPUTexture,
    view: { textureId: 0 } as unknown as GPUTextureView,
    sampler: { id: 0 } as unknown as GPUSampler,
    width: 2,
    height: 2,
    format: 'rgba8unorm',
  });

  renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenContext({
      device: mocks.device as unknown as GPUDevice,
      target: createHeadlessTarget(64, 64),
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(mocks.bindGroupEntries.length, 2);
  assertEquals(mocks.bindGroupEntries[0].map((entry) => entry.binding), [0]);
  assertEquals(mocks.bindGroupEntries[1].map((entry) => entry.binding), [0]);
});

Deno.test('renderForwardFrame assembles declared texture and sampler bindings for custom programs', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  const registry = createMaterialRegistry();
  const customProgram = {
    id: 'shader:textured-flat-red',
    label: 'Textured Flat Red',
    wgsl: `
struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct MeshTransform {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
};

struct MaterialUniforms {
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(2) var baseColorSampler: sampler;

@vertex
fn vsMain(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.viewProjection * meshTransform.model * vec4<f32>(position, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(input: VsOut) -> @location(0) vec4<f32> {
  return textureSample(baseColorTexture, baseColorSampler, input.uv) * material.color;
}
`,
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
    usesTransformBindings: true,
    materialBindings: [
      { kind: 'uniform' as const, binding: 0 },
      { kind: 'texture' as const, binding: 1, textureSemantic: 'baseColor' },
      { kind: 'sampler' as const, binding: 2, textureSemantic: 'baseColor' },
    ],
    vertexAttributes: [
      {
        semantic: 'POSITION',
        shaderLocation: 0,
        format: 'float32x3' as GPUVertexFormat,
        offset: 0,
        arrayStride: 12,
      },
      {
        semantic: 'TEXCOORD_0',
        shaderLocation: 1,
        format: 'float32x2' as GPUVertexFormat,
        offset: 0,
        arrayStride: 8,
      },
    ],
  };
  registerWgslMaterial(registry, customProgram);

  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom-textured',
    kind: 'custom',
    shaderId: 'shader:textured-flat-red',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 0.5, z: 0.5, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-custom-textured',
    materialId: 'material-custom-textured',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node-custom-textured', { meshId: 'mesh-custom-textured' }));

  runtimeResidency.geometry.set('mesh-custom-textured', {
    meshId: 'mesh-custom-textured',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      TEXCOORD_0: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });
  runtimeResidency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: {} as GPUTexture,
    view: { textureId: 0 } as unknown as GPUTextureView,
    sampler: { id: 0 } as unknown as GPUSampler,
    width: 2,
    height: 2,
    format: 'rgba8unorm',
  });

  const result = renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenContext({
      device: mocks.device as unknown as GPUDevice,
      target: createHeadlessTarget(64, 64),
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
    registry,
  );

  assertEquals(result.drawCount, 1);
  assertEquals(mocks.bindGroupEntries.length, 2);
  assertEquals(mocks.bindGroupEntries[0].map((entry) => entry.binding), [0]);
  assertEquals(mocks.bindGroupEntries[1].map((entry) => entry.binding), [0, 1, 2]);
});

Deno.test('renderForwardFrame uploads evaluated mesh transforms for built-in unlit draws', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-transformed',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(
    scene,
    createNode('node-transformed', {
      meshId: 'mesh-transformed',
      transform: {
        translation: { x: 0.5, y: -0.25, z: 0 },
        rotation: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
        scale: { x: 2, y: 1, z: 1 },
      },
    }),
  );

  runtimeResidency.geometry.set('mesh-transformed', {
    meshId: 'mesh-transformed',
    attributeBuffers: { POSITION: { id: 4 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenContext({
      device: mocks.device as unknown as GPUDevice,
      target: createHeadlessTarget(32, 32),
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  const transformUpload = mocks.writeBufferCalls.find((call) => call.bytes.byteLength === 128);
  const uploadedMatrix = transformUpload
    ? Array.from(new Float32Array(transformUpload.bytes.buffer.slice(0)))
    : [];
  const expectedModelMatrix = [
    0,
    2,
    0,
    0,
    -1,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0.5,
    -0.25,
    0,
    1,
  ];
  const expectedViewProjection = [
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
  assertEquals(uploadedMatrix.length, expectedModelMatrix.length + expectedViewProjection.length);
  uploadedMatrix.slice(0, 16).forEach((value, index) => {
    assertAlmostEquals(value, expectedModelMatrix[index], 1e-6);
  });
  uploadedMatrix.slice(16).forEach((value, index) => {
    assertAlmostEquals(value, expectedViewProjection[index], 1e-6);
  });
});

Deno.test('renderForwardFrame uploads parented mesh transforms after scene evaluation', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-parented',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(
    scene,
    createNode('parent', {
      transform: {
        translation: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );
  scene = appendNode(
    scene,
    createNode('child', {
      parentId: 'parent',
      meshId: 'mesh-parented',
      transform: {
        translation: { x: 0, y: 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  runtimeResidency.geometry.set('mesh-parented', {
    meshId: 'mesh-parented',
    attributeBuffers: { POSITION: { id: 5 } as unknown as GPUBuffer },
    vertexCount: 3,
    indexCount: 0,
  });

  renderForwardFrame(
    mocks as unknown as GpuRenderExecutionContext,
    createOffscreenContext({
      device: mocks.device as unknown as GPUDevice,
      target: createHeadlessTarget(32, 32),
    }),
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  const transformUpload = mocks.writeBufferCalls.find((call) => call.bytes.byteLength === 128);
  const uploadedMatrix = transformUpload
    ? Array.from(new Float32Array(transformUpload.bytes.buffer.slice(0)))
    : [];

  assertAlmostEquals(uploadedMatrix[12] ?? 0, -1, 1e-5);
  assertAlmostEquals(uploadedMatrix[13] ?? 0, 0, 1e-5);
  assertAlmostEquals(uploadedMatrix[28] ?? 0, 0, 1e-5);
  assertAlmostEquals(uploadedMatrix[31] ?? 0, 1, 1e-5);
});

Deno.test('renderDeferredFrame composites sdf and volume raymarch passes after deferred lighting', () => {
  const mocks = createRenderMocks();
  const runtimeResidency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-deferred',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-deferred' }));
  scene = {
    ...scene,
    sdfPrimitives: [{
      id: 'sdf-0',
      op: 'sphere',
      parameters: {
        radius: { x: 0.5, y: 0, z: 0, w: 0 },
      },
    }],
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));
  scene = appendNode(scene, createNode('volume-node', { volumeId: 'volume-0' }));

  runtimeResidency.geometry.set('mesh-deferred', {
    meshId: 'mesh-deferred',
    attributeBuffers: {
      POSITION: { id: 0 } as unknown as GPUBuffer,
      NORMAL: { id: 1 } as unknown as GPUBuffer,
    },
    vertexCount: 3,
    indexCount: 0,
  });
  runtimeResidency.volumes.set('volume-0', {
    volumeId: 'volume-0',
    texture: { id: 0 } as unknown as GPUTexture,
    view: { id: 1 } as unknown as GPUTextureView,
    sampler: { id: 2 } as unknown as GPUSampler,
    width: 4,
    height: 4,
    depth: 4,
    format: 'r8unorm',
  });

  const binding = createOffscreenContext({
    device: mocks.device as unknown as GPUDevice,
    target: createHeadlessTarget(64, 64),
  });

  const result = renderDeferredFrame(
    mocks as unknown as GpuRenderExecutionContext,
    binding,
    runtimeResidency,
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(result.drawCount, 5);
  assertEquals(result.submittedCommandBufferCount, 1);
  assertEquals(mocks.renderPassCount.current, 5);
  assertEquals(mocks.pipelines.length, 5);
  assertEquals(
    mocks.passActions.filter((action) => action.type === 'draw').length,
    5,
  );
});
