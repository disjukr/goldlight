import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { authoringTreeToSceneIr, createAuthoringElement } from '@rieul3d/react';

Deno.test('authoringTreeToSceneIr lowers declarative nodes into scene ir', () => {
  const scene = authoringTreeToSceneIr(
    createAuthoringElement('scene', 'authoring-scene', {}, [
      createAuthoringElement('node', 'root', {}, [
        createAuthoringElement('node', 'child'),
      ]),
    ]),
  );

  assertEquals(scene.rootNodeIds, ['root']);
  assertEquals(scene.nodes.find((node) => node.id === 'child')?.parentId, 'root');
});
