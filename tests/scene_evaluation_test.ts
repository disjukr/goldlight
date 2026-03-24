import { assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { createScreenWorldRay, evaluateScene, reevaluateSceneTransforms } from '@goldlight/core';
import {
  appendAnimationClip,
  appendCamera,
  appendMesh,
  appendNode,
  createNode,
  createOrthographicCamera,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '@goldlight/ir';

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

Deno.test('reevaluateSceneTransforms recomputes world matrices for transform-only scene changes', () => {
  let scene = createSceneIr('scene');
  scene = appendNode(
    scene,
    createNode('root', {
      transform: {
        translation: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
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

  const firstEvaluated = evaluateScene(scene, { timeMs: 0 });
  const nextScene = {
    ...scene,
    nodes: scene.nodes.map((node) =>
      node.id === 'root'
        ? {
          ...node,
          transform: {
            ...node.transform,
            translation: { x: 4, y: 0, z: 0 },
          },
        }
        : node
    ),
  };

  const nextEvaluated = reevaluateSceneTransforms(nextScene, firstEvaluated, { timeMs: 0 });
  const child = nextEvaluated.nodes.find((node) => node.node.id === 'child');

  assertEquals(child?.worldMatrix[12], 4);
  assertEquals(child?.worldMatrix[13], 2);
});

Deno.test('evaluateScene resolves the active camera and its view matrix', () => {
  let scene = createSceneIr('scene');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera('camera-0', {
        yfov: Math.PI / 3,
        znear: 0.1,
        zfar: 10,
      }),
    ),
    'camera-0',
  );
  scene = appendNode(
    scene,
    createNode('camera-node', {
      cameraId: 'camera-0',
      transform: {
        translation: { x: 0, y: 0, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  const evaluated = evaluateScene(scene, { timeMs: 0 });

  assertEquals(evaluated.activeCamera?.camera.type, 'perspective');
  assertEquals(evaluated.activeCamera?.worldMatrix[14], 3);
  assertAlmostEquals(evaluated.activeCamera?.viewMatrix[14] ?? 0, -3, 1e-6);
});

Deno.test('createScreenWorldRay returns a centered forward ray for a perspective camera', () => {
  let scene = createSceneIr('scene');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera('camera-0', {
        yfov: Math.PI / 2,
        znear: 0.1,
        zfar: 10,
      }),
    ),
    'camera-0',
  );
  scene = appendNode(scene, createNode('camera-node', { cameraId: 'camera-0' }));

  const evaluated = evaluateScene(scene, { timeMs: 0 });
  const ray = createScreenWorldRay(evaluated.activeCamera!, {
    x: 100,
    y: 50,
    viewportWidth: 200,
    viewportHeight: 100,
  });

  assertAlmostEquals(ray.origin.x, 0, 1e-6);
  assertAlmostEquals(ray.origin.y, 0, 1e-6);
  assertAlmostEquals(ray.origin.z, 0, 1e-6);
  assertAlmostEquals(ray.direction.x, 0, 1e-6);
  assertAlmostEquals(ray.direction.y, 0, 1e-6);
  assertAlmostEquals(ray.direction.z, -1, 1e-6);
});

Deno.test('createScreenWorldRay respects viewport offsets and camera rotation', () => {
  let scene = createSceneIr('scene');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera('camera-0', {
        yfov: Math.PI / 2,
        znear: 0.1,
        zfar: 10,
      }),
    ),
    'camera-0',
  );
  scene = appendNode(
    scene,
    createNode('camera-node', {
      cameraId: 'camera-0',
      transform: {
        translation: { x: 4, y: 2, z: 1 },
        rotation: { x: 0, y: 0.70710678, z: 0, w: 0.70710678 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  const evaluated = evaluateScene(scene, { timeMs: 0 });
  const ray = createScreenWorldRay(evaluated.activeCamera!, {
    x: 150,
    y: 70,
    viewportX: 50,
    viewportY: 20,
    viewportWidth: 200,
    viewportHeight: 100,
  });

  assertAlmostEquals(ray.origin.x, 4, 1e-6);
  assertAlmostEquals(ray.origin.y, 2, 1e-6);
  assertAlmostEquals(ray.origin.z, 1, 1e-6);
  assertAlmostEquals(ray.direction.x, -1, 1e-5);
  assertAlmostEquals(ray.direction.y, 0, 1e-6);
  assertAlmostEquals(ray.direction.z, 0, 1e-5);
});

Deno.test('createScreenWorldRay offsets orthographic origins across the viewport', () => {
  let scene = createSceneIr('scene');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createOrthographicCamera('camera-0', {
        xmag: 2,
        ymag: 1,
        znear: 0.5,
        zfar: 10,
      }),
    ),
    'camera-0',
  );
  scene = appendNode(
    scene,
    createNode('camera-node', {
      cameraId: 'camera-0',
      transform: {
        translation: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  const evaluated = evaluateScene(scene, { timeMs: 0 });
  const ray = createScreenWorldRay(evaluated.activeCamera!, {
    x: 200,
    y: 0,
    viewportWidth: 200,
    viewportHeight: 100,
  });

  assertAlmostEquals(ray.origin.x, 3, 1e-6);
  assertAlmostEquals(ray.origin.y, 3, 1e-6);
  assertAlmostEquals(ray.origin.z, 2.5, 1e-6);
  assertAlmostEquals(ray.direction.x, 0, 1e-6);
  assertAlmostEquals(ray.direction.y, 0, 1e-6);
  assertAlmostEquals(ray.direction.z, -1, 1e-6);
});

Deno.test('createScreenWorldRay rejects invalid viewport dimensions', () => {
  let scene = createSceneIr('scene');
  scene = setActiveCamera(appendCamera(scene, createPerspectiveCamera('camera-0')), 'camera-0');
  scene = appendNode(scene, createNode('camera-node', { cameraId: 'camera-0' }));

  const evaluated = evaluateScene(scene, { timeMs: 0 });

  assertThrows(() =>
    createScreenWorldRay(evaluated.activeCamera!, {
      x: 0,
      y: 0,
      viewportWidth: 0,
      viewportHeight: 100,
    })
  );
});

Deno.test('createScreenWorldRay follows the evaluated view fallback for singular camera transforms', () => {
  let scene = createSceneIr('scene');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera('camera-0', {
        yfov: Math.PI / 2,
        znear: 0.1,
        zfar: 10,
      }),
    ),
    'camera-0',
  );
  scene = appendNode(
    scene,
    createNode('camera-node', {
      cameraId: 'camera-0',
      transform: {
        translation: { x: 9, y: 4, z: 2 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 0, y: 1, z: 1 },
      },
    }),
  );

  const evaluated = evaluateScene(scene, { timeMs: 0 });
  const ray = createScreenWorldRay(evaluated.activeCamera!, {
    x: 100,
    y: 50,
    viewportWidth: 200,
    viewportHeight: 100,
  });

  assertEquals(evaluated.activeCamera?.viewMatrix, [
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ]);
  assertAlmostEquals(ray.origin.x, 0, 1e-6);
  assertAlmostEquals(ray.origin.y, 0, 1e-6);
  assertAlmostEquals(ray.origin.z, 0, 1e-6);
  assertAlmostEquals(ray.direction.x, 0, 1e-6);
  assertAlmostEquals(ray.direction.y, 0, 1e-6);
  assertAlmostEquals(ray.direction.z, -1, 1e-6);
});
