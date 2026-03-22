import {
  acquireColorAttachmentView,
  acquireColorResolveView,
  type RenderContextBinding,
} from '@rieul3d/gpu';
import type { DrawingPreparedRecording } from './draw_pass.ts';
import {
  type DawnPreparedWork,
  type DrawingPreparedCommandResources,
  type DrawingPreparedStepResources,
  prepareDawnRecording,
} from './prepare_resources.ts';
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
}>;

const toGpuColor = (color: readonly [number, number, number, number]): GPUColor => ({
  r: color[0],
  g: color[1],
  b: color[2],
  a: color[3],
});

const applyClipRect = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
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
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  target: Readonly<{ width: number; height: number }>,
): void => {
  if (!step.clipRect && !step.clipBounds) {
    applyFullClip(pass, target);
    return;
  }

  applyClipRect(pass, step, target);
};

const getStencilClipCount = (
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
): number => step.draw.clip?.elements?.length ?? 0;

const encodeStencilClips = (
  pass: GPURenderPassEncoder,
  resources: DrawingPreparedStepResources,
  commandResources: DrawingPreparedCommandResources,
  viewportBindGroup: GPUBindGroup,
): number => {
  if (resources.clipVertexBuffers.length === 0) {
    return 0;
  }

  pass.setBindGroup(0, viewportBindGroup);
  pass.setBindGroup(1, commandResources.identityStepBindGroup);
  pass.setBindGroup(2, commandResources.defaultClipTextureBindGroup);
  let clipPipelineIndex = 0;
  let clipReference = 0;

  if (resources.clipElements[0]?.op === 'difference') {
    pass.setPipeline(resources.clipPipelines[clipPipelineIndex++]!);
    pass.setStencilReference?.(1);
    pass.setVertexBuffer(0, commandResources.fullscreenClipVertexBuffer);
    pass.draw(commandResources.fullscreenClipVertexCount);
    clipReference = 1;
  }

  for (let index = 0; index < resources.clipVertexBuffers.length; index += 1) {
    const element = resources.clipElements[index]!;
    const nextReference = element.op === 'intersect' ? clipReference + 1 : clipReference;
    pass.setPipeline(resources.clipPipelines[clipPipelineIndex++]!);
    pass.setStencilReference?.(nextReference);
    pass.setVertexBuffer(0, resources.clipVertexBuffers[index]!);
    pass.draw(resources.clipVertexCounts[index]!);
    clipReference = nextReference;
  }
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

const encodePreparedFillStep = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  resources: DrawingPreparedStepResources,
  commandResources: DrawingPreparedCommandResources,
  target: Readonly<{ width: number; height: number }>,
  viewportBindGroup: GPUBindGroup,
): void => {
  if (step.draw.kind !== 'pathFill') {
    return;
  }

  const usesPatchFill = step.draw.renderer !== 'middle-out-fan';
  const usesFillStencil = step.usesFillStencil;
  applyStepClip(pass, step, target);
  if (usesFillStencil) {
    const stencilPipeline = resources.pipelines[0]!;
    const coverPipeline = resources.pipelines[1]!;
    pass.setPipeline(stencilPipeline);
    pass.setBindGroup(0, viewportBindGroup);
    pass.setBindGroup(1, resources.stepBindGroup);
    pass.setBindGroup(2, resources.clipTextureBindGroup);
    if (usesPatchFill && resources.patchVertexBuffer && resources.patchInstanceCount > 0) {
      pass.setVertexBuffer(0, resources.patchVertexBuffer);
      pass.draw(resources.patchVertexCount, resources.patchInstanceCount);
    } else if (resources.fillVertexBuffer && resources.fillVertexCount > 0) {
      pass.setVertexBuffer(0, resources.fillVertexBuffer);
      pass.draw(resources.fillVertexCount);
    }

    if (resources.boundsCoverVertexBuffer && resources.boundsCoverVertexCount > 0) {
      pass.setPipeline(coverPipeline);
      pass.setBindGroup(0, viewportBindGroup);
      pass.setBindGroup(1, resources.stepBindGroup);
      pass.setBindGroup(2, resources.clipTextureBindGroup);
      pass.setVertexBuffer(0, resources.boundsCoverVertexBuffer);
      pass.draw(resources.boundsCoverVertexCount);
    }

    if (resources.fringeVertexBuffer && resources.fringeVertexCount > 0) {
      pass.setPipeline(resources.fringePipeline ?? resources.pipelines[0]!);
      pass.setBindGroup(0, viewportBindGroup);
      pass.setBindGroup(1, resources.stepBindGroup);
      pass.setBindGroup(2, resources.clipTextureBindGroup);
      pass.setVertexBuffer(0, resources.fringeVertexBuffer);
      pass.draw(resources.fringeVertexCount);
    }
    return;
  }

  if (getStencilClipCount(step) > 0) {
    const colorPipeline = resources.pipelines[0]!;
    const clipReference = encodeStencilClips(pass, resources, commandResources, viewportBindGroup);
    pass.setStencilReference?.(clipReference);
    pass.setPipeline(colorPipeline);
  } else {
    pass.setPipeline(resources.pipelines[0]!);
  }
  pass.setBindGroup(0, viewportBindGroup);
  pass.setBindGroup(1, resources.stepBindGroup);
  pass.setBindGroup(2, resources.clipTextureBindGroup);

  if (usesPatchFill && resources.patchVertexBuffer && resources.patchInstanceCount > 0) {
    pass.setVertexBuffer(0, resources.patchVertexBuffer);
    pass.draw(resources.patchVertexCount, resources.patchInstanceCount);
  } else if (resources.fillVertexBuffer && resources.fillVertexCount > 0) {
    pass.setVertexBuffer(0, resources.fillVertexBuffer);
    pass.draw(resources.fillVertexCount);
  }

  if (resources.fringeVertexBuffer && resources.fringeVertexCount > 0) {
    if (usesPatchFill) {
      pass.setPipeline(resources.fringePipeline ?? resources.pipelines[0]!);
      pass.setBindGroup(0, viewportBindGroup);
      pass.setBindGroup(1, resources.stepBindGroup);
      pass.setBindGroup(2, resources.clipTextureBindGroup);
    }
    pass.setVertexBuffer(0, resources.fringeVertexBuffer);
    pass.draw(resources.fringeVertexCount);
  }
};

const encodePreparedStrokeStep = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  resources: DrawingPreparedStepResources,
  commandResources: DrawingPreparedCommandResources,
  target: Readonly<{ width: number; height: number }>,
  viewportBindGroup: GPUBindGroup,
): void => {
  if (step.draw.kind !== 'pathStroke') {
    return;
  }

  applyStepClip(pass, step, target);
  if (getStencilClipCount(step) > 0) {
    const clipReference = encodeStencilClips(pass, resources, commandResources, viewportBindGroup);
    pass.setStencilReference?.(clipReference);
    pass.setPipeline(resources.pipelines[0]!);
  } else {
    pass.setPipeline(resources.pipelines[0]!);
  }
  pass.setBindGroup(0, viewportBindGroup);
  pass.setBindGroup(1, resources.stepBindGroup);
  pass.setBindGroup(2, resources.clipTextureBindGroup);

  if (resources.patchVertexBuffer && resources.patchInstanceCount > 0) {
    pass.setVertexBuffer(0, resources.patchVertexBuffer);
    pass.draw(resources.patchVertexCount, resources.patchInstanceCount);
  } else {
    pass.setVertexBuffer(0, resources.fillVertexBuffer!);
    pass.draw(resources.fillVertexCount);
  }

  if (resources.fringeVertexBuffer && resources.fringeVertexCount > 0) {
    pass.setPipeline(resources.fringePipeline ?? resources.pipelines[0]!);
    pass.setBindGroup(0, viewportBindGroup);
    pass.setBindGroup(1, resources.stepBindGroup);
    pass.setBindGroup(2, resources.clipTextureBindGroup);
    pass.setVertexBuffer(0, resources.fringeVertexBuffer);
    pass.draw(resources.fringeVertexCount);
  }
};

const encodePreparedStep = (
  pass: GPURenderPassEncoder,
  step: DrawingPreparedRecording['passes'][number]['steps'][number],
  resources: DrawingPreparedStepResources,
  commandResources: DrawingPreparedCommandResources,
  target: Readonly<{ width: number; height: number }>,
  viewportBindGroup: GPUBindGroup,
): void => {
  switch (step.draw.kind) {
    case 'pathFill':
      encodePreparedFillStep(pass, step, resources, commandResources, target, viewportBindGroup);
      break;
    case 'pathStroke':
      encodePreparedStrokeStep(pass, step, resources, commandResources, target, viewportBindGroup);
      break;
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
  const colorView = acquireColorAttachmentView(
    {
      device: sharedContext.backend.device,
    },
    binding,
  );
  const resolveView = acquireColorResolveView(binding);
  const unsupportedCommands: DrawingCommand[] = [...preparedWork.prepared.unsupportedCommands];
  let passCount = 0;
  const hasStencilSteps = preparedWork.tasks.tasks.some((task) =>
    task.drawPasses.some((passInfo) =>
      passInfo.steps.some((step) => step.usesStencil || step.usesFillStencil || step.usesDepth)
    )
  );
  const stencilView = hasStencilSteps
    ? sharedContext.resourceProvider.getStencilAttachmentView()
    : undefined;

  for (let taskIndex = 0; taskIndex < preparedWork.tasks.tasks.length; taskIndex += 1) {
    const task = preparedWork.tasks.tasks[taskIndex]!;
    const taskResources = preparedWork.resources.tasks[taskIndex]!;
    for (let passIndex = 0; passIndex < task.drawPasses.length; passIndex += 1) {
      const passInfo = task.drawPasses[passIndex]!;
      const passResources = taskResources.passes[passIndex]!;
      if (passInfo.steps.length === 0) {
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
      while (stepIndex < passInfo.steps.length) {
        const step = passInfo.steps[stepIndex]!;
        if (step.usesStencil || step.usesFillStencil || step.usesDepth) {
          const pass = encoder.beginRenderPass(
            createRenderPassDescriptor(
              colorView,
              resolveView,
              passInfo.clearColor,
              colorLoadOp,
              stencilView,
            ),
          );
          encodePreparedStep(
            pass,
            step,
            passResources.steps[stepIndex]!,
            preparedWork.resources,
            sharedContext.backend.target,
            preparedWork.resources.viewportBindGroup,
          );
          pass.end();
          passCount += 1;
          colorLoadOp = 'load';
          stepIndex += 1;
          continue;
        }

        const pass = encoder.beginRenderPass(
          createRenderPassDescriptor(colorView, resolveView, passInfo.clearColor, colorLoadOp),
        );
        while (
          stepIndex < passInfo.steps.length &&
          !passInfo.steps[stepIndex]!.usesStencil &&
          !passInfo.steps[stepIndex]!.usesFillStencil &&
          !passInfo.steps[stepIndex]!.usesDepth
        ) {
          encodePreparedStep(
            pass,
            passInfo.steps[stepIndex]!,
            passResources.steps[stepIndex]!,
            preparedWork.resources,
            sharedContext.backend.target,
            preparedWork.resources.viewportBindGroup,
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
