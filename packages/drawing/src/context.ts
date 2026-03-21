import {
  createDawnBackendContext,
  type DawnBackendContext,
  type DawnBackendContextOptions,
  requestDawnBackendContext,
} from './dawn_backend_context.ts';
import { tickDawnQueueManager } from './queue_manager.ts';
import { createDrawingRecorder, type DrawingRecorder } from './recorder.ts';
import { createDawnSharedContext, type DawnSharedContext } from './shared_context.ts';

export type DrawingContext = Readonly<{
  backend: DawnBackendContext;
  sharedContext: DawnSharedContext;
  createRecorder: () => DrawingRecorder;
  tick: () => Promise<void>;
}>;

export const createDrawingContext = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DrawingContext => {
  const sharedContext = createDawnSharedContext(backend, options);

  return {
    backend,
    sharedContext,
    createRecorder: () => createDrawingRecorder(sharedContext),
    tick: () => tickDawnQueueManager(sharedContext.queueManager),
  };
};

export const createDrawingContextFromGpuContext = (
  context: Parameters<typeof createDawnBackendContext>[0],
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DrawingContext => createDrawingContext(createDawnBackendContext(context), options);

export const requestDrawingContext = async (
  options:
    & DawnBackendContextOptions
    & Readonly<{
      resourceBudget?: number;
    }>,
): Promise<DrawingContext> => {
  const backend = await requestDawnBackendContext(options);
  return createDrawingContext(backend, {
    resourceBudget: options.resourceBudget,
  });
};
