import type { DawnCommandBuffer } from './command_buffer.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';
import { tickDawnBackendContext } from './dawn_backend_context.ts';

export type DawnOutstandingSubmission = Readonly<{
  backend: 'graphite-dawn';
  serial: number;
  recorderId: number;
  commandBuffer: DawnCommandBuffer;
  completed: boolean;
  completionPromise: Promise<void> | null;
  error: string | null;
}>;

export type DawnQueueManager = Readonly<{
  backend: DawnBackendContext;
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  lastCompletedRecorderId: number | null;
  supportsSubmittedWorkDone: boolean;
  outstandingSubmissions: readonly DawnOutstandingSubmission[];
  pendingCompletions: readonly Promise<void>[];
  lastCompletedSerial: number;
  lastError: string | null;
}>;

type MutableDawnOutstandingSubmission = {
  completed: boolean;
  completionPromise: Promise<void> | null;
  error: string | null;
};

type MutableDawnQueueManager = {
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  lastCompletedRecorderId: number | null;
  supportsSubmittedWorkDone: boolean;
  outstandingSubmissions: DawnOutstandingSubmission[];
  pendingCompletions: Promise<void>[];
  lastCompletedSerial: number;
  lastError: string | null;
};

const asMutableQueueManager = (
  queueManager: DawnQueueManager,
): MutableDawnQueueManager => queueManager as unknown as MutableDawnQueueManager;

const asMutableSubmission = (
  submission: DawnOutstandingSubmission,
): MutableDawnOutstandingSubmission => submission as unknown as MutableDawnOutstandingSubmission;

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

const createOutstandingSubmission = (
  commandBuffer: DawnCommandBuffer,
  serial: number,
): DawnOutstandingSubmission => ({
  backend: 'graphite-dawn',
  serial,
  recorderId: commandBuffer.recording.recorderId,
  commandBuffer,
  completed: false,
  completionPromise: null,
  error: null,
});

const drainFinishedSubmissions = (queueManager: DawnQueueManager): void => {
  const mutable = asMutableQueueManager(queueManager);
  while (mutable.outstandingSubmissions[0]?.completed) {
    const finished = mutable.outstandingSubmissions[0]!;
    mutable.outstandingSubmissions = mutable.outstandingSubmissions.slice(1);
    completeSubmittedWork(queueManager, finished.serial, finished.recorderId);
  }
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
  outstandingSubmissions: [],
  pendingCompletions: [],
  lastCompletedSerial: 0,
  lastError: null,
});

export const submitToDawnQueueManager = (
  queueManager: DawnQueueManager,
  commandBuffer: DawnCommandBuffer,
): DawnOutstandingSubmission => {
  queueManager.backend.queue.submit([commandBuffer.commandBuffer]);

  const mutable = asMutableQueueManager(queueManager);
  mutable.submittedCount += 1;
  mutable.inFlightCount += 1;
  mutable.lastSubmittedRecorderId = commandBuffer.recording.recorderId;

  const submission = createOutstandingSubmission(commandBuffer, mutable.submittedCount);
  mutable.outstandingSubmissions = [...mutable.outstandingSubmissions, submission];

  if (!mutable.supportsSubmittedWorkDone) {
    return submission;
  }

  const mutableSubmission = asMutableSubmission(submission);
  const completion = queueManager.backend.queue.onSubmittedWorkDone!()
    .then(
      () => undefined,
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        mutable.lastError = message;
        mutableSubmission.error = message;
      },
    )
    .then(() => {
      mutableSubmission.completed = true;
    })
    .finally(() => {
      mutable.pendingCompletions = mutable.pendingCompletions.filter((pending) =>
        pending !== completion
      );
    });

  mutableSubmission.completionPromise = completion;
  mutable.pendingCompletions = [...mutable.pendingCompletions, completion];
  return submission;
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
  } else {
    for (const submission of mutable.outstandingSubmissions) {
      asMutableSubmission(submission).completed = true;
    }
  }

  drainFinishedSubmissions(queueManager);
};
