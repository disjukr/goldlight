import { assertEquals, assertNotStrictEquals, assertRejects } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import {
  createOffscreenContext,
  createRuntimeResidency,
  observeDeviceLoss,
  rebuildRuntimeResidency,
  type RuntimeResidencyRebuildContext,
} from '@rieul3d/gpu';
import {
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '@rieul3d/ir';
import { createHeadlessTarget } from '@rieul3d/platform';
import { renderForwardSnapshot } from '@rieul3d/renderer';

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

const createRenderMocks = (readbackRows: readonly number[][]) => {
  const submits: unknown[][] = [];
  const buffers: MockBuffer[] = [];
  const textures: MockTexture[] = [];

  const device = {
    createShaderModule: ({ code }: GPUShaderModuleDescriptor) =>
      ({ code }) as unknown as GPUShaderModule,
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) =>
      ({
        descriptor,
        getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
      }) as unknown as GPURenderPipeline,
    createBindGroup: () => ({}) as GPUBindGroup,
    createTexture: (descriptor: GPUTextureDescriptor) => {
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
    createBuffer: ({ label, size, usage }: GPUBufferDescriptor) => {
      const bytes = new Uint8Array(size);
      if (label === 'offscreen-readback-buffer') {
        for (let row = 0; row < readbackRows.length; row += 1) {
          bytes.set(readbackRows[row], row * 256);
        }
      }

      const buffer: MockBuffer = {
        id: buffers.length,
        label,
        size,
        usage,
      };
      buffers.push(buffer);

      return {
        ...buffer,
        mapAsync: () => Promise.resolve(),
        getMappedRange: () => bytes.buffer,
        unmap: () => undefined,
        destroy: () => undefined,
      } as unknown as GPUBuffer;
    },
    createCommandEncoder: ({ label }: GPUCommandEncoderDescriptor = {}) => {
      if (label === 'offscreen-readback') {
        return {
          copyTextureToBuffer: () => undefined,
          finish: () => ({ label } as unknown as GPUCommandBuffer),
        } as unknown as GPUCommandEncoder;
      }

      return {
        beginRenderPass: () => ({
          setBindGroup: () => undefined,
          setPipeline: () => undefined,
          setVertexBuffer: () => undefined,
          setIndexBuffer: () => undefined,
          draw: () => undefined,
          drawIndexed: () => undefined,
          end: () => undefined,
        }),
        finish: () => ({ label } as unknown as GPUCommandBuffer),
      } as unknown as GPUCommandEncoder;
    },
  };

  const queue = {
    writeBuffer: () => undefined,
    writeTexture: () => undefined,
    submit: (commandBuffers: readonly GPUCommandBuffer[]) => {
      submits.push([...commandBuffers]);
    },
  };

  return {
    device,
    queue,
    submits,
    buffers,
    textures,
  };
};

const createRecoveryScene = () => {
  let scene = createSceneIr('device-recovery-scene');
  scene = appendTexture(scene, {
    id: 'texture-0',
    assetId: 'image-0',
    semantic: 'baseColor',
    colorSpace: 'srgb',
    sampler: 'nearest-repeat',
  });
  scene = appendMaterial(scene, {
    id: 'material-0',
    kind: 'unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'nearest-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-0',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [-1, -1, 0, 1, -1, 0, 0, 1, 0] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 1, 1, 1, 0.5, 0] },
    ],
  });
  return appendNode(scene, createNode('node-0', { meshId: 'mesh-0' }));
};

const createRecoveryAssets = () => ({
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
  volumes: new Map(),
});

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

Deno.test('device-loss recovery rebinds the target, rebuilds residency, and submits the first new frame', async () => {
  const scene = createRecoveryScene();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  const assets = createRecoveryAssets();
  const target = createHeadlessTarget(2, 2);
  const initialContext = createRenderMocks([
    [11, 12, 13, 14, 15, 16, 17, 18],
    [19, 20, 21, 22, 23, 24, 25, 26],
  ]);
  const recoveredContext = createRenderMocks([
    [31, 32, 33, 34, 35, 36, 37, 38],
    [39, 40, 41, 42, 43, 44, 45, 46],
  ]);
  const residency = createRuntimeResidency();

  rebuildRuntimeResidency(
    initialContext,
    residency,
    scene,
    evaluatedScene,
    assets,
  );

  const initialBinding = createOffscreenContext({
    device: initialContext.device as unknown as GPUDevice,
    target,
  });
  const initialFrame = await renderForwardSnapshot(
    initialContext as unknown as Parameters<typeof renderForwardSnapshot>[0],
    initialBinding,
    residency,
    evaluatedScene,
  );

  assertEquals(initialFrame.drawCount, 1);
  assertEquals(initialFrame.submittedCommandBufferCount, 1);
  assertEquals(
    [...initialFrame.bytes],
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
  );
  assertEquals(initialContext.submits.length, 2);

  const lostInfo = await observeDeviceLoss(
    {
      lost: Promise.resolve({
        reason: 'destroyed',
        message: 'replace device and target',
      } as GPUDeviceLostInfo),
    },
  );
  assertEquals(lostInfo.reason, 'destroyed');

  const recoveredBinding = createOffscreenContext({
    device: recoveredContext.device as unknown as GPUDevice,
    target,
  });
  rebuildRuntimeResidency(
    recoveredContext,
    residency,
    scene,
    evaluatedScene,
    assets,
  );

  const recoveredFrame = await renderForwardSnapshot(
    recoveredContext as unknown as Parameters<typeof renderForwardSnapshot>[0],
    recoveredBinding,
    residency,
    evaluatedScene,
  );

  assertNotStrictEquals(recoveredBinding, initialBinding);
  assertEquals([...residency.geometry.keys()], ['mesh-0']);
  assertEquals([...residency.textures.keys()], ['texture-0']);
  assertEquals(recoveredFrame.drawCount, 1);
  assertEquals(recoveredFrame.submittedCommandBufferCount, 1);
  assertEquals(
    [...recoveredFrame.bytes],
    [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46],
  );
  assertEquals(recoveredContext.submits.length, 2);
});

Deno.test('failed recovery leaves the caller in a non-rendering state until rebuild succeeds', async () => {
  const scene = createRecoveryScene();
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  const target = createHeadlessTarget(2, 2);
  const context = createRenderMocks([
    [51, 52, 53, 54, 55, 56, 57, 58],
    [59, 60, 61, 62, 63, 64, 65, 66],
  ]);
  const residency = createRuntimeResidency();
  let binding: ReturnType<typeof createOffscreenContext> | undefined;

  await assertRejects(
    async () => {
      binding = createOffscreenContext({
        device: context.device as unknown as GPUDevice,
        target,
      });
      rebuildRuntimeResidency(
        context,
        residency,
        scene,
        evaluatedScene,
        {
          images: new Map(),
          volumes: new Map(),
        },
      );
      await renderForwardSnapshot(
        context as unknown as Parameters<typeof renderForwardSnapshot>[0],
        binding,
        residency,
        evaluatedScene,
      );
    },
    Error,
    'texture "texture-0" references missing asset "image-0"',
  );

  binding = undefined;
  assertEquals(binding, undefined);
  assertEquals(context.submits.length, 0);
  assertEquals([...residency.textures.keys()], []);
  assertEquals([...residency.geometry.keys()], ['mesh-0']);
});
