import { appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import type { Node, SceneIr, Transform } from '@rieul3d/ir';

export type SceneAuthoringProps = Readonly<Record<string, never>>;
export type FragmentAuthoringProps = Readonly<Record<string, never>>;

export type NodeAuthoringProps = Readonly<{
  name?: Node['name'];
  meshId?: Node['meshId'];
  sdfId?: Node['sdfId'];
  volumeId?: Node['volumeId'];
  transform?: Transform;
}>;

type AuthoringPropsByType = {
  scene: SceneAuthoringProps;
  node: NodeAuthoringProps;
  fragment: FragmentAuthoringProps;
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

export type SceneJsxProps = Readonly<{
  id: string;
  children?: AuthoringRenderable;
}>;

export type NodeJsxProps = Readonly<
  {
    id: string;
    children?: AuthoringRenderable;
  } & NodeAuthoringProps
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
  type: keyof AuthoringPropsByType,
  id: string,
  props: SceneAuthoringProps | NodeAuthoringProps | FragmentAuthoringProps = {},
  children: readonly AuthoringElement[] = [],
): AuthoringElement {
  return {
    type,
    id,
    props,
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
  type: 'scene' | 'node' | typeof Fragment | AuthoringComponent<SceneJsxProps | NodeJsxProps>,
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
    const { id } = authoringProps as SceneJsxProps;
    return createAuthoringElement('scene', id, {}, children);
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

  let scene = createSceneIr(element.id);

  const visit = (parentId: string | undefined, node: AuthoringElement) => {
    if (node.type !== 'node') {
      for (const child of node.children ?? []) visit(parentId, child);
      return;
    }

    scene = appendNode(
      scene,
      createNode(node.id, {
        parentId,
        ...(node.props ?? {}),
      }),
    );
    for (const child of node.children ?? []) visit(node.id, child);
  };

  for (const child of element.children ?? []) visit(undefined, child);
  return scene;
};
