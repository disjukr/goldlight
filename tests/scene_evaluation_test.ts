import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import {
  appendAnimationClip,
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
} from '@rieul3d/ir';

Deno.test('evaluateScene computes world transforms across parent-child nodes', () => {
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-0',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0] }],
  });
  scene = appendNode(
    scene,
    createNode('root', {
      transform: {
        translation: { x: 2, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      meshId: 'mesh-0',
    }),
  );
  scene = appendNode(
    scene,
    createNode('child', {
      parentId: 'root',
      transform: {
        translation: { x: 0, y: 3, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  const evaluated = evaluateScene(scene, { timeMs: 0 });
  const child = evaluated.nodes.find((node) => node.node.id === 'child');

  assertEquals(child?.worldMatrix[12], 2);
  assertEquals(child?.worldMatrix[13], 3);
});

Deno.test('evaluateScene composes rotated parent transforms in GPU column-major order', () => {
  let scene = createSceneIr('scene');
  scene = appendNode(
    scene,
    createNode('root', {
      transform: {
        translation: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );
  scene = appendNode(
    scene,
    createNode('child', {
      parentId: 'root',
      transform: {
        translation: { x: 0, y: 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  const evaluated = evaluateScene(scene, { timeMs: 0 });
  const child = evaluated.nodes.find((node) => node.node.id === 'child');

  assertAlmostEquals(child?.worldMatrix[12] ?? 0, -1, 1e-5);
  assertAlmostEquals(child?.worldMatrix[13] ?? 0, 0, 1e-5);
});

Deno.test('evaluateScene samples animation channels', () => {
  let scene = createSceneIr('scene');
  scene = appendNode(scene, createNode('node-0'));
  scene = appendAnimationClip(scene, {
    id: 'clip-0',
    durationMs: 1000,
    channels: [{
      nodeId: 'node-0',
      property: 'translation',
      keyframes: [
        { timeMs: 0, value: { x: 0, y: 0, z: 0, w: 0 } },
        { timeMs: 1000, value: { x: 10, y: 0, z: 0, w: 0 } },
      ],
    }],
  });

  const evaluated = evaluateScene(scene, { timeMs: 500, clipId: 'clip-0' });
  assertEquals(evaluated.nodes[0].node.transform.translation.x, 5);
});
