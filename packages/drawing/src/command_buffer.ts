import { acquireColorAttachmentView, type RenderContextBinding } from '@rieul3d/gpu';
import type { DrawingRecording } from './recording.ts';
import type { DawnSharedContext } from './shared_context.ts';
import type { DrawingCommand } from './types.ts';

export type DawnCommandBuffer = Readonly<{
  backend: 'graphite-dawn';
  recording: DrawingRecording;
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

export const encodeDawnCommandBuffer = (
  sharedContext: DawnSharedContext,
  recording: DrawingRecording,
  binding: RenderContextBinding,
): DawnCommandBuffer => {
  const encoder = sharedContext.backend.device.createCommandEncoder({
    label: `drawing-recorder-${recording.recorderId}`,
  });
  const colorView = acquireColorAttachmentView(
    {
      device: sharedContext.backend.device,
    },
    binding,
  );
  const unsupportedCommands: DrawingCommand[] = [];
  let passCount = 0;

  for (const command of recording.commands) {
    if (command.kind !== 'clear') {
      unsupportedCommands.push(command);
      continue;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: toGpuColor(command.color),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.end();
    passCount += 1;
  }

  return {
    backend: 'graphite-dawn',
    recording,
    commandBuffer: encoder.finish(),
    passCount,
    unsupportedCommands: Object.freeze(unsupportedCommands),
  };
};

export const submitDawnCommandBuffer = (
  sharedContext: DawnSharedContext,
  commandBuffer: DawnCommandBuffer,
): void => {
  sharedContext.backend.queue.submit([commandBuffer.commandBuffer]);
};
