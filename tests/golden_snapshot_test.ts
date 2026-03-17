import { assert } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import {
  createOffscreenContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  isWebGPUAvailable,
  requestGpuContext,
} from '@rieul3d/gpu';
import { createHeadlessTarget, encodePngRgba } from '@rieul3d/platform';
import { renderForwardSnapshot } from '@rieul3d/renderer';
import clearOnlyFrameFixture from './fixtures/golden-snapshots/clear-only-frame.png' with {
  type: 'bytes',
};
import solidQuadFrameFixture from './fixtures/golden-snapshots/solid-quad-frame.png' with {
  type: 'bytes',
};
import { createClearScene, createSolidQuadScene } from './golden_snapshot_scenes.ts';

const compareBytes = (expected: Uint8Array, actual: Uint8Array): Readonly<{
  mismatchCount: number;
  firstMismatchIndex: number;
}> => {
  const length = Math.min(expected.length, actual.length);
  let mismatchCount = Math.abs(expected.length - actual.length);
  let firstMismatchIndex = expected.length === actual.length ? -1 : length;

  for (let index = 0; index < length; index += 1) {
    if (expected[index] === actual[index]) {
      continue;
    }

    mismatchCount += 1;
    if (firstMismatchIndex === -1) {
      firstMismatchIndex = index;
    }
  }

  return {
    mismatchCount,
    firstMismatchIndex,
  };
};

const requestGoldenSnapshotContext = async (
  name: string,
): Promise<Awaited<ReturnType<typeof requestGpuContext>> | undefined> => {
  try {
    return await requestGpuContext({ target: createHeadlessTarget(16, 16) });
  } catch (error) {
    if (error instanceof Error && error.message === 'Failed to request WebGPU adapter') {
      console.warn(`Skipping golden snapshot "${name}" because no WebGPU adapter is available.`);
      return undefined;
    }

    throw error;
  }
};

const assertGoldenSnapshot = async (
  name: string,
  sceneFactory: () => ReturnType<typeof createClearScene>,
  expectedPng: Uint8Array,
): Promise<void> => {
  if (!isWebGPUAvailable()) {
    console.warn(`Skipping golden snapshot "${name}" because WebGPU is unavailable.`);
    return;
  }

  const gpuContext = await requestGoldenSnapshotContext(name);
  if (!gpuContext) {
    return;
  }

  try {
    const binding = createOffscreenContext(gpuContext);
    const scene = sceneFactory();
    const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
    const runtimeResidency = createRuntimeResidency();
    ensureSceneMeshResidency(gpuContext, runtimeResidency, scene, evaluatedScene);

    const snapshot = await renderForwardSnapshot(
      gpuContext,
      binding,
      runtimeResidency,
      evaluatedScene,
    );
    const actualPng = encodePngRgba(snapshot);
    const { mismatchCount, firstMismatchIndex } = compareBytes(expectedPng, actualPng);
    if (mismatchCount === 0) {
      return;
    }

    assert(
      false,
      [
        `golden snapshot "${name}" diverged from its checked-in PNG fixture`,
        `mismatched bytes: ${mismatchCount}`,
        `first mismatch index: ${firstMismatchIndex}`,
        'Run deno run -A --unstable-raw-imports scripts/refresh_golden_snapshots.ts to refresh fixtures intentionally.',
      ].join('\n'),
    );
  } finally {
    gpuContext.device.destroy();
  }
};

Deno.test('golden snapshot fixture matches the clear-only frame', async () => {
  await assertGoldenSnapshot('clear-only-frame', createClearScene, clearOnlyFrameFixture);
});

Deno.test('golden snapshot fixture matches the solid quad frame', async () => {
  await assertGoldenSnapshot('solid-quad-frame', createSolidQuadScene, solidQuadFrameFixture);
});
