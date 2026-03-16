import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { loadGltfFromJson, loadObjFromText, loadStlFromText } from '@rieul3d/loaders';

const encodeDataUri = (bytes: Uint8Array, mimeType = 'application/octet-stream'): string => {
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join('');
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return bytes;
};

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

Deno.test('loadGltfFromJson ingests buffer views, accessors, images, and materials', () => {
  const positions = new Float32Array([
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    1,
    0,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const padding = new Uint8Array([0, 0]);
  const animationTimes = new Float32Array([0, 1]);
  const animationValues = new Float32Array([
    0,
    0,
    0,
    1,
    0,
    0,
  ]);
  const imageBytes = new Uint8Array([137, 80, 78, 71]);
  const combinedBuffer = concatBytes(
    new Uint8Array(positions.buffer),
    new Uint8Array(indices.buffer),
    padding,
    new Uint8Array(animationTimes.buffer),
    new Uint8Array(animationValues.buffer),
  );

  const scene = loadGltfFromJson({
    buffers: [{
      uri: encodeDataUri(combinedBuffer),
      byteLength: combinedBuffer.byteLength,
    }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength + indices.byteLength + padding.byteLength,
        byteLength: animationTimes.byteLength,
      },
      {
        buffer: 0,
        byteOffset: positions.byteLength + indices.byteLength + padding.byteLength +
          animationTimes.byteLength,
        byteLength: animationValues.byteLength,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    images: [{
      uri: encodeDataUri(imageBytes, 'image/png'),
      mimeType: 'image/png',
    }],
    textures: [{ source: 0 }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        baseColorFactor: [0.25, 0.5, 0.75, 1],
      },
    }],
    meshes: [{
      primitives: [{
        attributes: {
          POSITION: 0,
        },
        indices: 1,
        material: 0,
      }],
    }],
    nodes: [{
      mesh: 0,
      translation: [1, 2, 3],
    }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    animations: [{
      samplers: [{
        input: 2,
        output: 3,
      }],
      channels: [{
        sampler: 0,
        target: {
          node: 0,
          path: 'translation',
        },
      }],
    }],
  }, 'gltf');

  assertEquals(scene.assets, [{
    id: 'gltf-image-0',
    uri: encodeDataUri(imageBytes, 'image/png'),
    mimeType: 'image/png',
  }]);
  assertEquals(scene.textures, [{
    id: 'gltf-texture-0',
    assetId: 'gltf-image-0',
    semantic: 'baseColor',
    colorSpace: 'srgb',
    sampler: 'linear-repeat',
  }]);
  assertEquals(scene.materials[0].textures, [scene.textures[0]]);
  assertEquals(scene.materials[0].parameters.color, {
    x: 0.25,
    y: 0.5,
    z: 0.75,
    w: 1,
  });
  assertEquals(scene.meshes[0].attributes[0].values, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assertEquals(scene.meshes[0].indices, [0, 1, 2]);
  assertEquals(scene.nodes[0].transform.translation, { x: 1, y: 2, z: 3 });
  assertEquals(scene.animationClips[0].channels[0].keyframes[1].value, {
    x: 1,
    y: 0,
    z: 0,
    w: 0,
  });
});
