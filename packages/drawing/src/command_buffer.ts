import {
  acquireColorAttachmentTexture,
  acquireColorResolveView,
  type RenderContextBinding,
} from '@rieul3d/gpu';
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
  const clipRect = step.clipRect;
  const clipBounds = step.clipBounds;
  const clipX = clipRect?.origin[0] ?? clipBounds?.origin[0] ?? 0;
  const clipY = clipRect?.origin[1] ?? clipBounds?.origin[1] ?? 0;
  const clipRight = clipRect
    ? clipRect.origin[0] + clipRect.size.width
    : clipBounds
    ? clipBounds.origin[0] + clipBounds.size.width
    : target.width;
  const clipBottom = clipRect
    ? clipRect.origin[1] + clipRect.size.height
    : clipBounds
    ? clipBounds.origin[1] + clipBounds.size.height
    : target.height;
  const clip2X = clipBounds?.origin[0] ?? clipX;
  const clip2Y = clipBounds?.origin[1] ?? clipY;
  const clip2Right = clipBounds ? clipBounds.origin[0] + clipBounds.size.width : clipRight;
  const clip2Bottom = clipBounds ? clipBounds.origin[1] + clipBounds.size.height : clipBottom;
  const x = Math.max(0, Math.floor(Math.max(clipX, clip2X)));
  const y = Math.max(0, Math.floor(Math.max(clipY, clip2Y)));
  const right = Math.min(target.width, Math.ceil(Math.min(clipRight, clip2Right)));
  const bottom = Math.min(target.height, Math.ceil(Math.min(clipBottom, clip2Bottom)));
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  pass.setScissorRect(x, y, width, height);
};

const applyFullClip = (
  pass: GPURenderPassEncoder,
  target: Readonly<{ width: number; height: number }>,
): void => {
  pass.setScissorRect(0, 0, target.width, target.height);
};

const applyStepClip = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRenderStep,
  target: Readonly<{ width: number; height: number }>,
): void => {
  if (!step.clipRect && !step.clipBounds) {
    applyFullClip(pass, target);
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
  pass.setBindGroup(2, commandResources.defaultClipTextureBindGroup);
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

const textureBindingUsage = 0x04;
const textureCopyDstUsage = 0x02;

const stepRequiresDstRead = (
  step: DrawingPreparedRenderStep,
): boolean => (step.draw.dstUsage & drawingDstUsage.dstReadRequired) !== 0;

const createStepClipTextureBindGroup = (
  sharedContext: DawnSharedContext,
  commandResources: DrawingPreparedCommandResources,
  resources: DrawingPreparedStepResources,
  dstTextureView?: GPUTextureView,
): GPUBindGroup =>
  !resources.clipTextureView && !dstTextureView
    ? commandResources.defaultClipTextureBindGroup
    : sharedContext.resourceProvider.createClipTextureBindGroup(
      resources.clipTextureView ?? undefined,
      dstTextureView,
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
  pass.setBindGroup(2, clipTextureBindGroup);

  if (resources.vertexBuffer && resources.vertexCount > 0) {
    pass.setVertexBuffer(0, resources.vertexBuffer);
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
  const unsupportedCommands: DrawingCommand[] = [...preparedWork.prepared.unsupportedCommands];
  let passCount = 0;
  const stencilView = sharedContext.resourceProvider.getStencilAttachmentView();

  for (let taskIndex = 0; taskIndex < preparedWork.tasks.tasks.length; taskIndex += 1) {
    const task = preparedWork.tasks.tasks[taskIndex]!;
    const taskResources = preparedWork.resources.tasks[taskIndex]!;
    for (let passIndex = 0; passIndex < task.drawPasses.length; passIndex += 1) {
      const passInfo = task.drawPasses[passIndex]!;
      const passResources = taskResources.passes[passIndex]!;
      if (passInfo.renderSteps.length === 0) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: colorView,
              resolveTarget: resolveView,
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
        if (stepRequiresDstRead(step)) {
          const clipStencilCache: ClipStencilCache = { key: null, reference: 0 };
          if (colorLoadOp === 'clear') {
            const clearPass = encoder.beginRenderPass(
              createRenderPassDescriptor(
                colorView,
                resolveView,
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
              colorView,
              resolveView,
              passInfo.clearColor,
              colorLoadOp,
              step.usesDepth ? stencilView : undefined,
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
        for (let batchIndex = stepIndex; batchIndex < passInfo.renderSteps.length; batchIndex += 1) {
          const batchStep = passInfo.renderSteps[batchIndex]!;
          if (stepRequiresDstRead(batchStep)) {
            break;
          }
          batchUsesDepth ||= batchStep.usesDepth || batchStep.usesStencil || batchStep.usesFillStencil;
        }
        const pass = encoder.beginRenderPass(
          createRenderPassDescriptor(
            colorView,
            resolveView,
            passInfo.clearColor,
            colorLoadOp,
            batchUsesDepth ? stencilView : undefined,
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
