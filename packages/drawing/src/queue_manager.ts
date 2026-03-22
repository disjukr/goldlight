import type { DawnCommandBuffer } from './command_buffer.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';
import { tickDawnBackendContext } from './dawn_backend_context.ts';

export type DawnQueueManager = Readonly<{
  backend: DawnBackendContext;
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  supportsSubmittedWorkDone: boolean;
  pendingCompletions: readonly Promise<void>[];
}>;

const asMutableQueueManager = (
  queueManager: DawnQueueManager,
): {
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  supportsSubmittedWorkDone: boolean;
  pendingCompletions: Promise<void>[];
} =>
  queueManager as unknown as {
    submittedCount: number;
    completedCount: number;
    inFlightCount: number;
    lastSubmittedRecorderId: number | null;
    supportsSubmittedWorkDone: boolean;
    pendingCompletions: Promise<void>[];
  };

export const createDawnQueueManager = (
  backend: DawnBackendContext,
): DawnQueueManager => ({
  backend,
  submittedCount: 0,
  completedCount: 0,
  inFlightCount: 0,
  lastSubmittedRecorderId: null,
  supportsSubmittedWorkDone: typeof backend.queue.onSubmittedWorkDone === 'function',
  pendingCompletions: [],
});

export const submitToDawnQueueManager = (
  queueManager: DawnQueueManager,
  commandBuffer: DawnCommandBuffer,
): void => {
  queueManager.backend.queue.submit([commandBuffer.commandBuffer]);

  const mutable = asMutableQueueManager(queueManager);
  mutable.submittedCount += 1;
  mutable.inFlightCount += 1;
  mutable.lastSubmittedRecorderId = commandBuffer.recording.recorderId;

  if (!mutable.supportsSubmittedWorkDone) {
    return;
  }

  const completion = queueManager.backend.queue.onSubmittedWorkDone!()
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      mutable.completedCount += 1;
      mutable.inFlightCount = Math.max(0, mutable.inFlightCount - 1);
    })
    .finally(() => {
      mutable.pendingCompletions = mutable.pendingCompletions.filter((pending) =>
        pending !== completion
      );
    });
  mutable.pendingCompletions = [...mutable.pendingCompletions, completion];
};

export const tickDawnQueueManager = async (
  queueManager: DawnQueueManager,
): Promise<void> => {
  await tickDawnBackendContext(queueManager.backend);

  const mutable = asMutableQueueManager(queueManager);
  if (mutable.supportsSubmittedWorkDone) {
    const pending = [...mutable.pendingCompletions];
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
    return;
  }

  mutable.completedCount += mutable.inFlightCount;
  mutable.inFlightCount = 0;
};
