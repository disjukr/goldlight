import type { ReactNode } from 'npm:react@19.2.0';
import Reconciler from 'npm:react-reconciler@0.33.0';
import {
  DefaultEventPriority,
  LegacyRoot,
  NoEventPriority,
} from 'npm:react-reconciler@0.33.0/constants.js';

import type {
  AnimationClipJsxProps,
  AssetJsxProps,
  CameraJsxProps,
  GroupJsxProps,
  LightJsxProps,
  MaterialJsxProps,
  MeshJsxProps,
  NodeJsxProps,
  SceneAuthoringProps,
  SceneJsxProps,
  TextureJsxProps,
} from './authoring.ts';
import { normalizeCameraJsxProps, normalizeNodeProps } from './authoring.ts';
import { createSceneRootCommit, type SceneRootSubscriber } from './scene_root.ts';
import type { SceneIr } from '@rieul3d/ir';
import {
  applySceneDocumentScene,
  createSceneDocument,
  removeSceneDocumentNode,
  removeSceneDocumentResource,
  type SceneDocument,
  sceneDocumentToSceneIr,
  upsertSceneDocumentNode,
  upsertSceneDocumentResource,
} from './scene_document.ts';

type ResourceIntrinsicType =
  | 'asset'
  | 'texture'
  | 'material'
  | 'light'
  | 'mesh'
  | 'animationClip'
  | 'camera';
type HostIntrinsicType = 'scene' | 'node' | 'group' | ResourceIntrinsicType;
const supportedIntrinsicTypes = new Set<HostIntrinsicType>([
  'scene',
  'node',
  'group',
  'asset',
  'texture',
  'material',
  'light',
  'mesh',
  'animationClip',
  'camera',
]);

type HostPropsByType = {
  scene: SceneJsxProps;
  node: NodeJsxProps;
  group: GroupJsxProps;
  asset: AssetJsxProps;
  texture: TextureJsxProps;
  material: MaterialJsxProps;
  light: LightJsxProps;
  mesh: MeshJsxProps;
  animationClip: AnimationClipJsxProps;
  camera: CameraJsxProps;
};

type HostPropsWithoutChildren<TType extends HostIntrinsicType> = Omit<
  HostPropsByType[TType],
  'children'
>;

type SceneHostInstance = {
  readonly type: 'scene';
  props: HostPropsWithoutChildren<'scene'>;
  children: HostChild[];
};

type NodeHostInstance = {
  readonly type: 'node';
  props: HostPropsWithoutChildren<'node'>;
  children: HostChild[];
};

type GroupHostInstance = {
  readonly type: 'group';
  props: HostPropsWithoutChildren<'group'>;
  children: HostChild[];
};

type AssetHostInstance = {
  readonly type: 'asset';
  props: HostPropsWithoutChildren<'asset'>;
  children: HostChild[];
};

type TextureHostInstance = {
  readonly type: 'texture';
  props: HostPropsWithoutChildren<'texture'>;
  children: HostChild[];
};

type MaterialHostInstance = {
  readonly type: 'material';
  props: HostPropsWithoutChildren<'material'>;
  children: HostChild[];
};

type LightHostInstance = {
  readonly type: 'light';
  props: HostPropsWithoutChildren<'light'>;
  children: HostChild[];
};

type MeshHostInstance = {
  readonly type: 'mesh';
  props: HostPropsWithoutChildren<'mesh'>;
  children: HostChild[];
};

type AnimationClipHostInstance = {
  readonly type: 'animationClip';
  props: HostPropsWithoutChildren<'animationClip'>;
  children: HostChild[];
};

type CameraHostInstance = {
  readonly type: 'camera';
  props: HostPropsWithoutChildren<'camera'>;
  children: HostChild[];
};

type ResourceHostInstance =
  | AssetHostInstance
  | TextureHostInstance
  | MaterialHostInstance
  | LightHostInstance
  | MeshHostInstance
  | AnimationClipHostInstance
  | CameraHostInstance;

type HostChild = NodeHostInstance | GroupHostInstance | ResourceHostInstance;
type HostInstance = SceneHostInstance | HostChild;
type HostContainer = {
  rootChildren: SceneHostInstance[];
  document?: SceneDocument;
  currentScene?: SceneIr;
  revision: number;
  subscribers: Set<SceneRootSubscriber>;
  pendingError?: Error;
};

type HostContext = Record<string, never>;

export type ReactSceneRoot = Readonly<{
  render: (element: ReactNode) => SceneIr | undefined;
  flushUpdates: (work?: () => void) => void;
  unmount: () => void;
  getScene: () => SceneIr | undefined;
  getRevision: () => number;
  subscribe: (subscriber: SceneRootSubscriber) => () => void;
}>;

const hostContext: HostContext = {};
let currentUpdatePriority = NoEventPriority;
const activeContainers = new Set<HostContainer>();

const renderer = Reconciler({
  getRootHostContext: () => hostContext,
  getChildHostContext: () => hostContext,
  prepareForCommit: () => null,
  resetAfterCommit: (container: HostContainer) => {
    syncContainerSceneDocument(container);
  },
  shouldSetTextContent: () => false,
  createTextInstance: (_text: string) => {
    throw new Error('@rieul3d/react reconciler does not support text children');
  },
  createInstance: (type: HostIntrinsicType, props: Record<string, unknown>) =>
    createHostInstance(type, props),
  appendInitialChild: (parent: HostInstance, child: HostChild) => {
    parent.children.push(child);
  },
  finalizeInitialChildren: () => false,
  getPublicInstance: (instance: HostInstance) => instance,
  supportsMutation: true,
  appendChild: (parent: HostInstance, child: HostChild) => {
    appendChild(parent, child);
  },
  appendChildToContainer: (container: HostContainer, child: SceneHostInstance) => {
    appendChildToContainer(container, child);
  },
  insertBefore: (parent: HostInstance, child: HostChild, beforeChild: HostChild) => {
    insertChildBefore(parent, child, beforeChild);
  },
  insertInContainerBefore: (
    container: HostContainer,
    child: SceneHostInstance,
    beforeChild: SceneHostInstance,
  ) => {
    insertContainerChildBefore(container, child, beforeChild);
  },
  removeChild: (parent: HostInstance, child: HostChild) => {
    removeChild(parent, child);
  },
  removeChildFromContainer: (container: HostContainer, child: SceneHostInstance) => {
    removeContainerChild(container, child);
  },
  clearContainer: (container: HostContainer) => {
    container.rootChildren.length = 0;
  },
  commitUpdate: (
    instance: HostInstance,
    type: HostIntrinsicType,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
    _internalHandle: unknown,
  ) => {
    instance.props = extractProps(type, newProps) as
      & HostPropsWithoutChildren<'scene'>
      & HostPropsWithoutChildren<'node'>
      & HostPropsWithoutChildren<ResourceIntrinsicType>;
  },
  prepareUpdate: (
    _instance: HostInstance,
    _type: HostIntrinsicType,
    _oldProps: Record<string, unknown>,
    _newProps: Record<string, unknown>,
  ) => true,
  commitMount: () => {},
  commitTextUpdate: () => {},
  resetTextContent: () => {},
  hideInstance: () => {},
  hideTextInstance: () => {},
  unhideInstance: () => {},
  unhideTextInstance: () => {},
  detachDeletedInstance: () => {},
  preparePortalMount: () => {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  scheduleMicrotask: queueMicrotask,
  supportsMicrotasks: true,
  isPrimaryRenderer: false,
  getCurrentEventPriority: () => DefaultEventPriority,
  setCurrentUpdatePriority: (priority: number) => {
    currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority: () =>
    currentUpdatePriority === NoEventPriority ? DefaultEventPriority : currentUpdatePriority,
  trackSchedulerEvent: () => {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => Date.now(),
  shouldAttemptEagerTransition: () => false,
} as never);

type ReconcilerRoot = ReturnType<typeof renderer.createContainer>;

const assertHostIntrinsicType = (type: string): HostIntrinsicType => {
  if (supportedIntrinsicTypes.has(type as HostIntrinsicType)) {
    return type as HostIntrinsicType;
  }
  throw new Error(`@rieul3d/react reconciler does not support the <${type}> intrinsic`);
};

const createHostInstance = (
  type: string,
  props: Record<string, unknown>,
): HostInstance => {
  const intrinsicType = assertHostIntrinsicType(type);
  const normalizedProps = extractProps(intrinsicType, props);
  if (intrinsicType === 'scene') {
    return {
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'scene'>,
      children: [],
    };
  }
  if (intrinsicType === 'node') {
    return {
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'node'>,
      children: [],
    };
  }
  if (intrinsicType === 'group') {
    return {
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'group'>,
      children: [],
    };
  }
  return {
    type: intrinsicType,
    props: normalizedProps as HostPropsWithoutChildren<ResourceIntrinsicType>,
    children: [],
  } as ResourceHostInstance;
};

const extractProps = <TType extends HostIntrinsicType>(
  type: TType,
  props: Record<string, unknown>,
): HostPropsWithoutChildren<TType> => {
  const { children: _children, ...rest } = props;
  if (type === 'node' || type === 'group') {
    return normalizeNodeProps(rest as NodeJsxProps) as HostPropsWithoutChildren<TType>;
  }
  return rest as HostPropsWithoutChildren<TType>;
};

const removeIfPresent = <TValue>(items: TValue[], value: TValue): void => {
  const index = items.indexOf(value);
  if (index >= 0) {
    items.splice(index, 1);
  }
};

const insertBeforeValue = <TValue>(
  items: TValue[],
  value: TValue,
  beforeValue: TValue,
): void => {
  removeIfPresent(items, value);
  const beforeIndex = items.indexOf(beforeValue);
  if (beforeIndex < 0) {
    items.push(value);
    return;
  }
  items.splice(beforeIndex, 0, value);
};

const appendChild = (parent: HostInstance, child: HostChild): void => {
  removeIfPresent(parent.children, child);
  parent.children.push(child);
};

const assertSceneRootChild = (child: HostInstance): SceneHostInstance => {
  if (child.type !== 'scene') {
    throw new Error('@rieul3d/react reconciler root must be a <scene> element');
  }
  return child;
};

const appendChildToContainer = (container: HostContainer, child: HostInstance): void => {
  const sceneChild = assertSceneRootChild(child);
  removeIfPresent(container.rootChildren, child);
  container.rootChildren.push(sceneChild);
};

const insertChildBefore = (parent: HostInstance, child: HostChild, beforeChild: HostChild): void =>
  insertBeforeValue(parent.children, child, beforeChild);

const insertContainerChildBefore = (
  container: HostContainer,
  child: HostInstance,
  beforeChild: HostInstance,
): void => {
  insertBeforeValue(
    container.rootChildren,
    assertSceneRootChild(child),
    assertSceneRootChild(beforeChild),
  );
};

const removeChild = (parent: HostInstance, child: HostChild): void => {
  removeIfPresent(parent.children, child);
};

const removeContainerChild = (container: HostContainer, child: HostInstance): void => {
  removeIfPresent(container.rootChildren, assertSceneRootChild(child));
};

const sweepUnvisitedResourceIds = (
  document: SceneDocument,
  kind: ResourceIntrinsicType,
  visitedIds: ReadonlySet<string>,
): void => {
  const orderedIds = kind === 'asset'
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
  for (const id of [...orderedIds]) {
    if (!visitedIds.has(id)) {
      removeSceneDocumentResource(document, kind, id);
    }
  }
};

const syncContainerSceneDocument = (container: HostContainer): void => {
  if (container.rootChildren.length === 0) {
    const previousScene = container.currentScene;
    container.document = undefined;
    container.currentScene = undefined;
    if (previousScene) {
      const commit = createSceneRootCommit(
        sceneDocumentToSceneIr(createSceneDocument(previousScene.id)),
        previousScene,
        container.revision + 1,
      );
      container.revision = commit.revision;
      for (const subscriber of [...container.subscribers]) {
        subscriber(commit);
      }
    }
    return;
  }

  if (container.rootChildren.length > 1) {
    throw new Error('@rieul3d/react reconciler expects a single <scene> root');
  }

  const sceneInstance = container.rootChildren[0];
  const document = container.document ?? createSceneDocument(sceneInstance.props.id);
  container.document = document;

  applySceneDocumentScene(document, {
    id: sceneInstance.props.id,
    activeCameraId: (sceneInstance.props as SceneAuthoringProps).activeCameraId,
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
    children: readonly HostChild[],
    startIndex = 0,
  ): number => {
    let nodeIndex = startIndex;
    for (const child of children) {
      nodeIndex = visitChild(parentId, child, nodeIndex);
    }
    return nodeIndex;
  };

  const visitChild = (
    parentId: string | undefined,
    child: HostChild,
    nodeIndex: number,
  ): number => {
    if (child.type === 'node' || child.type === 'group') {
      visitedNodeIds.add(child.props.id);
      upsertSceneDocumentNode(document, {
        id: child.props.id,
        parentId,
        index: nodeIndex,
        props: normalizeNodeProps(child.props),
      });
      visitChildren(child.props.id, child.children);
      return nodeIndex + 1;
    }

    switch (child.type) {
      case 'asset':
        visitedResourceIds.asset.add(child.props.id);
        upsertSceneDocumentResource(document, { kind: 'asset', value: child.props });
        break;
      case 'texture':
        visitedResourceIds.texture.add(child.props.id);
        upsertSceneDocumentResource(document, { kind: 'texture', value: child.props });
        break;
      case 'material':
        visitedResourceIds.material.add(child.props.id);
        upsertSceneDocumentResource(document, { kind: 'material', value: child.props });
        break;
      case 'light':
        visitedResourceIds.light.add(child.props.id);
        upsertSceneDocumentResource(document, { kind: 'light', value: child.props });
        break;
      case 'mesh':
        visitedResourceIds.mesh.add(child.props.id);
        upsertSceneDocumentResource(document, { kind: 'mesh', value: child.props });
        break;
      case 'animationClip':
        visitedResourceIds.animationClip.add(child.props.id);
        upsertSceneDocumentResource(document, { kind: 'animationClip', value: child.props });
        break;
      case 'camera':
        visitedResourceIds.camera.add(child.props.id);
        upsertSceneDocumentResource(document, {
          kind: 'camera',
          value: normalizeCameraJsxProps(child.props),
        });
        break;
    }

    return nodeIndex;
  };

  visitChildren(undefined, sceneInstance.children);

  for (const nodeId of [...document.nodes.order].reverse()) {
    if (!visitedNodeIds.has(nodeId)) {
      removeSceneDocumentNode(document, nodeId);
    }
  }
  sweepUnvisitedResourceIds(document, 'asset', visitedResourceIds.asset);
  sweepUnvisitedResourceIds(document, 'texture', visitedResourceIds.texture);
  sweepUnvisitedResourceIds(document, 'material', visitedResourceIds.material);
  sweepUnvisitedResourceIds(document, 'light', visitedResourceIds.light);
  sweepUnvisitedResourceIds(document, 'mesh', visitedResourceIds.mesh);
  sweepUnvisitedResourceIds(document, 'animationClip', visitedResourceIds.animationClip);
  sweepUnvisitedResourceIds(document, 'camera', visitedResourceIds.camera);

  const scene = sceneDocumentToSceneIr(document);
  const commit = createSceneRootCommit(scene, container.currentScene, container.revision + 1);
  container.currentScene = scene;
  container.revision = commit.revision;

  for (const subscriber of [...container.subscribers]) {
    subscriber(commit);
  }
};

const createRootContainer = (): HostContainer => ({
  rootChildren: [],
  revision: 0,
  subscribers: new Set(),
});

const toRendererError = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

const throwPendingContainerError = (container: HostContainer): void => {
  const pendingError = container.pendingError;
  if (pendingError) {
    container.pendingError = undefined;
    throw pendingError;
  }
};

const throwPendingContainerErrors = (containers: Iterable<HostContainer>): void => {
  for (const container of containers) {
    throwPendingContainerError(container);
  }
};

const createFiberRoot = (container: HostContainer): ReconcilerRoot =>
  renderer.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    '',
    (error: unknown) => {
      container.pendingError = toRendererError(error);
    },
    (error: unknown) => {
      container.pendingError = toRendererError(error);
    },
    (error: unknown) => {
      container.pendingError = toRendererError(error);
    },
    null,
  );

const flushRendererWork = (): void => {
  renderer.flushSyncWork();
  while (renderer.flushPassiveEffects()) {
    renderer.flushSyncWork();
  }
};

export const flushReactSceneUpdates = (work?: () => void): void => {
  if (work) {
    renderer.flushSyncFromReconciler(work);
  }
  flushRendererWork();
  throwPendingContainerErrors(activeContainers);
};

export const createReactSceneRoot = (initialElement?: ReactNode): ReactSceneRoot => {
  const container = createRootContainer();
  const fiberRoot = createFiberRoot(container);
  activeContainers.add(container);

  const flushUpdates = (work?: () => void): void => {
    if (work) {
      renderer.flushSyncFromReconciler(work);
    }
    flushRendererWork();
    throwPendingContainerError(container);
  };

  const render = (element: ReactNode): SceneIr | undefined => {
    renderer.updateContainerSync(element, fiberRoot, null, null);
    flushUpdates();
    return container.currentScene;
  };

  const unmount = (): void => {
    renderer.updateContainerSync(null, fiberRoot, null, null);
    flushUpdates();
    activeContainers.delete(container);
  };

  if (initialElement !== undefined) {
    render(initialElement);
  }

  return {
    render,
    flushUpdates,
    unmount,
    getScene: () => container.currentScene,
    getRevision: () => container.revision,
    subscribe: (subscriber) => {
      container.subscribers.add(subscriber);
      return () => {
        container.subscribers.delete(subscriber);
      };
    },
  };
};
