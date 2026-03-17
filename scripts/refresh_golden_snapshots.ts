import { dirname, fromFileUrl, join } from '@std/path';
import { evaluateScene } from '@rieul3d/core';
import {
  createOffscreenContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '@rieul3d/gpu';
import { createHeadlessTarget, encodePngRgba } from '@rieul3d/platform';
import { renderForwardSnapshot } from '@rieul3d/renderer';
import { createClearScene, createSolidQuadScene } from '../tests/golden_snapshot_scenes.ts';

const fixtureDirectory = join(
  dirname(fromFileUrl(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'golden-snapshots',
);

const renderFixture = async (
  name: string,
  sceneFactory: () => ReturnType<typeof createClearScene>,
): Promise<void> => {
  const target = createHeadlessTarget(16, 16);
  const gpuContext = await requestGpuContext({ target });

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
    const png = encodePngRgba(snapshot);
    const fixturePath = join(fixtureDirectory, `${name}.png`);
    await Deno.mkdir(dirname(fixturePath), { recursive: true });
    await Deno.writeFile(fixturePath, png);
    console.log(`Wrote ${fixturePath}`);
  } finally {
    gpuContext.device.destroy();
  }
};

await renderFixture('clear-only-frame', createClearScene);
await renderFixture('solid-quad-frame', createSolidQuadScene);
