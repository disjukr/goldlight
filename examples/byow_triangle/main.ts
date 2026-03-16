/// <reference lib="deno.unstable" />

import { EventType, WindowBuilder } from 'jsr:@divy/sdl2@0.15.0';
import triangleShader from './triangle.wgsl' with { type: 'text' };

const width = 960;
const height = 540;

const window = new WindowBuilder('rieul3d byow triangle', width, height).build();
const adapter = await navigator.gpu.requestAdapter();

if (!adapter) {
  throw new Error('WebGPU adapter is unavailable');
}

const device = await adapter.requestDevice();
const surface = window.windowSurface(width, height);
const context = surface.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format,
  alphaMode: 'opaque',
});

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
  surface.present();
};

for await (const event of window.events()) {
  switch (event.type) {
    case EventType.Draw:
      drawFrame();
      break;
    case EventType.Quit:
      Deno.exit(0);
  }
}
