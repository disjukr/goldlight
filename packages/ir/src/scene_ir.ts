import type {
  AnimationClip,
  Material,
  MeshPrimitive,
  Node,
  SceneIr,
  TextureRef,
  Transform,
  Vec3,
} from './generated/scene_ir.generated.ts';

export const createVec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const identityTransform = (): Transform => ({
  translation: createVec3(0, 0, 0),
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: createVec3(1, 1, 1),
});

export const createSceneIr = (id = 'scene'): SceneIr => ({
  id,
  assets: [],
  textures: [],
  materials: [],
  meshes: [],
  sdfPrimitives: [],
  volumePrimitives: [],
  nodes: [],
  rootNodeIds: [],
  animationClips: [],
});

export const createNode = (
  id: string,
  partial: Partial<Omit<Node, 'id' | 'transform'>> & { transform?: Transform } = {},
): Node => ({
  id,
  transform: partial.transform ?? identityTransform(),
  ...partial,
});

export const appendNode = (scene: SceneIr, node: Node): SceneIr => ({
  ...scene,
  nodes: [...scene.nodes, node],
  rootNodeIds: node.parentId ? scene.rootNodeIds : [...scene.rootNodeIds, node.id],
});

export const appendMesh = (scene: SceneIr, mesh: MeshPrimitive): SceneIr => ({
  ...scene,
  meshes: [...scene.meshes, mesh],
});

export const appendTexture = (scene: SceneIr, texture: TextureRef): SceneIr => ({
  ...scene,
  textures: [...scene.textures, texture],
});

export const appendMaterial = (scene: SceneIr, material: Material): SceneIr => ({
  ...scene,
  materials: [...scene.materials, material],
});

export const appendAnimationClip = (scene: SceneIr, clip: AnimationClip): SceneIr => ({
  ...scene,
  animationClips: [...scene.animationClips, clip],
});

export const validateSceneIr = (
  scene: SceneIr,
): { ok: true } | { ok: false; issues: string[] } => {
  const issues: string[] = [];
  const nodeIds = new Set(scene.nodes.map((node) => node.id));

  for (const rootNodeId of scene.rootNodeIds) {
    if (!nodeIds.has(rootNodeId)) {
      issues.push(`root node "${rootNodeId}" does not exist`);
    }
  }

  for (const node of scene.nodes) {
    if (node.parentId && !nodeIds.has(node.parentId)) {
      issues.push(`node "${node.id}" references missing parent "${node.parentId}"`);
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
};
