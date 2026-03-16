import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1.0.14';
import {
  type AssetSource,
  createRuntimeResidency,
  createVolumeUploadPlan,
  ensureSceneVolumeResidency,
  ensureVolumeResidency,
  type GpuTextureUploadContext,
  uploadVolumeResidency,
} from '@rieul3d/gpu';
import { createSceneIr } from '@rieul3d/ir';

type MockTexture = Readonly<{
  id: number;
  label?: string;
  format: GPUTextureFormat;
  dimension?: GPUTextureDimension;
  size: GPUExtent3DDict;
}>;

type MockSampler = Readonly<{
  descriptor: GPUSamplerDescriptor;
}>;

type MockImageDataLayout = Readonly<{
  offset?: number;
  bytesPerRow?: number;
  rowsPerImage?: number;
}>;

type TextureWrite = Readonly<{
  texture: MockTexture;
  dataLayout: MockImageDataLayout;
  size: GPUExtent3DDict;
}>;

const createMockTextureUploadContext = (): GpuTextureUploadContext & {
  textures: MockTexture[];
  samplers: MockSampler[];
  writes: TextureWrite[];
} => {
  const textures: MockTexture[] = [];
  const samplers: MockSampler[] = [];
  const writes: TextureWrite[] = [];

  return {
    textures,
    samplers,
    writes,
    device: {
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
      createSampler: (descriptor) => {
        const sampler: MockSampler = { descriptor: descriptor ?? {} };
        samplers.push(sampler);
        return sampler as unknown as GPUSampler;
      },
    },
    queue: {
      writeTexture: (destination, _data, dataLayout, size) => {
        writes.push({
          texture: destination.texture as unknown as MockTexture,
          dataLayout,
          size: size as GPUExtent3DDict,
        });
      },
    },
  };
};

const assetSource: AssetSource = {
  images: new Map(),
  volumes: new Map([
    ['volume-asset-0', {
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
    }],
  ]),
};

Deno.test('createVolumeUploadPlan derives 3d texture upload layout', () => {
  const plan = createVolumeUploadPlan(
    {
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 2, y: 2, z: 2 },
      format: 'density:r8unorm',
    },
    assetSource.volumes.get('volume-asset-0')!,
  );

  assertEquals(plan.width, 2);
  assertEquals(plan.height, 2);
  assertEquals(plan.depth, 2);
  assertEquals(plan.bytesPerRow, 2);
  assertEquals(plan.format, 'r8unorm');
});

Deno.test('uploadVolumeResidency creates a 3d texture, view, sampler, and upload write', () => {
  const context = createMockTextureUploadContext();
  const residency = uploadVolumeResidency(
    context,
    {
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 2, y: 2, z: 2 },
      format: 'density:r8unorm',
    },
    assetSource.volumes.get('volume-asset-0')!,
  );

  assertEquals(residency.width, 2);
  assertEquals(residency.height, 2);
  assertEquals(residency.depth, 2);
  assertEquals(context.textures.length, 1);
  assertEquals(context.textures[0].dimension, '3d');
  assertEquals(context.samplers.length, 1);
  assertEquals(context.writes.length, 1);
  assertEquals(context.writes[0].size, {
    width: 2,
    height: 2,
    depthOrArrayLayers: 2,
  });
});

Deno.test('ensureVolumeResidency reuses cached 3d texture residency', () => {
  const context = createMockTextureUploadContext();
  const runtimeResidency = createRuntimeResidency();
  const volumePrimitive = {
    id: 'volume-0',
    assetId: 'volume-asset-0',
    dimensions: { x: 2, y: 2, z: 2 },
    format: 'density:r8unorm',
  };

  const first = ensureVolumeResidency(context, runtimeResidency, assetSource, volumePrimitive);
  const second = ensureVolumeResidency(context, runtimeResidency, assetSource, volumePrimitive);

  assertStrictEquals(first, second);
  assertEquals(context.textures.length, 1);
});

Deno.test('ensureSceneVolumeResidency uploads scene volume primitives with backing assets', () => {
  const context = createMockTextureUploadContext();
  const runtimeResidency = createRuntimeResidency();
  const scene = {
    ...createSceneIr('scene'),
    volumePrimitives: [
      {
        id: 'volume-0',
        assetId: 'volume-asset-0',
        dimensions: { x: 2, y: 2, z: 2 },
        format: 'density:r8unorm',
      },
      {
        id: 'volume-generated',
        dimensions: { x: 2, y: 2, z: 2 },
        format: 'generated',
      },
    ],
  };

  ensureSceneVolumeResidency(context, runtimeResidency, scene, assetSource);

  assertEquals([...runtimeResidency.volumes.keys()], ['volume-0']);
  assertEquals(context.textures.length, 1);
});
