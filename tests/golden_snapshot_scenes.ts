import {
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
  type SceneIr,
} from '@rieul3d/ir';
import type { AssetSource } from '@rieul3d/gpu';

export type GoldenSnapshotScenario = Readonly<{
  scene: SceneIr;
  assets: AssetSource;
}>;

const emptyAssets = (): AssetSource => ({
  images: new Map(),
  volumes: new Map(),
});

export const createClearScene = (): GoldenSnapshotScenario => ({
  scene: createSceneIr('golden-clear-scene'),
  assets: emptyAssets(),
});

export const createSolidQuadScene = (): GoldenSnapshotScenario => {
  let scene = createSceneIr('golden-solid-quad-scene');
  scene = appendMaterial(scene, {
    id: 'material-solid-quad',
    kind: 'unlit',
    textures: [],
    parameters: {
      color: { x: 0.2, y: 0.6, z: 0.9, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-solid-quad',
    materialId: 'material-solid-quad',
    attributes: [{
      semantic: 'POSITION',
      itemSize: 3,
      values: [
        -1,
        -1,
        0,
        1,
        -1,
        0,
        -1,
        1,
        0,
        -1,
        1,
        0,
        1,
        -1,
        0,
        1,
        1,
        0,
      ],
    }],
  });
  scene = appendNode(scene, createNode('node-solid-quad', { meshId: 'mesh-solid-quad' }));
  return {
    scene,
    assets: emptyAssets(),
  };
};

export const createSdfSphereScene = (): GoldenSnapshotScenario => {
  let scene = createSceneIr('golden-sdf-sphere-scene');
  scene = {
    ...scene,
    sdfPrimitives: [{
      id: 'sdf-sphere',
      op: 'sphere',
      parameters: {
        radius: { x: 0.72, y: 0, z: 0, w: 0 },
        color: { x: 0.25, y: 0.85, z: 1, w: 1 },
      },
    }],
  };
  scene = appendNode(scene, createNode('node-sdf-sphere', { sdfId: 'sdf-sphere' }));
  return {
    scene,
    assets: emptyAssets(),
  };
};

const createVolumeDensityBytes = (): Uint8Array => {
  const bytes = new Uint8Array(4 * 4 * 4);
  let index = 0;

  for (let z = 0; z < 4; z += 1) {
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const dx = x - 1.5;
        const dy = y - 1.5;
        const dz = z - 1.5;
        const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
        const density = Math.max(0, 1 - (distance / 2.6));
        bytes[index] = Math.round(density * 255);
        index += 1;
      }
    }
  }

  return bytes;
};

export const createVolumeScene = (): GoldenSnapshotScenario => {
  let scene = createSceneIr('golden-volume-scene');
  scene = {
    ...scene,
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(
    scene,
    createNode('node-volume-0', {
      volumeId: 'volume-0',
      transform: {
        translation: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1.35, y: 1.35, z: 1.35 },
      },
    }),
  );

  return {
    scene,
    assets: {
      images: new Map(),
      volumes: new Map([['volume-asset-0', {
        id: 'volume-asset-0',
        mimeType: 'application/octet-stream',
        bytes: createVolumeDensityBytes(),
        width: 4,
        height: 4,
        depth: 4,
      }]]),
    },
  };
};
