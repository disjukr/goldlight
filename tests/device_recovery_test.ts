import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import {
  createRuntimeResidency,
  observeDeviceLoss,
  rebuildRuntimeResidency,
  type RuntimeResidencyRebuildContext,
} from '@rieul3d/gpu';
import { appendMesh, appendNode, appendTexture, createNode, createSceneIr } from '@rieul3d/ir';

type MockBuffer = Readonly<{
  id: number;
  label?: string;
  size: number;
  usage: number;
}>;

type MockTexture = Readonly<{
  id: number;
  label?: string;
  format: GPUTextureFormat;
  size: GPUExtent3DDict;
  dimension?: GPUTextureDimension;
}>;

const createRebuildContext = (): RuntimeResidencyRebuildContext & {
  buffers: MockBuffer[];
  textures: MockTexture[];
} => {
  const buffers: MockBuffer[] = [];
  const textures: MockTexture[] = [];

  return {
    buffers,
    textures,
    device: {
      createBuffer: (descriptor) => {
        const buffer: MockBuffer = {
          id: buffers.length,
          label: descriptor.label,
          size: descriptor.size,
          usage: descriptor.usage,
        };
        buffers.push(buffer);
        return buffer as unknown as GPUBuffer;
      },
      createTexture: (descriptor) => {
        const texture: MockTexture = {
          id: textures.length,
          label: descriptor.label,
          format: descriptor.format,
          dimension: descriptor.dimension,
          size: typeof descriptor.size === 'object' ? descriptor.size as GPUExtent3DDict : {
            width: descriptor.size[0],
            height: descriptor.size[1],
            depthOrArrayLayers: descriptor.size[2],
          },
        };
        textures.push(texture);
        return {
          ...texture,
          createView: () => ({ textureId: texture.id } as unknown as GPUTextureView),
        } as unknown as GPUTexture;
      },
      createSampler: () => ({}) as GPUSampler,
    },
    queue: {
      writeBuffer: () => undefined,
      writeTexture: () => undefined,
    },
  };
};

Deno.test('observeDeviceLoss forwards lost device info to the caller', async () => {
  const events: string[] = [];
  const info = await observeDeviceLoss(
    {
      lost: Promise.resolve({
        reason: 'destroyed',
        message: 'device was recreated',
      } as GPUDeviceLostInfo),
    },
    (lost) => {
      events.push(`${lost.reason}:${lost.message}`);
    },
  );

  assertEquals(info.reason, 'destroyed');
  assertEquals(info.message, 'device was recreated');
  assertEquals(events, ['destroyed:device was recreated']);
});

Deno.test('rebuildRuntimeResidency clears stale state and reuploads scene residency inputs', () => {
  const context = createRebuildContext();
  const residency = createRuntimeResidency();
  residency.pipelines.set('stale:pipeline', {} as GPURenderPipeline);

  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-0',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendTexture(scene, {
    id: 'texture-0',
    assetId: 'image-0',
    semantic: 'baseColor',
    colorSpace: 'srgb',
    sampler: 'linear-repeat',
  });
  scene = {
    ...scene,
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 2, y: 2, z: 2 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('node-0', { meshId: 'mesh-0', volumeId: 'volume-0' }));

  rebuildRuntimeResidency(
    context,
    residency,
    scene,
    evaluateScene(scene, { timeMs: 0 }),
    {
      images: new Map([['image-0', {
        id: 'image-0',
        mimeType: 'image/raw+rgba8',
        bytes: new Uint8Array([
          255,
          0,
          0,
          255,
          0,
          255,
          0,
          255,
          0,
          0,
          255,
          255,
          255,
          255,
          255,
          255,
        ]),
        width: 2,
        height: 2,
      }]]),
      volumes: new Map([['volume-asset-0', {
        id: 'volume-asset-0',
        mimeType: 'application/octet-stream',
        bytes: new Uint8Array([
          0,
          64,
          128,
          255,
          255,
          128,
          64,
          0,
        ]),
        width: 2,
        height: 2,
        depth: 2,
      }]]),
    },
  );

  assertEquals([...residency.geometry.keys()], ['mesh-0']);
  assertEquals([...residency.textures.keys()], ['texture-0']);
  assertEquals([...residency.volumes.keys()], ['volume-0']);
  assertEquals(residency.pipelines.size, 0);
  assertEquals(context.buffers.length, 1);
  assertEquals(context.textures.length, 2);
});
