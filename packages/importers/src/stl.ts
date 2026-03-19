import { appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import type { MeshAttribute, SceneIr } from '@rieul3d/ir';

export const importStlFromText = (source: string, sceneId = 'stl-scene'): SceneIr => {
  const positions: number[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('vertex ')) {
      continue;
    }

    const [, x, y, z] = trimmed.split(/\s+/);
    positions.push(Number(x), Number(y), Number(z));
  }

  const indices = Array.from({ length: positions.length / 3 }, (_, index) => index);
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
    indices,
  });
  scene = appendNode(scene, createNode(`${sceneId}-node-0`, { meshId }));
  return scene;
};
