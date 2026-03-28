import {
  acquireColorAttachmentTexture,
  acquireColorResolveView,
  type RenderContextBinding,
} from '@goldlight/gpu';
import type { DrawingPreparedRecording, DrawingPreparedRenderStep } from './draw_pass.ts';
import {
  type DawnPreparedWork,
  type DrawingPreparedClipDrawResources,
  type DrawingPreparedCommandResources,
  type DrawingPreparedPassResources,
  type DrawingPreparedStepResources,
  prepareDawnRecording,
} from './prepare_resources.ts';
import { drawingDstUsage } from './path_renderer.ts';
import { submitToDawnQueueManager } from './queue_manager.ts';
import type { DrawingRecording } from './recording.ts';
import type { DawnSharedContext } from './shared_context.ts';
import type { DrawingCommand } from './types.ts';

export type DawnCommandBuffer = Readonly<{
  backend: 'graphite-dawn';
  recording: DrawingRecording;
  prepared: DrawingPreparedRecording;
  commandBuffer: GPUCommandBuffer;
  passCount: number;
  unsupportedCommands: readonly DrawingCommand[];
  ownedBuffers: readonly GPUBuffer[];
  ownedTextures: readonly GPUTexture[];
}>;

const toGpuColor = (color: readonly [number, number, number, number]): GPUColor => ({
  r: color[0],
  g: color[1],
  b: color[2],
  a: color[3],
});

const applyClipRect = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRenderStep,
  target: Readonly<{ width: number; height: number }>,
): void => {
  const x = Math.min(target.width, Math.max(0, Math.floor(step.drawBounds.origin[0])));
  const y = Math.min(target.height, Math.max(0, Math.floor(step.drawBounds.origin[1])));
  const right = Math.min(
    target.width,
    Math.ceil(step.drawBounds.origin[0] + step.drawBounds.size.width),
  );
  const bottom = Math.min(
    target.height,
    Math.ceil(step.drawBounds.origin[1] + step.drawBounds.size.height),
  );
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  pass.setScissorRect(x, y, width, height);
};

const applyStepClip = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRenderStep,
  target: Readonly<{ width: number; height: number }>,
): void => {
  if (step.drawBounds.size.width <= 0 || step.drawBounds.size.height <= 0) {
    pass.setScissorRect(0, 0, 0, 0);
    return;
  }

  applyClipRect(pass, step, target);
};

const getStencilClipCount = (
  step: DrawingPreparedRenderStep,
): number => step.draw.clip?.elements?.length ?? 0;

const getStencilClipKey = (
  step: DrawingPreparedRenderStep,
): string | null => {
  const ids = step.draw.clip?.effectiveElementIds;
  return ids && ids.length > 0 && getStencilClipCount(step) > 0 ? ids.join(',') : null;
};

type ClipStencilCache = {
  key: string | null;
  reference: number;
};

const findClipDrawResourceById = (
  passResources: DrawingPreparedPassResources,
  clipDrawId: number,
): DrawingPreparedClipDrawResources | null =>
  passResources.clipDraws.find((clipDraw) => clipDraw.id === clipDrawId) ?? null;

const encodeStencilClips = (
  pass: GPURenderPassEncoder,
  clipDraw: DrawingPreparedClipDrawResources,
  commandResources: DrawingPreparedCommandResources,
  viewportBindGroup: GPUBindGroup,
): number => {
  pass.setBindGroup(0, viewportBindGroup);
  pass.setBindGroup(1, commandResources.identityStepBindGroup);
  pass.setBindGroup(2, commandResources.gradientBindGroup);
  pass.setBindGroup(3, commandResources.defaultClipTextureBindGroup);
  pass.setScissorRect(
    Math.max(0, Math.floor(clipDraw.scissorBounds.origin[0])),
    Math.max(0, Math.floor(clipDraw.scissorBounds.origin[1])),
    Math.max(0, Math.ceil(clipDraw.scissorBounds.size.width)),
    Math.max(0, Math.ceil(clipDraw.scissorBounds.size.height)),
  );
  let clipReference = 0;

  if (clipDraw.clipElement.op === 'difference') {
    pass.setPipeline(clipDraw.pipeline);
    pass.setStencilReference?.(1);
    pass.setVertexBuffer(0, commandResources.fullscreenClipVertexBuffer);
    pass.draw(commandResources.fullscreenClipVertexCount);
    clipReference = 1;
  }
  const nextReference = clipDraw.clipElement.op === 'intersect' ? clipReference + 1 : clipReference;
  pass.setPipeline(clipDraw.pipeline);
  pass.setStencilReference?.(nextReference);
  pass.setVertexBuffer(0, clipDraw.clipVertexBuffer);
  pass.draw(clipDraw.clipVertexCount);
  clipReference = nextReference;
  pass.setStencilReference?.(clipReference);
  return clipReference;
};

const createRenderPassDescriptor = (
  colorView: GPUTextureView,
  resolveView: GPUTextureView | undefined,
  clearColor: readonly [number, number, number, number],
  loadOp: GPULoadOp,
  stencilView?: GPUTextureView,
): GPURenderPassDescriptor => ({
  colorAttachments: [
    {
      view: colorView,
      resolveTarget: resolveView,
      clearValue: toGpuColor(clearColor),
      loadOp,
      storeOp: 'store',
    },
  ],
  depthStencilAttachment: stencilView
    ? {
      view: stencilView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'discard',
      stencilClearValue: 0,
      stencilLoadOp: 'clear',
      stencilStoreOp: 'discard',
    }
    : undefined,
});

const getBindingSampleCount = (
  binding: RenderContextBinding,
): 1 | 4 => (binding.kind === 'offscreen' ? binding.target.msaaSampleCount : 1) as 1 | 4;

const createTransientMsaaColorAttachment = (
  sharedContext: DawnSharedContext,
  binding: RenderContextBinding,
  sampleCount: 1 | 4,
): GPUTexture =>
  sharedContext.resourceProvider.createTexture({
    label: 'drawing-pass-msaa-color',
    size: {
      width: binding.target.width,
      height: binding.target.height,
      depthOrArrayLayers: 1,
    },
    format: binding.target.format,
    usage: 0x10,
    sampleCount,
  });

const textureBindingUsage = 0x04;
const textureCopyDstUsage = 0x02;

const stepRequiresDstRead = (
  step: DrawingPreparedRenderStep,
): boolean => (step.draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0;

const stepNeedsDepthStencilAttachment = (
  step: DrawingPreparedRenderStep,
): boolean => step.pipelineDesc.depthStencil !== 'none';

const createStepClipTextureBindGroup = (
  sharedContext: DawnSharedContext,
  commandResources: DrawingPreparedCommandResources,
  resources: DrawingPreparedStepResources,
  dstTextureView?: GPUTextureView,
): GPUBindGroup =>
  !resources.clipTextureView &&
    !dstTextureView &&
    !resources.sampledTextureView &&
    resources.textAtlasViews.length === 0
    ? commandResources.defaultClipTextureBindGroup
    : sharedContext.resourceProvider.createClipTextureBindGroup(
      resources.clipTextureView ?? undefined,
      dstTextureView,
      resources.sampledTextureView ?? undefined,
      resources.textAtlasViews,
      resources.sampledTextureFilter,
    );

const createDstSnapshotView = (
  sharedContext: DawnSharedContext,
  encoder: GPUCommandEncoder,
  binding: RenderContextBinding,
  colorTexture?: GPUTexture,
): GPUTextureView => {
  const width = binding.target.width;
  const height = binding.target.height;
  const snapshotTexture = sharedContext.resourceProvider.createTexture({
    label: 'drawing-dst-snapshot',
    size: {
      width,
      height,
      depthOrArrayLayers: 1,
    },
    format: binding.target.format,
    usage: textureBindingUsage | textureCopyDstUsage,
  });
  encoder.copyTextureToTexture(
    {
      texture: binding.kind === 'offscreen'
        ? binding.resolveTexture ?? binding.texture
        : colorTexture ?? (() => {
          throw new Error('surface dst snapshot requires current color texture');
        })(),
    },
    {
      texture: snapshotTexture,
    },
    {
      width,
      height,
      depthOrArrayLayers: 1,
    },
  );
  return snapshotTexture.createView();
};

const ensureClipDrawsEncoded = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRenderStep,
  passResources: DrawingPreparedPassResources,
  commandResources: DrawingPreparedCommandResources,
  viewportBindGroup: GPUBindGroup,
  clipStencilCache: ClipStencilCache,
): number => {
  const clipKey = getStencilClipKey(step);
  if (!clipKey) {
    return 0;
  }
  if (clipStencilCache.key === clipKey) {
    return clipStencilCache.reference;
  }
  let clipReference = 0;
  for (const clipDrawId of step.clipDrawIds) {
    const clipDraw = findClipDrawResourceById(passResources, clipDrawId);
    if (!clipDraw) {
      continue;
    }
    clipReference = encodeStencilClips(pass, clipDraw, commandResources, viewportBindGroup);
  }
  clipStencilCache.key = clipKey;
  clipStencilCache.reference = clipReference;
  return clipReference;
};

const encodePreparedStep = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRenderStep,
  resources: DrawingPreparedStepResources,
  passResources: DrawingPreparedPassResources,
  commandResources: DrawingPreparedCommandResources,
  target: Readonly<{ width: number; height: number }>,
  viewportBindGroup: GPUBindGroup,
  clipTextureBindGroup: GPUBindGroup,
  clipStencilCache: ClipStencilCache,
): void => {
  applyStepClip(pass, step, target);
  if (getStencilClipCount(step) > 0) {
    const clipReference = ensureClipDrawsEncoded(
      pass,
      step,
      passResources,
      commandResources,
      viewportBindGroup,
      clipStencilCache,
    );
    pass.setStencilReference?.(clipReference);
  }
  pass.setPipeline(resources.pipeline);
  pass.setBindGroup(0, viewportBindGroup);
  pass.setBindGroup(1, resources.stepBindGroup);
  pass.setBindGroup(2, commandResources.gradientBindGroup);
  pass.setBindGroup(3, clipTextureBindGroup);

  if (resources.vertexCount > 0) {
    if (resources.vertexBuffer) {
      pass.setVertexBuffer(0, resources.vertexBuffer);
    }
    if (resources.instanceBuffer) {
      pass.setVertexBuffer(resources.vertexBuffer ? 1 : 0, resources.instanceBuffer);
    }
    pass.draw(resources.vertexCount, resources.instanceCount);
  }
};

export const encodePreparedDawnCommandBuffer = (
  sharedContext: DawnSharedContext,
  preparedWork: DawnPreparedWork,
  binding: RenderContextBinding,
): DawnCommandBuffer => {
  const encoder = sharedContext.backend.device.createCommandEncoder({
    label: `drawing-recorder-${preparedWork.recording.recorderId}`,
  });
  const colorTexture = acquireColorAttachmentTexture(
    {
      device: sharedContext.backend.device,
    },
    binding,
  );
  const colorView = colorTexture.createView();
  const resolveView = acquireColorResolveView(binding);
  const ownedTextures: GPUTexture[] = [...preparedWork.resources.ownedTextures];
  const unsupportedCommands: DrawingCommand[] = [...preparedWork.prepared.unsupportedCommands];
  let passCount = 0;

  for (let taskIndex = 0; taskIndex < preparedWork.tasks.tasks.length; taskIndex += 1) {
    const task = preparedWork.tasks.tasks[taskIndex]!;
    const taskResources = preparedWork.resources.tasks[taskIndex]!;
    for (let passIndex = 0; passIndex < task.drawPasses.length; passIndex += 1) {
      const passInfo = task.drawPasses[passIndex]!;
      const passResources = taskResources.passes[passIndex]!;
      if (passInfo.renderSteps.length === 0) {
        const passSampleCount = passResources.sampleCount;
        const bindingSampleCount = getBindingSampleCount(binding);
        const msaaColorTexture = passSampleCount > bindingSampleCount
          ? createTransientMsaaColorAttachment(sharedContext, binding, passSampleCount)
          : null;
        if (msaaColorTexture) {
          ownedTextures.push(msaaColorTexture);
        }
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: msaaColorTexture?.createView() ?? colorView,
              resolveTarget: msaaColorTexture ? colorView : resolveView,
              clearValue: toGpuColor(passInfo.clearColor),
              loadOp: passInfo.loadOp,
              storeOp: 'store',
            },
          ],
        });
        unsupportedCommands.push(...passInfo.unsupportedDraws);
        pass.end();
        passCount += 1;
        continue;
      }

      let colorLoadOp = passInfo.loadOp;
      let stepIndex = 0;
      while (stepIndex < passInfo.renderSteps.length) {
        const step = passInfo.renderSteps[stepIndex]!;
        const passSampleCount = passResources.sampleCount;
        const bindingSampleCount = getBindingSampleCount(binding);
        const msaaColorTexture = passSampleCount > bindingSampleCount
          ? createTransientMsaaColorAttachment(sharedContext, binding, passSampleCount)
          : null;
        if (msaaColorTexture) {
          ownedTextures.push(msaaColorTexture);
        }
        const passColorView = msaaColorTexture?.createView() ?? colorView;
        const passResolveView = msaaColorTexture ? colorView : resolveView;
        if (stepRequiresDstRead(step)) {
          const clipStencilCache: ClipStencilCache = { key: null, reference: 0 };
          if (colorLoadOp === 'clear') {
            const clearPass = encoder.beginRenderPass(
              createRenderPassDescriptor(
                passColorView,
                passResolveView,
                passInfo.clearColor,
                colorLoadOp,
                undefined,
              ),
            );
            clearPass.end();
            passCount += 1;
            colorLoadOp = 'load';
          }
          const dstTextureView = createDstSnapshotView(
            sharedContext,
            encoder,
            binding,
            colorTexture,
          );
          const clipTextureBindGroup = createStepClipTextureBindGroup(
            sharedContext,
            preparedWork.resources,
            passResources.steps[stepIndex]!,
            dstTextureView,
          );
          const pass = encoder.beginRenderPass(
            createRenderPassDescriptor(
              passColorView,
              passResolveView,
              passInfo.clearColor,
              colorLoadOp,
              stepNeedsDepthStencilAttachment(step)
                ? sharedContext.resourceProvider.getStencilAttachmentView(passSampleCount)
                : undefined,
            ),
          );
          const drawStepIndex = step.stepIndex;
          while (
            stepIndex < passInfo.renderSteps.length &&
            passInfo.renderSteps[stepIndex]!.stepIndex === drawStepIndex &&
            stepRequiresDstRead(passInfo.renderSteps[stepIndex]!)
          ) {
            encodePreparedStep(
              pass,
              passInfo.renderSteps[stepIndex]!,
              passResources.steps[stepIndex]!,
              passResources,
              preparedWork.resources,
              sharedContext.backend.target,
              preparedWork.resources.viewportBindGroup,
              clipTextureBindGroup,
              clipStencilCache,
            );
            stepIndex += 1;
          }
          pass.end();
          passCount += 1;
          colorLoadOp = 'load';
          continue;
        }

        let batchUsesDepth = false;
        for (
          let batchIndex = stepIndex;
          batchIndex < passInfo.renderSteps.length;
          batchIndex += 1
        ) {
          const batchStep = passInfo.renderSteps[batchIndex]!;
          if (stepRequiresDstRead(batchStep)) {
            break;
          }
          batchUsesDepth ||= stepNeedsDepthStencilAttachment(batchStep);
        }
        const pass = encoder.beginRenderPass(
          createRenderPassDescriptor(
            passColorView,
            passResolveView,
            passInfo.clearColor,
            colorLoadOp,
            batchUsesDepth
              ? sharedContext.resourceProvider.getStencilAttachmentView(passSampleCount)
              : undefined,
          ),
        );
        const clipStencilCache: ClipStencilCache = { key: null, reference: 0 };
        while (
          stepIndex < passInfo.renderSteps.length &&
          !stepRequiresDstRead(passInfo.renderSteps[stepIndex]!)
        ) {
          const clipTextureBindGroup = createStepClipTextureBindGroup(
            sharedContext,
            preparedWork.resources,
            passResources.steps[stepIndex]!,
          );
          encodePreparedStep(
            pass,
            passInfo.renderSteps[stepIndex]!,
            passResources.steps[stepIndex]!,
            passResources,
            preparedWork.resources,
            sharedContext.backend.target,
            preparedWork.resources.viewportBindGroup,
            clipTextureBindGroup,
            clipStencilCache,
          );
          stepIndex += 1;
        }
        pass.end();
        passCount += 1;
        colorLoadOp = 'load';
      }

      unsupportedCommands.push(...passInfo.unsupportedDraws);
    }
  }

  return {
    backend: 'graphite-dawn',
    recording: preparedWork.recording,
    prepared: preparedWork.prepared,
    commandBuffer: encoder.finish(),
    passCount,
    unsupportedCommands: Object.freeze(unsupportedCommands),
    ownedBuffers: preparedWork.resources.ownedBuffers,
    ownedTextures: Object.freeze(ownedTextures),
  };
};

export const encodeDawnCommandBuffer = (
  sharedContext: DawnSharedContext,
  recording: DrawingRecording,
  binding: RenderContextBinding,
): DawnCommandBuffer =>
  encodePreparedDawnCommandBuffer(
    sharedContext,
    prepareDawnRecording(sharedContext, recording),
    binding,
  );

export const submitDawnCommandBuffer = (
  sharedContext: DawnSharedContext,
  commandBuffer: DawnCommandBuffer,
): void => {
  submitToDawnQueueManager(sharedContext.queueManager, commandBuffer);
};
