import type {
  AnimationChannel,
  Material,
  MeshPrimitive,
  Node,
  SceneIr,
  SdfPrimitive,
  VolumePrimitive,
} from '@rieul3d/ir';

export type Mat4 = readonly number[];

export type EvaluatedNode = Readonly<{
  node: Node;
  worldMatrix: Mat4;
  mesh?: MeshPrimitive;
  material?: Material;
  sdf?: SdfPrimitive;
  volume?: VolumePrimitive;
}>;

export type EvaluatedScene = Readonly<{
  sceneId: string;
  timeMs: number;
  nodes: readonly EvaluatedNode[];
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

  return {
    sceneId: scene.id,
    timeMs: options.timeMs,
    nodes: nodes.map((node) => ({
      node,
      worldMatrix: getWorldMatrix(node),
      mesh: node.meshId ? scene.meshes.find((mesh) => mesh.id === node.meshId) : undefined,
      material: node.meshId
        ? (() => {
          const mesh = scene.meshes.find((candidate) => candidate.id === node.meshId);
          return mesh?.materialId
            ? scene.materials.find((material) => material.id === mesh.materialId)
            : undefined;
        })()
        : undefined,
      sdf: node.sdfId
        ? scene.sdfPrimitives.find((primitive) => primitive.id === node.sdfId)
        : undefined,
      volume: node.volumeId
        ? scene.volumePrimitives.find((primitive) => primitive.id === node.volumeId)
        : undefined,
    })),
  };
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
