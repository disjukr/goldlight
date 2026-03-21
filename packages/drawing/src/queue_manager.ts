import type { DawnCommandBuffer } from './command_buffer.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';
import { tickDawnBackendContext } from './dawn_backend_context.ts';

export type DawnQueueManager = Readonly<{
  backend: DawnBackendContext;
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  pendingSubmissions: readonly Readonly<{
    settled: boolean;
    completion: Promise<void>;
  }>[];
}>;

type PendingSubmission = {
  settled: boolean;
  completion: Promise<void>;
};

const asMutableQueueManager = (
  queueManager: DawnQueueManager,
): {
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  pendingSubmissions: Array<{
    settled: boolean;
    completion: Promise<void>;
  }>;
} =>
  queueManager as unknown as {
    submittedCount: number;
    completedCount: number;
    inFlightCount: number;
    lastSubmittedRecorderId: number | null;
    pendingSubmissions: Array<{
      settled: boolean;
      completion: Promise<void>;
    }>;
  };

export const createDawnQueueManager = (
  backend: DawnBackendContext,
): DawnQueueManager => ({
  backend,
  submittedCount: 0,
  completedCount: 0,
  inFlightCount: 0,
  lastSubmittedRecorderId: null,
  pendingSubmissions: [],
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

  const queueWithCompletion = queueManager.backend.queue as GPUQueue & {
    onSubmittedWorkDone?: () => Promise<void>;
  };
  if (typeof queueWithCompletion.onSubmittedWorkDone === 'function') {
    const pendingSubmission = {
      settled: false,
      completion: Promise.resolve(queueWithCompletion.onSubmittedWorkDone()).then(() => {
        pendingSubmission.settled = true;
      }),
    };
    mutable.pendingSubmissions.push(pendingSubmission);
  }
};

export const tickDawnQueueManager = async (
  queueManager: DawnQueueManager,
): Promise<void> => {
  await tickDawnBackendContext(queueManager.backend);
  await Promise.resolve();

  const mutable = asMutableQueueManager(queueManager);
  if (mutable.pendingSubmissions.length === 0) {
    mutable.completedCount += mutable.inFlightCount;
    mutable.inFlightCount = 0;
    return;
  }

  let completedThisTick = 0;
  mutable.pendingSubmissions = mutable.pendingSubmissions.filter((submission) => {
    if (!submission.settled) {
      return true;
    }
    completedThisTick += 1;
    return false;
  });
  mutable.completedCount += completedThisTick;
  mutable.inFlightCount = Math.max(0, mutable.inFlightCount - completedThisTick);
};
