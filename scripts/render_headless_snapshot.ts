import { dirname, fromFileUrl, resolve } from '@std/path';
import { evaluateScene } from '@rieul3d/core';
import {
  createOffscreenContext,
  createRuntimeResidency,
  rebuildRuntimeResidency,
  requestGpuContext,
} from '@rieul3d/gpu';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
  createVec3,
  identityTransform,
} from '@rieul3d/ir';
import { createHeadlessTarget } from '@rieul3d/platform';
import { encodePngRgba } from '@rieul3d/exporters';
import { renderForwardSnapshot } from '@rieul3d/renderer';

const defaultWidth = 512;
const defaultHeight = 512;
const defaultOutputPath = '../examples/headless_snapshot/out/forward.png';
const scriptDirectory = dirname(fromFileUrl(import.meta.url));
const defaultSceneColor = { x: 0.96, y: 0.68, z: 0.24, w: 1 };

const parseSize = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const resolveOutputPath = (value: string | undefined): string =>
  value ? resolve(Deno.cwd(), value) : resolve(scriptDirectory, defaultOutputPath);

const createSnapshotScene = () => {
  let scene = createSceneIr('headless-snapshot');
  scene = appendMaterial(scene, {
    id: 'material-primary',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: defaultSceneColor,
    },
  });
  scene = appendMaterial(scene, {
    id: 'material-accent',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0.2, y: 0.78, z: 0.96, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-diamond',
    materialId: 'material-primary',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [
        0,
        0.72,
        0,
        0.72,
        0,
        0,
        0,
        -0.72,
        0,
        -0.72,
        0,
        0,
      ],
    }],
    indices: [0, 1, 2, 0, 2, 3],
  });
  scene = appendMesh(scene, {
    id: 'mesh-inner',
    materialId: 'material-accent',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [
        -0.22,
        0.2,
        0,
        0.26,
        0.34,
        0,
        0.18,
        -0.24,
        0,
      ],
    }],
  });
  scene = appendNode(
    scene,
    createNode('node-diamond', {
      meshId: 'mesh-diamond',
      transform: {
        ...identityTransform(),
        scale: createVec3(0.82, 0.82, 1),
      },
    }),
  );
  scene = appendNode(scene, createNode('node-inner', { meshId: 'mesh-inner' }));
  return scene;
};

const main = async () => {
  const outputPath = resolveOutputPath(Deno.args[0]);
  const width = parseSize(Deno.args[1], defaultWidth);
  const height = parseSize(Deno.args[2], defaultHeight);
  const target = createHeadlessTarget(width, height);
  const context = await requestGpuContext({ target });
  const residency = createRuntimeResidency();
  const scene = createSnapshotScene();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });

  rebuildRuntimeResidency(
    context,
    residency,
    scene,
    evaluatedScene,
    { images: new Map(), volumes: new Map() },
  );

  const binding = createOffscreenContext(context);
  const snapshot = await renderForwardSnapshot(context, binding, residency, evaluatedScene);
  const pngBytes = encodePngRgba(snapshot);

  await Deno.mkdir(dirname(outputPath), { recursive: true });
  await Deno.writeFile(outputPath, pngBytes);
  console.log(`Wrote ${snapshot.width}x${snapshot.height} snapshot to ${outputPath}`);
};

if (import.meta.main) {
  await main();
}
