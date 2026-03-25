import {
  createOrthographicCamera,
  createPerspectiveCamera,
  identityTransform,
} from '@goldlight/ir';
import type {
  AnimationClip,
  AssetRef,
  Camera,
  CameraOrthographic,
  CameraPerspective,
  Light,
  Material,
  MeshPrimitive,
  Node,
  Quat,
  SceneIr,
  TextureRef,
  Transform,
  Vec3,
} from '@goldlight/ir';
import {
  applyG3dSceneDocumentScene,
  createG3dSceneDocument,
  type G3dSceneDocument,
  g3dSceneDocumentToSceneIr,
  removeG3dSceneDocumentNode,
  removeG3dSceneDocumentResource,
  upsertG3dSceneDocumentNode,
  upsertG3dSceneDocumentResource,
} from './scene_document.ts';

type Vec3Like = Vec3 | readonly [number, number, number];
type QuatLike = Quat | readonly [number, number, number, number];

export type SceneAuthoringProps = Readonly<{
  activeCameraId?: SceneIr['activeCameraId'];
  clearColor?: readonly [number, number, number, number];
}>;
export type FragmentAuthoringProps = Readonly<Record<string, never>>;

export type NodeAuthoringProps = Readonly<{
  name?: Node['name'];
  meshId?: Node['meshId'];
  cameraId?: Node['cameraId'];
  lightId?: Node['lightId'];
  transform?: Transform;
  position?: Vec3Like;
  rotation?: QuatLike;
  scale?: Vec3Like;
}>;

export type AssetJsxProps = AssetRef;
export type TextureJsxProps = TextureRef;
export type MaterialJsxProps = Material;
export type LightJsxProps = Light;
export type MeshJsxProps = MeshPrimitive;
export type AnimationClipJsxProps = AnimationClip;
export type CameraJsxProps =
  | Readonly<
    {
      id: string;
      type: 'perspective';
    } & Partial<Omit<CameraPerspective, 'id' | 'type'>>
  >
  | Readonly<
    {
      id: string;
      type: 'orthographic';
    } & Partial<Omit<CameraOrthographic, 'id' | 'type'>>
  >;
type AssetAuthoringProps = Readonly<Omit<AssetRef, 'id'>>;
type TextureAuthoringProps = Readonly<Omit<TextureRef, 'id'>>;
type MaterialAuthoringProps = Readonly<Omit<Material, 'id'>>;
type LightAuthoringProps = Readonly<Omit<Light, 'id'>>;
type MeshAuthoringProps = Readonly<Omit<MeshPrimitive, 'id'>>;
type AnimationClipAuthoringProps = Readonly<Omit<AnimationClip, 'id'>>;
type CameraAuthoringProps =
  | Readonly<
    {
      type: 'perspective';
    } & Partial<Omit<CameraPerspective, 'id' | 'type'>>
  >
  | Readonly<
    {
      type: 'orthographic';
    } & Partial<Omit<CameraOrthographic, 'id' | 'type'>>
  >;

type AuthoringPropsByType = {
  scene: SceneAuthoringProps;
  node: NodeAuthoringProps;
  fragment: FragmentAuthoringProps;
  asset: AssetJsxProps;
  texture: TextureJsxProps;
  material: MaterialJsxProps;
  light: LightJsxProps;
  mesh: MeshJsxProps;
  animationClip: AnimationClipJsxProps;
  camera: CameraJsxProps;
};

export type AuthoringElement<
  TType extends keyof AuthoringPropsByType = keyof AuthoringPropsByType,
> = Readonly<{
  type: TType;
  id: string;
  props?: AuthoringPropsByType[TType];
  children?: readonly AuthoringElement[];
}>;

export type AuthoringRenderable =
  | AuthoringElement
  | readonly AuthoringRenderable[]
  | null
  | undefined
  | boolean;

export type SceneJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & SceneAuthoringProps
>;
export type G3dSceneJsxProps = SceneJsxProps;
export type GroupJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & NodeAuthoringProps
>;
export type G3dGroupJsxProps = GroupJsxProps;

export type NodeJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & NodeAuthoringProps
>;
export type G3dNodeJsxProps = NodeJsxProps;
type SceneObjectAliasNodeProps = Readonly<{
  nodeId?: string;
  name?: Node['name'];
  transform?: Transform;
  position?: Vec3Like;
  rotation?: QuatLike;
  scale?: Vec3Like;
}>;
export type PerspectiveCameraJsxProps = Readonly<
  & {
    id: string;
    children?: AuthoringRenderable;
  }
  & Partial<Omit<CameraPerspective, 'id' | 'type'>>
  & SceneObjectAliasNodeProps
>;
export type OrthographicCameraJsxProps = Readonly<
  & {
    id: string;
    children?: AuthoringRenderable;
  }
  & Partial<Omit<CameraOrthographic, 'id' | 'type'>>
  & SceneObjectAliasNodeProps
>;
export type DirectionalLightJsxProps = Readonly<
  & {
    id: string;
    children?: AuthoringRenderable;
  }
  & Omit<Light, 'id' | 'kind'>
  & SceneObjectAliasNodeProps
>;
export type G3dPerspectiveCameraProps = PerspectiveCameraJsxProps;
export type G3dOrthographicCameraProps = OrthographicCameraJsxProps;
export type G3dDirectionalLightProps = DirectionalLightJsxProps;
export type G3dAssetJsxProps = AssetJsxProps;
export type G3dTextureJsxProps = TextureJsxProps;
export type G3dMaterialJsxProps = MaterialJsxProps;
export type G3dLightJsxProps = LightJsxProps;
export type G3dMeshJsxProps = MeshJsxProps;
export type G3dAnimationClipJsxProps = AnimationClipJsxProps;
export type G3dCameraJsxProps = CameraJsxProps;

type AuthoringComponent<Props> = (
  props: Props & {
    children?: AuthoringRenderable;
  },
) => AuthoringRenderable;

export const Fragment = (
  props: Readonly<{
    children?: AuthoringRenderable;
  }>,
): AuthoringElement<'fragment'> =>
  createAuthoringElement(
    'fragment',
    '__fragment',
    {},
    flattenAuthoringChildren(props.children),
  );

export function createAuthoringElement(
  type: 'scene',
  id: string,
  props?: SceneAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'scene'>;
export function createAuthoringElement(
  type: 'node',
  id: string,
  props?: NodeAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'node'>;
export function createAuthoringElement(
  type: 'fragment',
  id: string,
  props?: FragmentAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'fragment'>;
export function createAuthoringElement(
  type: 'asset',
  id: string,
  props?: AssetAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'asset'>;
export function createAuthoringElement(
  type: 'texture',
  id: string,
  props?: TextureAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'texture'>;
export function createAuthoringElement(
  type: 'material',
  id: string,
  props?: MaterialAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'material'>;
export function createAuthoringElement(
  type: 'light',
  id: string,
  props?: LightAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'light'>;
export function createAuthoringElement(
  type: 'mesh',
  id: string,
  props?: MeshAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'mesh'>;
export function createAuthoringElement(
  type: 'animationClip',
  id: string,
  props?: AnimationClipAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'animationClip'>;
export function createAuthoringElement(
  type: 'camera',
  id: string,
  props?: CameraAuthoringProps,
  children?: readonly AuthoringElement[],
): AuthoringElement<'camera'>;
export function createAuthoringElement(
  type: keyof AuthoringPropsByType,
  id: string,
  props:
    | SceneAuthoringProps
    | NodeAuthoringProps
    | FragmentAuthoringProps
    | AssetAuthoringProps
    | TextureAuthoringProps
    | MaterialAuthoringProps
    | LightAuthoringProps
    | MeshAuthoringProps
    | AnimationClipAuthoringProps
    | CameraAuthoringProps = {},
  children: readonly AuthoringElement[] = [],
): AuthoringElement {
  const normalizedProps = type === 'node' ? normalizeNodeProps(props as NodeAuthoringProps) : (
      type === 'asset' || type === 'texture' || type === 'material' || type === 'light' ||
      type === 'mesh' || type === 'animationClip' || type === 'camera'
    )
    ? { id, ...props }
    : props;

  return {
    type,
    id,
    props: normalizedProps as AuthoringElement['props'],
    children,
  };
}

const isAuthoringElement = (value: AuthoringRenderable): value is AuthoringElement =>
  !Array.isArray(value) &&
  value != null &&
  value !== false &&
  value !== true &&
  typeof value === 'object' &&
  'type' in value &&
  'id' in value;

const flattenAuthoringChildren = (value: AuthoringRenderable): readonly AuthoringElement[] => {
  if (value == null || value === false || value === true) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenAuthoringChildren(entry));
  }
  return isAuthoringElement(value) ? [value] : [];
};

const normalizeRenderable = (
  renderable: AuthoringRenderable,
  fallbackId = '__fragment',
): AuthoringElement => {
  if (
    Array.isArray(renderable) || renderable == null || renderable === false || renderable === true
  ) {
    return createAuthoringElement(
      'fragment',
      fallbackId,
      {},
      flattenAuthoringChildren(renderable),
    );
  }
  if (isAuthoringElement(renderable)) {
    return renderable;
  }
  return createAuthoringElement('fragment', fallbackId, {}, []);
};

export const normalizeVec3Like = (value: Vec3Like): Vec3 => {
  if (!Array.isArray(value)) {
    return value as Vec3;
  }
  if (value.length !== 3) {
    throw new Error(
      `position/scale shorthand must contain exactly 3 numbers, received ${value.length}`,
    );
  }
  return { x: value[0], y: value[1], z: value[2] };
};

export const normalizeQuatLike = (value: QuatLike): Quat => {
  if (!Array.isArray(value)) {
    return value as Quat;
  }
  if (value.length !== 4) {
    throw new Error(`rotation shorthand must contain exactly 4 numbers, received ${value.length}`);
  }
  return { x: value[0], y: value[1], z: value[2], w: value[3] };
};

export const normalizeNodeProps = (props: NodeAuthoringProps): NodeAuthoringProps => {
  const { position, rotation, scale, transform, ...rest } = props;
  if (position === undefined && rotation === undefined && scale === undefined) {
    return props;
  }

  const baseTransform = transform ?? identityTransform();
  return {
    ...rest,
    transform: {
      translation: position === undefined ? baseTransform.translation : normalizeVec3Like(position),
      rotation: rotation === undefined ? baseTransform.rotation : normalizeQuatLike(rotation),
      scale: scale === undefined ? baseTransform.scale : normalizeVec3Like(scale),
    },
  };
};

const createSceneObjectAliasElement = (
  resourceType: 'camera' | 'light',
  id: string,
  resourceProps: CameraAuthoringProps | LightAuthoringProps,
  nodeProps: SceneObjectAliasNodeProps,
  binding: Pick<NodeAuthoringProps, 'cameraId'> | Pick<NodeAuthoringProps, 'lightId'>,
  children: readonly AuthoringElement[],
  key?: string,
): AuthoringElement<'fragment'> => {
  const { nodeId, ...restNodeProps } = nodeProps;
  const resourceElement = resourceType === 'camera'
    ? createAuthoringElement('camera', id, resourceProps as CameraAuthoringProps)
    : createAuthoringElement('light', id, resourceProps as LightAuthoringProps);
  return createAuthoringElement(
    'fragment',
    key ?? `${id}__alias`,
    {},
    [
      resourceElement,
      createAuthoringElement(
        'node',
        nodeId ?? id,
        normalizeNodeProps({
          ...restNodeProps,
          ...binding,
        }),
        children,
      ),
    ],
  );
};

const hasSceneObjectAliasNodeIntent = (
  nodeProps: SceneObjectAliasNodeProps,
  children: readonly AuthoringElement[],
): boolean =>
  children.length > 0 ||
  nodeProps.nodeId !== undefined ||
  nodeProps.name !== undefined ||
  nodeProps.transform !== undefined ||
  nodeProps.position !== undefined ||
  nodeProps.rotation !== undefined ||
  nodeProps.scale !== undefined;

const buildPerspectiveCameraElement = (
  props: PerspectiveCameraJsxProps,
  key?: string,
): AuthoringElement => {
  const {
    id,
    children: rawChildren,
    nodeId,
    name,
    transform,
    position,
    rotation,
    scale,
    ...cameraProps
  } = props;
  const children = flattenAuthoringChildren(rawChildren);
  const aliasNodeProps = { nodeId, name, transform, position, rotation, scale };
  if (!hasSceneObjectAliasNodeIntent(aliasNodeProps, children)) {
    return createAuthoringElement('camera', id, { ...cameraProps, type: 'perspective' });
  }
  return createSceneObjectAliasElement(
    'camera',
    id,
    { ...cameraProps, type: 'perspective' },
    aliasNodeProps,
    { cameraId: id },
    children,
    key,
  );
};

const buildOrthographicCameraElement = (
  props: OrthographicCameraJsxProps,
  key?: string,
): AuthoringElement => {
  const {
    id,
    children: rawChildren,
    nodeId,
    name,
    transform,
    position,
    rotation,
    scale,
    ...cameraProps
  } = props;
  const children = flattenAuthoringChildren(rawChildren);
  const aliasNodeProps = { nodeId, name, transform, position, rotation, scale };
  if (!hasSceneObjectAliasNodeIntent(aliasNodeProps, children)) {
    return createAuthoringElement('camera', id, { ...cameraProps, type: 'orthographic' });
  }
  return createSceneObjectAliasElement(
    'camera',
    id,
    { ...cameraProps, type: 'orthographic' },
    aliasNodeProps,
    { cameraId: id },
    children,
    key,
  );
};

const buildDirectionalLightElement = (
  props: DirectionalLightJsxProps,
  key?: string,
): AuthoringElement => {
  const {
    id,
    children: rawChildren,
    nodeId,
    name,
    transform,
    position,
    rotation,
    scale,
    ...lightProps
  } = props;
  const children = flattenAuthoringChildren(rawChildren);
  const aliasNodeProps = { nodeId, name, transform, position, rotation, scale };
  if (!hasSceneObjectAliasNodeIntent(aliasNodeProps, children)) {
    return createAuthoringElement('light', id, { ...lightProps, kind: 'directional' });
  }
  return createSceneObjectAliasElement(
    'light',
    id,
    { ...lightProps, kind: 'directional' },
    aliasNodeProps,
    { lightId: id },
    children,
    key,
  );
};

export const G3dPerspectiveCamera = (props: G3dPerspectiveCameraProps): AuthoringElement =>
  buildPerspectiveCameraElement(props);

export const G3dOrthographicCamera = (props: G3dOrthographicCameraProps): AuthoringElement =>
  buildOrthographicCameraElement(props);

export const G3dDirectionalLight = (props: G3dDirectionalLightProps): AuthoringElement =>
  buildDirectionalLightElement(props);

export const jsx = (
  type:
    | keyof AuthoringPropsByType
    | 'g3d-scene'
    | 'g3d-group'
    | 'g3d-node'
    | 'g3d-asset'
    | 'g3d-texture'
    | 'g3d-material'
    | 'g3d-light'
    | 'g3d-mesh'
    | 'g3d-animation-clip'
    | 'g3d-camera'
    | typeof Fragment
    | AuthoringComponent<
      | SceneJsxProps
      | GroupJsxProps
      | NodeJsxProps
      | AssetJsxProps
      | TextureJsxProps
      | MaterialJsxProps
      | LightJsxProps
      | MeshJsxProps
      | AnimationClipJsxProps
      | CameraJsxProps
      | PerspectiveCameraJsxProps
      | OrthographicCameraJsxProps
      | DirectionalLightJsxProps
    >,
  props: Record<string, unknown> | null,
  key?: string,
): AuthoringElement => {
  const authoringProps = props ?? {};
  const rawChildren = authoringProps.children as AuthoringRenderable | undefined;
  const children = flattenAuthoringChildren(rawChildren);

  if (type === Fragment) {
    return createAuthoringElement('fragment', key ?? '__fragment', {}, children);
  }

  if (typeof type === 'function') {
    return normalizeRenderable(
      type(
        {
          ...authoringProps,
          children: rawChildren,
        } as SceneJsxProps & NodeJsxProps & { children?: AuthoringRenderable },
      ),
      key ?? '__component',
    );
  }

  if (type === 'g3d-scene') {
    const { id, children: _children, ...sceneProps } = authoringProps as SceneJsxProps;
    return createAuthoringElement('scene', id, sceneProps, children);
  }

  if (type === 'g3d-group') {
    const { id, children: _children, ...groupProps } = authoringProps as GroupJsxProps;
    return createAuthoringElement('node', id, normalizeNodeProps(groupProps), children);
  }

  if (
    type === 'g3d-asset' || type === 'g3d-texture' || type === 'g3d-material' ||
    type === 'g3d-light' || type === 'g3d-mesh' || type === 'g3d-animation-clip' ||
    type === 'g3d-camera'
  ) {
    const { id, children: _children, ...resourceProps } = authoringProps as {
      id: string;
      children?: AuthoringRenderable;
    };
    const mappedType = type === 'g3d-asset'
      ? 'asset'
      : type === 'g3d-texture'
      ? 'texture'
      : type === 'g3d-material'
      ? 'material'
      : type === 'g3d-light'
      ? 'light'
      : type === 'g3d-mesh'
      ? 'mesh'
      : type === 'g3d-animation-clip'
      ? 'animationClip'
      : 'camera';
    return {
      type: mappedType,
      id,
      props: { id, ...resourceProps } as AuthoringPropsByType[typeof mappedType],
      children,
    };
  }

  const { id, children: _children, ...nodeProps } = authoringProps as NodeJsxProps;
  return createAuthoringElement('node', id, normalizeNodeProps(nodeProps), children);
};

export const jsxs = jsx;
export const jsxDEV = jsx;

export const normalizeCameraJsxProps = (camera: CameraJsxProps): Camera =>
  camera.type === 'perspective'
    ? createPerspectiveCamera(camera.id, camera)
    : createOrthographicCamera(camera.id, camera);

const sweepUnvisitedResourceIds = (
  document: G3dSceneDocument,
  kind:
    | 'asset'
    | 'texture'
    | 'material'
    | 'light'
    | 'mesh'
    | 'animationClip'
    | 'camera',
  visitedIds: ReadonlySet<string>,
): void => {
  const collection = kind === 'asset'
    ? document.assets.order
    : kind === 'texture'
    ? document.textures.order
    : kind === 'material'
    ? document.materials.order
    : kind === 'light'
    ? document.lights.order
    : kind === 'mesh'
    ? document.meshes.order
    : kind === 'animationClip'
    ? document.animationClips.order
    : document.cameras.order;
  for (const id of [...collection]) {
    if (!visitedIds.has(id)) {
      removeG3dSceneDocumentResource(document, kind, id);
    }
  }
};

export const authoringTreeToSceneDocument = (
  element: AuthoringElement,
  document = createG3dSceneDocument(element.id),
): G3dSceneDocument => {
  if (element.type !== 'scene') {
    throw new Error('authoring root must be a scene');
  }

  const sceneProps = element.props as SceneAuthoringProps | undefined;
  applyG3dSceneDocumentScene(document, {
    id: element.id,
    activeCameraId: sceneProps?.activeCameraId,
  });

  const visitedNodeIds = new Set<string>();
  const visitedResourceIds = {
    asset: new Set<string>(),
    texture: new Set<string>(),
    material: new Set<string>(),
    light: new Set<string>(),
    mesh: new Set<string>(),
    animationClip: new Set<string>(),
    camera: new Set<string>(),
  };

  const visitChildren = (
    parentId: string | undefined,
    children: readonly AuthoringElement[],
    startIndex = 0,
  ): number => {
    let nodeIndex = startIndex;
    for (const child of children) {
      nodeIndex = visit(parentId, child, nodeIndex);
    }
    return nodeIndex;
  };

  const visit = (
    parentId: string | undefined,
    node: AuthoringElement,
    nodeIndex: number,
  ): number => {
    switch (node.type) {
      case 'fragment':
        return visitChildren(parentId, node.children ?? [], nodeIndex);
      case 'node':
        visitedNodeIds.add(node.id);
        upsertG3dSceneDocumentNode(document, {
          id: node.id,
          parentId,
          index: nodeIndex,
          props: node.props as NodeAuthoringProps | undefined,
        });
        visitChildren(node.id, node.children ?? []);
        return nodeIndex + 1;
      case 'asset':
        visitedResourceIds.asset.add(node.id);
        upsertG3dSceneDocumentResource(document, {
          kind: 'asset',
          value: node.props as AssetRef,
        });
        return nodeIndex;
      case 'texture':
        visitedResourceIds.texture.add(node.id);
        upsertG3dSceneDocumentResource(document, {
          kind: 'texture',
          value: node.props as TextureRef,
        });
        return nodeIndex;
      case 'material':
        visitedResourceIds.material.add(node.id);
        upsertG3dSceneDocumentResource(document, {
          kind: 'material',
          value: node.props as Material,
        });
        return nodeIndex;
      case 'light':
        visitedResourceIds.light.add(node.id);
        upsertG3dSceneDocumentResource(document, {
          kind: 'light',
          value: node.props as Light,
        });
        return nodeIndex;
      case 'mesh':
        visitedResourceIds.mesh.add(node.id);
        upsertG3dSceneDocumentResource(document, {
          kind: 'mesh',
          value: node.props as MeshPrimitive,
        });
        return nodeIndex;
      case 'animationClip':
        visitedResourceIds.animationClip.add(node.id);
        upsertG3dSceneDocumentResource(document, {
          kind: 'animationClip',
          value: node.props as AnimationClip,
        });
        return nodeIndex;
      case 'camera':
        visitedResourceIds.camera.add(node.id);
        upsertG3dSceneDocumentResource(document, {
          kind: 'camera',
          value: normalizeCameraJsxProps(node.props as CameraJsxProps),
        });
        return nodeIndex;
      default:
        return nodeIndex;
    }
  };

  visitChildren(undefined, element.children ?? []);

  for (const nodeId of [...document.nodes.order].reverse()) {
    if (!visitedNodeIds.has(nodeId)) {
      removeG3dSceneDocumentNode(document, nodeId);
    }
  }
  sweepUnvisitedResourceIds(document, 'asset', visitedResourceIds.asset);
  sweepUnvisitedResourceIds(document, 'texture', visitedResourceIds.texture);
  sweepUnvisitedResourceIds(document, 'material', visitedResourceIds.material);
  sweepUnvisitedResourceIds(document, 'light', visitedResourceIds.light);
  sweepUnvisitedResourceIds(document, 'mesh', visitedResourceIds.mesh);
  sweepUnvisitedResourceIds(document, 'animationClip', visitedResourceIds.animationClip);
  sweepUnvisitedResourceIds(document, 'camera', visitedResourceIds.camera);

  return document;
};

export const authoringTreeToSceneIr = (element: AuthoringElement): SceneIr =>
  g3dSceneDocumentToSceneIr(authoringTreeToSceneDocument(element));
