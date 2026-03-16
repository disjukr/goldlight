import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createRuntimeResidency } from '@rieul3d/gpu';
import { appendMaterial, appendMesh, appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import {
  assertRendererSceneCapabilities,
  collectRendererCapabilityIssues,
  createDeferredRenderer,
  createForwardRenderer,
  extractVolumePassItems,
  planFrame,
} from '@rieul3d/renderer';

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

Deno.test('extractVolumePassItems returns only evaluated volumes with residency', () => {
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('node-0', { volumeId: 'volume-0' }));
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  const residency = createRuntimeResidency();
  residency.volumes.set('volume-0', {
    volumeId: 'volume-0',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 4,
    height: 4,
    depth: 4,
    format: 'r8unorm',
  });

  const items = extractVolumePassItems(evaluatedScene, residency);

  assertEquals(items.length, 1);
  assertEquals(items[0].nodeId, 'node-0');
  assertEquals(items[0].volumeId, 'volume-0');
});

Deno.test('collectRendererCapabilityIssues reports unsupported forward renderer features', () => {
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:flat-red',
    textures: [],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-custom',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = {
    ...scene,
    sdfPrimitives: [{ id: 'sdf-0', op: 'sphere', parameters: {} }],
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));
  scene = appendNode(scene, createNode('volume-node', { volumeId: 'volume-0' }));

  const issues = collectRendererCapabilityIssues(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(
    issues.map((issue) => issue.feature),
    ['sdf', 'volume'],
  );
});

Deno.test('assertRendererSceneCapabilities throws when renderer does not support scene content', () => {
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [{ id: 'sdf-0', op: 'sphere', parameters: {} }],
  };
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));

  assertThrows(() =>
    assertRendererSceneCapabilities(
      createForwardRenderer(),
      evaluateScene(scene, { timeMs: 0 }),
    )
  );
});

Deno.test('planned deferred renderer features are rejected for execution preflight', () => {
  let scene = createSceneIr('scene');
  scene = appendNode(scene, createNode('mesh-node'));
  scene = appendMesh(scene, {
    id: 'mesh-0',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = {
    ...scene,
    nodes: [createNode('mesh-node', { meshId: 'mesh-0' })],
    rootNodeIds: ['mesh-node'],
  };

  const issues = collectRendererCapabilityIssues(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(issues.map((issue) => issue.feature), ['mesh']);
});
