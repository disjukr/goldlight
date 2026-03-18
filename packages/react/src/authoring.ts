import {
  appendAsset,
  appendCamera,
  appendLight,
  appendMaterial,
  appendMesh,
  appendNode,
  appendTexture,
  createNode,
  createOrthographicCamera,
  createPerspectiveCamera,
  createSceneIr,
} from '@rieul3d/ir';
import type {
  AssetRef,
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
} from '@rieul3d/ir';

export type SceneAuthoringProps = Readonly<{
  activeCameraId?: SceneIr['activeCameraId'];
}>;
export type FragmentAuthoringProps = Readonly<Record<string, never>>;

export type NodeAuthoringProps = Readonly<{
  name?: Node['name'];
  meshId?: Node['meshId'];
  cameraId?: Node['cameraId'];
  sdfId?: Node['sdfId'];
  volumeId?: Node['volumeId'];
  lightId?: Node['lightId'];
  transform?: Transform;
}>;

export type AssetJsxProps = AssetRef;
export type TextureJsxProps = TextureRef;
export type MaterialJsxProps = Material;
export type LightJsxProps = Light;
export type MeshJsxProps = MeshPrimitive;
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
export type GroupJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & NodeAuthoringProps
>;

export type NodeJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & NodeAuthoringProps
>;
export type PerspectiveCameraJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & Partial<Omit<CameraPerspective, 'id' | 'type'>>
>;
export type OrthographicCameraJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & Partial<Omit<CameraOrthographic, 'id' | 'type'>>
>;
export type DirectionalLightJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & Omit<Light, 'id' | 'kind'>
>;

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
    | CameraAuthoringProps = {},
  children: readonly AuthoringElement[] = [],
): AuthoringElement {
  const normalizedProps = (
      type === 'asset' || type === 'texture' || type === 'material' || type === 'light' ||
      type === 'mesh' || type === 'camera'
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

export const jsx = (
  type:
    | keyof AuthoringPropsByType
    | 'group'
    | 'perspectiveCamera'
    | 'orthographicCamera'
    | 'directionalLight'
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

  if (type === 'scene') {
    const { id, children: _children, ...sceneProps } = authoringProps as SceneJsxProps;
    return createAuthoringElement('scene', id, sceneProps, children);
  }

  if (type === 'group') {
    const { id, children: _children, ...groupProps } = authoringProps as GroupJsxProps;
    return createAuthoringElement('node', id, groupProps, children);
  }

  if (type === 'perspectiveCamera') {
    const { id, children: _children, ...cameraProps } = authoringProps as PerspectiveCameraJsxProps;
    return createAuthoringElement('camera', id, { type: 'perspective', ...cameraProps }, children);
  }

  if (type === 'orthographicCamera') {
    const { id, children: _children, ...cameraProps } =
      authoringProps as OrthographicCameraJsxProps;
    return createAuthoringElement(
      'camera',
      id,
      { type: 'orthographic', ...cameraProps },
      children,
    );
  }

  if (type === 'directionalLight') {
    const { id, children: _children, ...lightProps } = authoringProps as DirectionalLightJsxProps;
    return createAuthoringElement('light', id, { kind: 'directional', ...lightProps }, children);
  }

  if (
    type === 'asset' || type === 'texture' || type === 'material' || type === 'light' ||
    type === 'mesh' || type === 'camera'
  ) {
    const { id, children: _children, ...resourceProps } = authoringProps as {
      id: string;
      children?: AuthoringRenderable;
    };
    return {
      type,
      id,
      props: { id, ...resourceProps } as AuthoringPropsByType[typeof type],
      children,
    };
  }

  const { id, children: _children, ...nodeProps } = authoringProps as NodeJsxProps;
  return createAuthoringElement('node', id, nodeProps, children);
};

export const jsxs = jsx;
export const jsxDEV = jsx;

export const authoringTreeToSceneIr = (element: AuthoringElement): SceneIr => {
  if (element.type !== 'scene') {
    throw new Error('authoring root must be a scene');
  }

  let scene: SceneIr = createSceneIr(element.id);
  const sceneProps = element.props as SceneAuthoringProps | undefined;
  if (sceneProps?.activeCameraId) {
    scene = {
      ...scene,
      activeCameraId: sceneProps.activeCameraId,
    };
  }

  const normalizeCamera = (camera: CameraJsxProps): Camera =>
    camera.type === 'perspective'
      ? createPerspectiveCamera(camera.id, camera)
      : createOrthographicCamera(camera.id, camera);

  const visit = (parentId: string | undefined, node: AuthoringElement) => {
    switch (node.type) {
      case 'fragment':
        for (const child of node.children ?? []) visit(parentId, child);
        return;
      case 'node':
        scene = appendNode(
          scene,
          createNode(node.id, {
            parentId,
            ...(node.props ?? {}),
          }),
        );
        for (const child of node.children ?? []) visit(node.id, child);
        return;
      case 'asset':
        scene = appendAsset(scene, node.props as AssetRef);
        return;
      case 'texture':
        scene = appendTexture(scene, node.props as TextureRef);
        return;
      case 'material':
        scene = appendMaterial(scene, node.props as Material);
        return;
      case 'light':
        scene = appendLight(scene, node.props as Light);
        return;
      case 'mesh':
        scene = appendMesh(scene, node.props as MeshPrimitive);
        return;
      case 'camera':
        scene = appendCamera(scene, normalizeCamera(node.props as CameraJsxProps));
        return;
      default:
        return;
    }
  };

  for (const child of element.children ?? []) visit(undefined, child);
  return scene;
};
