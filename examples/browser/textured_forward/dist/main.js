// packages/core/src/evaluate_scene.ts
var multiplyMat4 = (a, b) => {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const index = col * 4 + row;
      out[index] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
};
var transformToMatrix = (node) => {
  const { translation, rotation, scale } = node.transform;
  const { x, y, z, w } = rotation;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * scale.x,
    2 * (xy + wz) * scale.x,
    2 * (xz - wy) * scale.x,
    0,
    2 * (xy - wz) * scale.y,
    (1 - 2 * (xx + zz)) * scale.y,
    2 * (yz + wx) * scale.y,
    0,
    2 * (xz + wy) * scale.z,
    2 * (yz - wx) * scale.z,
    (1 - 2 * (xx + yy)) * scale.z,
    0,
    translation.x,
    translation.y,
    translation.z,
    1
  ];
};
var sampleChannel = (channel, timeMs) => {
  if (channel.keyframes.length === 0) return void 0;
  if (channel.keyframes.length === 1) return channel.keyframes[0].value;
  const duration = channel.keyframes[channel.keyframes.length - 1].timeMs || 1;
  const loopedTime = timeMs % duration;
  for (let index = 0; index < channel.keyframes.length - 1; index += 1) {
    const current = channel.keyframes[index];
    const next = channel.keyframes[index + 1];
    if (loopedTime < current.timeMs || loopedTime > next.timeMs) continue;
    const span = next.timeMs - current.timeMs || 1;
    const alpha = (loopedTime - current.timeMs) / span;
    return {
      x: current.value.x + (next.value.x - current.value.x) * alpha,
      y: current.value.y + (next.value.y - current.value.y) * alpha,
      z: current.value.z + (next.value.z - current.value.z) * alpha,
      w: current.value.w + (next.value.w - current.value.w) * alpha
    };
  }
  return channel.keyframes[channel.keyframes.length - 1].value;
};
var applyAnimation = (scene2, options) => {
  if (!options.clipId) return scene2.nodes;
  const clip = scene2.animationClips.find((candidate) => candidate.id === options.clipId);
  if (!clip) return scene2.nodes;
  const channelsByNode = /* @__PURE__ */ new Map();
  for (const channel of clip.channels) {
    channelsByNode.set(channel.nodeId, [
      ...channelsByNode.get(channel.nodeId) ?? [],
      channel
    ]);
  }
  return scene2.nodes.map((node) => {
    const channels = channelsByNode.get(node.id);
    if (!channels) return node;
    let nextNode = node;
    for (const channel of channels) {
      const sampled = sampleChannel(channel, options.timeMs);
      if (!sampled) continue;
      if (channel.property === "translation") {
        nextNode = {
          ...nextNode,
          transform: {
            ...nextNode.transform,
            translation: {
              x: sampled.x,
              y: sampled.y,
              z: sampled.z
            }
          }
        };
      } else if (channel.property === "scale") {
        nextNode = {
          ...nextNode,
          transform: {
            ...nextNode.transform,
            scale: {
              x: sampled.x,
              y: sampled.y,
              z: sampled.z
            }
          }
        };
      } else {
        nextNode = {
          ...nextNode,
          transform: {
            ...nextNode.transform,
            rotation: sampled
          }
        };
      }
    }
    return nextNode;
  });
};
var evaluateScene = (scene2, options) => {
  const nodes = applyAnimation(scene2, options);
  const nodeById = new Map(nodes.map((node) => [
    node.id,
    node
  ]));
  const worldById = /* @__PURE__ */ new Map();
  const getWorldMatrix = (node) => {
    const cached = worldById.get(node.id);
    if (cached) return cached;
    const local = transformToMatrix(node);
    const world = node.parentId ? multiplyMat4(getWorldMatrix(nodeById.get(node.parentId)), local) : local;
    worldById.set(node.id, world);
    return world;
  };
  return {
    sceneId: scene2.id,
    timeMs: options.timeMs,
    nodes: nodes.map((node) => ({
      node,
      worldMatrix: getWorldMatrix(node),
      mesh: node.meshId ? scene2.meshes.find((mesh) => mesh.id === node.meshId) : void 0,
      material: node.meshId ? (() => {
        const mesh = scene2.meshes.find((candidate) => candidate.id === node.meshId);
        return mesh?.materialId ? scene2.materials.find((material) => material.id === mesh.materialId) : void 0;
      })() : void 0,
      sdf: node.sdfId ? scene2.sdfPrimitives.find((primitive) => primitive.id === node.sdfId) : void 0,
      volume: node.volumeId ? scene2.volumePrimitives.find((primitive) => primitive.id === node.volumeId) : void 0
    }))
  };
};

// packages/gpu/src/context.ts
var requestGpuContext = async (options) => {
  const gpu = options.gpu ?? globalThis.navigator?.gpu;
  if (!gpu) {
    throw new Error("WebGPU is not available in this runtime");
  }
  const adapter = await gpu.requestAdapter({
    powerPreference: options.powerPreference
  });
  if (!adapter) {
    throw new Error("Failed to request WebGPU adapter");
  }
  const device = await adapter.requestDevice({
    requiredFeatures: options.requiredFeatures ? [
      ...options.requiredFeatures
    ] : void 0,
    requiredLimits: options.requiredLimits
  });
  return {
    adapter,
    device,
    queue: device.queue,
    target: options.target
  };
};
var configureSurfaceContext = (context, canvasContext2) => {
  if (context.target.kind !== "surface") {
    throw new Error("surface configuration requires a surface target");
  }
  canvasContext2.configure({
    device: context.device,
    format: context.target.format,
    alphaMode: "premultiplied"
  });
  return {
    kind: "surface",
    target: context.target,
    canvasContext: canvasContext2
  };
};
var acquireColorAttachmentView = (binding) => {
  if (binding.kind === "surface") {
    return binding.canvasContext.getCurrentTexture().createView();
  }
  return binding.view;
};

// packages/gpu/src/residency.ts
var createRuntimeResidency = () => ({
  textures: /* @__PURE__ */ new Map(),
  geometry: /* @__PURE__ */ new Map(),
  materials: /* @__PURE__ */ new Map(),
  volumes: /* @__PURE__ */ new Map(),
  pipelines: /* @__PURE__ */ new Map()
});
var vertexUsage = 32;
var indexUsage = 16;
var uniformUsage = 64;
var textureBindingUsage = 4;
var bufferCopyDstUsage = 8;
var textureCopyDstUsage = 2;
var materialParameterSlots = 16;
var floatsPerVec4 = 4;
var defaultMaterialColor = [
  0.95,
  0.95,
  0.95,
  1
];
var createAttributeArray = (attribute) => Float32Array.from(attribute.values);
var createIndexArray = (indices) => Uint32Array.from(indices);
var toBufferSource = (view) => {
  const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  return new Uint8Array(buffer);
};
var getVertexCount = (attribute) => attribute.itemSize > 0 ? Math.floor(attribute.values.length / attribute.itemSize) : 0;
var uploadMeshResidency = (context, mesh) => {
  const attributeBuffers = {};
  for (const attribute of mesh.attributes) {
    const data = createAttributeArray(attribute);
    const buffer = context.device.createBuffer({
      label: `${mesh.id}:${attribute.semantic}`,
      size: data.byteLength,
      usage: vertexUsage | bufferCopyDstUsage
    });
    context.queue.writeBuffer(buffer, 0, toBufferSource(data));
    attributeBuffers[attribute.semantic] = buffer;
  }
  let indexBuffer;
  if (mesh.indices && mesh.indices.length > 0) {
    const indexData = createIndexArray(mesh.indices);
    indexBuffer = context.device.createBuffer({
      label: `${mesh.id}:indices`,
      size: indexData.byteLength,
      usage: indexUsage | bufferCopyDstUsage
    });
    context.queue.writeBuffer(indexBuffer, 0, toBufferSource(indexData));
  }
  return {
    meshId: mesh.id,
    attributeBuffers,
    indexBuffer,
    vertexCount: mesh.attributes[0] ? getVertexCount(mesh.attributes[0]) : 0,
    indexCount: mesh.indices?.length ?? 0
  };
};
var ensureMeshResidency = (context, residency2, mesh) => {
  const cached = residency2.geometry.get(mesh.id);
  if (cached) {
    return cached;
  }
  const uploaded = uploadMeshResidency(context, mesh);
  residency2.geometry.set(mesh.id, uploaded);
  return uploaded;
};
var ensureSceneMeshResidency = (context, residency2, scene2, evaluatedScene2) => {
  const meshIds = new Set(evaluatedScene2.nodes.map((node) => node.mesh?.id).filter((meshId2) => Boolean(meshId2)));
  for (const mesh of scene2.meshes) {
    if (!meshIds.has(mesh.id)) {
      continue;
    }
    ensureMeshResidency(context, residency2, mesh);
  }
  return residency2;
};
var getMaterialParameterNames = (material) => {
  const names = Object.keys(material.parameters).filter((name) => name !== "color").sort();
  return material.parameters.color ? [
    "color",
    ...names
  ] : names;
};
var createMaterialUploadPlan = (material) => {
  const parameterNames = getMaterialParameterNames(material).slice(0, materialParameterSlots);
  const uniformData = new Float32Array(materialParameterSlots * floatsPerVec4);
  if (parameterNames.length === 0) {
    uniformData.set(defaultMaterialColor, 0);
  }
  for (let index = 0; index < parameterNames.length; index += 1) {
    const value = material.parameters[parameterNames[index]];
    uniformData.set([
      value.x,
      value.y,
      value.z,
      value.w
    ], index * floatsPerVec4);
  }
  return {
    materialId: material.id,
    parameterNames,
    uniformData,
    byteLength: uniformData.byteLength
  };
};
var uploadMaterialResidency = (context, material) => {
  const plan = createMaterialUploadPlan(material);
  const uniformBuffer = context.device.createBuffer({
    label: `${material.id}:uniforms`,
    size: plan.byteLength,
    usage: uniformUsage | bufferCopyDstUsage
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource(plan.uniformData));
  return {
    materialId: material.id,
    parameterNames: plan.parameterNames,
    uniformData: plan.uniformData,
    uniformBuffer
  };
};
var ensureMaterialResidency = (context, residency2, material) => {
  const cached = residency2.materials.get(material.id);
  if (cached) {
    return cached;
  }
  const uploaded = uploadMaterialResidency(context, material);
  residency2.materials.set(material.id, uploaded);
  return uploaded;
};
var resolveTextureImageAsset = (assetSource2, textureRef) => {
  if (!textureRef.assetId) {
    return void 0;
  }
  return assetSource2.images.get(textureRef.assetId);
};
var createTextureUploadPlan = (textureRef, imageAsset) => {
  if (!imageAsset.width || !imageAsset.height) {
    throw new Error(`texture asset "${imageAsset.id}" is missing width/height`);
  }
  return {
    textureId: textureRef.id,
    width: imageAsset.width,
    height: imageAsset.height,
    format: imageAsset.pixelFormat ?? "rgba8unorm",
    bytesPerRow: imageAsset.bytesPerRow ?? imageAsset.width * 4,
    rowsPerImage: imageAsset.rowsPerImage ?? imageAsset.height
  };
};
var createSamplerDescriptor = (textureRef) => {
  switch (textureRef.sampler) {
    case "nearest-clamp":
      return {
        magFilter: "nearest",
        minFilter: "nearest",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge"
      };
    case "linear-clamp":
      return {
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge"
      };
    case "nearest-repeat":
      return {
        magFilter: "nearest",
        minFilter: "nearest",
        addressModeU: "repeat",
        addressModeV: "repeat"
      };
    case "linear-repeat":
    default:
      return {
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat"
      };
  }
};
var uploadTextureResidency = (context, textureRef, imageAsset) => {
  const plan = createTextureUploadPlan(textureRef, imageAsset);
  const texture = context.device.createTexture({
    label: textureRef.id,
    size: {
      width: plan.width,
      height: plan.height,
      depthOrArrayLayers: 1
    },
    format: plan.format,
    usage: textureBindingUsage | textureCopyDstUsage
  });
  context.queue.writeTexture({
    texture
  }, toBufferSource(imageAsset.bytes), {
    offset: 0,
    bytesPerRow: plan.bytesPerRow,
    rowsPerImage: plan.rowsPerImage
  }, {
    width: plan.width,
    height: plan.height,
    depthOrArrayLayers: 1
  });
  return {
    textureId: textureRef.id,
    texture,
    view: texture.createView(),
    sampler: context.device.createSampler(createSamplerDescriptor(textureRef)),
    width: plan.width,
    height: plan.height,
    format: plan.format
  };
};
var ensureTextureResidency = (context, residency2, assetSource2, textureRef) => {
  const cached = residency2.textures.get(textureRef.id);
  if (cached) {
    return cached;
  }
  const imageAsset = resolveTextureImageAsset(assetSource2, textureRef);
  if (!imageAsset) {
    throw new Error(`texture "${textureRef.id}" references missing asset "${textureRef.assetId}"`);
  }
  const uploaded = uploadTextureResidency(context, textureRef, imageAsset);
  residency2.textures.set(textureRef.id, uploaded);
  return uploaded;
};
var ensureSceneTextureResidency = (context, residency2, scene2, assetSource2) => {
  for (const textureRef of scene2.textures) {
    if (!textureRef.assetId) {
      continue;
    }
    ensureTextureResidency(context, residency2, assetSource2, textureRef);
  }
  return residency2;
};

// packages/ir/src/scene_ir.ts
var createVec3 = (x = 0, y = 0, z = 0) => ({
  x,
  y,
  z
});
var identityTransform = () => ({
  translation: createVec3(0, 0, 0),
  rotation: {
    x: 0,
    y: 0,
    z: 0,
    w: 1
  },
  scale: createVec3(1, 1, 1)
});
var createSceneIr = (id = "scene") => ({
  id,
  assets: [],
  textures: [],
  materials: [],
  meshes: [],
  sdfPrimitives: [],
  volumePrimitives: [],
  nodes: [],
  rootNodeIds: [],
  animationClips: []
});
var createNode = (id, partial = {}) => ({
  id,
  transform: partial.transform ?? identityTransform(),
  ...partial
});
var appendNode = (scene2, node) => ({
  ...scene2,
  nodes: [
    ...scene2.nodes,
    node
  ],
  rootNodeIds: node.parentId ? scene2.rootNodeIds : [
    ...scene2.rootNodeIds,
    node.id
  ]
});
var appendMesh = (scene2, mesh) => ({
  ...scene2,
  meshes: [
    ...scene2.meshes,
    mesh
  ]
});
var appendTexture = (scene2, texture) => ({
  ...scene2,
  textures: [
    ...scene2.textures,
    texture
  ]
});
var appendMaterial = (scene2, material) => ({
  ...scene2,
  materials: [
    ...scene2.materials,
    material
  ]
});

// packages/platform/src/targets.ts
var createSurfaceTarget = (width, height, format = "bgra8unorm") => ({
  kind: "surface",
  width,
  height,
  format
});
var createBrowserSurfaceTarget = createSurfaceTarget;

// packages/platform/src/png.ts
var pngSignature = new Uint8Array([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10
]);
var crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

// packages/renderer/src/shaders/built_in_forward_unlit.wgsl
var built_in_forward_unlit_default = "struct MeshTransform {\n  world: mat4x4<f32>,\n};\n\nstruct MaterialUniforms {\n  values: array<vec4<f32>, 16>,\n};\n\nstruct VsOut {\n  @builtin(position) position: vec4<f32>,\n};\n\n@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;\n@group(1) @binding(0) var<uniform> material: MaterialUniforms;\n\n@vertex\nfn vsMain(@location(0) position: vec3<f32>) -> VsOut {\n  var out: VsOut;\n  out.position = meshTransform.world * vec4<f32>(position, 1.0);\n  return out;\n}\n\n@fragment\nfn fsMain() -> @location(0) vec4<f32> {\n  return material.values[0];\n}\n";

// packages/renderer/src/shaders/built_in_forward_unlit_textured.wgsl
var built_in_forward_unlit_textured_default = "struct MeshTransform {\n  world: mat4x4<f32>,\n};\n\nstruct MaterialUniforms {\n  values: array<vec4<f32>, 16>,\n};\n\nstruct VsOut {\n  @builtin(position) position: vec4<f32>,\n  @location(0) texCoord: vec2<f32>,\n};\n\n@group(0) @binding(0) var<uniform> meshTransform: MeshTransform;\n@group(1) @binding(0) var<uniform> material: MaterialUniforms;\n@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;\n@group(1) @binding(2) var baseColorSampler: sampler;\n\n@vertex\nfn vsMain(@location(0) position: vec3<f32>, @location(1) texCoord: vec2<f32>) -> VsOut {\n  var out: VsOut;\n  out.position = meshTransform.world * vec4<f32>(position, 1.0);\n  out.texCoord = texCoord;\n  return out;\n}\n\n@fragment\nfn fsMain(in: VsOut) -> @location(0) vec4<f32> {\n  return material.values[0] * textureSample(baseColorTexture, baseColorSampler, in.texCoord);\n}\n";

// packages/renderer/src/shaders/built_in_sdf_raymarch.wgsl
var built_in_sdf_raymarch_default = "struct SdfItem {\n  centerRadius: vec4<f32>,\n  color: vec4<f32>,\n};\n\nstruct SdfUniforms {\n  itemCount: f32,\n  _padding0: vec3<f32>,\n  items: array<SdfItem, 16>,\n};\n\nstruct VsOut {\n  @builtin(position) position: vec4<f32>,\n  @location(0) uv: vec2<f32>,\n};\n\n@group(0) @binding(0) var<uniform> sdf: SdfUniforms;\n\n@vertex\nfn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {\n  var positions = array<vec2<f32>, 3>(\n    vec2<f32>(-1.0, -3.0),\n    vec2<f32>(-1.0, 1.0),\n    vec2<f32>(3.0, 1.0),\n  );\n\n  let position = positions[vertexIndex];\n  var out: VsOut;\n  out.position = vec4<f32>(position, 0.0, 1.0);\n  out.uv = position;\n  return out;\n}\n\nfn sceneSdf(point: vec3<f32>) -> vec4<f32> {\n  var minDistance = 1e9;\n  var color = vec4<f32>(0.0);\n  let itemCount = u32(sdf.itemCount);\n\n  for (var index: u32 = 0u; index < itemCount; index = index + 1u) {\n    let item = sdf.items[index];\n    let distance = length(point - item.centerRadius.xyz) - item.centerRadius.w;\n    if (distance < minDistance) {\n      minDistance = distance;\n      color = item.color;\n    }\n  }\n\n  return vec4<f32>(color.xyz, minDistance);\n}\n\n@fragment\nfn fsMain(in: VsOut) -> @location(0) vec4<f32> {\n  let cameraOrigin = vec3<f32>(0.0, 0.0, 2.5);\n  let rayDirection = normalize(vec3<f32>(in.uv.x, -in.uv.y, -1.75));\n  var travel = 0.0;\n\n  for (var step: u32 = 0u; step < 48u; step = step + 1u) {\n    let point = cameraOrigin + (rayDirection * travel);\n    let sample = sceneSdf(point);\n    let distance = sample.w;\n\n    if (distance < 0.001) {\n      let shade = 1.0 - (travel / 8.0);\n      return vec4<f32>(sample.xyz * max(shade, 0.2), 1.0);\n    }\n\n    if (travel > 8.0) {\n      break;\n    }\n\n    travel = travel + distance;\n  }\n\n  return vec4<f32>(0.0, 0.0, 0.0, 0.0);\n}\n";

// packages/renderer/src/shaders/built_in_volume_raymarch.wgsl
var built_in_volume_raymarch_default = "struct VolumeUniforms {\n  worldToLocal: mat4x4<f32>,\n};\n\nstruct VsOut {\n  @builtin(position) position: vec4<f32>,\n  @location(0) uv: vec2<f32>,\n};\n\n@group(0) @binding(0) var<uniform> volume: VolumeUniforms;\n@group(0) @binding(1) var volumeTexture: texture_3d<f32>;\n@group(0) @binding(2) var volumeSampler: sampler;\n\n@vertex\nfn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VsOut {\n  var positions = array<vec2<f32>, 3>(\n    vec2<f32>(-1.0, -3.0),\n    vec2<f32>(-1.0, 1.0),\n    vec2<f32>(3.0, 1.0),\n  );\n\n  let position = positions[vertexIndex];\n  var out: VsOut;\n  out.position = vec4<f32>(position, 0.0, 1.0);\n  out.uv = position;\n  return out;\n}\n\nfn intersectBox(\n  rayOrigin: vec3<f32>,\n  rayDirection: vec3<f32>,\n  boxMin: vec3<f32>,\n  boxMax: vec3<f32>,\n) -> vec2<f32> {\n  let inverseDirection = 1.0 / rayDirection;\n  let t0 = (boxMin - rayOrigin) * inverseDirection;\n  let t1 = (boxMax - rayOrigin) * inverseDirection;\n  let tMin = min(t0, t1);\n  let tMax = max(t0, t1);\n  let enter = max(max(tMin.x, tMin.y), max(tMin.z, 0.0));\n  let exit = min(tMax.x, min(tMax.y, tMax.z));\n  return vec2<f32>(enter, exit);\n}\n\nfn transformPoint(matrix: mat4x4<f32>, point: vec3<f32>) -> vec3<f32> {\n  return (matrix * vec4<f32>(point, 1.0)).xyz;\n}\n\nfn transformVector(matrix: mat4x4<f32>, vector: vec3<f32>) -> vec3<f32> {\n  return (matrix * vec4<f32>(vector, 0.0)).xyz;\n}\n\n@fragment\nfn fsMain(in: VsOut) -> @location(0) vec4<f32> {\n  let cameraOrigin = vec3<f32>(0.0, 0.0, 2.5);\n  let rayDirection = normalize(vec3<f32>(in.uv.x, -in.uv.y, -1.75));\n  let localOrigin = transformPoint(volume.worldToLocal, cameraOrigin);\n  let localDirection = transformVector(volume.worldToLocal, rayDirection);\n  let boxMin = vec3<f32>(-0.5, -0.5, -0.5);\n  let boxMax = vec3<f32>(0.5, 0.5, 0.5);\n  let hit = intersectBox(localOrigin, localDirection, boxMin, boxMax);\n\n  if (hit.x >= hit.y) {\n    return vec4<f32>(0.0);\n  }\n\n  var accumulated = vec4<f32>(0.0);\n  let steps = 24.0;\n  let stepSize = (hit.y - hit.x) / steps;\n\n  for (var step: u32 = 0u; step < 24u; step = step + 1u) {\n    let travel = hit.x + (stepSize * (f32(step) + 0.5));\n    let point = localOrigin + (localDirection * travel);\n    let uvw = point + vec3<f32>(0.5, 0.5, 0.5);\n    let density = textureSampleLevel(volumeTexture, volumeSampler, uvw, 0.0).r;\n    let opacity = density * 0.2;\n    let color = vec3<f32>(density * 0.35, density * 0.75, density);\n    accumulated.rgb = accumulated.rgb + ((1.0 - accumulated.a) * color * opacity);\n    accumulated.a = accumulated.a + ((1.0 - accumulated.a) * opacity);\n\n    if (accumulated.a > 0.98) {\n      break;\n    }\n  }\n\n  return accumulated;\n}\n";

// packages/renderer/src/renderer.ts
var builtInUnlitProgramId = "built-in:unlit";
var builtInTexturedUnlitProgramId = "built-in:unlit-textured";
var builtInSdfRaymarchProgramId = "built-in:sdf-raymarch";
var builtInVolumeRaymarchProgramId = "built-in:volume-raymarch";
var uniformUsage2 = 64;
var bufferCopyDstUsage2 = 8;
var maxSdfPassItems = 16;
var toBufferSource2 = (view) => {
  const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  return new Uint8Array(buffer);
};
var builtInUnlitProgram = {
  id: builtInUnlitProgramId,
  label: "Built-in Unlit",
  wgsl: built_in_forward_unlit_default,
  vertexEntryPoint: "vsMain",
  fragmentEntryPoint: "fsMain",
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [
    {
      kind: "uniform",
      binding: 0
    }
  ],
  vertexAttributes: [
    {
      semantic: "POSITION",
      shaderLocation: 0,
      format: "float32x3",
      offset: 0,
      arrayStride: 12
    }
  ]
};
var builtInTexturedUnlitProgram = {
  id: builtInTexturedUnlitProgramId,
  label: "Built-in Unlit (Textured)",
  wgsl: built_in_forward_unlit_textured_default,
  vertexEntryPoint: "vsMain",
  fragmentEntryPoint: "fsMain",
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [
    {
      kind: "uniform",
      binding: 0
    },
    {
      kind: "texture",
      binding: 1,
      textureSemantic: "baseColor"
    },
    {
      kind: "sampler",
      binding: 2,
      textureSemantic: "baseColor"
    }
  ],
  vertexAttributes: [
    {
      semantic: "POSITION",
      shaderLocation: 0,
      format: "float32x3",
      offset: 0,
      arrayStride: 12
    },
    {
      semantic: "TEXCOORD_0",
      shaderLocation: 1,
      format: "float32x2",
      offset: 0,
      arrayStride: 8
    }
  ]
};
var createVertexBufferLayouts = (attributes) => {
  const grouped = /* @__PURE__ */ new Map();
  for (const attribute of attributes) {
    grouped.set(attribute.arrayStride, [
      ...grouped.get(attribute.arrayStride) ?? [],
      attribute
    ]);
  }
  return [
    ...grouped.entries()
  ].map(([arrayStride, strideAttributes]) => ({
    arrayStride,
    attributes: strideAttributes.map((attribute) => ({
      shaderLocation: attribute.shaderLocation,
      offset: attribute.offset,
      format: attribute.format
    }))
  }));
};
var createMaterialRegistry = () => ({
  programs: /* @__PURE__ */ new Map([
    [
      builtInUnlitProgramId,
      builtInUnlitProgram
    ],
    [
      builtInTexturedUnlitProgramId,
      builtInTexturedUnlitProgram
    ]
  ])
});
var resolveMaterialProgram = (registry, material, options = {}) => {
  if (!material) {
    return registry.programs.get(builtInUnlitProgramId) ?? builtInUnlitProgram;
  }
  if (material.shaderId) {
    const customProgram = registry.programs.get(material.shaderId);
    if (!customProgram) {
      throw new Error(`material "${material.id}" references missing shader "${material.shaderId}"`);
    }
    return customProgram;
  }
  if (material.kind === "unlit") {
    if (options.preferTexturedUnlit) {
      return registry.programs.get(builtInTexturedUnlitProgramId) ?? builtInTexturedUnlitProgram;
    }
    return registry.programs.get(builtInUnlitProgramId) ?? builtInUnlitProgram;
  }
  throw new Error(`material "${material.id}" uses unsupported kind "${material.kind}"`);
};
var getBaseColorTextureResidency = (residency2, material) => {
  const textureRef = material.textures.find((texture) => texture.semantic === "baseColor");
  return textureRef ? residency2.textures.get(textureRef.id) : void 0;
};
var getMaterialTextureResidency = (residency2, material, textureSemantic) => {
  const textureRef = material.textures.find((texture) => texture.semantic === textureSemantic);
  return textureRef ? residency2.textures.get(textureRef.id) : void 0;
};
var defaultMaterialBindings = [
  {
    kind: "uniform",
    binding: 0
  }
];
var getMaterialBindingDescriptors = (program) => program.materialBindings ?? (program.usesMaterialBindings ? defaultMaterialBindings : []);
var resolveMaterialBindingResource = (context, residency2, material, descriptor, materialResidency) => {
  switch (descriptor.kind) {
    case "uniform": {
      materialResidency.current ??= ensureMaterialResidency(context, residency2, material);
      return {
        binding: descriptor.binding,
        resource: {
          buffer: materialResidency.current.uniformBuffer
        }
      };
    }
    case "texture": {
      const textureResidency = getMaterialTextureResidency(residency2, material, descriptor.textureSemantic);
      if (!textureResidency) {
        throw new Error(`material "${material.id}" is missing residency for "${descriptor.textureSemantic}" texture binding`);
      }
      return {
        binding: descriptor.binding,
        resource: textureResidency.view
      };
    }
    case "sampler": {
      const textureResidency = getMaterialTextureResidency(residency2, material, descriptor.textureSemantic);
      if (!textureResidency) {
        throw new Error(`material "${material.id}" is missing residency for "${descriptor.textureSemantic}" sampler binding`);
      }
      return {
        binding: descriptor.binding,
        resource: textureResidency.sampler
      };
    }
  }
};
var createForwardRenderer = (label = "forward") => ({
  kind: "forward",
  label,
  capabilities: {
    mesh: "supported",
    sdf: "supported",
    volume: "supported",
    builtInMaterialKinds: [
      "unlit"
    ],
    customShaders: "supported"
  },
  passes: [
    {
      id: "mesh",
      kind: "mesh",
      reads: [
        "scene"
      ],
      writes: [
        "color",
        "depth"
      ]
    },
    {
      id: "raymarch",
      kind: "raymarch",
      reads: [
        "scene",
        "depth"
      ],
      writes: [
        "color"
      ]
    },
    {
      id: "present",
      kind: "present",
      reads: [
        "color"
      ],
      writes: [
        "target"
      ]
    }
  ]
});
var collectRendererCapabilityIssues = (renderer, evaluatedScene2) => evaluatedScene2.nodes.flatMap((node) => {
  const issues = [];
  if (node.mesh && renderer.capabilities.mesh !== "supported") {
    issues.push({
      nodeId: node.node.id,
      feature: "mesh",
      message: `renderer "${renderer.label}" does not support mesh execution`
    });
  }
  if (node.sdf) {
    if (renderer.capabilities.sdf !== "supported") {
      issues.push({
        nodeId: node.node.id,
        feature: "sdf",
        message: `renderer "${renderer.label}" does not support sdf execution`
      });
    } else if (node.sdf.op !== "sphere") {
      issues.push({
        nodeId: node.node.id,
        feature: "sdf",
        message: `renderer "${renderer.label}" only supports sphere sdf primitives right now`
      });
    }
  }
  if (node.volume && renderer.capabilities.volume !== "supported") {
    issues.push({
      nodeId: node.node.id,
      feature: "volume",
      message: `renderer "${renderer.label}" does not support volume execution`
    });
  }
  if (node.material && !node.material.shaderId && !renderer.capabilities.builtInMaterialKinds.includes(node.material.kind)) {
    issues.push({
      nodeId: node.node.id,
      feature: "material-kind",
      message: `renderer "${renderer.label}" does not support built-in material kind "${node.material.kind}"`
    });
  }
  if (node.material?.shaderId && renderer.capabilities.customShaders !== "supported") {
    issues.push({
      nodeId: node.node.id,
      feature: "custom-shader",
      message: `renderer "${renderer.label}" does not support custom shader materials`
    });
  }
  return issues;
});
var assertRendererSceneCapabilities = (renderer, evaluatedScene2) => {
  const issues = collectRendererCapabilityIssues(renderer, evaluatedScene2);
  if (issues.length === 0) {
    return;
  }
  throw new Error(issues.map((issue) => `[${issue.nodeId}] ${issue.message}`).join("\n"));
};
var extractVolumePassItems = (evaluatedScene2, residency2) => evaluatedScene2.nodes.flatMap((node) => {
  if (!node.volume) {
    return [];
  }
  const volumeResidency = residency2.volumes.get(node.volume.id);
  if (!volumeResidency) {
    return [];
  }
  return [
    {
      nodeId: node.node.id,
      volumeId: node.volume.id,
      worldMatrix: node.worldMatrix,
      residency: volumeResidency
    }
  ];
});
var getMatrixTranslation = (worldMatrix) => [
  worldMatrix[12] ?? 0,
  worldMatrix[13] ?? 0,
  worldMatrix[14] ?? 0
];
var getMatrixScale = (worldMatrix) => {
  const scaleX = Math.hypot(worldMatrix[0] ?? 0, worldMatrix[1] ?? 0, worldMatrix[2] ?? 0);
  const scaleY = Math.hypot(worldMatrix[4] ?? 0, worldMatrix[5] ?? 0, worldMatrix[6] ?? 0);
  const scaleZ = Math.hypot(worldMatrix[8] ?? 0, worldMatrix[9] ?? 0, worldMatrix[10] ?? 0);
  return [
    scaleX,
    scaleY,
    scaleZ
  ];
};
var invertAffineMatrix = (worldMatrix) => {
  const m00 = worldMatrix[0] ?? 0;
  const m01 = worldMatrix[1] ?? 0;
  const m02 = worldMatrix[2] ?? 0;
  const m10 = worldMatrix[4] ?? 0;
  const m11 = worldMatrix[5] ?? 0;
  const m12 = worldMatrix[6] ?? 0;
  const m20 = worldMatrix[8] ?? 0;
  const m21 = worldMatrix[9] ?? 0;
  const m22 = worldMatrix[10] ?? 0;
  const tx = worldMatrix[12] ?? 0;
  const ty = worldMatrix[13] ?? 0;
  const tz = worldMatrix[14] ?? 0;
  const c00 = m11 * m22 - m12 * m21;
  const c01 = -(m10 * m22 - m12 * m20);
  const c02 = m10 * m21 - m11 * m20;
  const c10 = -(m01 * m22 - m02 * m21);
  const c11 = m00 * m22 - m02 * m20;
  const c12 = -(m00 * m21 - m01 * m20);
  const c20 = m01 * m12 - m02 * m11;
  const c21 = -(m00 * m12 - m02 * m10);
  const c22 = m00 * m11 - m01 * m10;
  const determinant = m00 * c00 + m01 * c01 + m02 * c02;
  if (Math.abs(determinant) < 1e-8) {
    return [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    ];
  }
  const inverseDeterminant = 1 / determinant;
  const i00 = c00 * inverseDeterminant;
  const i01 = c10 * inverseDeterminant;
  const i02 = c20 * inverseDeterminant;
  const i10 = c01 * inverseDeterminant;
  const i11 = c11 * inverseDeterminant;
  const i12 = c21 * inverseDeterminant;
  const i20 = c02 * inverseDeterminant;
  const i21 = c12 * inverseDeterminant;
  const i22 = c22 * inverseDeterminant;
  return [
    i00,
    i01,
    i02,
    0,
    i10,
    i11,
    i12,
    0,
    i20,
    i21,
    i22,
    0,
    -(i00 * tx + i10 * ty + i20 * tz),
    -(i01 * tx + i11 * ty + i21 * tz),
    -(i02 * tx + i12 * ty + i22 * tz),
    1
  ];
};
var extractSdfPassItems = (evaluatedScene2) => evaluatedScene2.nodes.flatMap((node) => {
  if (!node.sdf || node.sdf.op !== "sphere") {
    return [];
  }
  const [scaleX, scaleY, scaleZ] = getMatrixScale(node.worldMatrix);
  const averageScale = (scaleX + scaleY + scaleZ) / 3 || 1;
  const radius = (node.sdf.parameters.radius?.x ?? 0.5) * averageScale;
  const color = node.sdf.parameters.color ?? {
    x: 1,
    y: 0.55,
    z: 0.2,
    w: 1
  };
  return [
    {
      nodeId: node.node.id,
      sdfId: node.sdf.id,
      op: node.sdf.op,
      center: getMatrixTranslation(node.worldMatrix),
      radius,
      color: [
        color.x,
        color.y,
        color.z,
        color.w
      ]
    }
  ];
});
var ensureMaterialPipeline = (context, residency2, program, format) => {
  const cacheKey = `${program.id}:${format}`;
  const cached = residency2.pipelines.get(cacheKey);
  if (cached) {
    return cached;
  }
  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: program.wgsl
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: program.vertexEntryPoint,
      buffers: createVertexBufferLayouts(program.vertexAttributes)
    },
    fragment: {
      module: shader,
      entryPoint: program.fragmentEntryPoint,
      targets: [
        {
          format
        }
      ]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  residency2.pipelines.set(cacheKey, pipeline);
  return pipeline;
};
var ensureSdfRaymarchPipeline = (context, residency2, format) => {
  const cacheKey = `${builtInSdfRaymarchProgramId}:${format}`;
  const cached = residency2.pipelines.get(cacheKey);
  if (cached) {
    return cached;
  }
  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: built_in_sdf_raymarch_default
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "vsMain"
    },
    fragment: {
      module: shader,
      entryPoint: "fsMain",
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add"
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add"
            }
          }
        }
      ]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  residency2.pipelines.set(cacheKey, pipeline);
  return pipeline;
};
var ensureVolumeRaymarchPipeline = (context, residency2, format) => {
  const cacheKey = `${builtInVolumeRaymarchProgramId}:${format}`;
  const cached = residency2.pipelines.get(cacheKey);
  if (cached) {
    return cached;
  }
  const shader = context.device.createShaderModule({
    label: cacheKey,
    code: built_in_volume_raymarch_default
  });
  const pipeline = context.device.createRenderPipeline({
    label: cacheKey,
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "vsMain"
    },
    fragment: {
      module: shader,
      entryPoint: "fsMain",
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add"
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add"
            }
          }
        }
      ]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  residency2.pipelines.set(cacheKey, pipeline);
  return pipeline;
};
var createSdfUniformData = (items) => {
  const uniformData = new Float32Array(4 + maxSdfPassItems * 8);
  uniformData[0] = Math.min(items.length, maxSdfPassItems);
  items.slice(0, maxSdfPassItems).forEach((item, index) => {
    const offset = 4 + index * 8;
    uniformData.set([
      ...item.center,
      item.radius
    ], offset);
    uniformData.set(item.color, offset + 4);
  });
  return uniformData;
};
var createVolumeUniformData = (item) => {
  return Float32Array.from(invertAffineMatrix(item.worldMatrix));
};
var createMeshTransformUniformData = (worldMatrix) => Float32Array.from(worldMatrix.slice(0, 16));
var renderSdfRaymarchPass = (context, encoder, binding, residency2, evaluatedScene2) => {
  const items = extractSdfPassItems(evaluatedScene2);
  if (items.length === 0) {
    return 0;
  }
  const pipeline = ensureSdfRaymarchPipeline(context, residency2, binding.target.format);
  const uniformData = createSdfUniformData(items);
  const uniformBuffer = context.device.createBuffer({
    label: "sdf-raymarch-uniforms",
    size: uniformData.byteLength,
    usage: uniformUsage2 | bufferCopyDstUsage2
  });
  context.queue.writeBuffer(uniformBuffer, 0, toBufferSource2(uniformData));
  const bindGroup = context.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer
        }
      }
    ]
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: acquireColorAttachmentView(binding),
        loadOp: "load",
        storeOp: "store"
      }
    ]
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
  return 1;
};
var renderVolumeRaymarchPass = (context, encoder, binding, residency2, evaluatedScene2) => {
  const items = extractVolumePassItems(evaluatedScene2, residency2);
  if (items.length === 0) {
    return 0;
  }
  const pipeline = ensureVolumeRaymarchPipeline(context, residency2, binding.target.format);
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: acquireColorAttachmentView(binding),
        loadOp: "load",
        storeOp: "store"
      }
    ]
  });
  pass.setPipeline(pipeline);
  for (const item of items) {
    const uniformData = createVolumeUniformData(item);
    const uniformBuffer = context.device.createBuffer({
      label: `${item.nodeId}:volume-raymarch-uniforms`,
      size: uniformData.byteLength,
      usage: uniformUsage2 | bufferCopyDstUsage2
    });
    context.queue.writeBuffer(uniformBuffer, 0, toBufferSource2(uniformData));
    const bindGroup = context.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer
          }
        },
        {
          binding: 1,
          resource: item.residency.view
        },
        {
          binding: 2,
          resource: item.residency.sampler
        }
      ]
    });
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
  }
  pass.end();
  return items.length;
};
var createDefaultMaterial = () => ({
  id: "built-in:default-unlit-material",
  kind: "unlit",
  textures: [],
  parameters: {
    color: {
      x: 0.95,
      y: 0.95,
      z: 0.95,
      w: 1
    }
  }
});
var renderForwardFrame = (context, binding, residency2, evaluatedScene2, materialRegistry2 = createMaterialRegistry()) => {
  assertRendererSceneCapabilities(createForwardRenderer(), evaluatedScene2);
  const view = acquireColorAttachmentView(binding);
  const encoder = context.device.createCommandEncoder({
    label: "forward-frame"
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view,
        clearValue: {
          r: 0.02,
          g: 0.02,
          b: 0.03,
          a: 1
        },
        loadOp: "clear",
        storeOp: "store"
      }
    ]
  });
  let drawCount = 0;
  for (const node of evaluatedScene2.nodes) {
    const mesh = node.mesh;
    if (!mesh) {
      continue;
    }
    const geometry = residency2.geometry.get(mesh.id);
    if (!geometry) {
      continue;
    }
    const material = node.material ?? createDefaultMaterial();
    const baseColorTexture = getBaseColorTextureResidency(residency2, material);
    const resolvedProgram = resolveMaterialProgram(materialRegistry2, node.material);
    const preferTexturedUnlit = resolvedProgram.id === builtInUnlitProgramId && Boolean(baseColorTexture) && Boolean(geometry.attributeBuffers.TEXCOORD_0);
    const program = preferTexturedUnlit ? resolveMaterialProgram(materialRegistry2, node.material, {
      preferTexturedUnlit: true
    }) : resolvedProgram;
    const pipeline = ensureMaterialPipeline(context, residency2, program, binding.target.format);
    let isDrawable = true;
    for (let index = 0; index < program.vertexAttributes.length; index += 1) {
      const attribute = program.vertexAttributes[index];
      if (attribute.offset !== 0) {
        isDrawable = false;
        break;
      }
      const buffer = geometry.attributeBuffers[attribute.semantic];
      if (!buffer) {
        isDrawable = false;
        break;
      }
      pass.setVertexBuffer(index, buffer);
    }
    if (!isDrawable) {
      continue;
    }
    pass.setPipeline(pipeline);
    if (program.usesTransformBindings) {
      const transformData = createMeshTransformUniformData(node.worldMatrix);
      const transformBuffer = context.device.createBuffer({
        label: `${node.node.id}:mesh-transform`,
        size: transformData.byteLength,
        usage: uniformUsage2 | bufferCopyDstUsage2
      });
      context.queue.writeBuffer(transformBuffer, 0, toBufferSource2(transformData));
      const transformBindGroup = context.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: transformBuffer
            }
          }
        ]
      });
      pass.setBindGroup(0, transformBindGroup);
    }
    const materialBindings = getMaterialBindingDescriptors(program);
    if (materialBindings.length > 0) {
      const materialBindGroupIndex = program.usesTransformBindings ? 1 : 0;
      const materialResidency = {
        current: void 0
      };
      const bindGroup = context.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(materialBindGroupIndex),
        entries: materialBindings.map((descriptor) => resolveMaterialBindingResource(context, residency2, material, descriptor, materialResidency))
      });
      pass.setBindGroup(materialBindGroupIndex, bindGroup);
    }
    if (geometry.indexBuffer && geometry.indexCount > 0) {
      pass.setIndexBuffer(geometry.indexBuffer, "uint32");
      pass.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
    } else {
      pass.draw(geometry.vertexCount, 1, 0, 0);
    }
    drawCount += 1;
  }
  pass.end();
  drawCount += renderSdfRaymarchPass(context, encoder, binding, residency2, evaluatedScene2);
  drawCount += renderVolumeRaymarchPass(context, encoder, binding, residency2, evaluatedScene2);
  const commandBuffer = encoder.finish();
  context.queue.submit([
    commandBuffer
  ]);
  return {
    drawCount,
    submittedCommandBufferCount: 1
  };
};

// examples/browser/textured_forward/main.ts
var canvas = document.querySelector("#app");
if (!canvas) {
  throw new Error("Missing #app canvas");
}
canvas.width = 640;
canvas.height = 480;
var textureAssetId = "checkerboard-image";
var textureId = "checkerboard-texture";
var materialId = "checkerboard-material";
var meshId = "textured-quad";
var scene = appendNode(appendMesh(appendMaterial(appendTexture(createSceneIr("browser-forward-textured"), {
  id: textureId,
  assetId: textureAssetId,
  semantic: "baseColor",
  colorSpace: "srgb",
  sampler: "nearest-repeat"
}), {
  id: materialId,
  kind: "unlit",
  textures: [
    {
      id: textureId,
      assetId: textureAssetId,
      semantic: "baseColor",
      colorSpace: "srgb",
      sampler: "nearest-repeat"
    }
  ],
  parameters: {
    color: {
      x: 1,
      y: 1,
      z: 1,
      w: 1
    }
  }
}), {
  id: meshId,
  materialId,
  attributes: [
    {
      semantic: "POSITION",
      itemSize: 3,
      values: [
        -0.7,
        0.7,
        0,
        -0.7,
        -0.7,
        0,
        0.7,
        -0.7,
        0,
        0.7,
        0.7,
        0
      ]
    },
    {
      semantic: "TEXCOORD_0",
      itemSize: 2,
      values: [
        0,
        0,
        0,
        1,
        1,
        1,
        1,
        0
      ]
    }
  ],
  indices: [
    0,
    1,
    2,
    0,
    2,
    3
  ]
}), createNode("textured-quad-node", {
  meshId
}));
var assetSource = {
  images: /* @__PURE__ */ new Map([
    [
      textureAssetId,
      {
        id: textureAssetId,
        mimeType: "image/raw-rgba",
        width: 2,
        height: 2,
        pixelFormat: "rgba8unorm",
        bytes: Uint8Array.from([
          255,
          96,
          64,
          255,
          255,
          230,
          92,
          255,
          44,
          112,
          255,
          255,
          28,
          28,
          40,
          255
        ])
      }
    ]
  ]),
  volumes: /* @__PURE__ */ new Map()
};
var target = createBrowserSurfaceTarget(canvas.width, canvas.height);
var gpuContext = await requestGpuContext({
  target
});
var canvasContext = canvas.getContext("webgpu");
if (!canvasContext) {
  throw new Error("Failed to acquire WebGPU canvas context");
}
var surface = configureSurfaceContext(gpuContext, canvasContext);
var residency = createRuntimeResidency();
var materialRegistry = createMaterialRegistry();
var evaluatedScene = evaluateScene(scene, {
  timeMs: 0
});
ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);
ensureSceneTextureResidency(gpuContext, residency, scene, assetSource);
var drawFrame = () => {
  renderForwardFrame(gpuContext, surface, residency, evaluatedScene, materialRegistry);
  requestAnimationFrame(drawFrame);
};
requestAnimationFrame(drawFrame);
