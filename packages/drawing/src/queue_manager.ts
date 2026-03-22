import type { DawnCommandBuffer } from './command_buffer.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';
import { tickDawnBackendContext } from './dawn_backend_context.ts';

export type DawnSubmissionState =
  | 'pending'
  | 'finished'
  | 'failed';

export type DawnSubmissionResult = Readonly<{
  success: boolean;
  serial: number;
  recorderId: number | null;
  error: string | null;
}>;

export type DawnFinishedCallback = (result: DawnSubmissionResult) => void;

export type DawnOutstandingSubmission = Readonly<{
  backend: 'graphite-dawn';
  serial: number;
  recorderId: number;
  commandBuffer: DawnCommandBuffer;
  state: DawnSubmissionState;
  completionPromise: Promise<void> | null;
  error: string | null;
  resourcesReleased: boolean;
  finishedCallbacks: readonly DawnFinishedCallback[];
  finishCallbacksNotified: boolean;
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
  lastCompletedSerial: number;
  lastError: string | null;
}>;

type MutableDawnOutstandingSubmission = {
  state: DawnSubmissionState;
  completionPromise: Promise<void> | null;
  error: string | null;
  resourcesReleased: boolean;
  finishedCallbacks: DawnFinishedCallback[];
  finishCallbacksNotified: boolean;
};

type MutableDawnQueueManager = {
  submittedCount: number;
  completedCount: number;
  inFlightCount: number;
  lastSubmittedRecorderId: number | null;
  lastCompletedRecorderId: number | null;
  supportsSubmittedWorkDone: boolean;
  outstandingSubmissions: DawnOutstandingSubmission[];
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
  state: 'pending',
  completionPromise: null,
  error: null,
  resourcesReleased: false,
  finishedCallbacks: [],
  finishCallbacksNotified: false,
});

const isSubmissionFinished = (
  submission: DawnOutstandingSubmission,
): boolean => submission.state !== 'pending';

const notifyFinishedCallbacks = (
  submission: DawnOutstandingSubmission,
): void => {
  const mutable = asMutableSubmission(submission);
  if (mutable.finishCallbacksNotified) {
    return;
  }
  mutable.finishCallbacksNotified = true;
  const result: DawnSubmissionResult = {
    success: submission.error === null,
    serial: submission.serial,
    recorderId: submission.recorderId,
    error: submission.error,
  };
  for (const callback of submission.finishedCallbacks) {
    callback(result);
  }
};

const releaseSubmissionResources = (
  submission: DawnOutstandingSubmission,
): void => {
  const mutable = asMutableSubmission(submission);
  if (mutable.resourcesReleased) {
    return;
  }
  mutable.resourcesReleased = true;
  for (const buffer of submission.commandBuffer.ownedBuffers) {
    buffer.destroy?.();
  }
};

const markSubmissionFinished = (
  queueManager: DawnQueueManager,
  submission: DawnOutstandingSubmission,
): void => {
  const mutable = asMutableSubmission(submission);
  mutable.state = submission.error === null ? 'finished' : 'failed';
  releaseSubmissionResources(submission);
  notifyFinishedCallbacks(submission);
  completeSubmittedWork(queueManager, submission.serial, submission.recorderId);
};

const settleSubmissionCompletion = (
  queueManager: DawnQueueManager,
  submission: DawnOutstandingSubmission,
): Promise<void> => {
  const mutableQueueManager = asMutableQueueManager(queueManager);
  const mutableSubmission = asMutableSubmission(submission);

  if (!mutableQueueManager.supportsSubmittedWorkDone) {
    mutableSubmission.state = 'finished';
    return Promise.resolve();
  }

  const completion = queueManager.backend.queue.onSubmittedWorkDone!()
    .then(
      () => undefined,
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        mutableQueueManager.lastError = message;
        mutableSubmission.error = message;
      },
    )
    .then(() => {
      mutableSubmission.state = mutableSubmission.error === null ? 'finished' : 'failed';
    });

  mutableSubmission.completionPromise = completion;
  return completion;
};

const drainFinishedSubmissions = (queueManager: DawnQueueManager): void => {
  const mutable = asMutableQueueManager(queueManager);
  while (mutable.outstandingSubmissions.length > 0) {
    const finished = mutable.outstandingSubmissions[0];
    if (finished === undefined || !isSubmissionFinished(finished)) {
      return;
    }
    mutable.outstandingSubmissions = mutable.outstandingSubmissions.slice(1);
    markSubmissionFinished(queueManager, finished);
  }
};

const waitForOutstandingSubmission = async (
  submission: DawnOutstandingSubmission,
): Promise<void> => {
  if (submission.completionPromise !== null) {
    await submission.completionPromise;
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
  lastCompletedSerial: 0,
  lastError: null,
});

export const submitToDawnQueueManager = (
  queueManager: DawnQueueManager,
  commandBuffer: DawnCommandBuffer,
): DawnOutstandingSubmission => {
  const mutable = asMutableQueueManager(queueManager);
  const submission = createOutstandingSubmission(commandBuffer, mutable.submittedCount + 1);

  try {
    queueManager.backend.queue.submit([commandBuffer.commandBuffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const mutableSubmission = asMutableSubmission(submission);
    mutableSubmission.error = message;
    mutableSubmission.state = 'failed';
    mutable.lastError = message;
    releaseSubmissionResources(submission);
    notifyFinishedCallbacks(submission);
    return submission;
  }

  mutable.submittedCount = submission.serial;
  mutable.inFlightCount += 1;
  mutable.lastSubmittedRecorderId = submission.recorderId;
  mutable.outstandingSubmissions = [...mutable.outstandingSubmissions, submission];
  void settleSubmissionCompletion(queueManager, submission);
  return submission;
};

export const addFinishedCallbackToDawnSubmission = (
  submission: DawnOutstandingSubmission,
  callback: DawnFinishedCallback,
): void => {
  const mutable = asMutableSubmission(submission);
  if (submission.state === 'pending') {
    mutable.finishedCallbacks = [...mutable.finishedCallbacks, callback];
    return;
  }
  callback({
    success: submission.error === null,
    serial: submission.serial,
    recorderId: submission.recorderId,
    error: submission.error,
  });
};

export const addFinishedCallbackToDawnQueueManager = (
  queueManager: DawnQueueManager,
  callback: DawnFinishedCallback,
): void => {
  const outstanding = queueManager.outstandingSubmissions;
  const latest = outstanding[outstanding.length - 1];
  if (latest !== undefined) {
    addFinishedCallbackToDawnSubmission(latest, callback);
    return;
  }
  callback({
    success: queueManager.lastError === null,
    serial: queueManager.lastCompletedSerial,
    recorderId: queueManager.lastCompletedRecorderId,
    error: queueManager.lastError,
  });
};

export const checkForFinishedDawnQueueManager = async (
  queueManager: DawnQueueManager,
  options: Readonly<{
    syncToCpu?: boolean;
  }> = {},
): Promise<void> => {
  const outstanding = queueManager.outstandingSubmissions;
  if (outstanding.length === 0) {
    return;
  }

  if (options.syncToCpu === true) {
    const back = outstanding[outstanding.length - 1];
    if (back !== undefined) {
      await waitForOutstandingSubmission(back);
    }
  }

  if (!queueManager.supportsSubmittedWorkDone) {
    for (const submission of outstanding) {
      asMutableSubmission(submission).state = 'finished';
    }
  }

  if (queueManager.supportsSubmittedWorkDone) {
    const front = outstanding[0];
    if (front !== undefined && front.completionPromise !== null) {
      await Promise.allSettled(
        outstanding
          .map((submission) => submission.completionPromise)
          .filter((completion): completion is Promise<void> => completion !== null),
      );
    }
  }

  drainFinishedSubmissions(queueManager);
};

export const tickDawnQueueManager = async (
  queueManager: DawnQueueManager,
): Promise<void> => {
  await tickDawnBackendContext(queueManager.backend);
  await Promise.resolve();
  await checkForFinishedDawnQueueManager(queueManager);
};
