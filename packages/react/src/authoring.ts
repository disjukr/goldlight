import { appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import type { Node, SceneIr, Transform } from '@rieul3d/ir';

export type SceneAuthoringProps = Readonly<Record<string, never>>;

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
};

export type AuthoringElement<
  TType extends keyof AuthoringPropsByType = keyof AuthoringPropsByType,
> = Readonly<{
  type: TType;
  id: string;
  props?: AuthoringPropsByType[TType];
  children?: readonly AuthoringElement[];
}>;

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
  type: keyof AuthoringPropsByType,
  id: string,
  props: SceneAuthoringProps | NodeAuthoringProps = {},
  children: readonly AuthoringElement[] = [],
): AuthoringElement {
  return {
    type,
    id,
    props,
    children,
  };
}

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
