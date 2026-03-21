import { assertEquals, assertExists } from 'jsr:@std/assert@^1.0.14';
import { createOffscreenBinding } from '@rieul3d/gpu';
import { createPath2D, createRect, createRRectPath2D, withPath2DFillRule } from '@rieul3d/geometry';
import {
  createDawnBackendContext,
  createDawnCaps,
  createDawnQueueManager,
  createDawnSharedContext,
  createDrawingContext,
  createDrawingPath2DFromShape,
  createDrawingRecorder,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  prepareDrawingRecording,
  recordClear,
  recordDrawPath,
  recordDrawShape,
  submitToDawnQueueManager,
  submitDrawingRecorder,
  tickDawnQueueManager,
} from '@rieul3d/drawing';

const createMockGpuContext = () => {
  const buffers: GPUBufferDescriptor[] = [];
  const textures: GPUTextureDescriptor[] = [];
  const samplers: GPUSamplerDescriptor[] = [];
  const renderPasses: GPURenderPassDescriptor[] = [];
  const submitted: GPUCommandBuffer[][] = [];
  const finishedCommandBuffers: GPUCommandBuffer[] = [];
  const shaderModules: GPUShaderModuleDescriptor[] = [];
  const renderPipelines: GPURenderPipelineDescriptor[] = [];
  const drawCalls: number[] = [];
  const mappedBuffers: ArrayBuffer[] = [];
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
      renderPipelines,
      drawCalls,
      mappedBuffers,
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
        submit: (buffers: Iterable<GPUCommandBuffer>) => {
          submitted.push([...buffers]);
        },
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

  assertEquals(sharedContext.resourceProvider.resourceBudget, 1024);
  assertEquals(sharedContext.caps.backend, 'graphite-dawn');
  assertEquals(sharedContext.caps.supportsTimestampQuery, true);
  assertEquals(mock.created.buffers.length, 1);
  assertEquals(mock.created.textures.length, 1);
  assertEquals(mock.created.samplers.length, 1);
});

Deno.test('dawn caps expose feature, format, and sample count policy', () => {
  const mock = createMockGpuContext();
  const caps = createDawnCaps(createDawnBackendContext(mock.context));

  assertEquals(caps.preferredCanvasFormat, 'rgba8unorm');
  assertEquals(caps.supportsTimestampQuery, true);
  assertEquals(caps.limits.maxTextureDimension2D, 8192);
  assertEquals(caps.isFormatRenderable('rgba8unorm'), true);
  assertEquals(caps.getFormatCapabilities('depth24plus').texturable, true);
  assertEquals(caps.supportsSampleCount(1), true);
  assertEquals(caps.supportsSampleCount(4), true);
  assertEquals(caps.supportsSampleCount(8), false);
});

Deno.test('drawing recorder tracks graphite-dawn style command submission', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordClear(recorder, [0, 0, 0, 1]);
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
  recordDrawShape(
    recorder,
    {
      kind: 'circle',
      circle: {
        center: [32, 32],
        radius: 12,
      },
      segments: 12,
    },
    {
      style: 'stroke',
      strokeWidth: 2,
    },
  );

  const submission = submitDrawingRecorder(recorder);

  assertEquals(submission.backend, 'graphite-dawn');
  assertEquals(submission.commands.length, 3);
  assertEquals(submission.commands[0]?.kind, 'clear');
  assertEquals(submission.commands[1]?.kind, 'drawPath');
  assertEquals(submission.commands[2]?.kind, 'drawShape');
  assertExists((submission.commands[2] as { path?: unknown }).path);
  assertEquals(recorder.commands.length, 0);
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
  const firstCommand = recording.commands[0];
  assertEquals(firstCommand?.kind, 'clear');
  if (firstCommand?.kind !== 'clear') {
    throw new Error('expected clear command');
  }
  assertEquals(firstCommand.color, [1, 1, 1, 1]);
  assertEquals(recorder.commands.length, 1);
});

Deno.test('drawing prepared recording groups clear and draw commands into passes', () => {
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

  const recording = finishDrawingRecorder(recorder);
  const prepared = prepareDrawingRecording(recording);

  assertEquals(prepared.backend, 'graphite-dawn');
  assertEquals(prepared.passCount, 2);
  assertEquals(prepared.passes[0]?.loadOp, 'clear');
  assertEquals(prepared.passes[0]?.draws.length, 1);
  assertEquals(prepared.passes[0]?.unsupportedDraws.length, 0);
  assertEquals(prepared.passes[1]?.loadOp, 'clear');
  assertEquals(prepared.passes[1]?.draws.length, 0);
  assertEquals(prepared.unsupportedCommands.length, 0);
});

Deno.test('drawing prepared recording flattens quadratic paths for fill draws', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

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

  const recording = finishDrawingRecorder(recorder);
  const prepared = prepareDrawingRecording(recording);

  assertEquals(prepared.passCount, 1);
  assertEquals(prepared.passes[0]?.draws.length, 1);
  assertEquals(prepared.passes[0]?.unsupportedDraws.length, 0);
  const preparedDraw = prepared.passes[0]?.draws[0];
  assertEquals(preparedDraw?.kind, 'pathFill');
  assertEquals((preparedDraw?.contours[0]?.length ?? 0) > 8, true);
  assertEquals(preparedDraw?.fillRule, 'nonzero');
});

Deno.test('drawing prepared recording preserves multiple contours and fill rule', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    withPath2DFillRule(
      createPath2D(
        { kind: 'moveTo', to: [16, 16] },
        { kind: 'lineTo', to: [64, 16] },
        { kind: 'lineTo', to: [64, 64] },
        { kind: 'lineTo', to: [16, 64] },
        { kind: 'close' },
        { kind: 'moveTo', to: [96, 96] },
        { kind: 'lineTo', to: [144, 96] },
        { kind: 'lineTo', to: [144, 144] },
        { kind: 'lineTo', to: [96, 144] },
        { kind: 'close' },
      ),
      'evenodd',
    ),
    { style: 'fill' },
  );

  const recording = finishDrawingRecorder(recorder);
  const prepared = prepareDrawingRecording(recording);
  const preparedDraw = prepared.passes[0]?.draws[0];

  assertEquals(prepared.passes[0]?.draws.length, 1);
  assertEquals(preparedDraw?.kind, 'pathFill');
  assertEquals(preparedDraw?.contours.length, 2);
  assertEquals(preparedDraw?.fillRule, 'evenodd');
});

Deno.test('dawn command buffer encodes clear passes and tracks unsupported commands', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);
  const recorder = createDrawingRecorder(sharedContext);

  recordClear(recorder, [0.25, 0.5, 0.75, 1]);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [10, 0] },
      { kind: 'lineTo', to: [10, 10] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const recording = finishDrawingRecorder(recorder);
  const commandBuffer = encodeDawnCommandBuffer(sharedContext, recording, binding);
  submitToDawnQueueManager(sharedContext.queueManager, commandBuffer);

  assertEquals(commandBuffer.backend, 'graphite-dawn');
  assertEquals(commandBuffer.prepared.passCount, 1);
  assertEquals(commandBuffer.passCount, 1);
  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.shaderModules.length, 2);
  assertEquals(mock.created.renderPipelines.length, 2);
  assertEquals(mock.created.drawCalls.length, 2);
  assertEquals(mock.created.drawCalls[0], 3);
  assertEquals(mock.created.drawCalls[1], 6);
  assertEquals(
    mock.created.renderPasses[0]?.colorAttachments[0]?.clearValue,
    { r: 0.25, g: 0.5, b: 0.75, a: 1 },
  );
  assertExists(mock.created.renderPasses[0]?.depthStencilAttachment);
  assertEquals(mock.created.submitted.length, 1);
  assertEquals(mock.created.submitted[0]?.length, 1);
  assertEquals(sharedContext.queueManager.submittedCount, 1);
  assertEquals(sharedContext.queueManager.inFlightCount, 1);
  assertEquals(sharedContext.queueManager.lastSubmittedRecorderId, recording.recorderId);
});

Deno.test('dawn command buffer draws flattened quadratic fill paths', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);
  const recorder = createDrawingRecorder(sharedContext);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 96] },
      { kind: 'quadTo', control: [96, 16], to: [160, 96] },
      { kind: 'lineTo', to: [160, 160] },
      { kind: 'lineTo', to: [32, 160] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.2, 0.4, 0.8, 1] },
  );

  const recording = finishDrawingRecorder(recorder);
  const commandBuffer = encodeDawnCommandBuffer(sharedContext, recording, binding);

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.drawCalls.length, 2);
  assertEquals((mock.created.drawCalls[0] ?? 0) > 3, true);
  assertEquals(mock.created.drawCalls[1], 6);
});

Deno.test('dawn command buffer draws each contour in a multi-contour fill path', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);
  const recorder = createDrawingRecorder(sharedContext);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [80, 16] },
      { kind: 'lineTo', to: [80, 80] },
      { kind: 'lineTo', to: [16, 80] },
      { kind: 'close' },
      { kind: 'moveTo', to: [96, 96] },
      { kind: 'lineTo', to: [160, 96] },
      { kind: 'lineTo', to: [160, 160] },
      { kind: 'lineTo', to: [96, 160] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.7, 0.2, 0.2, 1] },
  );

  const recording = finishDrawingRecorder(recorder);
  const commandBuffer = encodeDawnCommandBuffer(sharedContext, recording, binding);

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.drawCalls.length, 3);
  assertEquals(mock.created.drawCalls[0], 6);
  assertEquals(mock.created.drawCalls[1], 6);
  assertEquals(mock.created.drawCalls[2], 6);
});

Deno.test('dawn resource provider reuses path pipelines across command buffers', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);

  const createFilledRecording = () => {
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
      { style: 'fill', color: [0.2, 0.5, 0.7, 1] },
    );
    return finishDrawingRecorder(recorder);
  };

  encodeDawnCommandBuffer(sharedContext, createFilledRecording(), binding);
  encodeDawnCommandBuffer(sharedContext, createFilledRecording(), binding);

  assertEquals(mock.created.renderPipelines.length, 2);
  assertEquals(mock.created.shaderModules.length, 2);
});

Deno.test('dawn queue manager tracks submit and tick completion', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context, {
    tick: () => {
      mock.ticks.push(1);
    },
  });
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);
  const recorder = createDrawingRecorder(sharedContext);

  recordClear(recorder, [0, 0, 0, 1]);
  const recording = finishDrawingRecorder(recorder);
  const commandBuffer = encodeDawnCommandBuffer(sharedContext, recording, binding);

  submitToDawnQueueManager(queueManager, commandBuffer);

  assertEquals(queueManager.submittedCount, 1);
  assertEquals(queueManager.completedCount, 0);
  assertEquals(queueManager.inFlightCount, 1);

  await tickDawnQueueManager(queueManager);

  assertEquals(mock.ticks.length, 1);
  assertEquals(queueManager.completedCount, 1);
  assertEquals(queueManager.inFlightCount, 0);
});

Deno.test('drawing context increments recorder ids through shared context', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const sharedContext = createDawnSharedContext(backend);
  const first = createDrawingRecorder(sharedContext);
  const second = createDrawingRecorder(sharedContext);

  assertEquals(first.recorderId, 1);
  assertEquals(second.recorderId, 2);
  assertEquals(sharedContext.recorderCount, 2);
});
