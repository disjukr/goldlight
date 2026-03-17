import type {
  AnimationClip,
  Camera,
  CameraOrthographic,
  CameraPerspective,
  Light,
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
  lights: [],
  meshes: [],
  cameras: [],
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

export const appendCamera = (scene: SceneIr, camera: Camera): SceneIr => ({
  ...scene,
  cameras: [...scene.cameras, camera],
});

export const setActiveCamera = (scene: SceneIr, cameraId: string): SceneIr => ({
  ...scene,
  activeCameraId: cameraId,
});

export const createPerspectiveCamera = (
  id: string,
  partial: Partial<Omit<CameraPerspective, 'type' | 'id' | 'znear' | 'zfar'>> & {
    znear?: number;
    zfar?: number;
  } = {},
): Camera => ({
  type: 'perspective',
  id,
  yfov: partial.yfov ?? Math.PI / 3,
  znear: partial.znear ?? 0.1,
  zfar: partial.zfar ?? 100,
});

export const createOrthographicCamera = (
  id: string,
  partial:
    & Partial<Omit<CameraOrthographic, 'type' | 'id' | 'xmag' | 'ymag' | 'znear' | 'zfar'>>
    & {
      xmag?: number;
      ymag?: number;
      znear?: number;
      zfar?: number;
    } = {},
): Camera => ({
  type: 'orthographic',
  id,
  xmag: partial.xmag ?? 1,
  ymag: partial.ymag ?? 1,
  znear: partial.znear ?? 0,
  zfar: partial.zfar ?? 100,
});

export const appendTexture = (scene: SceneIr, texture: TextureRef): SceneIr => ({
  ...scene,
  textures: [...scene.textures, texture],
});

export const appendMaterial = (scene: SceneIr, material: Material): SceneIr => ({
  ...scene,
  materials: [...scene.materials, material],
});

export const appendLight = (scene: SceneIr, light: Light): SceneIr => ({
  ...scene,
  lights: [...scene.lights, light],
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
  const lightIds = new Set(scene.lights.map((light) => light.id));

  for (const rootNodeId of scene.rootNodeIds) {
    if (!nodeIds.has(rootNodeId)) {
      issues.push(`root node "${rootNodeId}" does not exist`);
    }
  }

  for (const node of scene.nodes) {
    if (node.parentId && !nodeIds.has(node.parentId)) {
      issues.push(`node "${node.id}" references missing parent "${node.parentId}"`);
    }
    if (node.lightId && !lightIds.has(node.lightId)) {
      issues.push(`node "${node.id}" references missing light "${node.lightId}"`);
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
};
