import { assertEquals, assertStrictEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import {
  acquireColorAttachmentView,
  acquireDepthAttachmentView,
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
        const size = Array.isArray(descriptor.size)
          ? { width: descriptor.size[0], height: descriptor.size[1] }
          : descriptor.size;
        const texture: MockTexture = {
          id: textures.length,
          descriptor,
        };
        textures.push(texture);
        return {
          ...texture,
          width: size.width,
          height: size.height,
          createView: () => ({ textureId: texture.id } as unknown as GPUTextureView),
        } as unknown as GPUTexture;
      },
    } as Pick<GPUDevice, 'createTexture'>,
  };
};

Deno.test('configureSurfaceContext configures the canvas context for a surface target', () => {
  const calls: GPUCanvasConfiguration[] = [];
  const { device, textures } = createMockDevice();
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
      device: device as GPUDevice,
      target: createBrowserSurfaceTarget(640, 480),
    },
    canvasContext,
  );

  assertEquals(surface.kind, 'surface');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].format, 'bgra8unorm');
  assertEquals(calls[0].alphaMode, 'premultiplied');
  assertEquals(textures.length, 1);
  assertEquals(textures[0].descriptor.format, 'depth24plus');
  assertStrictEquals(surface.device, device);
});

Deno.test('configureSurfaceContext honors an explicit surface alpha mode', () => {
  const calls: GPUCanvasConfiguration[] = [];
  const { device, textures } = createMockDevice();
  const canvasContext = {
    configure: (configuration: GPUCanvasConfiguration) => {
      calls.push(configuration);
    },
    getCurrentTexture: () => ({
      createView: () => ({ textureId: 0 } as unknown as GPUTextureView),
    } as GPUTexture),
  } as GPUCanvasContext;

  configureSurfaceContext(
    {
      device: device as GPUDevice,
      target: createDenoSurfaceTarget(640, 480, 'rgba8unorm', 'opaque'),
    },
    canvasContext,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].format, 'rgba8unorm');
  assertEquals(calls[0].alphaMode, 'opaque');
  assertEquals(textures.length, 1);
  assertEquals(textures[0].descriptor.format, 'depth24plus');
});

Deno.test('createOffscreenContext allocates color and depth textures and views', () => {
  const { device, textures } = createMockDevice();
  const offscreen = createOffscreenContext({
    device: device as GPUDevice,
    target: createHeadlessTarget(320, 240),
  });

  assertEquals(offscreen.kind, 'offscreen');
  assertEquals(textures.length, 2);
  assertEquals(textures[0].descriptor.format, 'rgba8unorm');
  assertEquals(textures[0].descriptor.size, { width: 320, height: 240, depthOrArrayLayers: 1 });
  assertEquals(textures[1].descriptor.format, 'depth24plus');
  assertEquals(Boolean(offscreen.depthView), true);
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
  const { device: surfaceDevice } = createMockDevice();
  const surfaceBinding = configureSurfaceContext(
    {
      device: surfaceDevice as GPUDevice,
      target: createBrowserSurfaceTarget(10, 10),
    },
    {
      configure: () => undefined,
      unconfigure: () => undefined,
      getCurrentTexture: () => ({
        createView: () => ({ textureId: 3 } as unknown as GPUTextureView),
      } as GPUTexture),
    } as unknown as GPUCanvasContext,
  );
  const surfaceView = acquireColorAttachmentView(surfaceBinding);
  const offscreenView = acquireColorAttachmentView(
    createOffscreenContext({
      device: device as GPUDevice,
      target: createHeadlessTarget(10, 10),
    }),
  );

  assertEquals(Boolean(surfaceView), true);
  assertEquals(Boolean(offscreenView), true);
  assertEquals(Boolean(acquireDepthAttachmentView(surfaceBinding)), true);
});

Deno.test('acquireColorAttachmentView recreates the surface depth attachment when the drawable size changes', () => {
  const { device, textures } = createMockDevice();
  let frame = 0;
  const surfaceBinding = configureSurfaceContext(
    {
      device: device as GPUDevice,
      target: createBrowserSurfaceTarget(10, 10),
    },
    {
      configure: () => undefined,
      unconfigure: () => undefined,
      getCurrentTexture: () => {
        frame += 1;
        return {
          width: frame === 1 ? 10 : 20,
          height: frame === 1 ? 10 : 12,
          createView: () => ({ textureId: 10 + frame } as unknown as GPUTextureView),
        } as GPUTexture;
      },
    } as unknown as GPUCanvasContext,
  );

  const initialDepthView = acquireDepthAttachmentView(surfaceBinding) as unknown as {
    textureId: number;
  };
  acquireColorAttachmentView(surfaceBinding);
  const colorView = acquireColorAttachmentView(surfaceBinding) as unknown as { textureId: number };
  const resizedDepthView = acquireDepthAttachmentView(surfaceBinding) as unknown as {
    textureId: number;
  };

  assertEquals(colorView.textureId, 12);
  assertEquals(textures.length, 2);
  assertEquals(initialDepthView.textureId, 0);
  assertEquals(resizedDepthView.textureId, 1);
  assertEquals(textures[1].descriptor.size, { width: 20, height: 12, depthOrArrayLayers: 1 });
});

Deno.test('acquireColorAttachmentView reconfigures a dropped surface presentation state', () => {
  const calls: GPUCanvasConfiguration[] = [];
  let attempts = 0;
  const { device } = createMockDevice();
  const view = acquireColorAttachmentView(
    configureSurfaceContext(
      {
        device: device as GPUDevice,
        target: createDenoSurfaceTarget(10, 10, 'rgba8unorm', 'opaque'),
      },
      {
        configure: (configuration: GPUCanvasConfiguration) => {
          calls.push(configuration);
        },
        unconfigure: () => undefined,
        getCurrentTexture: () => {
          if (attempts === 0) {
            attempts += 1;
            throw new DOMException('Presentation state was dropped', 'InvalidStateError');
          }
          return {
            createView: () => ({ textureId: 7 } as unknown as GPUTextureView),
          } as GPUTexture;
        },
      } as unknown as GPUCanvasContext,
    ),
  );

  assertEquals(Boolean(view), true);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].format, 'rgba8unorm');
  assertEquals(calls[0].alphaMode, 'opaque');
  assertEquals(calls[1].format, 'rgba8unorm');
  assertEquals(calls[1].alphaMode, 'opaque');
});

Deno.test('acquireColorAttachmentView rethrows non-state surface errors', () => {
  const { device } = createMockDevice();

  assertThrows(
    () =>
      acquireColorAttachmentView(
        configureSurfaceContext(
          {
            device: device as GPUDevice,
            target: createBrowserSurfaceTarget(10, 10),
          },
          {
            configure: () => undefined,
            unconfigure: () => undefined,
            getCurrentTexture: () => {
              throw new DOMException('Surface access denied', 'OperationError');
            },
          } as unknown as GPUCanvasContext,
        ),
      ),
    DOMException,
    'Surface access denied',
  );
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
    alphaMode: undefined,
  });
  assertEquals(getRenderTargetSize(createHeadlessTarget(8, 4)), { width: 8, height: 4 });
  assertEquals(getRenderTargetByteSize(createHeadlessTarget(8, 4)), 128);
});
