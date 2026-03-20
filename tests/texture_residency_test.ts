import { assertEquals, assertStrictEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import {
  type AssetSource,
  createRuntimeResidency,
  createTextureUploadPlan,
  ensureSceneTextureResidency,
  ensureTextureResidency,
  type GpuTextureUploadContext,
  uploadTextureResidency,
} from '@rieul3d/gpu';
import { createSceneIr } from '@rieul3d/ir';

type MockTexture = Readonly<{
  id: number;
  label?: string;
  format: GPUTextureFormat;
  size: GPUExtent3DDict;
}>;

type MockTextureView = Readonly<{
  textureId: number;
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
  data: ArrayBuffer;
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
      writeTexture: (destination, data, dataLayout, size) => {
        writes.push({
          texture: destination.texture as unknown as MockTexture,
          data: data as ArrayBuffer,
          dataLayout,
          size: size as GPUExtent3DDict,
        });
      },
    },
  };
};

const assetSource: AssetSource = {
  images: new Map([
    ['image-0', {
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
    }],
  ]),
};

const imageAsset = assetSource.images!.get('image-0')!;

Deno.test('createTextureUploadPlan derives texture dimensions and upload layout', () => {
  const plan = createTextureUploadPlan(
    {
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    },
    imageAsset,
  );

  assertEquals(plan.width, 2);
  assertEquals(plan.height, 2);
  assertEquals(plan.bytesPerRow, 8);
  assertEquals(plan.format, 'rgba8unorm');
});

Deno.test('uploadTextureResidency creates texture, view, sampler, and upload write', () => {
  const context = createMockTextureUploadContext();
  const residency = uploadTextureResidency(
    context,
    {
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'nearest-clamp',
    },
    imageAsset,
  );

  assertEquals(residency.width, 2);
  assertEquals(residency.height, 2);
  assertEquals(context.textures.length, 1);
  assertEquals(context.samplers.length, 1);
  assertEquals(context.writes.length, 1);
  assertEquals(context.samplers[0].descriptor.magFilter, 'nearest');
  assertEquals(context.samplers[0].descriptor.addressModeU, 'clamp-to-edge');
});

Deno.test('ensureTextureResidency reuses cached texture residency', () => {
  const context = createMockTextureUploadContext();
  const runtimeResidency = createRuntimeResidency();
  const textureRef = {
    id: 'texture-0',
    assetId: 'image-0',
    semantic: 'baseColor',
    colorSpace: 'srgb',
    sampler: 'linear-repeat',
  };

  const first = ensureTextureResidency(context, runtimeResidency, assetSource, textureRef);
  const second = ensureTextureResidency(context, runtimeResidency, assetSource, textureRef);

  assertStrictEquals(first, second);
  assertEquals(context.textures.length, 1);
});

Deno.test('ensureSceneTextureResidency uploads scene texture references with assets', () => {
  const context = createMockTextureUploadContext();
  const runtimeResidency = createRuntimeResidency();
  const scene = {
    ...createSceneIr('scene'),
    textures: [
      {
        id: 'texture-0',
        assetId: 'image-0',
        semantic: 'baseColor',
        colorSpace: 'srgb',
        sampler: 'linear-repeat',
      },
      {
        id: 'texture-1',
        semantic: 'generated',
        colorSpace: 'linear',
        sampler: 'linear-repeat',
      },
    ],
  };

  ensureSceneTextureResidency(context, runtimeResidency, scene, assetSource);

  assertEquals([...runtimeResidency.textures.keys()], ['texture-0']);
  assertEquals(context.textures.length, 1);
});

Deno.test('ensureTextureResidency fails when referenced asset metadata is incomplete', () => {
  const context = createMockTextureUploadContext();
  const runtimeResidency = createRuntimeResidency();

  assertThrows(() =>
    ensureTextureResidency(
      context,
      runtimeResidency,
      {
        images: new Map([['image-1', {
          id: 'image-1',
          mimeType: 'image/raw',
          bytes: new Uint8Array([0, 0, 0, 0]),
        }]]),
      },
      {
        id: 'texture-0',
        assetId: 'image-1',
        semantic: 'baseColor',
        colorSpace: 'srgb',
        sampler: 'linear-repeat',
      },
    )
  );
});
