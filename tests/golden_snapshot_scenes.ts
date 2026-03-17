import {
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
  type SceneIr,
} from '@rieul3d/ir';

export const createClearScene = (): SceneIr => createSceneIr('golden-clear-scene');

export const createSolidQuadScene = (): SceneIr => {
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
  return scene;
};
