import { appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import type { MeshAttribute, SceneIr } from '@rieul3d/ir';

export const importObjFromText = (source: string, sceneId = 'obj-scene'): SceneIr => {
  const positions: number[] = [];
  const faceIndices: number[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
      const [, x, y, z] = trimmed.split(/\s+/);
      positions.push(Number(x), Number(y), Number(z));
    }

    if (trimmed.startsWith('f ')) {
      const [, ...parts] = trimmed.split(/\s+/);
      const indices = parts.map((part) => Number(part.split('/')[0]) - 1);
      for (let index = 1; index < indices.length - 1; index += 1) {
        faceIndices.push(indices[0], indices[index], indices[index + 1]);
      }
    }
  }

  const positionAttribute: MeshAttribute = {
    semantic: 'POSITION',
    itemSize: 3,
    values: positions,
  };

  const meshId = `${sceneId}-mesh-0`;
  let scene = createSceneIr(sceneId);
  scene = appendMesh(scene, {
    id: meshId,
    attributes: [positionAttribute],
    indices: faceIndices,
  });
  scene = appendNode(scene, createNode(`${sceneId}-node-0`, { meshId }));
  return scene;
};
