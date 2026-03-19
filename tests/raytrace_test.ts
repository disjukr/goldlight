import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { buildBvh } from '@rieul3d/raytrace';

Deno.test('buildBvh returns a single leaf for a small triangle set', () => {
  const result = buildBvh([{
    a: [0, 0, 0],
    b: [1, 0, 0],
    c: [0, 1, 0],
  }]);

  assertEquals(result.nodes.length, 1);
  assertEquals(result.nodes[0].triangleCount, 1);
  assertEquals(result.triangleIndices, [0]);
});

Deno.test('buildBvh splits larger triangle sets into internal nodes', () => {
  const result = buildBvh([
    { a: [-2, 0, 0], b: [-1, 0, 0], c: [-2, 1, 0] },
    { a: [-1, 0, 0], b: [0, 0, 0], c: [-1, 1, 0] },
    { a: [1, 0, 0], b: [2, 0, 0], c: [1, 1, 0] },
    { a: [2, 0, 0], b: [3, 0, 0], c: [2, 1, 0] },
    { a: [4, 0, 0], b: [5, 0, 0], c: [4, 1, 0] },
  ], { maxLeafSize: 2 });

  assertEquals(result.nodes[0].triangleCount, 0);
  assertEquals(result.nodes[0].leftChild >= 0, true);
  assertEquals(result.nodes[0].rightChild >= 0, true);
  assertEquals(result.triangleIndices.length, 5);
});
