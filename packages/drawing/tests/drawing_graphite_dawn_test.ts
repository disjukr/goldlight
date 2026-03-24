import { assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { createOffscreenBinding } from '@rieul3d/gpu';
import {
  createPath2D,
  createRect,
  createRectPath2D,
  createRRectPath2D,
  createScaleMatrix2D,
  createTranslationMatrix2D,
  identityMatrix2D,
  withPath2DFillRule,
} from '@rieul3d/geometry';
import {
  addCommandBufferToDawnQueueManager,
  addFinishedCallbackToDawnQueueManager,
  addFinishedCallbackToDawnSubmission,
  appendDrawingClipStackElement,
  checkForFinishedDawnQueueManager,
  checkForFinishedDawnQueueWork,
  clipDrawingRecorderPath,
  clipDrawingRecorderRect,
  clipDrawingRecorderShader,
  concatDrawingRecorderTransform,
  createDawnBackendContext,
  createDawnCaps,
  createDawnQueueManager,
  createDawnSharedContext,
  createDrawingClipStackSnapshot,
  createDrawingContext,
  createDrawingPath2DFromShape,
  createDrawingRecorder,
  createDrawingRendererProvider,
  encodeDawnCommandBuffer,
  encodePreparedDawnCommandBuffer,
  finishDrawingRecorder,
  getDrawingRawClipElementLatestInsertion,
  hasPendingDawnQueueWork,
  hasUnfinishedDawnQueueWork,
  popDrawingClipStackSave,
  prepareDawnRecording,
  prepareDrawingRecording,
  pushDrawingClipStackSave,
  recordClear,
  recordDrawPath,
  recordDrawShape,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitDawnCommandBuffer,
  submitDrawingRecorder,
  submitPendingWorkToDawnQueueManager,
  submitToDawnQueueManager,
  tickDawnQueueManager,
  translateDrawingRecorder,
  visitDrawingClipStackForDraw,
} from '@rieul3d/drawing';

const createMockGpuContext = () => {
  type MockTextureCopy = {
    source: unknown;
    destination: unknown;
    copySize: Readonly<{ width: number; height: number; depthOrArrayLayers: number }>;
  };
  const buffers: GPUBufferDescriptor[] = [];
  const destroyedBuffers: GPUBufferDescriptor[] = [];
  const textures: GPUTextureDescriptor[] = [];
  const samplers: GPUSamplerDescriptor[] = [];
  const renderPasses: GPURenderPassDescriptor[] = [];
  const textureCopies: MockTextureCopy[] = [];
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
      destroyedBuffers,
      textures,
      samplers,
      renderPasses,
      textureCopies,
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
            destroy: () => {
              destroyedBuffers.push(descriptor);
            },
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
            copyTextureToTexture: (
              source: unknown,
              destination: unknown,
              copySize: Readonly<{ width: number; height: number; depthOrArrayLayers: number }>,
            ) => {
              textureCopies.push({ source, destination, copySize });
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
  assertEquals(sharedContext.rendererProvider.pathRendererStrategy, 'tessellation');
  assertEquals(sharedContext.caps.supportsTimestampQuery, true);
  assertEquals(sharedContext.rendererProvider.pathRendererStrategy, 'tessellation');
  assertEquals(sharedContext.rendererProvider.renderers.length, 6);
  assertEquals(mock.created.bindGroupLayouts.length, 2);
  assertEquals(mock.created.buffers.length, 1);
  assertEquals(mock.created.textures.length, 1);
  assertEquals(mock.created.samplers.length, 1);
});

Deno.test('dawn shared context threads requested path renderer strategy into caps', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context), {
    pathRendererStrategy: 'tessellation',
  });

  assertEquals(sharedContext.caps.requestedPathRendererStrategy, 'tessellation');
  assertEquals(sharedContext.rendererProvider.pathRendererStrategy, 'tessellation');
});

Deno.test('drawing renderer provider follows graphite wedge versus curve heuristics', () => {
  const mock = createMockGpuContext();
  const provider = createDrawingRendererProvider(
    createDawnCaps(createDawnBackendContext(mock.context)),
  );

  assertEquals(provider.convexTessellatedWedges().kind, 'convex-tessellated-wedges');
  assertEquals(
    provider.getPathFillRenderer({
      fillRule: 'nonzero',
      patchCount: 8,
      hasWedges: true,
      isSingleConvexContour: true,
      verbCount: 12,
      drawBoundsArea: 4096,
    }).kind,
    'convex-tessellated-wedges',
  );
  assertEquals(
    provider.getPathFillRenderer({
      fillRule: 'nonzero',
      patchCount: 80,
      hasWedges: true,
      isSingleConvexContour: false,
      verbCount: 60,
      drawBoundsArea: 512 * 512,
    }).kind,
    'stencil-tessellated-curves',
  );
  assertEquals(
    provider.getPathFillRenderer({
      fillRule: 'evenodd',
      patchCount: 12,
      hasWedges: true,
      isSingleConvexContour: false,
      verbCount: 20,
      drawBoundsArea: 128 * 128,
    }).kind,
    'stencil-tessellated-wedges',
  );
  assertEquals(provider.stencilTessellatedWedges('evenodd').fillRule, 'evenodd');
  assertEquals(provider.stencilTessellatedCurves('nonzero').fillRule, 'nonzero');
});

Deno.test('prepareDawnRecording uses the shared-context renderer provider', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const provider = createDrawingRendererProvider(sharedContext.caps);
  const originalGetPathFillRenderer = provider.getPathFillRenderer;
  (provider as {
    getPathFillRenderer: typeof provider.getPathFillRenderer;
  }).getPathFillRenderer = (options) => {
    const selected = originalGetPathFillRenderer(options);
    return selected.kind === 'convex-tessellated-wedges'
      ? provider.stencilTessellatedCurves(options.fillRule)
      : selected;
  };
  (sharedContext as { rendererProvider: typeof provider }).rendererProvider = provider;

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [16, 96] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDawnRecording(sharedContext, finishDrawingRecorder(recorder));
  const draw = prepared.prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathFill');
  assertEquals(draw?.renderer.kind, 'stencil-tessellated-curves');
});

Deno.test('curve stencil fills use Graphite middle-out fan triangles', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const provider = createDrawingRendererProvider(sharedContext.caps);
  (sharedContext as { rendererProvider: typeof provider }).rendererProvider = {
    ...provider,
    getPathFillRenderer: (options) => provider.stencilTessellatedCurves(options.fillRule),
  };

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [16, 96] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDawnRecording(sharedContext, finishDrawingRecorder(recorder));
  const draw = prepared.prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathFill');
  assertEquals(draw?.renderer.kind, 'stencil-tessellated-curves');
  assertEquals(draw?.triangles, [
    [16, 16],
    [96, 16],
    [96, 96],
    [96, 96],
    [16, 96],
    [16, 16],
  ]);
});

Deno.test('curve stencil fills do not encode line patches into Graphite curve instances', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const binding = createOffscreenBinding(mock.context);
  const recorder = createDrawingRecorder(sharedContext);
  const provider = createDrawingRendererProvider(sharedContext.caps);
  (sharedContext as { rendererProvider: typeof provider }).rendererProvider = {
    ...provider,
    getPathFillRenderer: (options) => provider.stencilTessellatedCurves(options.fillRule),
  };

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'quadTo', control: [128, 48], to: [96, 96] },
      { kind: 'lineTo', to: [16, 96] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  const curveStep = mock.created.renderPasses.length > 0
    ? mock.created.buffers.find((buffer) =>
      buffer.label === 'drawing-vertices' && buffer.size === (12 * 4)
    )
    : undefined;
  assertEquals(curveStep !== undefined, true);
});

Deno.test('dawn resource provider uses replace for first clip writes', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));

  sharedContext.resourceProvider.findOrCreateGraphicsPipeline({
    label: 'drawing-clip-stencil-write',
    shader: 'path',
    vertexLayout: 'device-vertex',
    blendMode: 'src-over',
    depthStencil: 'clip-stencil-write',
    colorWriteDisabled: true,
    topology: 'triangle-list',
  });

  assertEquals(
    mock.created.renderPipelines[0]?.depthStencil?.stencilFront?.passOp,
    'replace',
  );
});

Deno.test('dawn fill stencil pipelines follow graphite depth-tested stencil settings', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));

  sharedContext.resourceProvider.findOrCreateGraphicsPipeline({
    label: 'drawing-path-fill-stencil-nonzero',
    shader: 'path',
    vertexLayout: 'device-vertex',
    blendMode: 'src-over',
    depthStencil: 'fill-stencil-nonzero',
    colorWriteDisabled: true,
    topology: 'triangle-list',
  });

  const pipeline = mock.created.renderPipelines[0];
  assertEquals(pipeline?.depthStencil?.depthCompare, 'less');
  assertEquals(pipeline?.depthStencil?.depthWriteEnabled, false);
  assertEquals(pipeline?.depthStencil?.stencilFront?.passOp, 'increment-wrap');
  assertEquals(pipeline?.depthStencil?.stencilBack?.passOp, 'decrement-wrap');
});

Deno.test('dawn stroke shader keeps graphite duplicated-edge seam handling', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const binding = createOffscreenBinding(mock.context);
  const recorder = createDrawingRecorder(sharedContext);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 24] },
      { kind: 'lineTo', to: [96, 24] },
      { kind: 'lineTo', to: [96, 96] },
    ),
    { style: 'stroke', strokeWidth: 12, strokeJoin: 'round' },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  const strokeShaderCode = mock.created.shaderModules
    .map((descriptor) => descriptor.code)
    .find((code) =>
      typeof code === 'string' &&
      code.includes('combinedEdgeID = max(combinedEdgeID, 0.0);') &&
      code.includes('if (lastRadialEdgeID == 0.0) {')
    );

  assertEquals(typeof strokeShaderCode, 'string');
});

Deno.test('dawn stroke shader pretransforms hairlines before tessellation like graphite', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const binding = createOffscreenBinding(mock.context);
  const recorder = createDrawingRecorder(sharedContext);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 24] },
      { kind: 'lineTo', to: [96, 48] },
    ),
    { style: 'stroke', strokeWidth: 0, strokeCap: 'round' },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  const strokeShaderCode = mock.created.shaderModules
    .map((descriptor) => descriptor.code)
    .find((code) =>
      typeof code === 'string' &&
      code.includes('curveP0 = affine * curveP0;') &&
      code.includes('lastControlPoint = affine * lastControlPoint;') &&
      code.includes('strokedCoord + step.matrix1.xy')
    );

  assertEquals(typeof strokeShaderCode, 'string');
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
  assertEquals(caps.requestedPathRendererStrategy, null);
  assertEquals(caps.avoidMSAA, false);
  assertEquals(caps.dstReadStrategy, 'texture-copy');
  assertEquals(caps.blendEquationSupport, 'basic');
  assertEquals(caps.supportsHardwareAdvancedBlending, false);
  assertEquals(caps.supportsDualSourceBlending, false);
  assertEquals(caps.minPathSizeForMSAA, 0);
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

Deno.test('dawn caps derive runtime policy from actual queue and device capabilities', () => {
  const mock = createMockGpuContext();
  const caps = createDawnCaps(createDawnBackendContext({
    ...mock.context,
    device: {
      ...mock.context.device,
      createComputePipeline: () => ({}) as GPUComputePipeline,
      createRenderPipelineAsync: () => Promise.resolve(({}) as GPURenderPipeline),
      pushErrorScope: () => undefined,
      popErrorScope: () => Promise.resolve(null),
    } as unknown as GPUDevice,
  }));

  assertEquals(caps.runtimeCapabilities.computeSupport, true);
  assertEquals(caps.runtimeCapabilities.allowCpuSync, true);
  assertEquals(caps.runtimeCapabilities.useAsyncPipelineCreation, true);
  assertEquals(caps.runtimeCapabilities.allowScopedErrorChecks, true);
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
  assertEquals(
    caps.getSupportedTextureUsages('bc1-rgba-unorm' as GPUTextureFormat).has('sample'),
    true,
  );
  assertEquals(
    caps.getSupportedTextureUsages('bc1-rgba-unorm' as GPUTextureFormat).has('copyDst'),
    true,
  );
  assertEquals(caps.getSupportedTextureUsages('external' as GPUTextureFormat).has('sample'), true);
  assertEquals(
    caps.getSupportedTextureUsages('external' as GPUTextureFormat).has('copyDst'),
    false,
  );
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
      const x1 = Math.min(
        bounds.origin[0] + bounds.size.width,
        candidate.origin[0] + candidate.size.width,
      );
      const y1 = Math.min(
        bounds.origin[1] + bounds.size.height,
        candidate.origin[1] + candidate.size.height,
      );
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
    'drawing-path-fill-patch-cover',
  ]);
  assertEquals(prepared.passes[0]?.steps[0]?.usesStencil, false);
  assertEquals(prepared.passes[1]?.loadOp, 'clear');
  assertEquals(prepared.passes[1]?.steps.length, 0);
  assertEquals(prepared.unsupportedCommands.length, 0);
});

Deno.test('drawing prepared recording preserves supported coeff blend modes', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', blendMode: 'src' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];

  assertEquals(prepared.unsupportedCommands.length, 0);
  assertEquals(step?.draw.blendMode, 'src');
  assertEquals(step?.draw.dstUsage, 0b0000);
  assertEquals(step?.pipelineDescs[0]?.blendMode, 'src');
});

Deno.test('drawing prepared recording keeps plus and screen on hardware blend path for dawn', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const plusRecorder = drawingContext.createRecorder();
  const screenRecorder = drawingContext.createRecorder();
  const path = createPath2D(
    { kind: 'moveTo', to: [0, 0] },
    { kind: 'lineTo', to: [20, 0] },
    { kind: 'lineTo', to: [20, 20] },
    { kind: 'close' },
  );

  recordDrawPath(plusRecorder, path, { style: 'fill', blendMode: 'plus' });
  recordDrawPath(screenRecorder, path, { style: 'fill', blendMode: 'screen' });

  const plusPrepared = prepareDrawingRecording(finishDrawingRecorder(plusRecorder));
  const screenPrepared = prepareDrawingRecording(finishDrawingRecorder(screenRecorder));

  assertEquals(plusPrepared.unsupportedCommands.length, 0);
  assertEquals(plusPrepared.passes[0]?.steps[0]?.draw.dstUsage, 0b0001);
  assertEquals(plusPrepared.passes[0]?.steps[0]?.pipelineDescs[0]?.blendMode, 'plus');
  assertEquals(screenPrepared.unsupportedCommands.length, 0);
  assertEquals(screenPrepared.passes[0]?.steps[0]?.draw.dstUsage, 0b0001);
  assertEquals(screenPrepared.passes[0]?.steps[0]?.pipelineDescs[0]?.blendMode, 'screen');
});

Deno.test('drawing prepared recording keeps coeff dst-over on the hardware blend path', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', blendMode: 'dst-over' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];

  assertEquals(prepared.unsupportedCommands.length, 0);
  assertEquals(step?.draw.blendMode, 'dst-over');
  assertEquals(step?.draw.dstUsage, 0b0001);
  assertEquals(step?.pipelineDescs[0]?.blendMode, 'dst-over');
});

Deno.test('drawing prepared recording marks advanced blend modes for dst read', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', blendMode: 'multiply' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];

  assertEquals(prepared.unsupportedCommands.length, 0);
  assertEquals(step?.draw.blendMode, 'multiply');
  assertEquals(step?.draw.dstUsage, 0b0111);
  assertEquals(step?.pipelineDescs[0]?.blendMode, 'src');
});

Deno.test('drawing prepared recording treats lcd coverage as dst-read for non-src-over', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', blendMode: 'src', coverage: 'lcd' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];

  assertEquals(step?.draw.coverage, 'none');
  assertEquals(step?.draw.dstUsage, 0b0000);
  assertEquals(step?.pipelineDescs[0]?.blendMode, 'src');
});

Deno.test('drawing prepared recording carries arithmetic custom blenders into dst-read path', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    {
      style: 'fill',
      blender: { kind: 'arithmetic', coefficients: [0.25, 0.5, 0.25, 0.1] },
    },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const step = prepared.passes[0]?.steps[0];

  assertEquals(step?.draw.blender?.kind, 'arithmetic');
  assertEquals(step?.draw.dstUsage, 0b0011);
  assertEquals(step?.pipelineDescs[0]?.blendMode, 'src');
});

Deno.test('drawing prepared recording assigns original painter depth within each pass', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

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
  recordClear(recorder, [1, 1, 1, 1]);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 0] },
      { kind: 'lineTo', to: [44, 0] },
      { kind: 'lineTo', to: [44, 20] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 6 },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [48, 0] },
      { kind: 'lineTo', to: [68, 0] },
      { kind: 'lineTo', to: [68, 20] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 6 },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const firstPassDepths = prepared.passes[0]?.steps.map((step) => step.depth) ?? [];
  const secondPassDepths = prepared.passes[1]?.steps.map((step) => step.depth) ?? [];

  assertEquals(firstPassDepths.length, 1);
  assertEquals(secondPassDepths.length, 2);
  assertEquals(secondPassDepths[0]! > secondPassDepths[1]!, true);
  assertEquals(firstPassDepths[0], secondPassDepths[0]);
});

Deno.test('drawing prepared recording marks overlapping translucent draws as dst dependent', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [40, 0] },
      { kind: 'lineTo', to: [40, 40] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 0.5] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [20, 20] },
      { kind: 'lineTo', to: [60, 20] },
      { kind: 'lineTo', to: [60, 60] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 0.5] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(steps[0]?.dependsOnDst, true);
  assertEquals(steps[1]?.dependsOnDst, true);
  assertEquals((steps[1]?.paintOrder ?? -1) >= (steps[0]?.paintOrder ?? -1), true);
  assertEquals((steps[1]?.depth ?? 1) < (steps[0]?.depth ?? 0), true);
});

Deno.test('drawing prepared recording compresses disjoint opaque fills to same paint order', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 1] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [40, 0] },
      { kind: 'lineTo', to: [60, 0] },
      { kind: 'lineTo', to: [60, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(steps[0]?.dependsOnDst, false);
  assertEquals(steps[1]?.dependsOnDst, false);
  assertEquals(steps[0]?.paintOrder, 0);
  assertEquals(steps[1]?.paintOrder, 0);
});

Deno.test('drawing prepared recording separates overlapping stencil fills into later paint orders', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'cubicTo', control1: [60, -20], control2: [60, 80], to: [0, 60] },
      { kind: 'lineTo', to: [10, 10] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0.5, 0, 1] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [20, 0] },
      { kind: 'cubicTo', control1: [80, -20], control2: [80, 80], to: [20, 60] },
      { kind: 'lineTo', to: [30, 10] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 0, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(steps[0]?.usesFillStencil, true);
  assertEquals(steps[1]?.usesFillStencil, true);
  assertEquals(steps[0]?.paintOrder, 0);
  assertEquals(steps[1]?.paintOrder, 1);
});

Deno.test('drawing prepared recording separates overlapping direct fills after stencil fills', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'cubicTo', control1: [60, -20], control2: [60, 80], to: [0, 60] },
      { kind: 'lineTo', to: [10, 10] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0.5, 0, 1] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [10, 10] },
      { kind: 'lineTo', to: [50, 10] },
      { kind: 'lineTo', to: [50, 50] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 0, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(steps[0]?.usesFillStencil, true);
  assertEquals(steps[1]?.usesFillStencil, false);
  assertEquals(steps[0]?.paintOrder, 0);
  assertEquals(steps[1]?.paintOrder, 1);
});

Deno.test('drawing prepared recording preserves stencil step order within a single draw', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'cubicTo', control1: [60, -20], control2: [60, 80], to: [0, 60] },
      { kind: 'lineTo', to: [10, 10] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0.5, 0, 1] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [80, 0] },
      { kind: 'lineTo', to: [120, 0] },
      { kind: 'lineTo', to: [120, 40] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.5, 0.2, 0.8, 0.8] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const renderSteps = prepared.passes[0]?.renderSteps ?? [];
  const stencilDrawSteps = renderSteps
    .filter((step) => step.stepIndex === 0)
    .map((step) => step.kind);

  assertEquals(stencilDrawSteps, ['fill-stencil', 'fill-cover']);
});

Deno.test('drawing prepared recording compresses disjoint translucent draws to same paint order', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 0.5] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [40, 0] },
      { kind: 'lineTo', to: [60, 0] },
      { kind: 'lineTo', to: [60, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 0.5] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(steps[0]?.dependsOnDst, true);
  assertEquals(steps[1]?.dependsOnDst, true);
  assertEquals(steps[0]?.paintOrder, 0);
  assertEquals(steps[1]?.paintOrder, 0);
});

Deno.test('drawing prepared recording can drop back to earlier compressed paint order for later disjoint draws', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [20, 0] },
      { kind: 'lineTo', to: [20, 20] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 0.5] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [10, 10] },
      { kind: 'lineTo', to: [30, 10] },
      { kind: 'lineTo', to: [30, 30] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 0.5] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [60, 60] },
      { kind: 'lineTo', to: [80, 60] },
      { kind: 'lineTo', to: [80, 80] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 1, 0, 0.5] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 3);
  assertEquals(steps[0]?.paintOrder, 0);
  assertEquals(steps[1]?.paintOrder, 1);
  assertEquals(steps[2]?.paintOrder, 0);
});

Deno.test('drawing prepared recording uses clipped draw bounds for dst dependency queries', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderRect(recorder, createRect(0, 0, 20, 20));
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [60, 0] },
      { kind: 'lineTo', to: [60, 60] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 0.5] },
  );
  restoreDrawingRecorder(recorder);

  clipDrawingRecorderRect(recorder, createRect(40, 40, 20, 20));
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [60, 0] },
      { kind: 'lineTo', to: [60, 60] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 0.5] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(steps[0]?.dependsOnDst, true);
  assertEquals(steps[1]?.dependsOnDst, true);
  assertEquals(steps[0]?.drawBounds, createRect(0, 0, 20, 20));
  assertEquals(steps[1]?.drawBounds, createRect(40, 40, 20, 20));
  assertEquals(steps[0]?.paintOrder, 0);
  assertEquals(steps[1]?.paintOrder, 0);
});

Deno.test('drawing prepared recording uses conservative transformed stroke bounds for order compression', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();
  const skewTransform: [number, number, number, number, number, number] = [1, 0, -1, 1, 0, 0];

  concatDrawingRecorderTransform(recorder, skewTransform);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [10, 50] },
    ),
    { style: 'stroke', strokeWidth: 12, color: [1, 0, 0, 0.5] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [18, 0] },
      { kind: 'lineTo', to: [28, 50] },
    ),
    { style: 'stroke', strokeWidth: 12, color: [0, 0, 1, 0.5] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(steps[0]!.drawBounds.origin[0] < steps[1]!.drawBounds.origin[0], true);
  assertEquals(steps[0]!.paintOrder, 0);
  assertEquals(steps[1]!.paintOrder, 1);
});

Deno.test('drawing prepared recording uses Graphite-style stroke inflation for tessellated stroke ordering', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [410, 675] },
      {
        kind: 'arcTo',
        center: [500, 675],
        radius: 90,
        startAngle: Math.PI,
        endAngle: 0,
      },
    ),
    {
      style: 'stroke',
      strokeWidth: 18,
      strokeJoin: 'round',
      strokeCap: 'round',
      color: [0.13, 0.45, 0.36, 0.85],
    },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [500, 748] },
      { kind: 'lineTo', to: [542, 878] },
      { kind: 'lineTo', to: [430, 796] },
      { kind: 'lineTo', to: [570, 796] },
      { kind: 'lineTo', to: [458, 878] },
      { kind: 'close' },
    ),
    {
      style: 'stroke',
      strokeWidth: 18,
      strokeJoin: 'miter',
      strokeCap: 'butt',
      miterLimit: 4,
      color: [0.66, 0.22, 0.72, 0.5],
    },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];

  assertEquals(steps.length, 2);
  assertEquals(
    steps[0]!.drawBounds.origin[1] + steps[0]!.drawBounds.size.height >
      steps[1]!.drawBounds.origin[1],
    true,
  );
  assertEquals(steps[1]!.paintOrder, 1);
});

Deno.test('drawing prepared recording preserves shared clip element ids across restored clips', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  saveDrawingRecorder(recorder);
  clipDrawingRecorderRect(recorder, createRect(0, 0, 60, 60));
  saveDrawingRecorder(recorder);
  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [10, 10] },
      { kind: 'lineTo', to: [40, 10] },
      { kind: 'lineTo', to: [25, 40] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [50, 0] },
      { kind: 'lineTo', to: [50, 50] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 1] },
  );
  restoreDrawingRecorder(recorder);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [50, 0] },
      { kind: 'lineTo', to: [50, 50] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const steps = prepared.passes[0]?.steps ?? [];
  const firstIds = steps[0]?.draw.clip?.effectiveElementIds ?? [];
  const secondIds = steps[1]?.draw.clip?.effectiveElementIds ?? [];

  assertEquals(firstIds.length, 2);
  assertEquals(secondIds.length, 1);
  assertEquals(firstIds[0], secondIds[0]);
  assertEquals(firstIds[1] !== secondIds[0], true);
});

Deno.test('drawing prepared recording finalizes deferred clip draws when a clear flushes the pass', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [64, 96] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [128, 0] },
      { kind: 'lineTo', to: [128, 128] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 1] },
  );
  recordClear(recorder, [0, 0, 0, 0]);

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const firstPass = prepared.passes[0];
  const secondPass = prepared.passes[1];
  const rawClipElement = firstPass?.steps[0]?.draw.clip?.effectiveElements?.[0]?.rawElement;

  assertEquals(firstPass?.clipDraws.length, 1);
  assertEquals(firstPass?.steps[0]?.clipDrawIds.length, 1);
  assertEquals((firstPass?.renderSteps[0]?.clipDrawIds.length ?? 0) > 0, true);
  assertEquals(firstPass?.clipDraws[0]?.latestInsertion.wrapperKind, 'depth-only');
  assertEquals(firstPass?.clipDraws[0]?.sourceRenderStep.renderStepKind, 'fill-main');
  assertEquals(
    firstPass?.clipDraws[0]?.sourceRenderStep.pipelineKey,
    'drawing-path-fill-patch-clip-cover',
  );
  assertEquals(firstPass?.clipDraws[0]?.sourceRenderStep.requiresBarrier, false);
  assertEquals(
    firstPass?.renderSteps.some((step) =>
      step.pipelineDesc.label === firstPass.clipDraws[0]?.latestInsertion.pipelineKey &&
      step.renderStepIndex === firstPass.clipDraws[0]?.latestInsertion.renderStepIndex
    ),
    true,
  );
  assertEquals(getDrawingRawClipElementLatestInsertion(rawClipElement!), undefined);
  assertEquals(secondPass?.loadOp, 'clear');
});

Deno.test('drawing prepared recording preserves clip boundary ordering across successive clipped fills', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [112, 16] },
      { kind: 'lineTo', to: [64, 112] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 24] },
      { kind: 'lineTo', to: [104, 24] },
      { kind: 'lineTo', to: [104, 104] },
      { kind: 'lineTo', to: [24, 104] },
      { kind: 'close' },
      { kind: 'moveTo', to: [40, 40] },
      { kind: 'lineTo', to: [88, 40] },
      { kind: 'lineTo', to: [88, 88] },
      { kind: 'lineTo', to: [40, 88] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 32] },
      { kind: 'lineTo', to: [96, 32] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [32, 96] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.9, 0.2, 0.2, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const pass = prepared.passes[0]!;

  assertEquals(pass.steps.length, 2);
  assertEquals(pass.steps[1]!.paintOrder > pass.steps[0]!.paintOrder, false);
  assertEquals(pass.clipDraws[0]?.latestInsertion.wrapperKind, 'depth-only');
  assertEquals(pass.renderSteps.filter((step) => step.paintOrder === 0).length > 0, true);
  assertEquals(pass.renderSteps.filter((step) => step.paintOrder === 1).length > 0, false);
  assertEquals(pass.renderSteps.some((step) => step.kind === 'fill-main'), true);
});

Deno.test('drawing prepared recording isolates dst-read barrier wrappers from ordinary fills', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();
  const path = createPath2D(
    { kind: 'moveTo', to: [16, 16] },
    { kind: 'lineTo', to: [96, 16] },
    { kind: 'lineTo', to: [96, 96] },
    { kind: 'lineTo', to: [16, 96] },
    { kind: 'close' },
  );

  recordDrawPath(recorder, path, { style: 'fill', blendMode: 'multiply' });
  recordDrawPath(recorder, path, { style: 'fill', color: [0.1, 0.5, 0.8, 1] });

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const pass = prepared.passes[0]!;

  assertEquals(pass.steps.length, 2);
  assertEquals(pass.steps[0]!.requiresBarrier, true);
  assertEquals(pass.steps[1]!.requiresBarrier, false);
  assertEquals(pass.steps[1]!.paintOrder > pass.steps[0]!.paintOrder, false);
  assertEquals(pass.renderSteps[0]!.requiresBarrier, true);
  assertEquals(pass.renderSteps.some((step) => step.requiresBarrier === false), true);
});

Deno.test('drawing prepared recording preserves record order for ordinary fills in the same layer', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createRectPath2D(createRect(0, 0, 160, 160)),
    { style: 'fill', color: [0.1, 0.1, 0.1, 1] },
  );
  recordDrawPath(
    recorder,
    createRectPath2D(createRect(16, 16, 48, 48)),
    { style: 'fill', color: [1, 0, 0, 1] },
  );
  recordDrawPath(
    recorder,
    createRectPath2D(createRect(80, 16, 48, 48)),
    { style: 'fill', color: [0, 1, 0, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const pass = prepared.passes[0]!;

  assertEquals(pass.steps.map((step) => step.paintOrder), [0, 0, 0]);
  assertEquals(pass.renderSteps.map((step) => step.originalOrder), [0, 1, 2]);
});

Deno.test('drawing prepared recording expands stencil fills into render steps', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
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
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const pass = prepared.passes[0]!;

  assertEquals(pass.steps.length, 1);
  assertEquals(pass.renderSteps.map((step) => step.kind), ['fill-stencil', 'fill-cover']);
});

Deno.test('dawn command buffer executes expanded render steps for stencil fills', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
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
    { style: 'fill' },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.drawCalls.length, 2);
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
  assertEquals(
    preparedWork.resources.tasks[0]?.passes[0]?.steps.length,
    preparedWork.prepared.passes[0]?.renderSteps.length,
  );
  assertEquals((preparedWork.resources.tasks[0]?.passes[0]?.pipelineHandles.length ?? 0) > 0, true);
  assertEquals(
    (preparedWork.resources.tasks[0]?.passes[0]?.resolvedPipelines.length ?? 0) > 0,
    true,
  );
  assertEquals(commandBuffer.prepared, preparedWork.prepared);
});

Deno.test('drawing prepared recording selects convex tessellated wedges for simple convex fills', () => {
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
  assertEquals(draw?.renderer.kind, 'convex-tessellated-wedges');
  assertEquals((draw?.triangles.length ?? 0) > 0, true);
});

Deno.test('drawing prepared recording uses Graphite convexity for concave cubic fills', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [370, 89] },
      {
        kind: 'cubicTo',
        control1: [410.92, 99.72],
        control2: [474.16, 139.92],
        to: [463, 153.32],
      },
      {
        kind: 'cubicTo',
        control1: [451.84, 182.8],
        control2: [425.8, 225.36],
        to: [384.88, 223],
      },
      {
        kind: 'cubicTo',
        control1: [347.68, 220.32],
        control2: [317.92, 198.88],
        to: [277, 169.4],
      },
      {
        kind: 'cubicTo',
        control1: [310.48, 131.88],
        control2: [340.24, 107.76],
        to: [370, 89],
      },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;

  assertEquals(draw?.kind, 'pathFill');
  assertEquals(draw?.renderer.kind, 'stencil-tessellated-wedges');
});

Deno.test('drawing prepared recording uses Graphite path bounds for cubic fill cover', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [88, 850] },
      { kind: 'lineTo', to: [282, 850] },
      { kind: 'lineTo', to: [282, 890] },
      {
        kind: 'cubicTo',
        control1: [248, 926],
        control2: [122, 926],
        to: [88, 890],
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
  assertEquals(draw.bounds.origin, [88, 850]);
  assertEquals(draw.bounds.size.width, 194);
  assertEquals(draw.bounds.size.height, 76);
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
  assertEquals(draw.renderer.kind, 'convex-tessellated-wedges');
  assertEquals(draw.triangles.length > 6, true);
  assertEquals(Math.floor(draw.bounds.origin[0]), 24);
  assertEquals(draw.patches.length > 0, true);
  assertEquals(draw.patches.some((patch) => patch.fanPoint !== undefined), true);
  assertEquals(prepared.passes[0]?.steps[0]?.pipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-path-fill-patch-cover',
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

Deno.test('drawing prepared recording uses Graphite contour midpoint for wedge fan points', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 24] },
      { kind: 'lineTo', to: [144, 24] },
      { kind: 'lineTo', to: [144, 120] },
      { kind: 'lineTo', to: [24, 120] },
      { kind: 'close' },
      { kind: 'moveTo', to: [84, 44] },
      { kind: 'lineTo', to: [52, 72] },
      { kind: 'lineTo', to: [84, 100] },
      { kind: 'lineTo', to: [116, 72] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.2, 0.4, 0.8, 1] },
  );

  const recording = finishDrawingRecorder(recorder);
  const prepared = prepareDrawingRecording(recording);
  const draw = prepared.passes[0]!.steps[0]!.draw;
  const preparedWork = prepareDawnRecording(
    createDawnSharedContext(createDawnBackendContext(mock.context)),
    recording,
  );

  assertEquals(draw.renderer.kind, 'stencil-tessellated-wedges');
  if (draw.kind !== 'pathFill') {
    throw new Error(`expected pathFill draw, got ${draw.kind}`);
  }
  const wedgePatches = draw.patches.filter(
    (patch): patch is (typeof draw.patches)[number] & { fanPoint: [number, number] } =>
      'fanPoint' in patch && patch.fanPoint !== undefined,
  );
  assertEquals(wedgePatches.length > 0, true);
  assertEquals(wedgePatches[0]!.fanPoint, [104, 88]);
  assertEquals(preparedWork.resources.tasks[0]!.passes[0]!.steps[0]!.instanceCount, 8);
});

Deno.test('drawing prepared wedge fills implicitly close open contours like Graphite', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [96, 96] },
    ),
    { style: 'fill', color: [0.8, 0.4, 0.2, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]!.steps[0]!.draw;

  if (draw.kind !== 'pathFill') {
    throw new Error(`expected pathFill draw, got ${draw.kind}`);
  }

  assertEquals(
    draw.patches.some((patch) =>
      patch.kind === 'line' &&
      patch.points[0][0] === 96 &&
      patch.points[0][1] === 96 &&
      patch.points[1][0] === 16 &&
      patch.points[1][1] === 16
    ),
    true,
  );
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
    'drawing-path-fill-patch-clip-cover',
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
  assertEquals(draw.renderer.kind, 'convex-tessellated-wedges');
  assertEquals(draw.patches.length > 0, true);
  assertEquals((draw.fringeVertices?.length ?? 0) > 0, false);
  assertEquals(step?.clipRect, createRect(32, 32, 80, 80));
  assertEquals(step?.pipelineDescs.map((pipeline) => pipeline.label), [
    'drawing-path-fill-patch-clip-cover',
  ]);
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
  assertEquals(step?.draw.clip?.elements?.map((element) => element.op), [
    'intersect',
    'difference',
  ]);
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

Deno.test('drawing prepared recording carries linear gradient shader metadata', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);

  recordDrawPath(
    recorder,
    createRectPath2D(createRect(24, 24, 120, 96)),
    {
      style: 'fill',
      shader: {
        kind: 'linear-gradient',
        start: [24, 24],
        end: [144, 120],
        stops: [
          { offset: 0, color: [1, 0.4, 0.2, 1] },
          { offset: 1, color: [0.1, 0.5, 1, 1] },
        ],
      },
    },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathFill');
  assertEquals(draw?.shader?.kind, 'linear-gradient');
  assertEquals(draw?.shader?.stops[0], { offset: 0, color: [1, 0.4, 0.2, 1] });
  assertEquals(draw?.shader?.stops[1], { offset: 1, color: [0.1, 0.5, 1, 1] });
});

Deno.test('dawn command buffer encodes gradient-filled draws without unsupported commands', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [48, 32] },
      { kind: 'lineTo', to: [128, 56] },
      { kind: 'lineTo', to: [112, 144] },
      { kind: 'lineTo', to: [32, 132] },
      { kind: 'close' },
    ),
    {
      style: 'fill',
      shader: {
        kind: 'sweep-gradient',
        center: [80, 88],
        startAngle: 0,
        endAngle: Math.PI * 2,
        stops: [
          { offset: 0, color: [1, 0.84, 0.22, 1] },
          { offset: 1, color: [0.28, 0.22, 1, 1] },
        ],
      },
    },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  const pathShaderCode = mock.created.shaderModules
    .map((descriptor) => descriptor.code)
    .find((code) =>
      typeof code === 'string' &&
      code.includes('fn paint_shader_color(devicePosition: vec2<f32>) -> vec4<f32>') &&
      code.includes(
        'fn sweep_grad_layout(biasParam: f32, scaleParam: f32, pos: vec2<f32>) -> vec2<f32>',
      ) &&
      code.includes('fn colorize_grad_4(t: vec2<f32>) -> vec4<f32>')
    );
  assertEquals(typeof pathShaderCode, 'string');
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
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.renderer.kind, 'tessellated-strokes');
  assertEquals(draw.patches.length > 0, true);
  assertEquals(draw.usesTessellatedStrokePatches, true);
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
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.patches.length > 0, true);
  assertEquals(draw.usesTessellatedStrokePatches, true);
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
  const firstCurvePatch = draw.patches.find((patch) => {
    const points = patch.patch.points;
    return points.some((point) => point[0] !== points[0]![0] || point[1] !== points[0]![1]);
  });
  assertEquals(firstCurvePatch?.joinControlPoint, [0, 0]);
  assertEquals(firstCurvePatch?.startCap, 'round');
  assertEquals(draw.usesTessellatedStrokePatches, true);
});

Deno.test('drawing prepared stroke patches keep open contour joins chained across split curves', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [410, 730] },
      {
        kind: 'arcTo',
        center: [500, 730],
        radius: 90,
        startAngle: Math.PI,
        endAngle: 0,
      },
    ),
    { style: 'stroke', strokeWidth: 18, strokeJoin: 'round', strokeCap: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  const conicPatches = draw.patches.filter((patch) => patch.patch.kind === 'conic');
  assertEquals(conicPatches.length, 2);
  assertEquals(conicPatches[0]?.joinControlPoint, [410, 820]);
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
  assertEquals(draw.patches.at(-1)?.joinControlPoint, [40, 30]);
  assertEquals(draw.patches.at(-1)?.startCap, 'none');
  assertEquals(draw.patches.at(-1)?.contourStart, true);
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
  const syntheticCircles = draw.patches.filter((patch) =>
    patch.patch.kind === 'cubic' &&
    patch.patch.points.every((point) =>
      point[0] === patch.patch.points[0]![0] && point[1] === patch.patch.points[0]![1]
    ) &&
    patch.startCap === 'none' &&
    patch.endCap === 'none'
  );
  assertEquals(syntheticCircles.length >= 2, true);
  assertEquals(syntheticCircles.every((patch) => !patch.contourStart && !patch.contourEnd), true);
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

Deno.test('drawing prepared stroke patches emit square cap patches for open contours', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [260, 315] },
      { kind: 'lineTo', to: [380, 315] },
    ),
    { style: 'stroke', strokeWidth: 32, strokeJoin: 'round', strokeCap: 'square' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.patches[0]?.patch.kind, 'line');
  assertEquals(draw.patches[1]?.patch.kind, 'line');
  assertEquals(draw.patches.at(-1)?.patch.kind, 'line');
  assertEquals(draw.patches[0]?.joinControlPoint, [260, 315]);
  assertEquals(draw.patches[1]?.joinControlPoint, [244, 315]);
  assertEquals(draw.patches[0]?.patch.points, [[380, 315], [396, 315]]);
  assertEquals(draw.patches[1]?.patch.points, [[244, 315], [260, 315]]);
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
      firstPatch: draw.patches[0],
    };
  };

  const round = prepareCapKinds('round');
  assertEquals(round.usesTessellatedStrokePatches, true);
  assertEquals(round.patchCount > 0, true);
  assertEquals(round.firstPatch?.startCap, 'round');
  assertEquals(round.firstPatch?.endCap, 'round');
  assertEquals(round.firstPatch?.contourStart, true);
  assertEquals(round.firstPatch?.contourEnd, true);

  const square = prepareCapKinds('square');
  assertEquals(square.usesTessellatedStrokePatches, true);
  assertEquals(square.patchCount > 0, true);
  assertEquals(square.firstPatch?.patch.kind, 'line');
  assertEquals(square.firstPatch?.startCap, 'square');
  assertEquals(square.firstPatch?.endCap, 'square');
  assertEquals(square.firstPatch?.contourStart, true);
  assertEquals(square.firstPatch?.contourEnd, true);
});

Deno.test('drawing prepared stroke patches treat empty closed contours as zero-length round caps', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [144, 96] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 12, strokeCap: 'round', strokeJoin: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.usesTessellatedStrokePatches, true);
  assertEquals(draw.patches.length, 1);
  assertEquals(draw.patches[0]?.patch.kind, 'cubic');
  assertEquals(draw.patches[0]?.joinControlPoint, [144, 96]);
  assertEquals(draw.patches[0]?.startCap, 'round');
  assertEquals(draw.patches[0]?.endCap, 'round');
});

Deno.test('drawing prepared stroke patches treat empty closed contours as zero-length square caps', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [200, 140] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 12, strokeCap: 'square', strokeJoin: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.usesTessellatedStrokePatches, true);
  assertEquals(draw.patches.length, 1);
  assertEquals(draw.patches[0]?.patch.kind, 'line');
  assertEquals(draw.patches[0]?.patch.points, [[194, 140], [206, 140]]);
  assertEquals(draw.patches[0]?.joinControlPoint, [194, 140]);
  assertEquals(draw.patches[0]?.startCap, 'square');
  assertEquals(draw.patches[0]?.endCap, 'square');
});

Deno.test('drawing prepared stroke patches use inverse view scale for hairline square caps', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  concatDrawingRecorderTransform(recorder, [2, 1, 0, 3, 0, 0]);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [200, 140] },
      { kind: 'close' },
    ),
    { style: 'stroke', strokeWidth: 0.5, strokeCap: 'square', strokeJoin: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.patches.length, 1);
  assertEquals(draw.patches[0]?.patch.kind, 'line');
  assertAlmostEquals(draw.patches[0]!.patch.points[0]![0], 199.75);
  assertAlmostEquals(draw.patches[0]!.patch.points[0]![1], 140.08333333333334);
  assertAlmostEquals(draw.patches[0]!.patch.points[1]![0], 200.25);
  assertAlmostEquals(draw.patches[0]!.patch.points[1]![1], 139.91666666666666);
});

Deno.test('drawing prepared recording reopens contours from the closed start point', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [10, 10] },
      { kind: 'lineTo', to: [30, 10] },
      { kind: 'lineTo', to: [30, 30] },
      { kind: 'close' },
      { kind: 'lineTo', to: [60, 10] },
    ),
    { style: 'stroke', strokeWidth: 8, strokeCap: 'round', strokeJoin: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  const reopenedLinePatch = draw.patches.find((patch) =>
    patch.patch.kind === 'line' &&
    patch.patch.points[0]?.[0] === 10 &&
    patch.patch.points[0]?.[1] === 10 &&
    patch.patch.points[1]?.[0] === 60 &&
    patch.patch.points[1]?.[1] === 10
  );
  assertEquals(Boolean(reopenedLinePatch), true);
  assertEquals(draw.usesTessellatedStrokePatches, true);
});

Deno.test('dawn prepared stroke payload stores cpu-derived maxScale for tessellation', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const transform: [number, number, number, number, number, number] = [1, 0, 1, 1, 0, 0];

  concatDrawingRecorderTransform(recorder, transform);
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'quadTo', control: [20, 30], to: [40, 0] },
    ),
    { style: 'stroke', strokeWidth: 8, strokeCap: 'round', strokeJoin: 'round' },
  );

  const prepared = prepareDawnRecording(sharedContext, finishDrawingRecorder(recorder));
  const step = prepared.resources.tasks[0]?.passes[0]?.steps[0];
  if (!step) {
    throw new Error('expected prepared step resources');
  }

  const payload = new Float32Array(step.stepPayloadBuffer.getMappedRange());
  const expectedMaxScale = Math.sqrt((3 + Math.sqrt(5)) / 2);
  assertAlmostEquals(payload[6]!, expectedMaxScale, 1e-6);
});

Deno.test('drawing prepared stroke patches split quadratic cusps at the Skia mid-tangent', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'quadTo', control: [4, 0], to: [1, 0] },
    ),
    { style: 'stroke', strokeWidth: 8, strokeCap: 'round', strokeJoin: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }

  const cuspSplit = draw.patches.find((patch) =>
    patch.patch.kind === 'line' &&
    Math.abs(patch.patch.points[1][0] - (16 / 7)) < 1e-6 &&
    Math.abs(patch.patch.points[1][1]) < 1e-6
  );
  assertEquals(Boolean(cuspSplit), true);
  const cuspCircle = draw.patches.find((patch) =>
    patch.patch.kind === 'cubic' &&
    patch.patch.points.every((point) =>
      Math.abs(point[0] - (16 / 7)) < 1e-6 && Math.abs(point[1]) < 1e-6
    )
  );
  assertEquals(cuspCircle?.startCap, 'none');
  assertEquals(cuspCircle?.endCap, 'none');
});

Deno.test('drawing prepared stroke patches split conic cusps at the Skia mid-tangent', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'conicTo', control: [4, 0], to: [1, 0], weight: 0.5 },
    ),
    { style: 'stroke', strokeWidth: 8, strokeCap: 'round', strokeJoin: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }

  const cuspSplit = draw.patches.find((patch) =>
    patch.patch.kind === 'line' &&
    Math.abs(patch.patch.points[1][0] - 1.7370341836426595) < 1e-6 &&
    Math.abs(patch.patch.points[1][1]) < 1e-6
  );
  assertEquals(Boolean(cuspSplit), true);
  const cuspCircle = draw.patches.find((patch) =>
    patch.patch.kind === 'cubic' &&
    patch.patch.points.every((point) =>
      Math.abs(point[0] - 1.7370341836426595) < 1e-6 && Math.abs(point[1]) < 1e-6
    )
  );
  assertEquals(cuspCircle?.startCap, 'none');
  assertEquals(cuspCircle?.endCap, 'none');
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

Deno.test('drawing prepared stroke patches convert two-cusp cubics into line fallback', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'cubicTo', control1: [100, 0], control2: [-100, 0], to: [0, 0] },
    ),
    { style: 'stroke', strokeWidth: 10, strokeJoin: 'round', strokeCap: 'round' },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const draw = prepared.passes[0]?.steps[0]?.draw;
  assertEquals(draw?.kind, 'pathStroke');
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(
    draw.patches.filter((patch) => patch.patch.kind === 'line').length,
    3,
  );
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
  if (draw?.kind !== 'pathStroke') {
    throw new Error('expected pathStroke draw');
  }
  assertEquals(draw.patches.length > 0, true);
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
  assertEquals(draw?.renderer.kind, 'tessellated-strokes');
  assertEquals(draw?.color, [0.4, 0.6, 0.8, 0.5]);
});

Deno.test('drawing prepared recording adds non-AA inner fill render step for renderer-only dst usage', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [16, 96] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.2, 0.4, 0.8, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const renderSteps = prepared.passes[0]?.renderSteps ?? [];

  assertEquals(renderSteps.map((step) => step.kind), ['fill-main']);
});

Deno.test('drawing prepared recording skips non-AA inner fill for non-rect path fills', () => {
  const mock = createMockGpuContext();
  const drawingContext = createDrawingContext(createDawnBackendContext(mock.context));
  const recorder = drawingContext.createRecorder();

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 96] },
      { kind: 'lineTo', to: [64, 16] },
      { kind: 'lineTo', to: [112, 96] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.8, 0.4, 0.2, 1] },
  );

  const prepared = prepareDrawingRecording(finishDrawingRecorder(recorder));
  const renderSteps = prepared.passes[0]?.renderSteps ?? [];

  assertEquals(renderSteps.map((step) => step.kind), ['fill-main']);
});

Deno.test('dawn command buffer emits inner fill draw before translucent coverage fill', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [96, 16] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [16, 96] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.2, 0.4, 0.8, 1] },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  assertEquals(mock.created.drawCalls.length, 1);
});

Deno.test('dawn command buffer omits inner fill draw for non-rect path fills', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 96] },
      { kind: 'lineTo', to: [64, 16] },
      { kind: 'lineTo', to: [112, 96] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.8, 0.4, 0.2, 1] },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  assertEquals(mock.created.drawCalls.length, 1);
});

Deno.test('dawn command buffer keeps translated fill-cover vertices in device space', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  translateDrawingRecorder(recorder, 20, 30);
  recordDrawPath(
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
    { style: 'fill', color: [0.2, 0.4, 0.8, 1] },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  const vertexBufferIndices = mock.created.buffers
    .map((buffer, index) => ({ buffer, index }))
    .filter(({ buffer }) => buffer.label === 'drawing-vertices')
    .map(({ index }) => index);
  const fillCoverVertices = vertexBufferIndices
    .map((index) => new Float32Array(mock.created.mappedBuffers[index]!))
    .find((vertices) => vertices[0] === 36 && vertices[1] === 46);

  assertEquals(fillCoverVertices !== undefined, true);
  if (!fillCoverVertices) {
    throw new Error('expected translated fill-cover vertices');
  }

  assertEquals(fillCoverVertices[0], 36);
  assertEquals(fillCoverVertices[1], 46);
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
  assertEquals(mock.created.drawCalls.length, 2);
  assertEquals(mock.created.renderPasses[0]?.depthStencilAttachment !== undefined, true);
  assertEquals(mock.created.scissorCalls[0], [4, 6, 36, 34]);
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
  assertEquals(mock.created.drawCalls.length, 1);
  assertEquals(mock.created.renderPipelines.length, 1);
});

Deno.test('dawn stencil cover clears winding stencil for successive nonzero fills', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 24] },
      { kind: 'lineTo', to: [144, 24] },
      { kind: 'lineTo', to: [144, 144] },
      { kind: 'lineTo', to: [24, 144] },
      { kind: 'close' },
      { kind: 'moveTo', to: [84, 48] },
      { kind: 'lineTo', to: [48, 84] },
      { kind: 'lineTo', to: [84, 120] },
      { kind: 'lineTo', to: [120, 84] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.2, 0.4, 0.6, 0.9] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [168, 24] },
      { kind: 'lineTo', to: [240, 24] },
      { kind: 'lineTo', to: [240, 96] },
      { kind: 'lineTo', to: [168, 96] },
      { kind: 'close' },
      { kind: 'moveTo', to: [204, 40] },
      { kind: 'lineTo', to: [184, 60] },
      { kind: 'lineTo', to: [204, 80] },
      { kind: 'lineTo', to: [224, 60] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0.7, 0.5, 0.2, 0.9] },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  const stencilCoverPipeline = mock.created.renderPipelines.find((pipeline) =>
    pipeline.label === 'drawing-path-fill-stencil-cover'
  );
  assertEquals(stencilCoverPipeline !== undefined, true);
  assertEquals(stencilCoverPipeline?.depthStencil?.depthCompare, 'less');
  assertEquals(stencilCoverPipeline?.depthStencil?.depthWriteEnabled, true);
  assertEquals(stencilCoverPipeline?.depthStencil?.stencilWriteMask, 0xff);
  assertEquals(stencilCoverPipeline?.depthStencil?.stencilFront?.passOp, 'zero');
  assertEquals(stencilCoverPipeline?.depthStencil?.stencilFront?.depthFailOp, 'zero');
  assertEquals(stencilCoverPipeline?.depthStencil?.stencilBack?.passOp, 'zero');
  assertEquals(stencilCoverPipeline?.depthStencil?.stencilBack?.depthFailOp, 'zero');
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
  assertEquals(mock.created.drawCalls.length, 2);
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
  assertEquals(mock.created.drawCalls.length, 1);
  assertEquals(mock.created.stencilReferences.length, 0);
});

Deno.test('dawn command buffer reuses shared clip draws for identical clip stacks', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  clipDrawingRecorderPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [24, 24] },
      { kind: 'lineTo', to: [88, 24] },
      { kind: 'lineTo', to: [88, 88] },
      { kind: 'lineTo', to: [24, 88] },
      { kind: 'close' },
    ),
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [0, 0] },
      { kind: 'lineTo', to: [64, 0] },
      { kind: 'lineTo', to: [64, 64] },
      { kind: 'close' },
    ),
    { style: 'fill' },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [32, 32] },
      { kind: 'lineTo', to: [96, 32] },
      { kind: 'lineTo', to: [96, 96] },
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
  assertEquals(mock.created.drawCalls.length, 3);
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

Deno.test('dawn command buffer snapshots dst for offscreen dst-read blend modes', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [72, 16] },
      { kind: 'lineTo', to: [72, 72] },
      { kind: 'lineTo', to: [16, 72] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 1] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [40, 40] },
      { kind: 'lineTo', to: [96, 40] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [40, 96] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 1], blendMode: 'multiply' },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.textureCopies.length, 1);
  assertEquals(mock.created.bindGroups.some((group) => group.entries.length === 4), true);
  assertEquals(commandBuffer.passCount, 2);
});

Deno.test('dawn command buffer snapshots dst for surface dst-read blend modes', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext({
    ...mock.context,
    target: {
      kind: 'surface',
      width: 256,
      height: 256,
      format: 'rgba8unorm',
    } as const,
  }));
  const recorder = createDrawingRecorder(sharedContext);
  const surfaceTexture = {
    width: 256,
    height: 256,
    createView: () => ({ label: 'surface-view' } as unknown as GPUTextureView),
  } as unknown as GPUTexture;
  const binding = {
    kind: 'surface',
    device: mock.context.device,
    target: {
      kind: 'surface',
      width: 256,
      height: 256,
      format: 'rgba8unorm',
    } as const,
    canvasContext: {
      configure: () => undefined,
      getCurrentTexture: () => surfaceTexture,
    } as unknown as GPUCanvasContext,
    depthTexture: surfaceTexture,
    depthView: surfaceTexture.createView(),
    depthWidth: 256,
    depthHeight: 256,
  } as Parameters<typeof encodeDawnCommandBuffer>[2];

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [72, 16] },
      { kind: 'lineTo', to: [72, 72] },
      { kind: 'lineTo', to: [16, 72] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [1, 0, 0, 1] },
  );
  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [40, 40] },
      { kind: 'lineTo', to: [96, 40] },
      { kind: 'lineTo', to: [96, 96] },
      { kind: 'lineTo', to: [40, 96] },
      { kind: 'close' },
    ),
    { style: 'fill', color: [0, 0, 1, 1], blendMode: 'multiply' },
  );

  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );

  assertEquals(commandBuffer.unsupportedCommands.length, 0);
  assertEquals(mock.created.textureCopies.length, 1);
  assertEquals(commandBuffer.passCount, 2);
});

Deno.test('dawn resource provider reuses one pipeline across shader-blended modes', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const binding = createOffscreenBinding(mock.context);
  const path = createPath2D(
    { kind: 'moveTo', to: [16, 16] },
    { kind: 'lineTo', to: [72, 16] },
    { kind: 'lineTo', to: [72, 72] },
    { kind: 'lineTo', to: [16, 72] },
    { kind: 'close' },
  );

  for (const blendMode of ['multiply', 'overlay'] as const) {
    const recorder = createDrawingRecorder(sharedContext);
    recordDrawPath(
      recorder,
      path,
      { style: 'fill', color: [0.2, 0.4, 0.8, 1], blendMode },
    );
    encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);
  }

  assertEquals(mock.created.renderPipelines.length, 1);
});

Deno.test('dawn command buffer encodes arithmetic custom blender coefficients in step payload', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);

  recordDrawPath(
    recorder,
    createPath2D(
      { kind: 'moveTo', to: [16, 16] },
      { kind: 'lineTo', to: [72, 16] },
      { kind: 'lineTo', to: [72, 72] },
      { kind: 'lineTo', to: [16, 72] },
      { kind: 'close' },
    ),
    {
      style: 'fill',
      blender: { kind: 'arithmetic', coefficients: [0.25, 0.5, 0.25, 0.1] },
    },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  const payloadIndex = mock.created.buffers.findLastIndex((buffer) =>
    buffer.label === 'drawing-step-payload'
  );
  const payload = new Float32Array(mock.created.mappedBuffers[payloadIndex]!);
  assertAlmostEquals(payload[32]!, 0.25);
  assertAlmostEquals(payload[33]!, 0.5);
  assertAlmostEquals(payload[34]!, 0.25);
  assertAlmostEquals(payload[35]!, 0.1);
});

Deno.test('dawn command buffer isolates tessellated stroke patches into a depth-tested render pass', () => {
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
  assertEquals(mock.created.drawCalls.length, 2);
  assertEquals(mock.created.stencilReferences, []);
  assertEquals(mock.created.renderPasses[0]?.depthStencilAttachment !== undefined, true);

  const strokePatchPipeline = mock.created.renderPipelines.find((pipeline) =>
    pipeline.label === 'drawing-path-stroke-patch-cover'
  );
  assertEquals(strokePatchPipeline?.depthStencil?.depthCompare, 'less');
  assertEquals(strokePatchPipeline?.depthStencil?.depthWriteEnabled, true);
});

Deno.test('dawn stroke patch shader keeps Skia-like combined-edge solve structure', () => {
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
    { style: 'stroke', strokeWidth: 8, strokeJoin: 'round', strokeCap: 'round' },
  );

  encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding);

  const strokeShader = mock.created.shaderModules.find((module) =>
    module.label === 'drawing-stroke-patch-shader'
  );
  assertEquals(typeof strokeShader?.code, 'string');
  if (typeof strokeShader?.code !== 'string') {
    throw new Error('expected stroke patch shader source');
  }
  const strokeShaderSource = strokeShader.code;
  assertEquals(
    strokeShaderSource.includes('let testParametricID = lastParametricEdgeID + exp2(f32(exp));'),
    true,
  );
  assertEquals(strokeShaderSource.includes('let rootSentinel = -0.5 * rootQ * quadraticA;'), true);
  assertEquals(strokeShaderSource.includes('unchecked_mix_vec2'), true);
  assertEquals(
    strokeShaderSource.includes('step.matrix1.w'),
    true,
  );
  assertEquals(strokeShaderSource.includes('return robust_normalize_diff(p1, p0);'), true);
});

Deno.test('dawn curve patch shader keeps line patches on the line code path', () => {
  const mock = createMockGpuContext();
  const sharedContext = createDawnSharedContext(createDawnBackendContext(mock.context));
  sharedContext.resourceProvider.findOrCreateGraphicsPipeline({
    label: 'curve-patch-test',
    shader: 'curve-patch',
    vertexLayout: 'curve-patch-instance',
    blendMode: 'src-over',
    colorWriteDisabled: false,
    depthStencil: 'direct',
    topology: 'triangle-list',
  });

  const curveShader = mock.created.shaderModules.find((module) =>
    module.label === 'drawing-curve-patch-shader'
  );
  assertEquals(typeof curveShader?.code, 'string');
  if (typeof curveShader?.code !== 'string') {
    throw new Error('expected curve patch shader source');
  }
  const curveShaderSource = curveShader.code;
  assertEquals(curveShaderSource.includes('if (curveType < 0.5) {'), true);
  assertEquals(curveShaderSource.includes('return select(p0, p3, fixedVertexID > 0.0);'), true);
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
  assertEquals(queueManager.outstandingSubmissions.length, 1);
  assertEquals(queueManager.outstandingSubmissions[0]?.serial, 1);
  assertEquals(queueManager.outstandingSubmissions[0]?.state, 'pending');
  assertEquals(
    queueManager.outstandingSubmissions[0]?.recorderId,
    commandBuffer.recording.recorderId,
  );

  mock.created.submissionDoneResolvers.shift()?.();
  await tickDawnQueueManager(queueManager);

  assertEquals(mock.ticks.length, 1);
  assertEquals(queueManager.completedCount, 1);
  assertEquals(queueManager.inFlightCount, 0);
  assertEquals(queueManager.outstandingSubmissions.length, 0);
  assertEquals(mock.created.destroyedBuffers.length > 0, true);
});

Deno.test('dawn queue manager can stage a command buffer before submit', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
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

  assertEquals(queueManager.currentCommandBuffer, null);
  assertEquals(addCommandBufferToDawnQueueManager(queueManager, commandBuffer), true);
  assertEquals(
    queueManager.currentCommandBuffer?.recording.recorderId,
    commandBuffer.recording.recorderId,
  );
  assertEquals(hasPendingDawnQueueWork(queueManager), true);

  const submission = submitPendingWorkToDawnQueueManager(queueManager);
  assertEquals(submission?.recorderId, commandBuffer.recording.recorderId);
  assertEquals(queueManager.currentCommandBuffer, null);
  assertEquals(queueManager.outstandingSubmissions.length, 1);
});

Deno.test('dawn queue manager does not sync unfinished submissions during ordinary tick', async () => {
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
  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );
  submitToDawnQueueManager(queueManager, commandBuffer);

  await tickDawnQueueManager(queueManager);

  assertEquals(mock.ticks.length, 1);
  assertEquals(queueManager.completedCount, 0);
  assertEquals(queueManager.inFlightCount, 1);
  assertEquals(queueManager.outstandingSubmissions.length, 1);
  assertEquals(queueManager.outstandingSubmissions[0]?.state, 'pending');
  assertEquals(mock.created.destroyedBuffers.length, 0);
});

Deno.test('dawn submission finished callbacks fire when gpu work completes', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const recorder = createDrawingRecorder(sharedContext);
  const binding = createOffscreenBinding(mock.context);
  const finished: Array<{
    success: boolean;
    serial: number;
    recorderId: number | null;
    error: string | null;
  }> = [];

  recordClear(recorder, [0, 0, 0, 1]);
  const commandBuffer = encodeDawnCommandBuffer(
    sharedContext,
    finishDrawingRecorder(recorder),
    binding,
  );
  const submission = submitToDawnQueueManager(queueManager, commandBuffer);
  if (submission === null) {
    throw new Error('expected submission');
  }
  addFinishedCallbackToDawnSubmission(submission, (result) => {
    finished.push(result);
  });

  mock.created.submissionDoneResolvers.shift()?.();
  await tickDawnQueueManager(queueManager);

  assertEquals(finished, [{
    success: true,
    serial: 1,
    recorderId: commandBuffer.recording.recorderId,
    error: null,
  }]);
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
  assertEquals(sharedContext.queueManager.outstandingSubmissions.length, 1);
  assertEquals(sharedContext.queueManager.outstandingSubmissions[0]?.state, 'pending');
  assertEquals(
    sharedContext.queueManager.lastSubmittedRecorderId,
    commandBuffer.recording.recorderId,
  );
});

Deno.test('dawn queue manager attaches finish callbacks to the newest outstanding submission', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);
  const finished: Array<{
    success: boolean;
    serial: number;
    recorderId: number | null;
    error: string | null;
  }> = [];

  for (let index = 0; index < 2; index += 1) {
    const recorder = createDrawingRecorder(sharedContext);
    recordClear(recorder, [0, 0, 0, 1]);
    submitToDawnQueueManager(
      queueManager,
      encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding),
    );
  }

  addFinishedCallbackToDawnQueueManager(queueManager, (result) => {
    finished.push(result);
  });

  mock.created.submissionDoneResolvers.shift()?.();
  mock.created.submissionDoneResolvers.shift()?.();
  await tickDawnQueueManager(queueManager);

  assertEquals(finished.length, 1);
  assertEquals(finished[0]?.serial, 2);
  assertEquals(finished[0]?.success, true);
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
  assertEquals(queueManager.outstandingSubmissions.length, 1);

  await tickDawnQueueManager(queueManager);

  assertEquals(mock.ticks.length, 1);
  assertEquals(queueManager.completedCount, 1);
  assertEquals(queueManager.inFlightCount, 0);
  assertEquals(queueManager.outstandingSubmissions.length, 0);
  assertEquals(queueManager.lastCompletedRecorderId, commandBuffer.recording.recorderId);
  assertEquals(queueManager.outstandingSubmissions.length, 0);
  assertEquals(mock.created.destroyedBuffers.length > 0, true);
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
  assertEquals(queueManager.outstandingSubmissions.length, 0);
  assertEquals(queueManager.lastError, 'device lost');
});

Deno.test('dawn queue manager can sync to the last outstanding submission like graphite', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context, {
    tick: () => {
      mock.ticks.push(1);
    },
  });
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);

  const submitClear = () => {
    const recorder = createDrawingRecorder(sharedContext);
    recordClear(recorder, [0, 0, 0, 1]);
    const commandBuffer = encodeDawnCommandBuffer(
      sharedContext,
      finishDrawingRecorder(recorder),
      binding,
    );
    submitToDawnQueueManager(queueManager, commandBuffer);
  };

  submitClear();
  submitClear();

  assertEquals(queueManager.outstandingSubmissions.length, 2);
  mock.created.submissionDoneResolvers.shift()?.();
  mock.created.submissionDoneResolvers.shift()?.();

  await checkForFinishedDawnQueueManager(queueManager, {
    syncToCpu: true,
  });

  assertEquals(queueManager.completedCount, 2);
  assertEquals(queueManager.inFlightCount, 0);
  assertEquals(queueManager.outstandingSubmissions.length, 0);
});

Deno.test('dawn queue manager exposes Graphite-like work query helpers', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
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

  assertEquals(hasUnfinishedDawnQueueWork(queueManager), true);
  assertEquals(hasPendingDawnQueueWork(queueManager), true);

  mock.created.submissionDoneResolvers.shift()?.();
  await queueManager.outstandingSubmissions[0]?.completionPromise;
  await checkForFinishedDawnQueueWork(queueManager);

  assertEquals(hasUnfinishedDawnQueueWork(queueManager), false);
  assertEquals(hasPendingDawnQueueWork(queueManager), false);
});

Deno.test('dawn queue manager drains outstanding submissions in submission order', async () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext(mock.context);
  const queueManager = createDawnQueueManager(backend);
  const sharedContext = createDawnSharedContext(backend);
  const binding = createOffscreenBinding(mock.context);

  const submitClear = (color: readonly [number, number, number, number]) => {
    const recorder = createDrawingRecorder(sharedContext);
    recordClear(recorder, color);
    return submitToDawnQueueManager(
      queueManager,
      encodeDawnCommandBuffer(sharedContext, finishDrawingRecorder(recorder), binding),
    );
  };

  const first = submitClear([1, 0, 0, 1]);
  const second = submitClear([0, 0, 1, 1]);
  if (first === null || second === null) {
    throw new Error('expected queued submissions');
  }

  assertEquals(queueManager.outstandingSubmissions.length, 2);

  mock.created.submissionDoneResolvers[1]?.();
  await second.completionPromise;
  await checkForFinishedDawnQueueWork(queueManager);

  assertEquals(queueManager.completedCount, 0);
  assertEquals(queueManager.inFlightCount, 2);
  assertEquals(queueManager.outstandingSubmissions.length, 2);

  mock.created.submissionDoneResolvers[0]?.();
  await first.completionPromise;
  await checkForFinishedDawnQueueWork(queueManager);

  assertEquals(queueManager.completedCount, 2);
  assertEquals(queueManager.inFlightCount, 0);
  assertEquals(queueManager.outstandingSubmissions.length, 0);
  assertEquals(queueManager.lastCompletedRecorderId, second.recorderId);
  assertEquals(first.serial, 1);
});

Deno.test('dawn queue manager records submit failures without enqueuing work', () => {
  const mock = createMockGpuContext();
  const backend = createDawnBackendContext({
    ...mock.context,
    queue: {
      ...mock.context.queue,
      submit: () => {
        throw new Error('submit failed');
      },
    } as unknown as GPUQueue,
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
  const submission = submitToDawnQueueManager(queueManager, commandBuffer);
  if (submission === null) {
    throw new Error('expected failed submission');
  }

  assertEquals(submission.state, 'failed');
  assertEquals(submission.error, 'submit failed');
  assertEquals(queueManager.submittedCount, 0);
  assertEquals(queueManager.inFlightCount, 0);
  assertEquals(queueManager.outstandingSubmissions.length, 0);
  assertEquals(queueManager.lastError, 'submit failed');
  assertEquals(mock.created.destroyedBuffers.length > 0, true);
});

Deno.test('dawn queue manager fires idle finish callbacks immediately', () => {
  const mock = createMockGpuContext();
  const queueManager = createDawnQueueManager(createDawnBackendContext(mock.context));
  const finished: Array<{
    success: boolean;
    serial: number;
    recorderId: number | null;
    error: string | null;
  }> = [];

  addFinishedCallbackToDawnQueueManager(queueManager, (result) => {
    finished.push(result);
  });

  assertEquals(finished, [{
    success: true,
    serial: 0,
    recorderId: null,
    error: null,
  }]);
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
