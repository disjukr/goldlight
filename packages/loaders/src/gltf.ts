import {
  appendAnimationClip,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createSceneIr,
} from '@rieul3d/ir';
import type { AnimationClip, MeshAttribute, SceneIr } from '@rieul3d/ir';

export type GltfLike = Readonly<{
  asset?: { version?: string };
  images?: readonly { uri?: string; mimeType?: string; name?: string }[];
  textures?: readonly { source?: number }[];
  materials?: readonly { name?: string }[];
  meshes?: readonly {
    name?: string;
    primitives: readonly {
      attributes?: Record<string, readonly number[]>;
      indices?: readonly number[];
      material?: number;
    }[];
  }[];
  nodes?: readonly {
    name?: string;
    mesh?: number;
    translation?: readonly number[];
    rotation?: readonly number[];
    scale?: readonly number[];
  }[];
  scenes?: readonly { nodes?: readonly number[] }[];
  scene?: number;
  animations?: readonly {
    name?: string;
    channels?: readonly {
      node: number;
      path: 'translation' | 'rotation' | 'scale';
      times: readonly number[];
      values: readonly (readonly number[])[];
    }[];
  }[];
}>;

export const loadGltfFromJson = (gltf: GltfLike, sceneId = 'gltf-scene'): SceneIr => {
  let scene = createSceneIr(sceneId);

  for (const [imageIndex, image] of (gltf.images ?? []).entries()) {
    scene = {
      ...scene,
      assets: [
        ...scene.assets,
        {
          id: `${sceneId}-image-${imageIndex}`,
          uri: image.uri,
          mimeType: image.mimeType,
        },
      ],
    };
  }

  for (const [textureIndex, texture] of (gltf.textures ?? []).entries()) {
    scene = appendTexture(scene, {
      id: `${sceneId}-texture-${textureIndex}`,
      assetId: texture.source !== undefined ? `${sceneId}-image-${texture.source}` : undefined,
      semantic: 'generic',
      colorSpace: 'srgb',
      sampler: 'linear-repeat',
    });
  }

  for (const [materialIndex] of (gltf.materials ?? []).entries()) {
    scene = {
      ...scene,
      materials: [
        ...scene.materials,
        {
          id: `${sceneId}-material-${materialIndex}`,
          kind: 'pbr',
          textures: [],
          parameters: {},
        },
      ],
    };
  }

  for (const [meshIndex, mesh] of (gltf.meshes ?? []).entries()) {
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      const attributes: MeshAttribute[] = Object.entries(primitive.attributes ?? {}).map(
        ([semantic, values]) => ({
          semantic,
          itemSize: semantic === 'TEXCOORD_0' ? 2 : 3,
          values: [...values],
        }),
      );

      scene = appendMesh(scene, {
        id: `${sceneId}-mesh-${meshIndex}-${primitiveIndex}`,
        attributes,
        indices: primitive.indices ? [...primitive.indices] : undefined,
        materialId: primitive.material !== undefined
          ? `${sceneId}-material-${primitive.material}`
          : undefined,
      });
    }
  }

  for (const [nodeIndex, node] of (gltf.nodes ?? []).entries()) {
    scene = appendNode(
      scene,
      createNode(`${sceneId}-node-${nodeIndex}`, {
        name: node.name,
        meshId: node.mesh !== undefined ? `${sceneId}-mesh-${node.mesh}-0` : undefined,
        transform: {
          translation: {
            x: node.translation?.[0] ?? 0,
            y: node.translation?.[1] ?? 0,
            z: node.translation?.[2] ?? 0,
          },
          rotation: {
            x: node.rotation?.[0] ?? 0,
            y: node.rotation?.[1] ?? 0,
            z: node.rotation?.[2] ?? 0,
            w: node.rotation?.[3] ?? 1,
          },
          scale: {
            x: node.scale?.[0] ?? 1,
            y: node.scale?.[1] ?? 1,
            z: node.scale?.[2] ?? 1,
          },
        },
      }),
    );
  }

  scene = {
    ...scene,
    rootNodeIds: (gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []).map(
      (nodeIndex) => `${sceneId}-node-${nodeIndex}`,
    ),
  };

  for (const [animationIndex, animation] of (gltf.animations ?? []).entries()) {
    const channels = (animation.channels ?? []).map((channel) => ({
      nodeId: `${sceneId}-node-${channel.node}`,
      property: channel.path,
      keyframes: channel.times.map((time, keyframeIndex) => {
        const value = channel.values[keyframeIndex];
        return {
          timeMs: time * 1000,
          value: {
            x: value?.[0] ?? 0,
            y: value?.[1] ?? 0,
            z: value?.[2] ?? 0,
            w: value?.[3] ?? (channel.path === 'rotation' ? 1 : 0),
          },
        };
      }),
    })) as AnimationClip['channels'];

    scene = appendAnimationClip(scene, {
      id: `${sceneId}-animation-${animationIndex}`,
      name: animation.name,
      durationMs: Math.max(
        0,
        ...channels.flatMap((channel) => channel.keyframes.map((keyframe) => keyframe.timeMs)),
      ),
      channels,
    });
  }

  return scene;
};
