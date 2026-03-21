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
  lastCompletedSubmissionId: number | null;
  nextSubmissionId: number;
  pendingSubmissions: readonly DawnPendingSubmission[];
}>;

export type DawnPendingSubmission = Readonly<{
  id: number;
  recorderId: number;
  settled: boolean;
  completion: Promise<void>;
  completionMode: 'queue-work-done' | 'tick-fallback';
}>;

type PendingSubmission = {
  id: number;
  recorderId: number;
  settled: boolean;
  completion: Promise<void>;
  completionMode: 'queue-work-done' | 'tick-fallback';
};

const asMutableQueueManager = (
  queueManager: DawnQueueManager,
): {
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  lastCompletedRecorderId: number | null;
  lastCompletedSubmissionId: number | null;
  nextSubmissionId: number;
  pendingSubmissions: PendingSubmission[];
} =>
  queueManager as unknown as {
    submittedCount: number;
    completedCount: number;
    inFlightCount: number;
    lastSubmittedRecorderId: number | null;
    lastCompletedRecorderId: number | null;
    lastCompletedSubmissionId: number | null;
    nextSubmissionId: number;
    pendingSubmissions: PendingSubmission[];
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
  lastCompletedSubmissionId: null,
  nextSubmissionId: 1,
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
      id: mutable.nextSubmissionId,
      recorderId: commandBuffer.recording.recorderId,
      settled: false,
      completionMode: 'queue-work-done' as const,
      completion: Promise.resolve(queueWithCompletion.onSubmittedWorkDone()).then(() => {
        pendingSubmission.settled = true;
      }),
    };
    mutable.pendingSubmissions.push(pendingSubmission);
    mutable.nextSubmissionId += 1;
    return;
  }

  mutable.pendingSubmissions.push({
    id: mutable.nextSubmissionId,
    recorderId: commandBuffer.recording.recorderId,
    settled: false,
    completionMode: 'tick-fallback',
    completion: Promise.resolve(),
  });
  mutable.nextSubmissionId += 1;
};

export const tickDawnQueueManager = async (
  queueManager: DawnQueueManager,
): Promise<void> => {
  await tickDawnBackendContext(queueManager.backend);
  await Promise.resolve();

  const mutable = asMutableQueueManager(queueManager);
  let completedThisTick = 0;
  let lastCompletedRecorderId = mutable.lastCompletedRecorderId;
  let lastCompletedSubmissionId = mutable.lastCompletedSubmissionId;
  mutable.pendingSubmissions = mutable.pendingSubmissions.filter((submission) => {
    if (submission.completionMode === 'tick-fallback') {
      submission.settled = true;
    }
    if (!submission.settled) {
      return true;
    }
    completedThisTick += 1;
    lastCompletedRecorderId = submission.recorderId;
    lastCompletedSubmissionId = submission.id;
    return false;
  });
  mutable.completedCount += completedThisTick;
  mutable.inFlightCount = Math.max(0, mutable.inFlightCount - completedThisTick);
  mutable.lastCompletedRecorderId = lastCompletedRecorderId;
  mutable.lastCompletedSubmissionId = lastCompletedSubmissionId;
};
