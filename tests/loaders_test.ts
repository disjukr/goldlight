import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { loadGltfFromJson, loadObjFromText, loadStlFromText } from '@rieul3d/loaders';

Deno.test('loadObjFromText builds a mesh scene', () => {
  const scene = loadObjFromText(
    ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'),
    'obj',
  );

  assertEquals(scene.meshes.length, 1);
  assertEquals(scene.nodes.length, 1);
  assertEquals(scene.meshes[0].indices, [0, 1, 2]);
});

Deno.test('loadStlFromText builds an indexed mesh scene', () => {
  const scene = loadStlFromText(
    [
      'solid triangle',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 0 0 0',
      'vertex 1 0 0',
      'vertex 0 1 0',
      'endloop',
      'endfacet',
      'endsolid',
    ].join('\n'),
    'stl',
  );

  assertEquals(scene.meshes[0].indices, [0, 1, 2]);
});

Deno.test('loadGltfFromJson normalizes nodes, meshes, and animations', () => {
  const scene = loadGltfFromJson({
    meshes: [{
      primitives: [{
        attributes: {
          POSITION: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        },
        indices: [0, 1, 2],
      }],
    }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    animations: [{
      channels: [{
        node: 0,
        path: 'translation',
        times: [0, 1],
        values: [[0, 0, 0], [1, 0, 0]],
      }],
    }],
  }, 'gltf');

  assertEquals(scene.meshes.length, 1);
  assertEquals(scene.rootNodeIds, ['gltf-node-0']);
  assertEquals(scene.animationClips[0].durationMs, 1000);
});
