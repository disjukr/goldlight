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
  TextureJsxProps,
} from './authoring.ts';
import { normalizeCameraJsxProps, normalizeNodeProps } from './authoring.ts';
import type { Reconciler2dSceneProps, Reconciler3dSceneProps } from './reconciler_runtime.ts';
import { createG3dSceneRootCommit, type G3dSceneRootSubscriber } from './scene_root.ts';
import type { SceneIr, TextureRef } from '@goldlight/ir';
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

type ResourceIntrinsicType =
  | 'asset'
  | 'texture'
  | 'material'
  | 'light'
  | 'mesh'
  | 'animationClip'
  | 'camera';
type HostIntrinsicType =
  | 'g3d-scene'
  | 'g3d-node'
  | 'g3d-group'
  | 'g2d-scene'
  | 'g3d-asset'
  | 'g3d-texture'
  | 'g3d-material'
  | 'g3d-light'
  | 'g3d-mesh'
  | 'g3d-animation-clip'
  | 'g3d-camera';
const supportedIntrinsicTypes = new Set<HostIntrinsicType>([
  'g3d-scene',
  'g3d-node',
  'g3d-group',
  'g2d-scene',
  'g3d-asset',
  'g3d-texture',
  'g3d-material',
  'g3d-light',
  'g3d-mesh',
  'g3d-animation-clip',
  'g3d-camera',
]);

type HostPropsByType = {
  'g3d-scene': Reconciler3dSceneProps;
  'g3d-node': NodeJsxProps;
  'g3d-group': GroupJsxProps;
  'g3d-asset': AssetJsxProps;
  'g3d-texture': TextureJsxProps;
  'g3d-material': MaterialJsxProps;
  'g3d-light': LightJsxProps;
  'g3d-mesh': MeshJsxProps;
  'g3d-animation-clip': AnimationClipJsxProps;
  'g3d-camera': CameraJsxProps;
  'g2d-scene': Reconciler2dSceneProps;
};

type HostPropsWithoutChildren<TType extends HostIntrinsicType> = Omit<
  HostPropsByType[TType],
  'children'
>;

type SceneHostInstance = {
  readonly type: 'g3d-scene';
  props: HostPropsWithoutChildren<'g3d-scene'>;
  children: HostChild[];
};

type NodeHostInstance = {
  readonly type: 'g3d-node';
  props: HostPropsWithoutChildren<'g3d-node'>;
  children: HostChild[];
};

type GroupHostInstance = {
  readonly type: 'g3d-group';
  props: HostPropsWithoutChildren<'g3d-group'>;
  children: HostChild[];
};

type AssetHostInstance = {
  readonly type: 'g3d-asset';
  props: HostPropsWithoutChildren<'g3d-asset'>;
  children: HostChild[];
};

type TextureHostInstance = {
  readonly type: 'g3d-texture';
  props: HostPropsWithoutChildren<'g3d-texture'>;
  children: HostChild[];
};

type MaterialHostInstance = {
  readonly type: 'g3d-material';
  props: HostPropsWithoutChildren<'g3d-material'>;
  children: HostChild[];
};

type LightHostInstance = {
  readonly type: 'g3d-light';
  props: HostPropsWithoutChildren<'g3d-light'>;
  children: HostChild[];
};

type MeshHostInstance = {
  readonly type: 'g3d-mesh';
  props: HostPropsWithoutChildren<'g3d-mesh'>;
  children: HostChild[];
};

type AnimationClipHostInstance = {
  readonly type: 'g3d-animation-clip';
  props: HostPropsWithoutChildren<'g3d-animation-clip'>;
  children: HostChild[];
};

type CameraHostInstance = {
  readonly type: 'g3d-camera';
  props: HostPropsWithoutChildren<'g3d-camera'>;
  children: HostChild[];
};

type Scene2dHostInstance = {
  readonly type: 'g2d-scene';
  props: HostPropsWithoutChildren<'g2d-scene'>;
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

type HostChild =
  | SceneHostInstance
  | NodeHostInstance
  | GroupHostInstance
  | Scene2dHostInstance
  | ResourceHostInstance;
type RootHostInstance = SceneHostInstance | Scene2dHostInstance;
type HostInstance = RootHostInstance | HostChild;
export type React2dScene = Readonly<{
  id: string;
  textureId: string;
  textureWidth: number;
  textureHeight: number;
  draw: Reconciler2dSceneProps['draw'];
}>;
export type React3dScene = Readonly<{
  id: string;
  textureId: string;
  textureWidth: number;
  textureHeight: number;
  scene: SceneIr;
  clearColor?: readonly [number, number, number, number];
}>;
type HostContainer = {
  rootChildren: RootHostInstance[];
  document?: G3dSceneDocument;
  currentScene?: SceneIr;
  current2dScenes: readonly React2dScene[];
  current3dScenes: readonly React3dScene[];
  currentRootClearColor?: readonly [number, number, number, number];
  revision: number;
  subscribers: Set<G3dSceneRootSubscriber>;
  pendingError?: Error;
};

type HostContext = Record<string, never>;

export type React3dSceneRoot = Readonly<{
  render: (element: ReactNode) => SceneIr | undefined;
  flushUpdates: (work?: () => void) => void;
  unmount: () => void;
  getScene: () => SceneIr | undefined;
  get2dScenes: () => readonly React2dScene[];
  get3dScenes: () => readonly React3dScene[];
  getRootClearColor: () => readonly [number, number, number, number] | undefined;
  getRevision: () => number;
  subscribe: (subscriber: G3dSceneRootSubscriber) => () => void;
}>;

const default2dSceneTextureSize = 512;
const default3dSceneTextureSize = 512;

const get2dSceneTextureId = (props: Reconciler2dSceneProps): string => props.outputTextureId;
const get3dSceneTextureId = (props: Reconciler3dSceneProps): string => {
  if (!props.outputTextureId) {
    throw new Error('<g3d-scene> requires outputTextureId when used as a nested scene');
  }
  return props.outputTextureId;
};

const create2dSceneTextureRef = (props: Reconciler2dSceneProps): TextureRef => ({
  id: get2dSceneTextureId(props),
  semantic: 'baseColor',
  colorSpace: 'srgb',
  sampler: 'linear',
});

const create2dSceneDescriptor = (props: Reconciler2dSceneProps): React2dScene => ({
  id: props.id,
  textureId: get2dSceneTextureId(props),
  textureWidth: props.textureWidth ?? default2dSceneTextureSize,
  textureHeight: props.textureHeight ?? default2dSceneTextureSize,
  draw: props.draw,
});

const create3dSceneTextureRef = (props: Reconciler3dSceneProps): TextureRef => ({
  id: get3dSceneTextureId(props),
  semantic: 'baseColor',
  colorSpace: 'srgb',
  sampler: 'linear',
});

const create3dSceneDescriptor = (
  props: Reconciler3dSceneProps,
  scene: SceneIr,
): React3dScene => ({
  id: props.id,
  textureId: get3dSceneTextureId(props),
  textureWidth: props.textureWidth ?? default3dSceneTextureSize,
  textureHeight: props.textureHeight ?? default3dSceneTextureSize,
  scene,
  clearColor: props.clearColor,
});

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
    throw new Error('@goldlight/react reconciler does not support text children');
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
  appendChildToContainer: (container: HostContainer, child: RootHostInstance) => {
    appendChildToContainer(container, child);
  },
  insertBefore: (parent: HostInstance, child: HostChild, beforeChild: HostChild) => {
    insertChildBefore(parent, child, beforeChild);
  },
  insertInContainerBefore: (
    container: HostContainer,
    child: RootHostInstance,
    beforeChild: RootHostInstance,
  ) => {
    insertContainerChildBefore(container, child, beforeChild);
  },
  removeChild: (parent: HostInstance, child: HostChild) => {
    removeChild(parent, child);
  },
  removeChildFromContainer: (container: HostContainer, child: RootHostInstance) => {
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
      & HostPropsWithoutChildren<'g3d-scene'>
      & HostPropsWithoutChildren<'g3d-node'>
      & HostPropsWithoutChildren<'g2d-scene'>
      & HostPropsWithoutChildren<'g3d-asset'>
      & HostPropsWithoutChildren<'g3d-texture'>
      & HostPropsWithoutChildren<'g3d-material'>
      & HostPropsWithoutChildren<'g3d-light'>
      & HostPropsWithoutChildren<'g3d-mesh'>
      & HostPropsWithoutChildren<'g3d-animation-clip'>
      & HostPropsWithoutChildren<'g3d-camera'>;
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
  throw new Error(`@goldlight/react reconciler does not support the <${type}> intrinsic`);
};

const createHostInstance = (
  type: string,
  props: Record<string, unknown>,
): HostInstance => {
  const intrinsicType = assertHostIntrinsicType(type);
  const normalizedProps = extractProps(intrinsicType, props);
  if (intrinsicType === 'g3d-scene') {
    return {
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g3d-scene'>,
      children: [],
    };
  }
  if (intrinsicType === 'g3d-node') {
    return {
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g3d-node'>,
      children: [],
    };
  }
  if (intrinsicType === 'g3d-group') {
    return {
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g3d-group'>,
      children: [],
    };
  }
  if (intrinsicType === 'g2d-scene') {
    return {
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g2d-scene'>,
      children: [],
    };
  }
  return {
    type: intrinsicType,
    props: normalizedProps as
      & HostPropsWithoutChildren<'g3d-asset'>
      & HostPropsWithoutChildren<'g3d-texture'>
      & HostPropsWithoutChildren<'g3d-material'>
      & HostPropsWithoutChildren<'g3d-light'>
      & HostPropsWithoutChildren<'g3d-mesh'>
      & HostPropsWithoutChildren<'g3d-animation-clip'>
      & HostPropsWithoutChildren<'g3d-camera'>,
    children: [],
  } as ResourceHostInstance;
};

const extractProps = <TType extends HostIntrinsicType>(
  type: TType,
  props: Record<string, unknown>,
): HostPropsWithoutChildren<TType> => {
  const { children: _children, ...rest } = props;
  if (type === 'g3d-node' || type === 'g3d-group') {
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

const assertRootChild = (child: HostInstance): RootHostInstance => {
  if (child.type !== 'g3d-scene' && child.type !== 'g2d-scene') {
    throw new Error(
      '@goldlight/react reconciler root must be a <g3d-scene> or <g2d-scene> element',
    );
  }
  return child;
};

const appendChildToContainer = (container: HostContainer, child: HostInstance): void => {
  const sceneChild = assertRootChild(child);
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
    assertRootChild(child),
    assertRootChild(beforeChild),
  );
};

const removeChild = (parent: HostInstance, child: HostChild): void => {
  removeIfPresent(parent.children, child);
};

const removeContainerChild = (container: HostContainer, child: HostInstance): void => {
  removeIfPresent(container.rootChildren, assertRootChild(child));
};

const sweepUnvisitedResourceIds = (
  document: G3dSceneDocument,
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
      removeG3dSceneDocumentResource(document, kind, id);
    }
  }
};

type ReconciledSceneSnapshot = Readonly<{
  scene: SceneIr;
  scenes2d: readonly React2dScene[];
  scenes3d: readonly React3dScene[];
}>;

const reconcile3DSceneSnapshot = (
  sceneInstance: SceneHostInstance,
  document = createG3dSceneDocument(sceneInstance.props.id),
): ReconciledSceneSnapshot => {
  const visitedNodeIds = new Set<string>();
  const scenes2d: React2dScene[] = [];
  const scenes3d: React3dScene[] = [];
  const visitedResourceIds = {
    asset: new Set<string>(),
    texture: new Set<string>(),
    material: new Set<string>(),
    light: new Set<string>(),
    mesh: new Set<string>(),
    animationClip: new Set<string>(),
    camera: new Set<string>(),
  };

  applyG3dSceneDocumentScene(document, {
    id: sceneInstance.props.id,
    activeCameraId: (sceneInstance.props as SceneAuthoringProps).activeCameraId,
  });

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
    if (child.type === 'g3d-scene') {
      const nestedSnapshot = reconcile3DSceneSnapshot(child);
      const scene3d = create3dSceneDescriptor(child.props, nestedSnapshot.scene);
      scenes2d.push(...nestedSnapshot.scenes2d);
      scenes3d.push(...nestedSnapshot.scenes3d, scene3d);
      visitedResourceIds.texture.add(scene3d.textureId);
      upsertG3dSceneDocumentResource(document, {
        kind: 'texture',
        value: create3dSceneTextureRef(child.props),
      });
      return nodeIndex;
    }
    if (child.type === 'g3d-node' || child.type === 'g3d-group') {
      visitedNodeIds.add(child.props.id);
      upsertG3dSceneDocumentNode(document, {
        id: child.props.id,
        parentId,
        index: nodeIndex,
        props: normalizeNodeProps(child.props),
      });
      visitChildren(child.props.id, child.children);
      return nodeIndex + 1;
    }
    if (child.type === 'g2d-scene') {
      const scene2d = create2dSceneDescriptor(child.props);
      scenes2d.push(scene2d);
      visitedResourceIds.texture.add(scene2d.textureId);
      upsertG3dSceneDocumentResource(document, {
        kind: 'texture',
        value: create2dSceneTextureRef(child.props),
      });
      if (child.children.length > 0) {
        throw new Error('<g2d-scene> does not support children yet');
      }
      return nodeIndex;
    }

    switch (child.type) {
      case 'g3d-asset':
        visitedResourceIds.asset.add(child.props.id);
        upsertG3dSceneDocumentResource(document, { kind: 'asset', value: child.props });
        break;
      case 'g3d-texture':
        visitedResourceIds.texture.add(child.props.id);
        upsertG3dSceneDocumentResource(document, { kind: 'texture', value: child.props });
        break;
      case 'g3d-material':
        visitedResourceIds.material.add(child.props.id);
        upsertG3dSceneDocumentResource(document, { kind: 'material', value: child.props });
        break;
      case 'g3d-light':
        visitedResourceIds.light.add(child.props.id);
        upsertG3dSceneDocumentResource(document, { kind: 'light', value: child.props });
        break;
      case 'g3d-mesh':
        visitedResourceIds.mesh.add(child.props.id);
        upsertG3dSceneDocumentResource(document, { kind: 'mesh', value: child.props });
        break;
      case 'g3d-animation-clip':
        visitedResourceIds.animationClip.add(child.props.id);
        upsertG3dSceneDocumentResource(document, { kind: 'animationClip', value: child.props });
        break;
      case 'g3d-camera':
        visitedResourceIds.camera.add(child.props.id);
        upsertG3dSceneDocumentResource(document, {
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

  return {
    scene: g3dSceneDocumentToSceneIr(document),
    scenes2d,
    scenes3d,
  };
};

const syncContainerSceneDocument = (container: HostContainer): void => {
  if (container.rootChildren.length === 0) {
    const previousScene = container.currentScene;
    container.document = undefined;
    container.currentScene = undefined;
    container.current2dScenes = [];
    container.current3dScenes = [];
    container.currentRootClearColor = undefined;
    if (previousScene) {
      const commit = createG3dSceneRootCommit(
        g3dSceneDocumentToSceneIr(createG3dSceneDocument(previousScene.id)),
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
    throw new Error(
      '@goldlight/react reconciler expects a single <g3d-scene> or <g2d-scene> root',
    );
  }

  const previousScene = container.currentScene;
  const rootInstance = container.rootChildren[0];
  if (rootInstance.type === 'g2d-scene') {
    const document = container.document ?? createG3dSceneDocument(rootInstance.props.id);
    container.document = document;
    const scene2d = create2dSceneDescriptor(rootInstance.props);
    upsertG3dSceneDocumentResource(document, {
      kind: 'texture',
      value: create2dSceneTextureRef(rootInstance.props),
    });
    if (rootInstance.children.length > 0) {
      throw new Error('<g2d-scene> does not support children yet');
    }
    applyG3dSceneDocumentScene(document, { id: rootInstance.props.id });
    for (const nodeId of [...document.nodes.order].reverse()) {
      removeG3dSceneDocumentNode(document, nodeId);
    }
    sweepUnvisitedResourceIds(document, 'asset', new Set());
    sweepUnvisitedResourceIds(document, 'texture', new Set([scene2d.textureId]));
    sweepUnvisitedResourceIds(document, 'material', new Set());
    sweepUnvisitedResourceIds(document, 'light', new Set());
    sweepUnvisitedResourceIds(document, 'mesh', new Set());
    sweepUnvisitedResourceIds(document, 'animationClip', new Set());
    sweepUnvisitedResourceIds(document, 'camera', new Set());
    const scene = g3dSceneDocumentToSceneIr(document);
    const commit = createG3dSceneRootCommit(scene, previousScene, container.revision + 1);
    container.currentScene = scene;
    container.current2dScenes = [scene2d];
    container.current3dScenes = [];
    container.currentRootClearColor = undefined;
    container.revision = commit.revision;
    for (const subscriber of [...container.subscribers]) {
      subscriber(commit);
    }
    return;
  }

  const document = container.document ?? createG3dSceneDocument(rootInstance.props.id);
  container.document = document;
  const snapshot = reconcile3DSceneSnapshot(rootInstance, document);
  const commit = createG3dSceneRootCommit(snapshot.scene, previousScene, container.revision + 1);
  container.currentScene = snapshot.scene;
  container.current2dScenes = snapshot.scenes2d;
  container.current3dScenes = snapshot.scenes3d;
  container.currentRootClearColor = rootInstance.props.clearColor;
  container.revision = commit.revision;

  for (const subscriber of [...container.subscribers]) {
    subscriber(commit);
  }
};

const createRootContainer = (): HostContainer => ({
  rootChildren: [],
  current2dScenes: [],
  current3dScenes: [],
  currentRootClearColor: undefined,
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

export const createReactSceneRoot = (initialElement?: ReactNode): React3dSceneRoot => {
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
    get2dScenes: () => container.current2dScenes,
    get3dScenes: () => container.current3dScenes,
    getRootClearColor: () => container.currentRootClearColor,
    getRevision: () => container.revision,
    subscribe: (subscriber) => {
      container.subscribers.add(subscriber);
      return () => {
        container.subscribers.delete(subscriber);
      };
    },
  };
};
