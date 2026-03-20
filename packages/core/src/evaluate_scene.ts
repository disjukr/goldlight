import type {
  AnimationChannel,
  Camera,
  Light,
  Material,
  MeshPrimitive,
  Node,
  SceneIr,
} from '@rieul3d/ir';

export type Mat4 = readonly number[];

export type EvaluatedNode = Readonly<{
  node: Node;
  worldMatrix: Mat4;
  mesh?: MeshPrimitive;
  material?: Material;
  light?: Light;
}>;

export type EvaluatedCamera = Readonly<{
  camera: Camera;
  node?: Node;
  worldMatrix: Mat4;
  viewMatrix: Mat4;
}>;

export type EvaluatedScene = Readonly<{
  sceneId: string;
  timeMs: number;
  nodes: readonly EvaluatedNode[];
  activeCamera?: EvaluatedCamera;
}>;

export type EvaluateSceneOptions = Readonly<{
  timeMs: number;
  clipId?: string;
}>;

const multiplyMat4 = (a: Mat4, b: Mat4): Mat4 => {
  const out = new Array<number>(16).fill(0);

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const index = (col * 4) + row;
      out[index] = a[row] * b[col * 4] +
        a[4 + row] * b[(col * 4) + 1] +
        a[8 + row] * b[(col * 4) + 2] +
        a[12 + row] * b[(col * 4) + 3];
    }
  }

  return out;
};

const identityMat4 = (): Mat4 => [
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
  1,
];

const transformToMatrix = (node: Node): Mat4 => {
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
    (2 * (xy + wz)) * scale.x,
    (2 * (xz - wy)) * scale.x,
    0,
    (2 * (xy - wz)) * scale.y,
    (1 - 2 * (xx + zz)) * scale.y,
    (2 * (yz + wx)) * scale.y,
    0,
    (2 * (xz + wy)) * scale.z,
    (2 * (yz - wx)) * scale.z,
    (1 - 2 * (xx + yy)) * scale.z,
    0,
    translation.x,
    translation.y,
    translation.z,
    1,
  ];
};

const invertAffineMatrix = (worldMatrix: readonly number[]): Mat4 => {
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

  const c00 = (m11 * m22) - (m12 * m21);
  const c01 = -((m10 * m22) - (m12 * m20));
  const c02 = (m10 * m21) - (m11 * m20);
  const c10 = -((m01 * m22) - (m02 * m21));
  const c11 = (m00 * m22) - (m02 * m20);
  const c12 = -((m00 * m21) - (m01 * m20));
  const c20 = (m01 * m12) - (m02 * m11);
  const c21 = -((m00 * m12) - (m02 * m10));
  const c22 = (m00 * m11) - (m01 * m10);
  const determinant = (m00 * c00) + (m01 * c01) + (m02 * c02);

  if (Math.abs(determinant) < 1e-8) {
    return identityMat4();
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
    -((i00 * tx) + (i10 * ty) + (i20 * tz)),
    -((i01 * tx) + (i11 * ty) + (i21 * tz)),
    -((i02 * tx) + (i12 * ty) + (i22 * tz)),
    1,
  ];
};

const sampleChannel = (channel: AnimationChannel, timeMs: number) => {
  if (channel.keyframes.length === 0) return undefined;
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
      w: current.value.w + (next.value.w - current.value.w) * alpha,
    };
  }

  return channel.keyframes[channel.keyframes.length - 1].value;
};

const applyAnimation = (scene: SceneIr, options: EvaluateSceneOptions): readonly Node[] => {
  if (!options.clipId) return scene.nodes;
  const clip = scene.animationClips.find((candidate) => candidate.id === options.clipId);
  if (!clip) return scene.nodes;

  const channelsByNode = new Map<string, readonly AnimationChannel[]>();
  for (const channel of clip.channels) {
    channelsByNode.set(channel.nodeId, [...(channelsByNode.get(channel.nodeId) ?? []), channel]);
  }

  return scene.nodes.map((node) => {
    const channels = channelsByNode.get(node.id);
    if (!channels) return node;

    let nextNode = node;
    for (const channel of channels) {
      const sampled = sampleChannel(channel, options.timeMs);
      if (!sampled) continue;
      if (channel.property === 'translation') {
        nextNode = {
          ...nextNode,
          transform: {
            ...nextNode.transform,
            translation: { x: sampled.x, y: sampled.y, z: sampled.z },
          },
        };
      } else if (channel.property === 'scale') {
        nextNode = {
          ...nextNode,
          transform: {
            ...nextNode.transform,
            scale: { x: sampled.x, y: sampled.y, z: sampled.z },
          },
        };
      } else {
        nextNode = {
          ...nextNode,
          transform: {
            ...nextNode.transform,
            rotation: sampled,
          },
        };
      }
    }
    return nextNode;
  });
};

export const evaluateScene = (scene: SceneIr, options: EvaluateSceneOptions): EvaluatedScene => {
  const nodes = applyAnimation(scene, options);
  const meshById = new Map(scene.meshes.map((mesh) => [mesh.id, mesh]));
  const materialById = new Map(scene.materials.map((material) => [material.id, material]));
  const lightById = new Map(scene.lights.map((light) => [light.id, light]));
  return evaluateResolvedScene(
    scene,
    nodes,
    options,
    meshById,
    materialById,
    lightById,
  );
};

const evaluateResolvedScene = (
  scene: SceneIr,
  nodes: readonly Node[],
  options: EvaluateSceneOptions,
  meshById: ReadonlyMap<string, MeshPrimitive>,
  materialById: ReadonlyMap<string, Material>,
  lightById: ReadonlyMap<string, Light>,
): EvaluatedScene => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const worldById = new Map<string, Mat4>();

  const getWorldMatrix = (node: Node): Mat4 => {
    const cached = worldById.get(node.id);
    if (cached) return cached;
    const local = transformToMatrix(node);
    const world = node.parentId
      ? multiplyMat4(getWorldMatrix(nodeById.get(node.parentId)!), local)
      : local;
    worldById.set(node.id, world);
    return world;
  };

  const activeCamera = (() => {
    const camera = scene.activeCameraId
      ? scene.cameras.find((candidate) => candidate.id === scene.activeCameraId)
      : undefined;
    if (!camera) {
      return undefined;
    }

    const cameraNode = nodes.find((node) => node.cameraId === camera.id);
    const worldMatrix = cameraNode ? getWorldMatrix(cameraNode) : identityMat4();

    return {
      camera,
      node: cameraNode,
      worldMatrix,
      viewMatrix: invertAffineMatrix(worldMatrix),
    };
  })();

  return {
    sceneId: scene.id,
    timeMs: options.timeMs,
    activeCamera,
    nodes: nodes.map((node) => {
      const mesh = node.meshId ? meshById.get(node.meshId) : undefined;
      return {
        node,
        worldMatrix: getWorldMatrix(node),
        mesh,
        material: mesh?.materialId ? materialById.get(mesh.materialId) : undefined,
        light: node.lightId ? lightById.get(node.lightId) : undefined,
      };
    }),
  };
};

export const reevaluateSceneTransforms = (
  scene: SceneIr,
  previousEvaluatedScene: EvaluatedScene,
  options: EvaluateSceneOptions,
): EvaluatedScene => {
  const nodes = applyAnimation(scene, options);
  const previousByNodeId = new Map(
    previousEvaluatedScene.nodes.map((entry) => [entry.node.id, entry]),
  );
  const meshById = new Map(scene.meshes.map((mesh) => [mesh.id, mesh]));
  const materialById = new Map(scene.materials.map((material) => [material.id, material]));
  const lightById = new Map(scene.lights.map((light) => [light.id, light]));

  for (const node of nodes) {
    const previous = previousByNodeId.get(node.id);
    if (!previous) {
      return evaluateScene(scene, options);
    }
    if (
      previous.node.parentId !== node.parentId ||
      previous.node.meshId !== node.meshId ||
      previous.node.cameraId !== node.cameraId ||
      previous.node.lightId !== node.lightId
    ) {
      return evaluateScene(scene, options);
    }
  }

  return evaluateResolvedScene(
    scene,
    nodes,
    options,
    meshById,
    materialById,
    lightById,
  );
};

export const createScratchMatrixBuffer = (size: number): Float32Array =>
  new Float32Array(size * 16);

export const writeEvaluatedSceneMatrices = (
  evaluatedScene: EvaluatedScene,
  target: Float32Array,
): Float32Array => {
  for (let index = 0; index < evaluatedScene.nodes.length; index += 1) {
    target.set(evaluatedScene.nodes[index].worldMatrix, index * 16);
  }
  return target;
};
