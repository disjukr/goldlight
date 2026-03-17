import { dirname, fromFileUrl, join } from '@std/path';
import { evaluateScene } from '@rieul3d/core';
import {
  createOffscreenContext,
  createRuntimeResidency,
  rebuildRuntimeResidency,
  requestGpuContext,
} from '@rieul3d/gpu';
import { createHeadlessTarget, encodePngRgba } from '@rieul3d/platform';
import { renderForwardSnapshot } from '@rieul3d/renderer';
import {
  createClearScene,
  createSdfSphereScene,
  createSolidQuadScene,
  createVolumeScene,
  type GoldenSnapshotScenario,
} from '../tests/golden_snapshot_scenes.ts';

const fixtureDirectory = join(
  dirname(fromFileUrl(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'golden-snapshots',
);

const renderFixture = async (
  name: string,
  scenarioFactory: () => GoldenSnapshotScenario,
): Promise<void> => {
  const target = createHeadlessTarget(16, 16);
  const gpuContext = await requestGpuContext({ target });

  try {
    const binding = createOffscreenContext(gpuContext);
    const { scene, assets } = scenarioFactory();
    const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
    const runtimeResidency = createRuntimeResidency();
    rebuildRuntimeResidency(gpuContext, runtimeResidency, scene, evaluatedScene, assets);

    const snapshot = await renderForwardSnapshot(
      gpuContext,
      binding,
      runtimeResidency,
      evaluatedScene,
    );
    const png = encodePngRgba(snapshot);
    const fixturePath = join(fixtureDirectory, `${name}.png`);
    await Deno.mkdir(dirname(fixturePath), { recursive: true });
    await Deno.writeFile(fixturePath, png);
    console.log(`Wrote ${fixturePath}`);
  } finally {
    gpuContext.device.destroy();
  }
};

const renderRecoveryFixture = async (
  name: string,
  scenarioFactory: () => GoldenSnapshotScenario,
): Promise<void> => {
  const { scene, assets } = scenarioFactory();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  const residency = createRuntimeResidency();
  let initialContext: Awaited<ReturnType<typeof requestGpuContext>> | undefined;
  let recoveredContext: Awaited<ReturnType<typeof requestGpuContext>> | undefined;

  try {
    initialContext = await requestGpuContext({ target: createHeadlessTarget(16, 16) });
    rebuildRuntimeResidency(initialContext, residency, scene, evaluatedScene, assets);
    await renderForwardSnapshot(
      initialContext,
      createOffscreenContext(initialContext),
      residency,
      evaluatedScene,
    );
    initialContext.device.destroy();
    initialContext = undefined;

    recoveredContext = await requestGpuContext({ target: createHeadlessTarget(16, 16) });
    rebuildRuntimeResidency(recoveredContext, residency, scene, evaluatedScene, assets);
    const snapshot = await renderForwardSnapshot(
      recoveredContext,
      createOffscreenContext(recoveredContext),
      residency,
      evaluatedScene,
    );
    const png = encodePngRgba(snapshot);
    const fixturePath = join(fixtureDirectory, `${name}.png`);
    await Deno.mkdir(dirname(fixturePath), { recursive: true });
    await Deno.writeFile(fixturePath, png);
    console.log(`Wrote ${fixturePath}`);
  } finally {
    initialContext?.device.destroy();
    recoveredContext?.device.destroy();
  }
};

await renderFixture('clear-only-frame', createClearScene);
await renderFixture('solid-quad-frame', createSolidQuadScene);
await renderFixture('sdf-sphere-frame', createSdfSphereScene);
await renderFixture('volume-frame', createVolumeScene);
await renderRecoveryFixture('recovery-volume-frame', createVolumeScene);
