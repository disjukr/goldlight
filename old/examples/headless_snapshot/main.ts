import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBunWebGpu } from '../shared/install_bun_webgpu.ts';

import { exportPngRgba } from '@disjukr/goldlight/exporters';
import {
  createOffscreenBinding,
  createRuntimeResidency,
  ensureSceneMaterialResidency,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '@disjukr/goldlight/gpu';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
} from '@disjukr/goldlight/ir';
import { evaluateScene, createMaterialRegistry, renderForwardSnapshot } from '@disjukr/goldlight/renderer';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const launchCwd = process.cwd();
await installBunWebGpu();

const parseDimension = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const outputPath = process.argv[2]
  ? path.resolve(launchCwd, process.argv[2])
  : path.join(scriptDir, 'out', 'forward.png');
const width = parseDimension(process.argv[3], 256);
const height = parseDimension(process.argv[4], 256);

const scene = appendNode(
  appendMaterial(
    appendMesh(
      createSceneIr('headless-forward-snapshot'),
      {
        id: 'snapshot-triangle',
        materialId: 'snapshot-material',
        attributes: [{
          semantic: 'POSITION',
          itemSize: 3,
          values: [
            -0.72,
            -0.56,
            0,
            0.76,
            -0.46,
            0,
            -0.08,
            0.78,
            0,
          ],
        }],
      },
    ),
    {
      id: 'snapshot-material',
      kind: 'unlit',
      textures: [],
      parameters: {
        color: { x: 0.16, y: 0.55, z: 0.93, w: 1 },
      },
    },
  ),
  createNode('snapshot-node', {
    meshId: 'snapshot-triangle',
  }),
);

const context = await requestGpuContext({
  target: {
    kind: 'offscreen',
    width,
    height,
    format: 'rgba8unorm',
    msaaSampleCount: 1,
  },
});

const binding = createOffscreenBinding(context);
const residency = createRuntimeResidency();
const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

ensureSceneMeshResidency(context, residency, scene, evaluatedScene);
ensureSceneMaterialResidency(context, residency, evaluatedScene);

const snapshot = await renderForwardSnapshot(
  context,
  binding,
  residency,
  evaluatedScene,
  createMaterialRegistry(),
);

const png = exportPngRgba({
  width: snapshot.width,
  height: snapshot.height,
  bytes: snapshot.bytes,
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, png);

console.log(`Wrote ${outputPath}`);
console.log(`Size: ${snapshot.width}x${snapshot.height}`);
console.log(`Draws: ${snapshot.drawCount}`);
process.exit(0);
