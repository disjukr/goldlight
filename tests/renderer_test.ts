import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createRuntimeResidency } from '@rieul3d/gpu';
import { appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import { createDeferredRenderer, createForwardRenderer, planFrame } from '@rieul3d/renderer';

Deno.test('forward renderer omits raymarch pass when scene has no sdf or volume nodes', () => {
  let scene = createSceneIr('scene');
  scene = appendNode(scene, createNode('node-0'));
  const frame = planFrame(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    createRuntimeResidency(),
  );

  assertEquals(frame.passes.map((pass) => pass.id), ['mesh', 'present']);
});

Deno.test('deferred renderer keeps raymarch pass when scene has an sdf node', () => {
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [{ id: 'sdf-0', op: 'sphere', parameters: {} }],
  };
  scene = appendNode(scene, createNode('node-0', { sdfId: 'sdf-0' }));

  const frame = planFrame(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    createRuntimeResidency(),
  );

  assertEquals(frame.passes.map((pass) => pass.id), [
    'depth-prepass',
    'gbuffer',
    'lighting',
    'raymarch',
    'present',
  ]);
});
