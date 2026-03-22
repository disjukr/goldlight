import type { DawnCommandBuffer } from './command_buffer.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';
import { tickDawnBackendContext } from './dawn_backend_context.ts';

export type DawnQueueManager = Readonly<{
  backend: DawnBackendContext;
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  lastCompletedRecorderId: number | null;
  supportsSubmittedWorkDone: boolean;
  pendingCompletions: readonly Promise<void>[];
  lastCompletedSerial: number;
  lastError: string | null;
}>;

const asMutableQueueManager = (
  queueManager: DawnQueueManager,
): {
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  lastCompletedRecorderId: number | null;
  supportsSubmittedWorkDone: boolean;
  pendingCompletions: Promise<void>[];
  lastCompletedSerial: number;
  lastError: string | null;
} =>
  queueManager as unknown as {
    submittedCount: number;
    completedCount: number;
    inFlightCount: number;
    lastSubmittedRecorderId: number | null;
    lastCompletedRecorderId: number | null;
    supportsSubmittedWorkDone: boolean;
    pendingCompletions: Promise<void>[];
    lastCompletedSerial: number;
    lastError: string | null;
  };

const completeSubmittedWork = (
  queueManager: DawnQueueManager,
  serial: number,
  recorderId: number,
): void => {
  const mutable = asMutableQueueManager(queueManager);
  if (serial <= mutable.lastCompletedSerial) {
    return;
  }

  const completedDelta = serial - mutable.lastCompletedSerial;
  mutable.lastCompletedSerial = serial;
  mutable.completedCount += completedDelta;
  mutable.inFlightCount = Math.max(0, mutable.inFlightCount - completedDelta);
  mutable.lastCompletedRecorderId = recorderId;
};

export const createDawnQueueManager = (
  backend: DawnBackendContext,
): DawnQueueManager => ({
  backend,
  submittedCount: 0,
  completedCount: 0,
  inFlightCount: 0,
  lastSubmittedRecorderId: null,
  lastCompletedRecorderId: null,
  supportsSubmittedWorkDone: typeof backend.queue.onSubmittedWorkDone === 'function',
  pendingCompletions: [],
  lastCompletedSerial: 0,
  lastError: null,
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
  const submissionSerial = mutable.submittedCount;

  if (!mutable.supportsSubmittedWorkDone) {
    return;
  }

  const completion = queueManager.backend.queue.onSubmittedWorkDone!()
    .then(
      () => undefined,
      (error) => {
        mutable.lastError = error instanceof Error ? error.message : String(error);
      },
    )
    .then(() => {
      completeSubmittedWork(
        queueManager,
        submissionSerial,
        commandBuffer.recording.recorderId,
      );
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
  await Promise.resolve();

  const mutable = asMutableQueueManager(queueManager);
  if (mutable.supportsSubmittedWorkDone) {
    const pending = [...mutable.pendingCompletions];
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
    return;
  }

  completeSubmittedWork(
    queueManager,
    mutable.submittedCount,
    mutable.lastSubmittedRecorderId ?? mutable.lastCompletedRecorderId ?? 0,
  );
};
