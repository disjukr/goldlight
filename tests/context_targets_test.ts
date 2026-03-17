import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import {
  acquireColorAttachmentView,
  bindRenderTarget,
  configureSurfaceContext,
  createOffscreenContext,
  getRenderTargetByteSize,
  getRenderTargetSize,
} from '@rieul3d/gpu';
import {
  createBrowserSurfaceTarget,
  createDenoSurfaceTarget,
  createHeadlessTarget,
} from '@rieul3d/platform';

type MockTexture = Readonly<{
  id: number;
  descriptor: GPUTextureDescriptor;
}>;

const createMockDevice = () => {
  const textures: MockTexture[] = [];

  return {
    textures,
    device: {
      createTexture: (descriptor) => {
        const texture: MockTexture = {
          id: textures.length,
          descriptor,
        };
        textures.push(texture);
        return {
          ...texture,
          createView: () => ({ textureId: texture.id } as unknown as GPUTextureView),
        } as unknown as GPUTexture;
      },
    } as Pick<GPUDevice, 'createTexture'>,
  };
};

Deno.test('configureSurfaceContext configures the canvas context for a surface target', () => {
  const calls: GPUCanvasConfiguration[] = [];
  const canvasContext = {
    configure: (configuration) => {
      calls.push(configuration);
    },
    getCurrentTexture: () => ({
      createView: () => ({ textureId: 0 } as unknown as GPUTextureView),
    } as GPUTexture),
  } as GPUCanvasContext;

  const surface = configureSurfaceContext(
    {
      device: {} as GPUDevice,
      target: createBrowserSurfaceTarget(640, 480),
    },
    canvasContext,
  );

  assertEquals(surface.kind, 'surface');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].format, 'bgra8unorm');
});

Deno.test('createOffscreenContext allocates an offscreen texture and view', () => {
  const { device, textures } = createMockDevice();
  const offscreen = createOffscreenContext({
    device: device as GPUDevice,
    target: createHeadlessTarget(320, 240),
  });

  assertEquals(offscreen.kind, 'offscreen');
  assertEquals(textures.length, 1);
  assertEquals(textures[0].descriptor.format, 'rgba8unorm');
  assertEquals(textures[0].descriptor.size, { width: 320, height: 240, depthOrArrayLayers: 1 });
});

Deno.test('bindRenderTarget chooses surface or offscreen binding based on input', () => {
  const { device } = createMockDevice();
  const surfaceBinding = bindRenderTarget(
    {
      device: device as GPUDevice,
      target: createBrowserSurfaceTarget(100, 50),
    },
    {
      canvasContext: {
        configure: () => undefined,
        unconfigure: () => undefined,
        getCurrentTexture: () => ({
          createView: () => ({ textureId: 1 } as unknown as GPUTextureView),
        } as GPUTexture),
      } as unknown as GPUCanvasContext,
    },
  );
  const offscreenBinding = bindRenderTarget(
    {
      device: device as GPUDevice,
      target: createHeadlessTarget(100, 50),
    },
    { offscreen: true },
  );

  assertEquals(surfaceBinding.kind, 'surface');
  assertEquals(offscreenBinding.kind, 'offscreen');
});

Deno.test('acquireColorAttachmentView returns a view for surface and offscreen bindings', () => {
  const { device } = createMockDevice();
  const surfaceView = acquireColorAttachmentView({
    kind: 'surface',
    target: createBrowserSurfaceTarget(10, 10),
    canvasContext: {
      configure: () => undefined,
      unconfigure: () => undefined,
      getCurrentTexture: () => ({
        createView: () => ({ textureId: 3 } as unknown as GPUTextureView),
      } as GPUTexture),
    } as unknown as GPUCanvasContext,
  });
  const offscreenView = acquireColorAttachmentView(
    createOffscreenContext({
      device: device as GPUDevice,
      target: createHeadlessTarget(10, 10),
    }),
  );

  assertEquals(Boolean(surfaceView), true);
  assertEquals(Boolean(offscreenView), true);
});

Deno.test('surface/offscreen helpers reject mismatched target kinds and expose target sizing', () => {
  assertThrows(() =>
    configureSurfaceContext(
      {
        device: {} as GPUDevice,
        target: createHeadlessTarget(8, 8),
      },
      {} as GPUCanvasContext,
    )
  );

  assertEquals(createDenoSurfaceTarget(12, 6), {
    kind: 'surface',
    width: 12,
    height: 6,
    format: 'bgra8unorm',
  });
  assertEquals(getRenderTargetSize(createHeadlessTarget(8, 4)), { width: 8, height: 4 });
  assertEquals(getRenderTargetByteSize(createHeadlessTarget(8, 4)), 128);
});
