import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import {
  applyRuntimeResidencyPlan,
  createRuntimeResidency,
  invalidateResidency,
  invalidateResidencyResources,
} from '@rieul3d/gpu';

const createMockBuffer = () => {
  let destroyed = false;
  return {
    get destroyed() {
      return destroyed;
    },
    destroy: () => {
      destroyed = true;
    },
  } as GPUBuffer & { readonly destroyed: boolean };
};

const createMockTexture = () => {
  let destroyed = false;
  return {
    get destroyed() {
      return destroyed;
    },
    destroy: () => {
      destroyed = true;
    },
  } as GPUTexture & { readonly destroyed: boolean };
};

Deno.test('invalidateResidencyResources drops only selected residency ids', () => {
  const geometryBuffer = createMockBuffer();
  const materialBuffer = createMockBuffer();
  const texture = createMockTexture();
  const volume = createMockTexture();
  const residency = createRuntimeResidency();

  residency.geometry.set('mesh-a', {
    meshId: 'mesh-a',
    attributeBuffers: { POSITION: geometryBuffer },
    vertexCount: 3,
    indexCount: 0,
  });
  residency.geometry.set('mesh-b', {
    meshId: 'mesh-b',
    attributeBuffers: { POSITION: createMockBuffer() },
    vertexCount: 3,
    indexCount: 0,
  });
  residency.materials.set('material-a', {
    materialId: 'material-a',
    parameterNames: ['color'],
    uniformData: new Float32Array(4),
    uniformBuffer: materialBuffer,
  });
  residency.textures.set('texture-a', {
    textureId: 'texture-a',
    texture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
  });
  residency.volumes.set('volume-a', {
    volumeId: 'volume-a',
    texture: volume,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    depth: 1,
    format: 'r8unorm',
  });
  residency.pipelines.set('pipeline-a', {} as GPURenderPipeline);
  residency.pipelines.set('pipeline-b', {} as GPURenderPipeline);

  invalidateResidencyResources(residency, {
    meshIds: ['mesh-a'],
    materialIds: ['material-a'],
    textureIds: ['texture-a'],
    volumeIds: ['volume-a'],
    pipelineKeys: ['pipeline-a'],
  });

  assertEquals(geometryBuffer.destroyed, true);
  assertEquals(materialBuffer.destroyed, true);
  assertEquals(texture.destroyed, true);
  assertEquals(volume.destroyed, true);
  assertEquals([...residency.geometry.keys()], ['mesh-b']);
  assertEquals([...residency.materials.keys()], []);
  assertEquals([...residency.textures.keys()], []);
  assertEquals([...residency.volumes.keys()], []);
  assertEquals([...residency.pipelines.keys()], ['pipeline-b']);
});

Deno.test('invalidateResidency destroys and clears every cached residency class', () => {
  const geometryBuffer = createMockBuffer();
  const materialBuffer = createMockBuffer();
  const texture = createMockTexture();
  const volume = createMockTexture();
  const residency = createRuntimeResidency();

  residency.geometry.set('mesh-a', {
    meshId: 'mesh-a',
    attributeBuffers: { POSITION: geometryBuffer },
    indexBuffer: createMockBuffer(),
    vertexCount: 3,
    indexCount: 3,
  });
  residency.materials.set('material-a', {
    materialId: 'material-a',
    parameterNames: ['color'],
    uniformData: new Float32Array(4),
    uniformBuffer: materialBuffer,
  });
  residency.textures.set('texture-a', {
    textureId: 'texture-a',
    texture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
  });
  residency.volumes.set('volume-a', {
    volumeId: 'volume-a',
    texture: volume,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    depth: 1,
    format: 'r8unorm',
  });
  residency.pipelines.set('pipeline-a', {} as GPURenderPipeline);

  invalidateResidency(residency);

  assertEquals(geometryBuffer.destroyed, true);
  assertEquals(materialBuffer.destroyed, true);
  assertEquals(texture.destroyed, true);
  assertEquals(volume.destroyed, true);
  assertEquals(residency.geometry.size, 0);
  assertEquals(residency.materials.size, 0);
  assertEquals(residency.textures.size, 0);
  assertEquals(residency.volumes.size, 0);
  assertEquals(residency.pipelines.size, 0);
});

Deno.test('applyRuntimeResidencyPlan delegates targeted invalidation without full reset', () => {
  const geometryBuffer = createMockBuffer();
  const materialBuffer = createMockBuffer();
  const texture = createMockTexture();
  const volume = createMockTexture();
  const residency = createRuntimeResidency();

  residency.geometry.set('mesh-a', {
    meshId: 'mesh-a',
    attributeBuffers: { POSITION: geometryBuffer },
    vertexCount: 3,
    indexCount: 0,
  });
  residency.materials.set('material-a', {
    materialId: 'material-a',
    parameterNames: ['color'],
    uniformData: new Float32Array(4),
    uniformBuffer: materialBuffer,
  });
  residency.textures.set('texture-a', {
    textureId: 'texture-a',
    texture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
  });
  residency.volumes.set('volume-a', {
    volumeId: 'volume-a',
    texture: volume,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    depth: 1,
    format: 'r8unorm',
  });

  applyRuntimeResidencyPlan(residency, {
    reset: false,
    meshIds: ['mesh-a'],
    materialIds: ['material-a'],
    textureIds: ['texture-a'],
    volumeIds: ['volume-a'],
  });

  assertEquals(geometryBuffer.destroyed, true);
  assertEquals(materialBuffer.destroyed, true);
  assertEquals(texture.destroyed, true);
  assertEquals(volume.destroyed, true);
  assertEquals(residency.geometry.size, 0);
  assertEquals(residency.materials.size, 0);
  assertEquals(residency.textures.size, 0);
  assertEquals(residency.volumes.size, 0);
});

Deno.test('applyRuntimeResidencyPlan falls back to full reset', () => {
  const geometryBuffer = createMockBuffer();
  const residency = createRuntimeResidency();

  residency.geometry.set('mesh-a', {
    meshId: 'mesh-a',
    attributeBuffers: { POSITION: geometryBuffer },
    vertexCount: 3,
    indexCount: 0,
  });
  residency.pipelines.set('pipeline-a', {} as GPURenderPipeline);

  applyRuntimeResidencyPlan(residency, {
    reset: true,
    meshIds: [],
    materialIds: [],
    textureIds: [],
    volumeIds: [],
  });

  assertEquals(geometryBuffer.destroyed, true);
  assertEquals(residency.geometry.size, 0);
  assertEquals(residency.pipelines.size, 0);
});
