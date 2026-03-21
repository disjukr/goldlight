import { assertEquals, assertExists } from 'jsr:@std/assert@^1.0.14';
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
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  prepareDrawingRecording,
  recordClear,
  recordDrawPath,
  recordDrawShape,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitDrawingRecorder,
  submitToDawnQueueManager,
  tickDawnQueueManager,
  translateDrawingRecorder,
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
  const scissorCalls: Array<readonly [number, number, number, number]> = [];
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
      scissorCalls,
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
                setScissorRect: (x: number, y: number, width: number, height: number) => {
                  scissorCalls.push([x, y, width, height]);
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
  assertEquals(first.clipRect, createRect(20, 30, 40, 50));
  assertEquals(second.transform, identityMatrix2D);
  assertEquals(second.clipRect, undefined);
  assertEquals(first.path.verbs[0], { kind: 'moveTo', to: [12, 15] });
});

Deno.test('drawing recorder supports explicit transform concatenation', () => {
  const mock = createMockGpuContext();
  const recorder = createDrawingRecorder(createDawnSharedContext(createDawnBackendContext(mock.context)));

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
  assertEquals(prepared.passes[0]?.steps[0]?.pipelineKeys, [
    'path-fill-nonzero-stencil',
    'path-fill-cover',
  ]);
  assertEquals(prepared.passes[0]?.steps[0]?.usesStencil, true);
  assertEquals(prepared.passes[1]?.loadOp, 'clear');
  assertEquals(prepared.passes[1]?.steps.length, 0);
  assertEquals(prepared.unsupportedCommands.length, 0);
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
  assertEquals((draw?.triangles.length ?? 0) > 6, true);
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
  assertEquals(step?.pipelineKeys, ['path-fill-evenodd-stencil', 'path-fill-cover']);
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
  assertEquals(prepared.passes[0]?.steps[0]?.clipBounds, createRect(32, 40, 64, 48));
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

  const commandBuffer = encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);
  submitToDawnQueueManager(sharedContext.queueManager, commandBuffer);

  assertEquals(commandBuffer.passCount, 1);
  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.renderPipelines.length, 2);
  assertEquals(mock.created.drawCalls.length, 2);
  assertExists(mock.created.renderPasses[0]?.depthStencilAttachment);
  assertEquals(mock.created.scissorCalls[0], [4, 6, 40, 50]);
  assertEquals(
    mock.created.renderPasses[0]?.colorAttachments[0]?.clearValue,
    { r: 0.25, g: 0.5, b: 0.75, a: 1 },
  );
});

Deno.test('dawn command buffer clips via clip path bounds fallback', () => {
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

  const commandBuffer = encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(mock.created.renderPipelines.length, 1);
  assertEquals(mock.created.drawCalls.length, 1);
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

  assertEquals(mock.created.renderPipelines.length, 3);
  assertEquals(mock.created.shaderModules.length, 3);
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
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordClear(recorder, [0, 0, 0, 1]);
  const commandBuffer = encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);
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
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const first = createDrawingRecorder(sharedContext);
  const second = createDrawingRecorder(sharedContext);

  assertEquals(first.recorderId, 1);
  assertEquals(second.recorderId, 2);
  assertEquals(sharedContext.recorderCount, 2);
});

Deno.test('submitDrawingRecorder exposes draw commands without mutating backend metadata', () => {
  const mock = createMockGpuContext();
  const recorder = createDrawingRecorder(createDawnSharedContext(createDawnBackendContext(mock.context)));

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
