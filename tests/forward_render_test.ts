import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createOffscreenContext, createRuntimeResidency } from '@rieul3d/gpu';
import { appendMaterial, appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import {
  createMaterialRegistry,
  ensureBuiltInForwardPipeline,
  ensureMaterialPipeline,
  type GpuRenderExecutionContext,
  registerWgslMaterial,
  renderForwardFrame,
  resolveMaterialProgram,
} from '@rieul3d/renderer';
import { createHeadlessTarget } from '@rieul3d/platform';

type MockBuffer = Readonly<{ id: number }>;
type MockBindGroup = Readonly<{ id: number }>;
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

const createRenderMocks = () => {
  const pipelines: MockPipeline[] = [];
  const shaders: MockShader[] = [];
  const buffers: MockBuffer[] = [];
  const bindGroups: MockBindGroup[] = [];
  const submits: unknown[][] = [];
  const passActions: MockPassAction[] = [];

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
    createBindGroup: () => {
      const bindGroup = { id: bindGroups.length };
      bindGroups.push(bindGroup);
      return bindGroup as unknown as GPUBindGroup;
    },
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline: (pipeline: GPURenderPipeline) => {
          passActions.push({ type: 'setPipeline', pipeline: pipeline as unknown as MockPipeline });
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
      }),
      finish: () => ({}) as GPUCommandBuffer,
    }),
    createTexture: () => ({
      createView: () => ({ textureId: 0 } as unknown as GPUTextureView),
    } as GPUTexture),
  };

  const queue = {
    writeBuffer: () => undefined,
    submit: (buffers: readonly GPUCommandBuffer[]) => {
      submits.push([...buffers]);
    },
  };

  return { device, queue, pipelines, shaders, buffers, bindGroups, submits, passActions };
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
    2,
  );
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

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`,
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
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

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`,
    vertexEntryPoint: 'vsMain',
    fragmentEntryPoint: 'fsMain',
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
});
