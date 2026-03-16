import type { EvaluatedScene } from '@rieul3d/core';
import type { Material } from '@rieul3d/ir';
import {
  acquireColorAttachmentView,
  type GpuReadbackContext,
  readOffscreenSnapshot,
  type RenderContextBinding,
  type RuntimeResidency,
} from '@rieul3d/gpu';
import builtInForwardShader from './shaders/built_in_forward_unlit.wgsl' with { type: 'text' };

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

export type Renderer = Readonly<{
  kind: RendererKind;
  label: string;
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
  device: Pick<GPUDevice, 'createCommandEncoder' | 'createRenderPipeline' | 'createShaderModule'>;
  queue: Pick<GPUQueue, 'submit'>;
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
}>;

export type MaterialRegistry = Readonly<{
  programs: Map<string, MaterialProgram>;
}>;

export type VolumePassItem = Readonly<{
  nodeId: string;
  volumeId: string;
  worldMatrix: readonly number[];
  residency: NonNullable<RuntimeResidency['volumes'] extends Map<string, infer T> ? T : never>;
}>;

const builtInUnlitProgramId = 'built-in:unlit';

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
  vertexAttributes: [{
    semantic: 'POSITION',
    shaderLocation: 0,
    format: 'float32x3',
    offset: 0,
    arrayStride: 12,
  }],
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
  programs: new Map([[builtInUnlitProgramId, builtInUnlitProgram]]),
});

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
    return registry.programs.get(builtInUnlitProgramId) ?? builtInUnlitProgram;
  }

  throw new Error(`material "${material.id}" uses unsupported kind "${material.kind}"`);
};

export const createForwardRenderer = (label = 'forward'): Renderer => ({
  kind: 'forward',
  label,
  passes: [
    { id: 'mesh', kind: 'mesh', reads: ['scene'], writes: ['color', 'depth'] },
    { id: 'raymarch', kind: 'raymarch', reads: ['scene', 'depth'], writes: ['color'] },
    { id: 'present', kind: 'present', reads: ['color'], writes: ['target'] },
  ],
});

export const createDeferredRenderer = (label = 'deferred'): Renderer => ({
  kind: 'deferred',
  label,
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

export const renderForwardFrame = (
  context: GpuRenderExecutionContext,
  binding: RenderContextBinding,
  residency: RuntimeResidency,
  evaluatedScene: EvaluatedScene,
  materialRegistry = createMaterialRegistry(),
): ForwardRenderResult => {
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

    const program = resolveMaterialProgram(materialRegistry, node.material);
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
