// @ts-nocheck
import type { DesktopModuleContext } from '@disjukr/goldlight/desktop';
import triangleShader from './triangle.wgsl' with { type: 'text' };

export default async ({ window }: DesktopModuleContext): Promise<() => void> => {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable');
  }

  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const context = window.canvasContext;

  const configureContext = () => {
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
    });
  };

  configureContext();
  window.runtime.addEventListener('resize', configureContext);

  const shaderModule = device.createShaderModule({
    label: 'byow-triangle-shader',
    code: triangleShader,
  });

  const pipeline = device.createRenderPipeline({
    label: 'byow-triangle-pipeline',
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vsMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  let frameHandle = 0;
  const drawFrame = () => {
    const encoder = device.createCommandEncoder({
      label: 'byow-triangle-frame',
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setPipeline(pipeline);
    pass.draw(3, 1, 0, 0);
    pass.end();

    device.queue.submit([encoder.finish()]);
    window.present();
    frameHandle = window.runtime.requestAnimationFrame(drawFrame);
  };

  frameHandle = window.runtime.requestAnimationFrame(drawFrame);

  return () => {
    window.runtime.removeEventListener('resize', configureContext);
    window.runtime.cancelAnimationFrame(frameHandle);
  };
};


