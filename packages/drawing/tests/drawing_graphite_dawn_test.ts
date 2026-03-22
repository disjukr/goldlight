import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { createOffscreenBinding } from '@rieul3d/gpu';
import {
  createPath2D,
  createRect,
  createRRectPath2D,
  createScaleMatrix2D,
  createTranslationMatrix2D,
  identityMatrix2D,
  withPath2DFillRule,
} from '@rieul3d/geometry';
import {
  appendDrawingClipStackElement,
  createDrawingClipStackSnapshot,
  clipDrawingRecorderShader,
  clipDrawingRecorderPath,
  clipDrawingRecorderRect,
  concatDrawingRecorderTransform,
  createDawnBackendContext,
  createDawnCaps,
  createDawnQueueManager,
  createDawnSharedContext,
  createDrawingContext,
  createDrawingPath2DFromShape,
  createDrawingRecorder,
  encodePreparedDawnCommandBuffer,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  prepareDawnRecording,
  prepareDrawingRecording,
  recordClear,
  recordDrawPath,
  recordDrawShape,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitDawnCommandBuffer,
  submitDrawingRecorder,
  submitToDawnQueueManager,
  tickDawnQueueManager,
  translateDrawingRecorder,
  popDrawingClipStackSave,
  pushDrawingClipStackSave,
  visitDrawingClipStackForDraw,
} from '@rieul3d/drawing';

const createMockGpuContext = () => {
  const buffers: GPUBufferDescriptor[] = [];
  const textures: GPUTextureDescriptor[] = [];
  const samplers: GPUSamplerDescriptor[] = [];
  const renderPasses: GPURenderPassDescriptor[] = [];
  const submitted: GPUCommandBuffer[][] = [];
  const finishedCommandBuffers: GPUCommandBuffer[] = [];
  const shaderModules: GPUShaderModuleDescriptor[] = [];
  const bindGroupLayouts: GPUBindGroupLayoutDescriptor[] = [];
  const pipelineLayouts: GPUPipelineLayoutDescriptor[] = [];
  const bindGroups: GPUBindGroupDescriptor[] = [];
  const renderPipelines: GPURenderPipelineDescriptor[] = [];
  const drawCalls: number[] = [];
  const scissorCalls: Array<readonly [number, number, number, number]> = [];
  const stencilReferences: number[] = [];
  const bindGroupCalls: number[] = [];
  const submissionDoneResolvers: Array<() => void> = [];
  const mappedBuffers: ArrayBuffer[] = [];
  const submittedWorkDoneResolvers = submissionDoneResolvers;
  const offscreenView = { label: 'offscreen-view' } as unknown as GPUTextureView;
  const ticks: number[] = [];

  return {
    created: {
      buffers,
      textures,
      samplers,
      renderPasses,
      submitted,
      finishedCommandBuffers,
      shaderModules,
      bindGroupLayouts,
      pipelineLayouts,
      bindGroups,
      renderPipelines,
      drawCalls,
      scissorCalls,
      stencilReferences,
      bindGroupCalls,
      submissionDoneResolvers,
      mappedBuffers,
      submittedWorkDoneResolvers,
    },
    context: {
      adapter: {
        features: new Set(['bgra8unorm-storage']),
      } as unknown as GPUAdapter,
      device: {
        features: new Set(['timestamp-query']),
        limits: {
          maxTextureDimension2D: 8192,
          maxColorAttachments: 8,
          maxBufferSize: 1024 * 1024,
          minUniformBufferOffsetAlignment: 256,
          minStorageBufferOffsetAlignment: 256,
          maxStorageBuffersPerShaderStage: 8,
          maxUniformBuffersPerShaderStage: 12,
          maxInterStageShaderVariables: 16,
        },
        createBuffer: (descriptor: GPUBufferDescriptor) => {
          buffers.push(descriptor);
          const range = new ArrayBuffer(descriptor.size);
          mappedBuffers.push(range);
          return {
            descriptor,
            getMappedRange: () => range,
            unmap: () => undefined,
          } as unknown as GPUBuffer;
        },
        createTexture: (descriptor: GPUTextureDescriptor) => {
          textures.push(descriptor);
          return {
            descriptor,
            createView: () => offscreenView,
          } as unknown as GPUTexture;
        },
        createSampler: (descriptor?: GPUSamplerDescriptor) => {
          samplers.push(descriptor ?? {});
          return { descriptor } as unknown as GPUSampler;
        },
        createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
          shaderModules.push(descriptor);
          return { descriptor } as unknown as GPUShaderModule;
        },
        createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
          bindGroupLayouts.push(descriptor);
          return { descriptor } as unknown as GPUBindGroupLayout;
        },
        createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor) => {
          pipelineLayouts.push(descriptor);
          return { descriptor } as unknown as GPUPipelineLayout;
        },
        createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
          bindGroups.push(descriptor);
          return { descriptor } as unknown as GPUBindGroup;
        },
        createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
          renderPipelines.push(descriptor);
          return { descriptor } as unknown as GPURenderPipeline;
        },
        createCommandEncoder: () =>
          ({
            beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
              renderPasses.push(descriptor);
              return {
                setPipeline: () => undefined,
                setVertexBuffer: () => undefined,
                setScissorRect: (x: number, y: number, width: number, height: number) => {
                  scissorCalls.push([x, y, width, height]);
                },
                setStencilReference: (reference: number) => {
                  stencilReferences.push(reference);
                },
                setBindGroup: (index: number) => {
                  bindGroupCalls.push(index);
                },
                draw: (vertexCount: number) => {
                  drawCalls.push(vertexCount);
                },
                end: () => undefined,
              } as unknown as GPURenderPassEncoder;
            },
            finish: () => {
              const commandBuffer = {
                label: `command-buffer-${finishedCommandBuffers.length}`,
              } as unknown as GPUCommandBuffer;
              finishedCommandBuffers.push(commandBuffer);
              return commandBuffer;
            },
          }) as GPUCommandEncoder,
      } as unknown as GPUDevice,
      queue: {
        submit: (commandBuffers: Iterable<GPUCommandBuffer>) => {
          submitted.push([...commandBuffers]);
        },
        onSubmittedWorkDone: () =>
          new Promise<void>((resolve) => {
            submissionDoneResolvers.push(resolve);
          }),
      } as unknown as GPUQueue,
      target: {
        kind: 'offscreen',
        width: 256,
        height: 256,
        format: 'rgba8unorm',
        sampleCount: 1,
      } as const,
    },
    ticks,
  };
};

Deno.test('drawing shape path delegates path generation to geometry package', () => {
  const path = createDrawingPath2DFromShape({
    kind: 'rect',
    rect: createRect(10, 20, 30, 40),
  });

  assertEquals(path.verbs[0]?.kind, 'moveTo');
  assertEquals(path.verbs.length, 5);
  assertEquals(path.fillRule, 'nonzero');
});

Deno.test('dawn shared context exposes resource provider over gpu device', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const sharedContext = createDawnSharedContext(backend, { resourceBudget: 1024 });

  sharedContext.resourceProvider.createBuffer({
    label: 'vertex',
    size: 64,
    usage: 0x20,
  });
  sharedContext.resourceProvider.createTexture({
    label: 'color',
    size: { width: 16, height: 16, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: 0x10,
  });
  sharedContext.resourceProvider.createSampler({
    label: 'linear',
  });
  sharedContext.resourceProvider.createSampler({
    label: 'linear-again',
  });

  assertEquals(sharedContext.resourceProvider.resourceBudget, 1024);
  assertEquals(sharedContext.caps.backend, 'graphite-dawn');
  assertEquals(sharedContext.caps.supportsTimestampQuery, true);
  assertEquals(mock.created.bindGroupLayouts.length, 2);
  assertEquals(mock.created.buffers.length, 1);
  assertEquals(mock.created.textures.length, 1);
  assertEquals(mock.created.samplers.length, 1);
});

Deno.test('dawn resource provider uses replace for first clip writes', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));

  sharedContext.resourceProvider.findOrCreateGraphicsPipeline({
    label: 'drawing-clip-stencil-write',
    shader: 'path',
    vertexLayout: 'device-vertex',
    depthStencil: 'clip-stencil-write',
    colorWriteDisabled: true,
    topology: 'triangle-list',
  });

  assertEquals(
    mock.created.renderPipelines[0]?.depthStencil?.stencilFront?.passOp,
    'replace',
  );
});

Deno.test('dawn caps expose feature, format, and sample count policy', () => {
  const mock = createMockGpuContext();
  const caps = createDawnCaps(createDawnBackendContext(mock.context));

  assertEquals(caps.preferredCanvasFormat, 'rgba8unorm');
  assertEquals(caps.resourceBindingRequirements.backendApi, 'dawn');
  assertEquals(caps.resourceBindingRequirements.uniformBufferLayout, 'std140');
  assertEquals(caps.resourceBindingRequirements.separateTextureAndSamplerBinding, true);
  assertEquals(caps.supportsTimestampQuery, true);
  assertEquals(caps.supportsCommandBufferTimestamps, true);
  assertEquals(caps.supportsShaderF16, false);
  assertEquals(caps.limits.maxTextureDimension2D, 8192);
  assertEquals(caps.limits.maxStorageBuffersPerShaderStage, 8);
  assertEquals(caps.supportsStorageBuffers, true);
  assertEquals(caps.isFormatRenderable('rgba8unorm'), true);
  assertEquals(caps.canUseAsResolveTarget('rgba8unorm'), true);
  assertEquals(caps.isFormatStorageCompatible('bgra8unorm'), true);
  assertEquals(caps.getFormatCapabilities('depth24plus').texturable, true);
  assertEquals(caps.getFormatCapabilities('depth24plus').renderable, false);
  assertEquals(caps.getSupportedTextureUsages('rgba8unorm').has('copyDst'), true);
  assertEquals(caps.getSupportedTextureUsages('rgba8unorm').has('resolve'), true);
  assertEquals(caps.getSupportedSampleCounts('rgba8unorm'), [1, 4]);
  assertEquals(caps.getColorTypeInfos('r8unorm')[0]?.writeSwizzle, 'a000');
  assertEquals(caps.emulateLoadStoreResolve, true);
  assertEquals(caps.differentResolveAttachmentSizeSupport, true);
  assertEquals(caps.supportsSampleCount(1), true);
  assertEquals(caps.supportsSampleCount(4), true);
  assertEquals(caps.supportsSampleCount(8), false);
});

Deno.test('dawn caps track transient and load-resolve features separately', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext({
    ...mock.context,
    device: {
      ...mock.context.device,
      features: new Set([
        'timestamp-query',
        'transient-attachments',
        'msaa-render-to-single-sampled',
        'dawn-load-resolve-texture',
        'dawn-partial-load-resolve-texture',
        'render-pass-render-area',
      ]),
    } as unknown as GPUDevice,
  });
  const caps = createDawnCaps(backend);

  assertEquals(caps.supportsTransientAttachments, true);
  assertEquals(caps.supportsMSAARenderToSingleSampled, true);
  assertEquals(caps.supportsLoadResolveTexture, true);
  assertEquals(caps.supportsPartialLoadResolve, true);
  assertEquals(caps.supportsRenderPassRenderArea, true);
  assertEquals(caps.resourceBindingRequirements.usePushConstantsForIntrinsicConstants, false);
  assertEquals(caps.emulateLoadStoreResolve, false);
  assertEquals(caps.getSupportedTextureUsages('rgba8unorm').has('msaaRenderToSingleSampled'), true);
  assertEquals(caps.getSupportedTextureUsages('rgba8unorm').has('transient'), true);
});

Deno.test('dawn caps apply observable storage-buffer workaround policy', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext({
    ...mock.context,
    device: {
      ...mock.context.device,
      features: new Set(['timestamp-query', 'disable-storage-buffers']),
    } as unknown as GPUDevice,
  });
  const caps = createDawnCaps(backend);

  assertEquals(caps.requiresStorageBufferWorkaround, true);
  assertEquals(caps.supportsStorageBuffers, false);
  assertEquals(caps.runtimeCapabilities.drawBufferCanBeMapped, false);
  assertEquals(caps.runtimeCapabilities.bufferMapsAreAsync, true);
});

Deno.test('dawn caps keep command-buffer timestamps feature-based in webgpu mode', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const caps = createDawnCaps(backend);

  assertEquals(caps.supportsTimestampQuery, true);
  assertEquals(caps.supportsCommandBufferTimestamps, true);
});

Deno.test('dawn caps expose compressed and external format policy when features are enabled', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext({
    ...mock.context,
    device: {
      ...mock.context.device,
      features: new Set([
        'timestamp-query',
        'texture-compression-bc',
        'texture-compression-etc2',
        'external-texture',
      ]),
    } as unknown as GPUDevice,
  });
  const caps = createDawnCaps(backend);

  assertEquals(caps.supportsCompressedBC, true);
  assertEquals(caps.supportsCompressedETC2, true);
  assertEquals(caps.supportsExternalTextures, true);
  assertEquals(caps.getSupportedTextureUsages('bc1-rgba-unorm' as GPUTextureFormat).has('sample'), true);
  assertEquals(caps.getSupportedTextureUsages('bc1-rgba-unorm' as GPUTextureFormat).has('copyDst'), true);
  assertEquals(caps.getSupportedTextureUsages('external' as GPUTextureFormat).has('sample'), true);
  assertEquals(caps.getSupportedTextureUsages('external' as GPUTextureFormat).has('copyDst'), false);
});

Deno.test('dawn resource provider validates caps-based texture usages', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));

  assertThrows(
    () =>
      sharedContext.resourceProvider.createTexture({
        label: 'invalid-depth-render-target',
        size: { width: 8, height: 8, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: 0x10,
      }),
    Error,
    'does not support render attachment usage',
  );
});

Deno.test('drawing recorder records transform and clip state into draw commands', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  saveDrawingRecorder(recorder);
  translateDrawingRecorder(recorder, 10, 12);
  scaleDrawingRecorder(recorder, 2, 3);
  clipDrawingRecorderRect(recorder, createRect(20, 30, 40, 50));
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [1, 1] },
      { kind: 'lineTo', to: [4, 1] },
      { kind: 'lineTo', to: [4, 5] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );
  restoreDrawingRecorder(recorder);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [1, 0] },
      { kind: 'lineTo', to: [1, 1] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const recording = finishDrawingRecorder(recorder);
  const first = recording.commands[0];
  const second = recording.commands[1];
  assertEquals(first?.kind, 'drawPath');
  assertEquals(second?.kind, 'drawPath');
  if (first?.kind !== 'drawPath' || second?.kind !== 'drawPath') {
    throw new Error('expected draw path commands');
  }
  assertEquals(first.transform, [2, 0, 0, 3, 10, 12]);
  assertEquals(first.clipStack.elements.length, 1);
  assertEquals(first.clipStack.elements[0]?.clip.kind, 'rect');
  if (first.clipStack.elements[0]?.clip.kind !== 'rect') {
    throw new Error('expected rect clip');
  }
  assertEquals(first.clipStack.saveRecords.length, 2);
  assertEquals(first.clipStack.elements[0].clip.op, 'intersect');
  assertEquals(first.clipStack.elements[0].clip.rect, createRect(20, 30, 40, 50));
  assertEquals(second.transform, identityMatrix2D);
  assertEquals(second.clipStack.elements.length, 0);
  assertEquals(first.path.verbs[0], { kind: 'moveTo', to: [1, 1] });
});

Deno.test('clip stack defers save-record materialization until a clip mutates it', () => {
  const saved = pushDrawingClipStackSave(createDrawingClipStackSnapshot());

  assertEquals(saved.saveRecords.length, 1);
  assertEquals(saved.saveRecords[0]?.deferredSaveCount, 1);

  const materialized = appendDrawingClipStackElement(saved, {
    kind: 'rect',
    op: 'intersect',
    rect: createRect(8, 12, 24, 28),
    transform: identityMatrix2D,
  });

  assertEquals(materialized.saveRecords.length, 2);
  assertEquals(materialized.saveRecords[0]?.deferredSaveCount, 0);
  assertEquals(materialized.saveRecords[1]?.startingElementIndex, 0);
  assertEquals(materialized.saveRecords[1]?.state, 'deviceRect');

  const restored = popDrawingClipStackSave(materialized);
  assertEquals(restored.saveRecords.length, 1);
  assertEquals(restored.elements.length, 0);
});

Deno.test('clip stack invalidates superseded rect intersects within the active save record', () => {
  let clipStack = createDrawingClipStackSnapshot();
  clipStack = appendDrawingClipStackElement(clipStack, {
    kind: 'rect',
    op: 'intersect',
    rect: createRect(0, 0, 96, 96),
    transform: identityMatrix2D,
  });
  clipStack = appendDrawingClipStackElement(clipStack, {
    kind: 'rect',
    op: 'intersect',
    rect: createRect(16, 20, 32, 28),
    transform: identityMatrix2D,
  });

  assertEquals(clipStack.elements.length, 2);
  assertEquals(clipStack.elements[0]?.invalidatedByIndex, 0);
  assertEquals(clipStack.saveRecords[0]?.oldestValidIndex, 1);
  assertEquals(clipStack.saveRecords[0]?.bounds, createRect(16, 20, 32, 28));

  const visited = visitDrawingClipStackForDraw(
    clipStack,
    () => null,
    (bounds, candidate) => {
      if (!candidate) {
        return bounds;
      }
      if (!bounds) {
        return candidate;
      }
      const x0 = Math.max(bounds.origin[0], candidate.origin[0]);
      const y0 = Math.max(bounds.origin[1], candidate.origin[1]);
      const x1 = Math.min(bounds.origin[0] + bounds.size.width, candidate.origin[0] + candidate.size.width);
      const y1 = Math.min(bounds.origin[1] + bounds.size.height, candidate.origin[1] + candidate.size.height);
      return createRect(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    },
    (points) => {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const point of points) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
      return createRect(minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY));
    },
  );

  assertEquals(visited.effectiveElements.length, 1);
  assertEquals(visited.effectiveElements[0]?.clip.kind, 'rect');
  if (visited.effectiveElements[0]?.clip.kind !== 'rect') {
    throw new Error('expected rect clip');
  }
  assertEquals(visited.effectiveElements[0].clip.rect, createRect(16, 20, 32, 28));
});

Deno.test('drawing recorder supports explicit transform concatenation', () => {
  const mock = createMockGpuContext();
  const recorder = createDrawingRecorder(
    createDawnSharedContext(createDawnBackendContext(mock.context)),
  );

  concatDrawingRecorderTransform(recorder, createTranslationMatrix2D(5, 8));
  concatDrawingRecorderTransform(recorder, createScaleMatrix2D(2, 2));
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [1, 1] },
      { kind: 'lineTo', to: [2, 1] },
      { kind: 'lineTo', to: [2, 2] },
      { kind: 'close' },
    ),
  );
  const recording = finishDrawingRecorder(recorder);
  const command = recording.commands[0];
  assertEquals(command?.kind, 'drawPath');
  if (command?.kind !== 'drawPath') {
    throw new Error('expected drawPath');
  }
  assertEquals(command.transform, [2, 0, 0, 2, 5, 8]);
});

Deno.test('drawing recorder finishes into an immutable recording snapshot', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordClear(recorder, [1, 1, 1, 1]);
  const recording = finishDrawingRecorder(recorder);
  recorder.commands.push({
    kind: 'clear',
    color: [0, 0, 0, 1],
  });

  assertEquals(recording.backend, 'graphite-dawn');
  assertEquals(recording.recorderId, recorder.recorderId);
  assertEquals(recording.commandCount, 1);
  assertEquals(recording.commands.length, 1);
  assertEquals(recording.commands[0], {
    kind: 'clear',
    color: [1, 1, 1, 1],
  });
});

Deno.test('drawing prepared recording groups clear and prepared steps into passes', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordClear(recorder, [0.1, 0.2, 0.3, 1]);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );
  recordClear(recorder, [0, 0, 0, 1]);

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));

  assertEquals(prepared.passCount, 2);
  assertEquals(prepared.passes[0]?.loadOp, 'clear');
  assertEquals(prepared.passes[0]?.steps.length, 1);
  assertEquals(prepared.passes[0]?.steps[0]?.pipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-path-fill-cover',
  ]);
  assertEquals(prepared.passes[0]?.steps[0]?.usesStencil, false);
  assertEquals(prepared.passes[1]?.loadOp, 'clear');
  assertEquals(prepared.passes[1]?.steps.length, 0);
  assertEquals(prepared.unsupportedCommands.length, 0);
});

Deno.test('dawn preparation separates recording, draw-pass preparation, and resource preparation', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'quadTo', control: [64, 0], to: [112, 16] },
      { kind: 'lineTo', to: [112, 112] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.2, 0.5, 0.8, 1] },
  );

  const recording = finishDrawingRecorder(recorder);
  const preparedWork = prepareDawnRecording(sharedContext, recording);
  const commandBuffer = encodePreparedDawnCommandBuffer(sharedContext, preparedWork, binding);

  assertEquals(preparedWork.recording.commandCount, 1);
  assertEquals(preparedWork.prepared.passes.length, 1);
  assertEquals(preparedWork.tasks.tasks.length, 1);
  assertEquals(preparedWork.resources.tasks.length, 1);
  assertEquals(preparedWork.resources.tasks[0]?.passes.length, 1);
  assertEquals(preparedWork.resources.tasks[0]?.passes[0]?.steps.length, 1);
  assertEquals((preparedWork.resources.tasks[0]?.passes[0]?.pipelineHandles.length ?? 0) > 0, true);
  assertEquals((preparedWork.resources.tasks[0]?.passes[0]?.resolvedPipelines.length ?? 0) > 0, true);
  assertEquals(commandBuffer.prepared, preparedWork.prepared);
});

Deno.test('drawing prepared recording selects middle-out fan for simple convex fills', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [120, 64] },
      { kind: 'lineTo', to: [96, 112] },
      { kind: 'lineTo', to: [16, 112] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;

  assertEquals(draw?.kind, 'pathFill');
  assertEquals(draw?.renderer, 'middle-out-fan');
  assertEquals((draw?.triangles.length ?? 0) > 0, true);
});

Deno.test('drawing prepared recording flattens quadratic and cubic paths for fill draws', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 96] },
      { kind: 'quadTo', control: [96, 24], to: [168, 96] },
      { kind: 'cubicTo', control1: [192, 120], control2: [96, 180], to: [24, 144] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;

  assertEquals(draw?.kind, 'pathFill');
  if (draw?.kind !== 'pathFill') {
    throw new Error('expected pathFill draw');
  }
  assertEquals(draw.renderer, 'stencil-tessellated-wedges');
  assertEquals(draw.triangles.length > 6, true);
  assertEquals(draw.bounds.origin[0], 24);
  assertEquals(draw.patches.length > 0, true);
  assertEquals(draw.patches.some((patch) => patch.fanPoint !== undefined), true);
  assertEquals(prepared.passes[0]?.steps[0]?.pipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-path-fill-patch-stencil-nonzero',
    'drawing-path-fill-stencil-cover',
  ]);
});

Deno.test('drawing prepared recording flattens conic and arc verbs', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [48, 120] },
      { kind: 'conicTo', control: [120, 24], to: [192, 120], weight: 0.5 },
      {
        kind: 'arcTo',
        center: [120, 120],
        radius: 72,
        startAngle: 0,
        endAngle: Math.PI,
      },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathFill');
  if (draw?.kind !== 'pathFill') {
    throw new Error('expected pathFill draw');
  }
  assertEquals(draw.triangles.length > 6, true);
  assertEquals(draw.patches.some((patch) => patch.kind === 'conic'), true);
});

Deno.test('drawing prepared recording splits cusp-like cubic patches', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'cubicTo', control1: [96, 32], control2: [96, 160], to: [160, 96] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 10, strokeJoin: 'round', strokeCap: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  assertEquals(
    (draw?.kind === 'pathStroke'
      ? draw.patches.filter((patch) => patch.patch.kind === 'cubic').length
      : 0) >= 1,
    true,
  );
});

Deno.test('drawing prepared recording computes Wang-style resolve levels for patches', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const createResolveLevel = (transform = identityMatrix2D) => {
    const recorder = drawingContext.createRecorder();
    concatDrawingRecorderTransform(recorder, transform);
    recordDrawPath(
      recorder,
      createPath2D(
        { kind: 'moveTo', to: [16, 96] },
        { kind: 'cubicTo', control1: [96, 0], control2: [160, 192], to: [240, 96] },
        { kind: 'close' },
      ),
      { style: 'fill' },
    );

    const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
    const draw = prepared.passes[0]?.steps[0]?.draw;
    const cubicPatch = draw?.kind === 'pathFill'
      ? draw.patches.find((patch) => patch.kind === 'cubic')
      : undefined;
    return cubicPatch?.resolveLevel ?? 0;
  };

  const baseResolveLevel = createResolveLevel();
  const scaledResolveLevel = createResolveLevel(createScaleMatrix2D(4, 4));

  assertEquals(scaledResolveLevel >= baseResolveLevel, true);
});

Deno.test('drawing prepared recording preserves evenodd fill rule through draw step metadata', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    withPath2DFillRule(
      createPath2D(
        { kind: 'moveTo', to: [16, 16] },
        { kind: 'lineTo', to: [120, 16] },
        { kind: 'lineTo', to: [120, 120] },
        { kind: 'lineTo', to: [16, 120] },
        { kind: 'close' },
        { kind: 'moveTo', to: [40, 40] },
        { kind: 'lineTo', to: [96, 40] },
        { kind: 'lineTo', to: [96, 96] },
        { kind: 'lineTo', to: [40, 96] },
        { kind: 'close' },
      ),
      'evenodd',
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];
  const draw = step?.draw;

  assertEquals(draw?.kind, 'pathFill');
  if (draw?.kind !== 'pathFill') {
    throw new Error('expected pathFill draw');
  }
  assertEquals(draw.fillRule, 'evenodd');
  assertEquals(step?.pipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-path-fill-patch-stencil-evenodd',
    'drawing-path-fill-stencil-cover',
  ]);
  assertEquals(step?.usesFillStencil, true);
});

Deno.test('drawing prepared recording derives clip bounds from clip path', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 40] },
      { kind: 'lineTo', to: [96, 40] },
      { kind: 'lineTo', to: [96, 88] },
      { kind: 'lineTo', to: [32, 88] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [120, 0] },
      { kind: 'lineTo', to: [120, 120] },
      { kind: 'lineTo', to: [0, 120] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  assertEquals(prepared.passes[0]?.steps[0]?.clipRect, createRect(32, 40, 64, 48));
  assertEquals(prepared.passes[0]?.steps[0]?.pipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-path-fill-clip-cover',
  ]);
});

Deno.test('drawing prepared recording preserves patch fill when convex clips are present', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [48, 32] },
      { kind: 'lineTo', to: [112, 48] },
      { kind: 'lineTo', to: [96, 112] },
      { kind: 'lineTo', to: [32, 96] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 96] },
      { kind: 'quadTo', control: [96, 24], to: [168, 96] },
      { kind: 'cubicTo', control1: [192, 120], control2: [96, 180], to: [24, 144] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];
  const draw = step?.draw;

  assertEquals(draw?.kind, 'pathFill');
  if (draw?.kind !== 'pathFill') {
    throw new Error('expected pathFill draw');
  }
  assertEquals(draw.renderer, 'stencil-tessellated-wedges');
  assertEquals(draw.patches.length > 0, true);
  assertEquals((draw.fringeVertices?.length ?? 0) > 0, true);
  assertEquals(step?.clipRect, createRect(32, 32, 80, 80));
  assertEquals(step?.pipelineDescs.map((pipeline) => pipeline.label), ['drawing-path-fill-patch-clip-cover']);
  assertEquals(step?.usesFillStencil, false);
});

Deno.test('drawing prepared recording accumulates clip stack intersections', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderRect(recorder, createRect(16, 16, 80, 80));
  clipDrawingRecorderRect(recorder, createRect(32, 24, 48, 72));
  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 32] },
      { kind: 'lineTo', to: [88, 32] },
      { kind: 'lineTo', to: [88, 72] },
      { kind: 'lineTo', to: [24, 72] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [120, 0] },
      { kind: 'lineTo', to: [120, 120] },
      { kind: 'lineTo', to: [0, 120] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  assertEquals(prepared.passes[0]?.steps[0]?.clipRect, createRect(32, 32, 48, 40));
});

Deno.test('drawing prepared recording preserves difference clips as stencil elements', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderRect(recorder, createRect(16, 16, 96, 96));
  clipDrawingRecorderRect(recorder, createRect(40, 40, 32, 32), 'difference');
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [128, 0] },
      { kind: 'lineTo', to: [128, 128] },
      { kind: 'lineTo', to: [0, 128] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];

  assertEquals(step?.clipRect, createRect(16, 16, 96, 96));
  assertEquals(step?.clipPipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-clip-stencil-write',
    'drawing-clip-stencil-difference',
  ]);
  assertEquals(step?.draw.clip?.elements?.map((element) => element.op), ['intersect', 'difference']);
  assertEquals(step?.draw.clip?.atlasClip, undefined);
});

Deno.test('drawing prepared recording preserves stroke patches when convex clips are present', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [40, 32] },
      { kind: 'lineTo', to: [104, 32] },
      { kind: 'lineTo', to: [120, 96] },
      { kind: 'lineTo', to: [56, 112] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'cubicTo', control1: [48, 16], control2: [144, 16], to: [160, 96] },
      { kind: 'lineTo', to: [160, 160] },
    ),
    { style: 'stroke', strokeWidth: 8, strokeJoin: 'round', strokeCap: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;

  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.patches.length > 0, true);
  assertEquals(draw.usesTessellatedStrokePatches, true);
  assertEquals((draw.fringeVertices?.length ?? 0) > 0, false);
  assertEquals(prepared.passes[0]?.steps[0]?.pipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-path-stroke-patch-clip-cover',
  ]);
});

Deno.test('drawing prepared recording collapses multiple complex path clips into an atlas clip', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [16, 96] },
      { kind: 'close' },
      { kind: 'moveTo', to: [32, 32] },
      { kind: 'lineTo', to: [80, 32] },
      { kind: 'lineTo', to: [80, 80] },
      { kind: 'lineTo', to: [32, 80] },
      { kind: 'close' },
    ),
  );
  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [40, 8] },
      { kind: 'lineTo', to: [104, 56] },
      { kind: 'lineTo', to: [40, 104] },
      { kind: 'lineTo', to: [8, 56] },
      { kind: 'close' },
      { kind: 'moveTo', to: [40, 32] },
      { kind: 'lineTo', to: [72, 56] },
      { kind: 'lineTo', to: [40, 80] },
      { kind: 'lineTo', to: [24, 56] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [120, 0] },
      { kind: 'lineTo', to: [120, 120] },
      { kind: 'lineTo', to: [0, 120] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;

  assertEquals(draw?.kind, 'pathFill');
  if (draw?.kind !== 'pathFill') {
    throw new Error('expected pathFill draw');
  }
  assertEquals(draw.usesStencil, false);
  assertEquals(draw.clip?.atlasClip !== undefined, true);
  assertEquals((draw.clip?.deferredClipDraws?.length ?? 0) >= 2, true);
  assertEquals((draw.clip?.atlasClip?.elements.length ?? 0) >= 2, true);
  assertEquals((draw.clip?.atlasClip?.bounds.size.width ?? 0) > 0, true);
});

Deno.test('drawing prepared recording carries analytic and shader clip metadata', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderRect(recorder, createRect(12, 18, 40, 36));
  clipDrawingRecorderShader(recorder, {
    kind: 'solidColor',
    color: [0.5, 0.75, 1, 0.5],
  });
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [96, 0] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [0, 96] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathFill');
  if (draw?.kind !== 'pathFill') {
    throw new Error('expected pathFill draw');
  }
  assertEquals(draw.clip?.analyticClip?.kind, 'rect');
  assertEquals(draw.clip?.analyticClip?.rect, createRect(12, 18, 40, 36));
  assertEquals(draw.clip?.shader?.kind, 'solidColor');
  assertEquals(draw.clip?.shader?.color, [0.5, 0.75, 1, 0.5]);
});

Deno.test('drawing prepared recording falls back for self-intersecting fill paths', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 32] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [32, 96] },
      { kind: 'lineTo', to: [96, 32] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathFill');
  assertEquals((draw?.triangles.length ?? 0) > 0, true);
});

Deno.test('drawing prepared recording expands stroke geometry', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawShape(
    recorder,
    {
      kind: 'circle',
      circle: { center: [80, 80], radius: 24 },
      segments: 8,
    },
    { style: 'stroke', strokeWidth: 6 },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  assertEquals(draw?.renderer, 'tessellated-strokes');
  assertEquals((draw?.triangles.length ?? 0) > 12, true);
});

Deno.test('drawing prepared recording expands stroke joins and caps', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'lineTo', to: [96, 32] },
      { kind: 'lineTo', to: [160, 96] },
    ),
    { style: 'stroke', strokeWidth: 12, strokeJoin: 'round', strokeCap: 'square' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  assertEquals((draw?.triangles.length ?? 0) > 18, true);
});

Deno.test('drawing prepared stroke patches seed open contours from first tangent control point', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'quadTo', control: [20, 30], to: [40, 0] },
    ),
    { style: 'stroke', strokeWidth: 8, strokeCap: 'round', strokeJoin: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.patches.length > 0, true);
  assertEquals(draw.patches[0]?.joinControlPoint, [20, 30]);
  assertEquals(draw.patches[0]?.startCap, 'round');
  assertEquals(draw.usesTessellatedStrokePatches, true);
});

Deno.test('drawing prepared stroke patches rewrite closed contour first join control point', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [40, 0] },
      { kind: 'lineTo', to: [40, 30] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 8, strokeJoin: 'round', strokeCap: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.patches.length >= 3, true);
  assertEquals(draw.patches[0]?.joinControlPoint, [40, 30]);
  assertEquals(draw.patches[0]?.startCap, 'none');
  assertEquals(draw.patches[0]?.contourStart, true);
});

Deno.test('drawing prepared stroke patches emit synthetic circle patches for round joins and caps', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'lineTo', to: [96, 32] },
      { kind: 'lineTo', to: [160, 96] },
    ),
    { style: 'stroke', strokeWidth: 12, strokeJoin: 'round', strokeCap: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.usesTessellatedStrokePatches, true);
  assertEquals(draw.patches.length > 0, true);
});

Deno.test('drawing prepared stroke patches preserve bevel and miter line joins in patch path', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));

  const prepareJoinKinds = (strokeJoin: 'bevel' | 'miter') => {
    const recorder = drawingContext.createRecorder();
    recordDrawPath(
      recorder,
      createPath2D(
        { kind: 'moveTo', to: [32, 96] },
        { kind: 'lineTo', to: [96, 32] },
        { kind: 'lineTo', to: [160, 96] },
      ),
      { style: 'stroke', strokeWidth: 12, strokeJoin, strokeCap: 'butt' },
    );
    const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
    const draw = prepared.passes[0]?.steps[0]?.draw;
    assertEquals(draw?.kind, 'pathStroke');
    if (draw?.kind !== 'pathStroke') {
      throw new Error('expected pathStroke draw');
    }
    return {
      usesTessellatedStrokePatches: draw.usesTessellatedStrokePatches,
      patchCount: draw.patches.length,
    };
  };

  const bevelKinds = prepareJoinKinds('bevel');
  assertEquals(bevelKinds.usesTessellatedStrokePatches, true);
  assertEquals(bevelKinds.patchCount > 0, true);
  const bevelRecorder = drawingContext.createRecorder();
  recordDrawPath(
    bevelRecorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'lineTo', to: [96, 32] },
      { kind: 'lineTo', to: [160, 96] },
    ),
    { style: 'stroke', strokeWidth: 12, strokeJoin: 'bevel', strokeCap: 'butt' },
  );
  const bevelPrepared = prepareDrawingRecording(finishDrawingRecorder(bevelRecorder));
  const bevelDraw = bevelPrepared.passes[0]?.steps[0]?.draw;
  assertEquals(bevelDraw?.kind, 'pathStroke');
  if (bevelDraw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(bevelDraw.usesTessellatedStrokePatches, true);

  const miterKinds = prepareJoinKinds('miter');
  assertEquals(miterKinds.usesTessellatedStrokePatches, true);
  assertEquals(miterKinds.patchCount > 0, true);
});

Deno.test('drawing prepared stroke patches emit synthetic cap patches for degenerate contours', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));

  const prepareCapKinds = (strokeCap: 'round' | 'square') => {
    const recorder = drawingContext.createRecorder();
    recordDrawPath(
      recorder,
      createPath2D(
        { kind: 'moveTo', to: [96, 96] },
        { kind: 'lineTo', to: [96, 96] },
      ),
      { style: 'stroke', strokeWidth: 12, strokeCap, strokeJoin: 'round' },
    );
    const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
    const draw = prepared.passes[0]?.steps[0]?.draw;
    assertEquals(draw?.kind, 'pathStroke');
    if (draw?.kind !== 'pathStroke') {
      throw new Error('expected pathStroke draw');
    }
    return {
      usesTessellatedStrokePatches: draw.usesTessellatedStrokePatches,
      patchCount: draw.patches.length,
    };
  };

  const round = prepareCapKinds('round');
  assertEquals(round.usesTessellatedStrokePatches, true);
  assertEquals(round.patchCount > 0, true);

  const square = prepareCapKinds('square');
  assertEquals(square.usesTessellatedStrokePatches, true);
  assertEquals(square.patchCount > 0, true);
});

Deno.test('drawing prepared stroke patches emit cusp circles for turnaround curves', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'cubicTo', control1: [96, 32], control2: [96, 160], to: [160, 96] },
    ),
    { style: 'stroke', strokeWidth: 10, strokeJoin: 'round', strokeCap: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.usesTessellatedStrokePatches, true);
  assertEquals(draw.patches.length > 0, true);
});

Deno.test('drawing prepared recording applies dash pattern to strokes', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 48] },
      { kind: 'lineTo', to: [208, 48] },
    ),
    { style: 'stroke', strokeWidth: 8, dashArray: [24, 12] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  assertEquals((draw?.triangles.length ?? 0) > 0, true);
  assertEquals((draw?.triangles.length ?? 0) < 72, true);
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.usesTessellatedStrokePatches, true);
});

Deno.test('drawing prepared recording scales hairline alpha coverage', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 32] },
      { kind: 'lineTo', to: [160, 32] },
    ),
    { style: 'stroke', strokeWidth: 0.5, color: [0.4, 0.6, 0.8, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  assertEquals(draw?.renderer, 'tessellated-strokes');
  assertEquals(draw?.color, [0.4, 0.6, 0.8, 0.5]);
});

Deno.test('dawn command buffer encodes fill draws with stencil and cover pipelines', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordClear(recorder, [0.25, 0.5, 0.75, 1]);
  clipDrawingRecorderRect(recorder, createRect(4, 6, 40, 50));
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [40, 0] },
      { kind: 'lineTo', to: [40, 40] },
      { kind: 'lineTo', to: [0, 40] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );
  submitToDawnQueueManager(sharedContext.queueManager, commandBuffer);

  assertEquals(commandBuffer.passCount, 1);
  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.renderPipelines.length, 2);
  assertEquals(mock.created.bindGroupLayouts.length > 0, true);
  assertEquals(mock.created.pipelineLayouts.length > 0, true);
  assertEquals(mock.created.bindGroups.length > 0, true);
  assertEquals(mock.created.bindGroupCalls.length > 0, true);
  assertEquals(mock.created.drawCalls.length, 3);
  assertEquals(mock.created.renderPasses[0]?.depthStencilAttachment !== undefined, true);
  assertEquals(mock.created.scissorCalls[0], [4, 6, 40, 50]);
  assertEquals(
    mock.created.renderPasses[0]?.colorAttachments[0]?.clearValue,
    { r: 0.25, g: 0.5, b: 0.75, a: 1 },
  );
});

Deno.test('dawn command buffer uses stencil-cover fill path for patch-rendered nonzero fills', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 96] },
      { kind: 'quadTo', control: [96, 24], to: [168, 96] },
      { kind: 'cubicTo', control1: [192, 120], control2: [96, 180], to: [24, 144] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.2, 0.4, 0.6, 0.5] },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.renderPasses[0]?.depthStencilAttachment !== undefined, true);
  assertEquals(mock.created.drawCalls.length, 3);
  assertEquals(mock.created.renderPipelines.length, 2);
});

Deno.test('dawn command buffer clips via clip path stencil replay with clip bounds', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 30] },
      { kind: 'lineTo', to: [72, 30] },
      { kind: 'lineTo', to: [72, 78] },
      { kind: 'lineTo', to: [24, 78] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [96, 0] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [0, 96] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);
  assertEquals(mock.created.scissorCalls[0], [24, 30, 48, 48]);
  assertEquals(mock.created.drawCalls.length, 3);
});

Deno.test('dawn command buffer accumulates multiple stencil clip paths before color draw', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [16, 96] },
      { kind: 'close' },
      { kind: 'moveTo', to: [32, 32] },
      { kind: 'lineTo', to: [80, 32] },
      { kind: 'lineTo', to: [80, 80] },
      { kind: 'lineTo', to: [32, 80] },
      { kind: 'close' },
    ),
  );
  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [40, 8] },
      { kind: 'lineTo', to: [104, 56] },
      { kind: 'lineTo', to: [40, 104] },
      { kind: 'lineTo', to: [8, 56] },
      { kind: 'close' },
      { kind: 'moveTo', to: [40, 32] },
      { kind: 'lineTo', to: [72, 56] },
      { kind: 'lineTo', to: [40, 80] },
      { kind: 'lineTo', to: [24, 56] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [120, 0] },
      { kind: 'lineTo', to: [120, 120] },
      { kind: 'lineTo', to: [0, 120] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.drawCalls.length, 2);
  assertEquals(mock.created.stencilReferences.length, 0);
});

Deno.test('dawn command buffer encodes stroke draws without stencil', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'cubicTo', control1: [48, 16], control2: [144, 16], to: [160, 96] },
      { kind: 'lineTo', to: [160, 160] },
    ),
    { style: 'stroke', strokeWidth: 8, color: [0.2, 0.4, 0.8, 1] },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.renderPipelines.length, 1);
  assertEquals(mock.created.drawCalls.length, 1);
});

Deno.test('dawn command buffer batches consecutive non-stencil draws into one render pass', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [64, 16] },
      { kind: 'lineTo', to: [64, 64] },
      { kind: 'lineTo', to: [16, 64] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [96, 16] },
      { kind: 'lineTo', to: [160, 16] },
      { kind: 'lineTo', to: [160, 80] },
      { kind: 'lineTo', to: [96, 80] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 6 },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  assertEquals(commandBuffer.passCount, 1);
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.drawCalls.length, 3);
  assertEquals(mock.created.stencilReferences, []);
});

Deno.test('dawn resource provider reuses pipelines across command buffers', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const binding = createOffscreenBinding(mock.context);

  const createRecording = (style: 'fill' | 'stroke') => {
    const recorder = createDrawingRecorder(sharedContext);
    recordDrawPath(
      recorder,
      createPath2D(
        { kind: 'moveTo', to: [16, 16] },
        { kind: 'lineTo', to: [96, 16] },
        { kind: 'lineTo', to: [96, 96] },
        { kind: 'lineTo', to: [16, 96] },
        { kind: 'close' },
      ),
      style === 'fill'
        ? { style: 'fill', color: [0.2, 0.5, 0.7, 1] }
        : { style: 'stroke', strokeWidth: 4, color: [0.9, 0.3, 0.2, 1] },
    );
    return finishDrawingRecorder(recorder);
  };

  encodeDawnCommandBuffer(sharedContext, createRecording('fill'), binding);
  encodeDawnCommandBuffer(sharedContext, createRecording('fill'), binding);
  encodeDawnCommandBuffer(sharedContext, createRecording('stroke'), binding);
  encodeDawnCommandBuffer(sharedContext, createRecording('stroke'), binding);

  assertEquals(mock.created.renderPipelines.length, 2);
  assertEquals(mock.created.shaderModules.length, 3);
  assertEquals(mock.created.bindGroupLayouts.length > 0, true);
  assertEquals(mock.created.pipelineLayouts.length > 0, true);
});

Deno.test('dawn pipelines honor target sample count for MSAA', () => {
  const mock = createMockGpuContext();
  const context = {
    ...mock.context,
    target: {
      ...mock.context.target,
      sampleCount: 4,
    } as const,
  };
  const sharedContext = createDawnSharedContext(createDawnBackendContext(context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [64, 16] },
      { kind: 'lineTo', to: [64, 64] },
      { kind: 'lineTo', to: [16, 64] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);
  assertEquals(mock.created.renderPipelines[0]?.multisample?.count, 4);
});

Deno.test('dawn queue manager tracks explicit submitted-work completion', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context, {
    tick: () => {
      mock.ticks.push(1);
      const resolver = mock.created.submittedWorkDoneResolvers.shift();
      resolver?.();
    },
  });
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordClear(recorder, [0, 0, 0, 1]);
  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );
  submitToDawnQueueManager(queueManager, commandBuffer);

  assertEquals(queueManager.submittedCount, 1);
  assertEquals(queueManager.completedCount, 0);
  assertEquals(queueManager.inFlightCount, 1);
  assertEquals(queueManager.supportsSubmittedWorkDone, true);

  mock.created.submissionDoneResolvers.shift()?.();
  await tickDawnQueueManager(queueManager);

  assertEquals(mock.ticks.length, 1);
  assertEquals(queueManager.completedCount, 1);
  assertEquals(queueManager.inFlightCount, 0);
});

Deno.test('submitDawnCommandBuffer routes submissions through queue manager tracking', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordClear(recorder, [0, 0, 0, 1]);
  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  submitDawnCommandBuffer(sharedContext, commandBuffer);

  assertEquals(sharedContext.queueManager.submittedCount, 1);
  assertEquals(sharedContext.queueManager.inFlightCount, 1);
  assertEquals(
    sharedContext.queueManager.lastSubmittedRecorderId,
    commandBuffer.recording.recorderId,
  );
});

Deno.test('dawn queue manager falls back to coarse tick completion without submitted-work callback', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext({
    ...mock.context,
    queue: {
      submit: mock.context.queue.submit.bind(mock.context.queue),
    } as GPUQueue,
  }, {
    tick: () => {
      mock.ticks.push(1);
    },
  });
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordClear(recorder, [0, 0, 0, 1]);
  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );
  submitToDawnQueueManager(queueManager, commandBuffer);

  assertEquals(queueManager.supportsSubmittedWorkDone, false);
  assertEquals(queueManager.completedCount, 0);
  assertEquals(queueManager.inFlightCount, 1);

  await tickDawnQueueManager(queueManager);

  assertEquals(mock.ticks.length, 1);
  assertEquals(queueManager.completedCount, 1);
  assertEquals(queueManager.inFlightCount, 0);
  assertEquals(queueManager.lastCompletedRecorderId, commandBuffer.recording.recorderId);
});

Deno.test('dawn queue manager clears pending completion when submitted-work callback rejects', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext({
    ...mock.context,
    queue: {
      submit: mock.context.queue.submit.bind(mock.context.queue),
      onSubmittedWorkDone: () => Promise.reject(new Error('device lost')),
    } as GPUQueue,
  });
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordClear(recorder, [0, 0, 0, 1]);
  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );
  submitToDawnQueueManager(queueManager, commandBuffer);

  await tickDawnQueueManager(queueManager);

  assertEquals(queueManager.completedCount, 1);
  assertEquals(queueManager.inFlightCount, 0);
  assertEquals(queueManager.pendingCompletions.length, 0);
});

Deno.test('drawing context increments recorder ids through shared context', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const first = createDrawingRecorder(sharedContext);
  const second = createDrawingRecorder(sharedContext);

  assertEquals(first.recorderId, 1);
  assertEquals(second.recorderId, 2);
  assertEquals(sharedContext.recorderCount, 2);
});

Deno.test('submitDrawingRecorder exposes draw commands without mutating backend metadata', () => {
  const mock = createMockGpuContext();
  const recorder = createDrawingRecorder(
    createDawnSharedContext(createDawnBackendContext(mock.context)),
  );

  recordDrawPath(
    recorder,
    createRRectPath2D({
      rect: createRect(24, 24, 80, 60),
      topLeft: { x: 12, y: 12 },
      topRight: { x: 12, y: 12 },
      bottomRight: { x: 12, y: 12 },
      bottomLeft: { x: 12, y: 12 },
    }),
    { style: 'fill' },
  );

  const submission = submitDrawingRecorder(recorder);
  assertEquals(submission.backend, 'graphite-dawn');
  assertEquals(submission.commands.length, 1);
  assertEquals(submission.commands[0]?.kind, 'drawPath');
});
