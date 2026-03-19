import { dirname, fromFileUrl, join } from '@std/path';
import { evaluateScene } from '@rieul3d/core';
import {
  createOffscreenBinding,
  createRuntimeResidency,
  rebuildRuntimeResidency,
  requestGpuContext,
} from '@rieul3d/gpu';
import { encodePngRgba } from '@rieul3d/exporters';
import { renderForwardSnapshot } from '@rieul3d/renderer';
import {
  createClearScene,
  createSdfBoxScene,
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
  const target = {
    kind: 'offscreen',
    width: 16,
    height: 16,
    format: 'rgba8unorm',
    sampleCount: 1,
  } as const;
  const gpuContext = await requestGpuContext({ target });

  try {
    const binding = createOffscreenBinding(gpuContext);
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
    initialContext = await requestGpuContext({
      target: { kind: 'offscreen', width: 16, height: 16, format: 'rgba8unorm', sampleCount: 1 },
    });
    rebuildRuntimeResidency(initialContext, residency, scene, evaluatedScene, assets);
    await renderForwardSnapshot(
      initialContext,
      createOffscreenBinding(initialContext),
      residency,
      evaluatedScene,
    );
    initialContext.device.destroy();
    initialContext = undefined;

    recoveredContext = await requestGpuContext({
      target: { kind: 'offscreen', width: 16, height: 16, format: 'rgba8unorm', sampleCount: 1 },
    });
    rebuildRuntimeResidency(recoveredContext, residency, scene, evaluatedScene, assets);
    const snapshot = await renderForwardSnapshot(
      recoveredContext,
      createOffscreenBinding(recoveredContext),
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
await renderFixture('sdf-box-frame', createSdfBoxScene);
await renderFixture('volume-frame', createVolumeScene);
await renderRecoveryFixture('recovery-volume-frame', createVolumeScene);
