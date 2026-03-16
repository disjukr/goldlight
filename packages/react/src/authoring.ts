import { appendNode, createNode, createSceneIr } from '@rieul3d/ir';
import type { SceneIr } from '@rieul3d/ir';

export type AuthoringElement = Readonly<{
  type: 'scene' | 'node';
  id: string;
  props?: Readonly<Record<string, unknown>>;
  children?: readonly AuthoringElement[];
}>;

export const createAuthoringElement = (
  type: AuthoringElement['type'],
  id: string,
  props: AuthoringElement['props'] = {},
  children: readonly AuthoringElement[] = [],
): AuthoringElement => ({
  type,
  id,
  props,
  children,
});

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

    scene = appendNode(scene, createNode(node.id, { parentId }));
    for (const child of node.children ?? []) visit(node.id, child);
  };

  for (const child of element.children ?? []) visit(undefined, child);
  return scene;
};
