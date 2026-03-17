import { assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { evaluateScene } from '@rieul3d/core';
import { createRuntimeResidency } from '@rieul3d/gpu';
import {
  appendLight,
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createSceneIr,
} from '@rieul3d/ir';
import {
  assertRendererSceneCapabilities,
  collectRendererCapabilityIssues,
  createDeferredRenderer,
  createForwardRenderer,
  createMaterialRegistry,
  extractDirectionalLightItems,
  extractSdfPassItems,
  extractVolumePassItems,
  type MaterialProgram,
  planFrame,
  registerWgslMaterial,
} from '@rieul3d/renderer';

const createFlatRedProgram = (): MaterialProgram => ({
  id: 'shader:flat-red',
  label: 'Flat Red',
  wgsl: `
struct VsOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  vertexAttributes: [{
    semantic: 'POSITION',
    shaderLocation: 0,
    format: 'float32x3',
    offset: 0,
    arrayStride: 12,
  }],
});

const createTexturedCustomProgram = (): MaterialProgram => ({
  id: 'shader:textured-custom',
  label: 'Textured Custom',
  wgsl: `
struct VsOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vsMain(@location(0) position: vec3<f32>) -> VsOut {
  var out: VsOut;
  out.position = vec4<f32>(position, 1.0);
  return out;
}

@group(1) @binding(0) var customTexture: texture_2d<f32>;
@group(1) @binding(1) var customSampler: sampler;

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return textureSample(customTexture, customSampler, vec2<f32>(0.5, 0.5));
}
`,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  vertexAttributes: [{
    semantic: 'POSITION',
    shaderLocation: 0,
    format: 'float32x3',
    offset: 0,
    arrayStride: 12,
  }],
  usesTransformBindings: true,
  materialBindings: [
    {
      kind: 'texture' as const,
      binding: 0,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'sampler' as const,
      binding: 1,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'texture' as const,
      binding: 2,
      textureSemantic: 'normal',
    },
  ],
});

const createDeferredTexturedCustomProgram = (): MaterialProgram => ({
  id: 'shader:deferred-textured-custom',
  label: 'Deferred Textured Custom',
  wgsl: `
struct MeshTransform {
  world: mat4x4<f32>,
  normal: mat4x4<f32>,
};

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct FsOut {
  @location(0) albedo: vec4<f32>,
  @location(1) encodedNormal: vec4<f32>,
};

@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;
@group(1) @binding(0) var customTexture: texture_2d<f32>;
@group(1) @binding(1) var customSampler: sampler;

@vertex
fn vsMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
) -> VsOut {
  var out: VsOut;
  out.position = meshTransform.world * vec4<f32>(position, 1.0);
  out.normal = normalize((meshTransform.normal * vec4<f32>(normal, 0.0)).xyz);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> FsOut {
  var out: FsOut;
  out.albedo = textureSample(customTexture, customSampler, in.uv);
  out.encodedNormal = vec4<f32>((normalize(in.normal) * 0.5) + vec3<f32>(0.5), 1.0);
  return out;
}
`,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'NORMAL',
      shaderLocation: 1,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'TEXCOORD_0',
      shaderLocation: 2,
      format: 'float32x2',
      offset: 0,
      arrayStride: 8,
    },
  ],
  usesTransformBindings: true,
  materialBindings: [
    {
      kind: 'texture' as const,
      binding: 0,
      textureSemantic: 'baseColor',
    },
    {
      kind: 'sampler' as const,
      binding: 1,
      textureSemantic: 'baseColor',
    },
  ],
});

Deno.test('forward renderer omits raymarch pass when scene has no sdf or volume nodes', () => {
  let scene = createSceneIr('scene');
  scene = appendNode(scene, createNode('node-0'));
  const frame = planFrame(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    createRuntimeResidency(),
  );

  assertEquals(frame.passes.map((pass) => pass.id), ['mesh', 'present']);
});

Deno.test('deferred renderer plans only the implemented mesh passes', () => {
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-0',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('node-0', { meshId: 'mesh-0' }));

  const frame = planFrame(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    createRuntimeResidency(),
  );

  assertEquals(frame.passes.map((pass) => pass.id), [
    'depth-prepass',
    'gbuffer',
    'lighting',
    'present',
  ]);
});

Deno.test('deferred renderer plans a hybrid raymarch pass when sdf or volume nodes are present', () => {
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [{
      id: 'sdf-0',
      op: 'sphere',
      parameters: {
        radius: { x: 0.5, y: 0, z: 0, w: 0 },
      },
    }],
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));
  scene = appendNode(scene, createNode('volume-node', { volumeId: 'volume-0' }));

  const frame = planFrame(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    createRuntimeResidency(),
  );

  assertEquals(frame.passes.map((pass) => pass.id), [
    'depth-prepass',
    'gbuffer',
    'lighting',
    'raymarch',
    'present',
  ]);
});

Deno.test('extractVolumePassItems returns only evaluated volumes with residency', () => {
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('node-0', { volumeId: 'volume-0' }));
  const evaluatedScene = evaluateScene(scene, { timeMs: 0 });
  const residency = createRuntimeResidency();
  residency.volumes.set('volume-0', {
    volumeId: 'volume-0',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 4,
    height: 4,
    depth: 4,
    format: 'r8unorm',
  });

  const items = extractVolumePassItems(evaluatedScene, residency);

  assertEquals(items.length, 1);
  assertEquals(items[0].nodeId, 'node-0');
  assertEquals(items[0].volumeId, 'volume-0');
});

Deno.test('extractSdfPassItems returns supported sphere and box sdf nodes with derived bounds', () => {
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [
      {
        id: 'sdf-sphere',
        op: 'sphere',
        parameters: {
          radius: { x: 2, y: 0, z: 0, w: 0 },
          color: { x: 0.4, y: 0.8, z: 1, w: 1 },
        },
      },
      {
        id: 'sdf-box',
        op: 'box',
        parameters: {
          size: { x: 1, y: 2, z: 3, w: 0 },
          color: { x: 1, y: 0.2, z: 0.1, w: 1 },
        },
      },
    ],
  };
  scene = appendNode(
    scene,
    createNode('sphere-node', {
      sdfId: 'sdf-sphere',
      transform: {
        translation: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 2, y: 2, z: 2 },
      },
    }),
  );
  scene = appendNode(
    scene,
    createNode('box-node', {
      sdfId: 'sdf-box',
      transform: {
        translation: { x: -2, y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
        scale: { x: 4, y: 5, z: 6 },
      },
    }),
  );

  const items = extractSdfPassItems(evaluateScene(scene, { timeMs: 0 }));

  assertEquals(items[0], {
    nodeId: 'sphere-node',
    sdfId: 'sdf-sphere',
    op: 'sphere',
    center: [1, 2, 3],
    radius: 4,
    halfExtents: [1, 1, 1],
    color: [0.4, 0.8, 1, 1],
    worldToLocalRotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  });
  assertEquals(items[1].nodeId, 'box-node');
  assertEquals(items[1].sdfId, 'sdf-box');
  assertEquals(items[1].op, 'box');
  assertEquals(items[1].center, [-2, 0, 1]);
  assertEquals(items[1].color, [1, 0.2, 0.1, 1]);
  assertAlmostEquals(items[1].radius, 2.5, 1e-6);
  assertAlmostEquals(items[1].halfExtents[0], 4, 1e-6);
  assertAlmostEquals(items[1].halfExtents[1], 10, 1e-6);
  assertAlmostEquals(items[1].halfExtents[2], 18, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[0], 0, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[1], 1, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[2], 0, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[3], -1, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[4], 0, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[5], 0, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[6], 0, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[7], 0, 1e-6);
  assertAlmostEquals(items[1].worldToLocalRotation[8], 1, 1e-6);
});

Deno.test('extractDirectionalLightItems resolves world-space directions from light nodes', () => {
  let scene = createSceneIr('scene');
  scene = appendLight(scene, {
    id: 'light-directional',
    kind: 'directional',
    color: { x: 1, y: 0.9, z: 0.8 },
    intensity: 2,
  });
  scene = appendNode(scene, createNode('light-node', { lightId: 'light-directional' }));

  const items = extractDirectionalLightItems(evaluateScene(scene, { timeMs: 0 }));

  assertEquals(items, [{
    nodeId: 'light-node',
    lightId: 'light-directional',
    direction: [0, 0, -1],
    color: [1, 0.9, 0.8],
    intensity: 2,
  }]);
});

Deno.test('collectRendererCapabilityIssues accepts the current forward primitive mix', () => {
  const materialRegistry = createMaterialRegistry();
  registerWgslMaterial(materialRegistry, createFlatRedProgram());
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:flat-red',
    textures: [],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-custom',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = {
    ...scene,
    sdfPrimitives: [{ id: 'sdf-0', op: 'sphere', parameters: {} }],
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));
  scene = appendNode(scene, createNode('volume-node', { volumeId: 'volume-0' }));

  const issues = collectRendererCapabilityIssues(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    materialRegistry,
  );

  assertEquals(issues, []);
});

Deno.test('collectRendererCapabilityIssues accepts lit materials when a directional light is present', () => {
  let scene = createSceneIr('scene');
  scene = appendLight(scene, {
    id: 'light-directional',
    kind: 'directional',
    color: { x: 1, y: 1, z: 1 },
    intensity: 1,
  });
  scene = appendMaterial(scene, {
    id: 'material-lit',
    kind: 'lit',
    textures: [],
    parameters: {
      color: { x: 0.8, y: 0.4, z: 0.2, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-lit',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('light-node', { lightId: 'light-directional' }));
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  const issues = collectRendererCapabilityIssues(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(issues, []);
});

Deno.test('collectRendererCapabilityIssues rejects lit materials without lights or normals', () => {
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-lit',
    kind: 'lit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 0.6, y: 0.7, z: 0.9, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-lit',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  const issues = collectRendererCapabilityIssues(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(issues, [
    {
      nodeId: 'mesh-node',
      feature: 'light',
      requirement: 'light-source:directional',
      message:
        'renderer "forward" requires at least one directional light for material "material-lit"',
    },
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'light-material:textures-unsupported',
      message:
        'renderer "forward" does not yet support textures on built-in lit material "material-lit"',
    },
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'vertex-attribute:NORMAL',
      message:
        'renderer "forward" cannot light node "mesh-node" because mesh "mesh-0" is missing NORMAL',
    },
  ]);
});

Deno.test('collectRendererCapabilityIssues accepts supported box sdf ops for execution', () => {
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [{ id: 'sdf-0', op: 'box', parameters: {} }],
  };
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));

  const issues = collectRendererCapabilityIssues(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(issues, []);
});

Deno.test('collectRendererCapabilityIssues accepts deferred hybrid sdf and volume scenes', () => {
  const renderer = createDeferredRenderer();
  const residency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [{
      id: 'sdf-0',
      op: 'sphere',
      parameters: {
        radius: { x: 0.5, y: 0, z: 0, w: 0 },
      },
    }],
    volumePrimitives: [{
      id: 'volume-0',
      assetId: 'volume-asset-0',
      dimensions: { x: 4, y: 4, z: 4 },
      format: 'density:r8unorm',
    }],
  };
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));
  scene = appendNode(scene, createNode('volume-node', { volumeId: 'volume-0' }));
  residency.volumes.set('volume-0', {
    volumeId: 'volume-0',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 4,
    height: 4,
    depth: 4,
    format: 'r8unorm',
  });

  const issues = collectRendererCapabilityIssues(
    renderer,
    evaluateScene(scene, { timeMs: 0 }),
    createMaterialRegistry(),
    residency,
  );

  assertEquals(issues, []);
});

Deno.test('collectRendererCapabilityIssues reports binding-specific failures in one pass', () => {
  const materialRegistry = createMaterialRegistry();
  registerWgslMaterial(materialRegistry, createTexturedCustomProgram());
  let scene = createSceneIr('scene');
  scene = {
    ...scene,
    sdfPrimitives: [{ id: 'sdf-0', op: 'torus', parameters: {} }],
  };
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:textured-custom',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-custom',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));
  scene = appendNode(scene, createNode('sdf-node', { sdfId: 'sdf-0' }));

  const issues = collectRendererCapabilityIssues(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    materialRegistry,
  );

  assertEquals(issues, [
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'vertex-attribute:TEXCOORD_0',
      message:
        'renderer "forward" cannot sample material "material-custom" on node "mesh-node" because mesh "mesh-0" is missing TEXCOORD_0',
    },
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'texture-semantic:normal',
      message:
        'renderer "forward" cannot satisfy "normal" texture binding for material "material-custom"',
    },
    {
      nodeId: 'sdf-node',
      feature: 'sdf',
      requirement: 'sdf-op:torus',
      message:
        'renderer "forward" only supports sphere and box sdf primitives right now; node "sdf-node" requested "torus"',
    },
  ]);
});

Deno.test('collectRendererCapabilityIssues reports missing resident textures for custom bindings', () => {
  const materialRegistry = createMaterialRegistry();
  const residency = createRuntimeResidency();
  registerWgslMaterial(materialRegistry, createTexturedCustomProgram());
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:textured-custom',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-custom',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  const issues = collectRendererCapabilityIssues(
    createForwardRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    materialRegistry,
    residency,
  );

  assertEquals(issues, [
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'texture-residency:baseColor:texture',
      message:
        'renderer "forward" cannot satisfy "baseColor" texture binding for material "material-custom" because texture "texture-0" is not resident',
    },
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'texture-residency:baseColor:sampler',
      message:
        'renderer "forward" cannot satisfy "baseColor" sampler binding for material "material-custom" because texture "texture-0" is not resident',
    },
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'texture-semantic:normal',
      message:
        'renderer "forward" cannot satisfy "normal" texture binding for material "material-custom"',
    },
  ]);
});

Deno.test('assertRendererSceneCapabilities surfaces aggregated binding diagnostics cleanly', () => {
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:missing',
    textures: [],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-custom',
    attributes: [{ semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] }],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  assertThrows(
    () =>
      assertRendererSceneCapabilities(
        createForwardRenderer(),
        evaluateScene(scene, { timeMs: 0 }),
      ),
    Error,
    '(material-binding:shader:shader:missing)',
  );
});

Deno.test('assertRendererSceneCapabilities fails early for non-resident built-in texture bindings', () => {
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-textured',
    kind: 'unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-textured',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  assertThrows(
    () =>
      assertRendererSceneCapabilities(
        createForwardRenderer(),
        evaluateScene(scene, { timeMs: 0 }),
        createMaterialRegistry(),
        createRuntimeResidency(),
      ),
    Error,
    '(material-binding:texture-residency:baseColor:texture)',
  );
});

Deno.test('deferred renderer accepts minimal mesh/unlit scenes with normals', () => {
  let scene = createSceneIr('scene');
  scene = appendMesh(scene, {
    id: 'mesh-0',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  const issues = collectRendererCapabilityIssues(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(issues, []);
});

Deno.test('deferred renderer accepts textured unlit scenes with normals, uvs, and resident textures', () => {
  const residency = createRuntimeResidency();
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-textured',
    kind: 'unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  residency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 2,
    height: 2,
    format: 'rgba8unorm-srgb',
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-textured',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  const issues = collectRendererCapabilityIssues(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    createMaterialRegistry(),
    residency,
  );

  assertEquals(issues, []);
});

Deno.test('deferred renderer accepts custom WGSL materials that satisfy deferred gbuffer bindings', () => {
  const materialRegistry = createMaterialRegistry();
  const residency = createRuntimeResidency();
  registerWgslMaterial(materialRegistry, createDeferredTexturedCustomProgram());
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-custom',
    kind: 'custom',
    shaderId: 'shader:deferred-textured-custom',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {},
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-custom',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { semantic: 'NORMAL', itemSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: [0, 0, 1, 0, 0, 1] },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));
  residency.textures.set('texture-0', {
    textureId: 'texture-0',
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    sampler: {} as GPUSampler,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
  });

  const issues = collectRendererCapabilityIssues(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
    materialRegistry,
    residency,
  );

  assertEquals(issues, []);
});

Deno.test('deferred renderer rejects textured unlit scenes that omit normals or uvs during preflight', () => {
  let scene = createSceneIr('scene');
  scene = appendMaterial(scene, {
    id: 'material-textured',
    kind: 'unlit',
    textures: [{
      id: 'texture-0',
      assetId: 'image-0',
      semantic: 'baseColor',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    }],
    parameters: {
      color: { x: 1, y: 1, z: 1, w: 1 },
    },
  });
  scene = appendMesh(scene, {
    id: 'mesh-0',
    materialId: 'material-textured',
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
    ],
  });
  scene = appendNode(scene, createNode('mesh-node', { meshId: 'mesh-0' }));

  const issues = collectRendererCapabilityIssues(
    createDeferredRenderer(),
    evaluateScene(scene, { timeMs: 0 }),
  );

  assertEquals(issues, [
    {
      nodeId: 'mesh-node',
      feature: 'mesh',
      requirement: 'vertex-attribute:NORMAL',
      message:
        'renderer "deferred" requires NORMAL vertex data on node "mesh-node" for deferred lighting',
    },
    {
      nodeId: 'mesh-node',
      feature: 'material-binding',
      requirement: 'vertex-attribute:TEXCOORD_0',
      message:
        'renderer "deferred" cannot sample baseColor textures on node "mesh-node" because mesh "mesh-0" is missing TEXCOORD_0',
    },
  ]);
});
