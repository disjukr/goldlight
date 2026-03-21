import { createDawnCaps, type DawnCaps } from './caps.ts';
import { createDawnResourceProvider, type DawnResourceProvider } from './resource_provider.ts';
import type { DawnBackendContext } from './dawn_backend_context.ts';

export type DawnSharedContext = Readonly<{
  backend: DawnBackendContext;
  caps: DawnCaps;
  resourceProvider: DawnResourceProvider;
  hasTick: boolean;
  recorderCount: number;
}>;

export const createDawnSharedContext = (
  backend: DawnBackendContext,
  options: Readonly<{
    resourceBudget?: number;
  }> = {},
): DawnSharedContext => ({
  backend,
  caps: createDawnCaps(backend),
  resourceProvider: createDawnResourceProvider(backend, {
    resourceBudget: options.resourceBudget,
  }),
  hasTick: typeof backend.tick === 'function',
  recorderCount: 0,
});

export const registerDawnRecorder = (
  sharedContext: DawnSharedContext,
): number => {
  const mutable = sharedContext as {
    recorderCount: number;
  };
  mutable.recorderCount += 1;
  return mutable.recorderCount;
};
