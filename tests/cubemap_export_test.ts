import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { type CubemapSnapshotResult, exportCubemapSnapshot } from '@goldlight/renderer';

const faceOrder = [
  'positive-x',
  'negative-x',
  'positive-y',
  'negative-y',
  'positive-z',
  'negative-z',
] as const;

const faceColors = {
  'positive-x': [255, 0, 0, 255],
  'negative-x': [0, 255, 0, 255],
  'positive-y': [0, 0, 255, 255],
  'negative-y': [255, 255, 0, 255],
  'positive-z': [255, 0, 255, 255],
  'negative-z': [0, 255, 255, 255],
} as const;

const createFaceBytes = (
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): Uint8Array => {
  const bytes = new Uint8Array(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    bytes[offset] = rgba[0];
    bytes[offset + 1] = rgba[1];
    bytes[offset + 2] = rgba[2];
    bytes[offset + 3] = rgba[3];
  }

  return bytes;
};

const createSyntheticCubemapSnapshot = (size: number): CubemapSnapshotResult => ({
  drawCount: 0,
  submittedCommandBufferCount: 0,
  size,
  faces: faceOrder.map((face) => ({
    face,
    width: size,
    height: size,
    bytes: createFaceBytes(size, size, faceColors[face]),
    viewMatrix: [],
    projectionMatrix: [],
  })),
});

const readPixel = (
  bytes: Uint8Array,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number, number] => {
  const offset = ((y * width) + x) * 4;

  return [
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  ];
};

const createCornerFaceBytes = (): Uint8Array => {
  const bytes = new Uint8Array(2 * 2 * 4);
  const corners = [
    [0, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
  ] as const;

  corners.forEach((rgba, index) => {
    const offset = index * 4;
    bytes[offset] = rgba[0];
    bytes[offset + 1] = rgba[1];
    bytes[offset + 2] = rgba[2];
    bytes[offset + 3] = rgba[3];
  });

  return bytes;
};

const createCornerWeightedCubemapSnapshot = (): CubemapSnapshotResult => {
  const snapshot = createSyntheticCubemapSnapshot(2);

  return {
    ...snapshot,
    faces: snapshot.faces.map((face) =>
      face.face === 'positive-z'
        ? {
          ...face,
          bytes: createCornerFaceBytes(),
        }
        : face
    ),
  };
};

const createHorizontalGradientFaceBytes = (): Uint8Array => {
  const width = 4;
  const height = 4;
  const ramp = [0, 64, 128, 255] as const;
  const bytes = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      bytes[offset] = ramp[x];
      bytes[offset + 1] = 0;
      bytes[offset + 2] = 0;
      bytes[offset + 3] = 255;
    }
  }

  return bytes;
};

const createStripCrossResampleSnapshot = (): CubemapSnapshotResult => {
  const snapshot = createSyntheticCubemapSnapshot(4);

  return {
    ...snapshot,
    faces: snapshot.faces.map((face) =>
      face.face === 'positive-z'
        ? {
          ...face,
          bytes: createHorizontalGradientFaceBytes(),
        }
        : face
    ),
  };
};

Deno.test('exportCubemapSnapshot lays faces out in strip order', () => {
  const result = exportCubemapSnapshot(createSyntheticCubemapSnapshot(2), { layout: 'strip' });

  assertEquals(result.width, 12);
  assertEquals(result.height, 2);
  faceOrder.forEach((face, index) => {
    assertEquals(readPixel(result.bytes, result.width, (index * 2) + 1, 1), faceColors[face]);
  });
});

Deno.test('exportCubemapSnapshot lays faces out in horizontal cross order', () => {
  const result = exportCubemapSnapshot(createSyntheticCubemapSnapshot(2), { layout: 'cross' });

  assertEquals(result.width, 8);
  assertEquals(result.height, 6);
  assertEquals(readPixel(result.bytes, result.width, 3, 1), faceColors['negative-y']);
  assertEquals(readPixel(result.bytes, result.width, 1, 3), faceColors['negative-x']);
  assertEquals(readPixel(result.bytes, result.width, 3, 3), faceColors['positive-z']);
  assertEquals(readPixel(result.bytes, result.width, 5, 3), faceColors['positive-x']);
  assertEquals(readPixel(result.bytes, result.width, 7, 3), faceColors['negative-z']);
  assertEquals(readPixel(result.bytes, result.width, 3, 5), faceColors['positive-y']);
});

Deno.test('exportCubemapSnapshot reprojects cubemap faces into equirectangular layout', () => {
  const result = exportCubemapSnapshot(createSyntheticCubemapSnapshot(4), {
    layout: 'equirectangular',
  });

  assertEquals(result.width, 16);
  assertEquals(result.height, 8);
  assertEquals(readPixel(result.bytes, result.width, 8, 4), faceColors['positive-z']);
  assertEquals(readPixel(result.bytes, result.width, 12, 4), faceColors['positive-x']);
  assertEquals(readPixel(result.bytes, result.width, 0, 4), faceColors['negative-z']);
  assertEquals(readPixel(result.bytes, result.width, 4, 4), faceColors['negative-x']);
  assertEquals(readPixel(result.bytes, result.width, 8, 0), faceColors['positive-y']);
  assertEquals(readPixel(result.bytes, result.width, 8, 7), faceColors['negative-y']);
});

Deno.test('exportCubemapSnapshot supports custom equirectangular dimensions', () => {
  const result = exportCubemapSnapshot(createSyntheticCubemapSnapshot(4), {
    layout: 'equirectangular',
    width: 10,
  });

  assertEquals(result.width, 10);
  assertEquals(result.height, 5);
  assertEquals(readPixel(result.bytes, result.width, 5, 2), faceColors['positive-z']);
});

Deno.test('exportCubemapSnapshot reprojects cubemap faces into angular layout', () => {
  const result = exportCubemapSnapshot(createSyntheticCubemapSnapshot(8), { layout: 'angular' });

  assertEquals(result.width, 16);
  assertEquals(result.height, 16);
  assertEquals(readPixel(result.bytes, result.width, 8, 8), faceColors['positive-z']);
  assertEquals(readPixel(result.bytes, result.width, 12, 8), faceColors['positive-x']);
  assertEquals(readPixel(result.bytes, result.width, 8, 4), faceColors['positive-y']);
  assertEquals(readPixel(result.bytes, result.width, 0, 0), [0, 0, 0, 0]);
});

Deno.test('exportCubemapSnapshot supports filtered angular sampling', () => {
  const nearest = exportCubemapSnapshot(createCornerWeightedCubemapSnapshot(), {
    layout: 'angular',
    width: 5,
  });
  const linear = exportCubemapSnapshot(createCornerWeightedCubemapSnapshot(), {
    layout: 'angular',
    width: 5,
    sampling: 'linear',
  });

  assertEquals(readPixel(nearest.bytes, nearest.width, 2, 2), [0, 0, 255, 255]);
  assertEquals(readPixel(linear.bytes, linear.width, 2, 2), [64, 64, 64, 255]);
});

Deno.test('exportCubemapSnapshot supports custom cross dimensions', () => {
  const result = exportCubemapSnapshot(createSyntheticCubemapSnapshot(2), {
    layout: 'cross',
    width: 12,
  });

  assertEquals(result.width, 12);
  assertEquals(result.height, 9);
  assertEquals(readPixel(result.bytes, result.width, 4, 1), faceColors['negative-y']);
  assertEquals(readPixel(result.bytes, result.width, 4, 7), faceColors['positive-y']);
});

Deno.test('exportCubemapSnapshot samples resized strip faces at pixel centers', () => {
  const result = exportCubemapSnapshot(createStripCrossResampleSnapshot(), {
    layout: 'strip',
    width: 12,
    sampling: 'linear',
  });

  assertEquals(result.width, 12);
  assertEquals(result.height, 2);
  assertEquals(readPixel(result.bytes, result.width, 8, 1), [48, 0, 0, 255]);
  assertEquals(readPixel(result.bytes, result.width, 9, 1), [160, 0, 0, 255]);
});

Deno.test('exportCubemapSnapshot samples resized cross faces at pixel centers', () => {
  const result = exportCubemapSnapshot(createStripCrossResampleSnapshot(), {
    layout: 'cross',
    width: 8,
    sampling: 'linear',
  });

  assertEquals(result.width, 8);
  assertEquals(result.height, 6);
  assertEquals(readPixel(result.bytes, result.width, 2, 3), [48, 0, 0, 255]);
  assertEquals(readPixel(result.bytes, result.width, 3, 3), [160, 0, 0, 255]);
});

Deno.test('exportCubemapSnapshot rejects incomplete cubemap snapshots', () => {
  const snapshot = createSyntheticCubemapSnapshot(2);

  assertThrows(
    () =>
      exportCubemapSnapshot({
        ...snapshot,
        faces: snapshot.faces.slice(0, 5),
      }, { layout: 'strip' }),
    Error,
    'exactly one snapshot for each of the six cubemap faces',
  );
});

Deno.test('exportCubemapSnapshot rejects invalid equirectangular dimensions', () => {
  assertThrows(
    () =>
      exportCubemapSnapshot(createSyntheticCubemapSnapshot(2), {
        layout: 'equirectangular',
        width: 7,
        height: 5,
      }),
    Error,
    '2:1 width/height ratio',
  );
});
