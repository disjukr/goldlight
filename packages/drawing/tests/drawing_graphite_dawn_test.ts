import { assertEquals, assertExists } from 'jsr:@std/assert@^1.0.14';
import { createOffscreenBinding } from '@rieul3d/gpu';
import { createPath2D, createRect } from '@rieul3d/geometry';
import {
  createDawnBackendContext,
  encodeDawnCommandBuffer,
  createDawnCaps,
  createDawnSharedContext,
  createDrawingContext,
  createDrawingPath2DFromShape,
  createDrawingRecorder,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  recordDrawShape,
  submitDawnCommandBuffer,
  submitDrawingRecorder,
} from '@rieul3d/drawing';

const createMockGpuContext = () => {
  const buffers: GPUBufferDescriptor[] = [];
  const textures: GPUTextureDescriptor[] = [];
  const samplers: GPUSamplerDescriptor[] = [];
  const renderPasses: GPURenderPassDescriptor[] = [];
  const submitted: GPUCommandBuffer[][] = [];
  const finishedCommandBuffers: GPUCommandBuffer[] = [];
  const offscreenView = { label: 'offscreen-view' } as unknown as GPUTextureView;

  return {
    created: {
      buffers,
      textures,
      samplers,
      renderPasses,
      submitted,
      finishedCommandBuffers,
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
          return { descriptor } as unknown as GPUBuffer;
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
        createCommandEncoder: () =>
          ({
            beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
              renderPasses.push(descriptor);
              return {
                end: () => undefined,
              } as GPURenderPassEncoder;
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
  };
};

Deno.test('drawing shape path delegates path generation to geometry package', () => {
  const path = createDrawingPath2DFromShape({
    kind: 'rect',
    rect: createRect(10, 20, 30, 40),
  });

  assertEquals(path.verbs[0]?.kind, 'moveTo');
  assertEquals(path.verbs.length, 5);
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
  submitDawnCommandBuffer(sharedContext, commandBuffer);

  assertEquals(commandBuffer.backend, 'graphite-dawn');
  assertEquals(commandBuffer.passCount, 1);
  assertEquals(commandBuffer.unsupportedCommands.length, 1);
  assertEquals(commandBuffer.unsupportedCommands[0]?.kind, 'drawPath');
  assertEquals(mock.created.renderPasses.length, 1);
  assertEquals(
    mock.created.renderPasses[0]?.colorAttachments[0]?.clearValue,
    { r: 0.25, g: 0.5, b: 0.75, a: 1 },
  );
  assertEquals(mock.created.submitted.length, 1);
  assertEquals(mock.created.submitted[0]?.length, 1);
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
