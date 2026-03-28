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
import type {
  Reconciler2dCircleProps,
  Reconciler2dGlyphProps,
  Reconciler2dGroupProps,
  Reconciler2dPathProps,
  Reconciler2dRectProps,
  Reconciler2dSceneProps,
  Reconciler3dSceneProps,
} from './reconciler_runtime.ts';
import {
  buildDirectMaskSubRun,
  buildSdfSubRun,
  buildTransformedMaskSubRun,
  type DirectMaskSubRun,
  recordDirectMaskSubRun,
  recordPathFallbackRun,
  recordSdfSubRun,
  recordTransformedMaskSubRun,
  type SdfSubRun,
  type ShapedRun,
  type TextHost,
  type TransformedMaskSubRun,
} from '@disjukr/goldlight/text';
import { createG3dSceneRootCommit, type G3dSceneRootSubscriber } from './scene_root.ts';
import type { SceneIr, TextureRef } from '@disjukr/goldlight/ir';
import type { DrawingPaint, DrawingRecorder } from '@disjukr/goldlight/drawing';
import type { FrameState } from '@disjukr/goldlight/renderer';
import {
  concatDrawingRecorderTransform,
  recordClear,
  recordDrawPath,
  recordDrawShape,
  restoreDrawingRecorder,
  saveDrawingRecorder,
} from '@disjukr/goldlight/drawing';
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
import { createCircle, createCirclePath2d, createRect } from '@disjukr/goldlight/geometry';

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
  | 'g2d-group'
  | 'g2d-path'
  | 'g2d-rect'
  | 'g2d-circle'
  | 'g2d-glyphs'
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
  'g2d-group',
  'g2d-path',
  'g2d-rect',
  'g2d-circle',
  'g2d-glyphs',
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
  'g2d-group': Reconciler2dGroupProps;
  'g2d-path': Reconciler2dPathProps;
  'g2d-rect': Reconciler2dRectProps;
  'g2d-circle': Reconciler2dCircleProps;
  'g2d-glyphs': Reconciler2dGlyphProps;
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

type Group2dHostInstance = {
  readonly type: 'g2d-group';
  props: HostPropsWithoutChildren<'g2d-group'>;
  children: HostChild[];
};

type Path2dHostInstance = {
  readonly type: 'g2d-path';
  props: HostPropsWithoutChildren<'g2d-path'>;
  children: HostChild[];
};

type Rect2dHostInstance = {
  readonly type: 'g2d-rect';
  props: HostPropsWithoutChildren<'g2d-rect'>;
  children: HostChild[];
};

type Circle2dHostInstance = {
  readonly type: 'g2d-circle';
  props: HostPropsWithoutChildren<'g2d-circle'>;
  children: HostChild[];
};

type Glyph2dHostInstance = {
  readonly type: 'g2d-glyphs';
  props: HostPropsWithoutChildren<'g2d-glyphs'>;
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
  | Group2dHostInstance
  | Path2dHostInstance
  | Rect2dHostInstance
  | Circle2dHostInstance
  | Glyph2dHostInstance
  | ResourceHostInstance;
type RootHostInstance = SceneHostInstance | Scene2dHostInstance;
type HostInstance = RootHostInstance | HostChild;
export type React2dScene = Readonly<{
  id: string;
  textureId: string;
  usesBindingTextureSize: boolean;
  viewportWidth: number;
  viewportHeight: number;
  textureWidth: number;
  textureHeight: number;
  revision: number;
  draw: (recorder: DrawingRecorder, frameState: FrameState) => void;
}>;
export type React3dScene = Readonly<{
  id: string;
  textureId: string;
  viewportWidth: number;
  viewportHeight: number;
  textureWidth: number;
  textureHeight: number;
  revision: number;
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
  currentRootViewportWidth: number;
  currentRootViewportHeight: number;
  runtimeRootViewportWidth: number;
  runtimeRootViewportHeight: number;
  revision: number;
  contentRevision: number;
  contentTreeRevision?: number;
  subscribers: Set<G3dSceneRootSubscriber>;
  pendingError?: Error;
};

type HostContext = Record<string, never>;

export type React3dSceneRoot = Readonly<{
  render: (element: ReactNode) => SceneIr | undefined;
  flushUpdates: (work?: () => void) => void;
  unmount: () => void;
  getRootType: () => 'g3d-scene' | 'g2d-scene' | undefined;
  getScene: () => SceneIr | undefined;
  get2dScenes: () => readonly React2dScene[];
  get3dScenes: () => readonly React3dScene[];
  getRootClearColor: () => readonly [number, number, number, number] | undefined;
  getRootViewportWidth: () => number;
  getRootViewportHeight: () => number;
  setRootViewport: (width: number, height: number) => void;
  getRevision: () => number;
  getContentRevision: () => number;
  subscribe: (subscriber: G3dSceneRootSubscriber) => () => void;
}>;

export type CreateReactSceneRootConfig = Readonly<{
  rootViewportWidth: number;
  rootViewportHeight: number;
}>;

const default2dSceneTextureSize = 512;
const default3dSceneTextureSize = 512;
const HASH_OFFSET = 2166136261;
const HASH_PRIME = 16777619;
const numberHashBuffer = new ArrayBuffer(8);
const numberHashView = new DataView(numberHashBuffer);

type HostRevisionState = {
  selfFingerprint?: number;
  selfVersion: number;
  subtreeRevision: number;
  lastChildRefs: readonly HostChild[];
  lastChildSubtreeRevisions: readonly number[];
};

type GlyphPathFallbackRun = Readonly<{
  typeface: bigint;
  size: number;
  glyphIDs: Uint32Array;
  positions: Float32Array;
  offsets: Float32Array;
}>;

type TranslatedShapedRun = ShapedRun;

type GlyphRenderCacheState = {
  host?: TextHost;
  selfVersion: number;
  typeface?: bigint;
  shapedRun?: ShapedRun;
  translatedRun?: TranslatedShapedRun;
  directMaskSubRun?: DirectMaskSubRun;
  transformedMaskSubRun?: TransformedMaskSubRun;
  transformedMaskScale?: number;
  sdfSubRun?: SdfSubRun;
  sdfKey?: string;
  pathRun?: GlyphPathFallbackRun;
};

const hostRevisionStates = new WeakMap<HostInstance, HostRevisionState>();
const glyphRenderCaches = new WeakMap<Glyph2dHostInstance, GlyphRenderCacheState>();
const mixHash = (hash: number, byte: number): number => {
  return Math.imul(hash ^ byte, HASH_PRIME) >>> 0;
};

const hashString = (hash: number, value: string): number => {
  let nextHash = hash;
  for (let index = 0; index < value.length; index += 1) {
    nextHash = mixHash(nextHash, value.charCodeAt(index) & 0xff);
    nextHash = mixHash(nextHash, value.charCodeAt(index) >>> 8);
  }
  return nextHash;
};

const hashNumber = (hash: number, value: number): number => {
  numberHashView.setFloat64(0, value, true);
  let nextHash = hash;
  for (let index = 0; index < 8; index += 1) {
    nextHash = mixHash(nextHash, numberHashView.getUint8(index));
  }
  return nextHash;
};

const fingerprintValue = (value: unknown): number => {
  if (value === null) return hashString(HASH_OFFSET, 'null');
  if (value === undefined) return hashString(HASH_OFFSET, 'undefined');
  if (typeof value === 'string') return hashString(HASH_OFFSET, value);
  if (typeof value === 'number') return hashNumber(HASH_OFFSET, value);
  if (typeof value === 'boolean') return hashString(HASH_OFFSET, value ? 'true' : 'false');
  if (Array.isArray(value)) {
    let hash = hashString(HASH_OFFSET, 'array');
    for (const item of value) {
      const itemFingerprint = fingerprintValue(item);
      hash = mixHash(hash, 0xff);
      hash = mixHash(hash, itemFingerprint & 0xff);
      hash = mixHash(hash, (itemFingerprint >>> 8) & 0xff);
      hash = mixHash(hash, (itemFingerprint >>> 16) & 0xff);
      hash = mixHash(hash, itemFingerprint >>> 24);
    }
    return hash;
  }
  if (typeof value === 'object') {
    let hash = hashString(HASH_OFFSET, 'object');
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    for (const [key, entryValue] of entries) {
      hash = hashString(hash, key);
      const entryFingerprint = fingerprintValue(entryValue);
      hash = mixHash(hash, entryFingerprint & 0xff);
      hash = mixHash(hash, (entryFingerprint >>> 8) & 0xff);
      hash = mixHash(hash, (entryFingerprint >>> 16) & 0xff);
      hash = mixHash(hash, entryFingerprint >>> 24);
    }
    return hash;
  }
  return hashString(HASH_OFFSET, String(value));
};

const createInitialHostRevisionState = (): HostRevisionState => ({
  selfVersion: 0,
  subtreeRevision: 0,
  lastChildRefs: [],
  lastChildSubtreeRevisions: [],
});

const initializeHostRevisionState = <TInstance extends HostInstance>(
  instance: TInstance,
): TInstance => {
  hostRevisionStates.set(instance, createInitialHostRevisionState());
  return instance;
};

const getHostRevisionState = (instance: HostInstance): HostRevisionState => {
  const state = hostRevisionStates.get(instance);
  if (!state) {
    throw new Error(`missing revision state for <${instance.type}> host instance`);
  }
  return state;
};

const getHostSubtreeRevision = (instance: HostInstance): number =>
  getHostRevisionState(instance).subtreeRevision;

const syncHostSubtreeRevision = (instance: HostInstance): number => {
  const state = getHostRevisionState(instance);
  const selfFingerprint = fingerprintValue(instance.props);
  const selfChanged = state.selfFingerprint !== selfFingerprint;
  if (selfChanged) {
    state.selfFingerprint = selfFingerprint;
    state.selfVersion += 1;
  }

  const childRefs = [...instance.children];
  const childSubtreeRevisions = childRefs.map((child) => syncHostSubtreeRevision(child));
  const childListChanged = state.lastChildRefs.length !== childRefs.length ||
    childRefs.some((child, index) => state.lastChildRefs[index] !== child);
  const childRevisionChanged =
    state.lastChildSubtreeRevisions.length !== childSubtreeRevisions.length ||
    childSubtreeRevisions.some((revision, index) =>
      state.lastChildSubtreeRevisions[index] !== revision
    );

  if (selfChanged || childListChanged || childRevisionChanged || state.subtreeRevision === 0) {
    state.subtreeRevision += 1;
    state.lastChildRefs = childRefs;
    state.lastChildSubtreeRevisions = childSubtreeRevisions;
  }

  return state.subtreeRevision;
};

const get2dSceneTextureId = (
  props: Reconciler2dSceneProps,
  nested: boolean,
): string => {
  if (props.outputTextureId) {
    return props.outputTextureId;
  }
  if (nested) {
    throw new Error('<g2d-scene> requires outputTextureId when used as a nested scene');
  }
  return `__root_g2d_scene_texture__:${props.id}`;
};
const get3dSceneTextureId = (props: Reconciler3dSceneProps): string => {
  if (!props.outputTextureId) {
    throw new Error('<g3d-scene> requires outputTextureId when used as a nested scene');
  }
  return props.outputTextureId;
};

const create2dSceneTextureRef = (props: Reconciler2dSceneProps): TextureRef => ({
  id: get2dSceneTextureId(props, true),
  semantic: 'baseColor',
  colorSpace: 'srgb',
  sampler: 'linear',
});

const create2dPaint = (
  props:
    | Reconciler2dPathProps
    | Reconciler2dRectProps
    | Reconciler2dCircleProps
    | Reconciler2dGlyphProps,
): DrawingPaint => ({
  color: props.color,
  blendMode: props.blendMode,
  style: props.style,
  strokeWidth: props.strokeWidth,
  strokeJoin: props.strokeJoin,
  strokeCap: props.strokeCap,
  miterLimit: props.miterLimit,
  dashArray: props.dashArray,
  dashOffset: props.dashOffset,
});

const resolve2dGlyphTextHost = (
  sceneProps: Reconciler2dSceneProps,
  props: Reconciler2dGlyphProps,
  frameState: FrameState,
): TextHost => {
  const fromScene = sceneProps.textHost;
  if (fromScene) {
    return fromScene;
  }
  const fromProps = props.textHost;
  if (fromProps) {
    return fromProps;
  }
  const frameTextHost = frameState.textHost;
  if (
    frameTextHost &&
    typeof frameTextHost === 'object' &&
    'shapeText' in frameTextHost &&
    typeof frameTextHost.shapeText === 'function'
  ) {
    return frameTextHost as TextHost;
  }
  throw new Error(
    '<g2d-glyphs> requires a TextHost via <g2d-scene textHost={...}> or frameState.textHost',
  );
};

const resolve2dGlyphTypeface = (host: TextHost, props: Reconciler2dGlyphProps): bigint => {
  const families = props.fontFamily === undefined
    ? []
    : Array.isArray(props.fontFamily)
    ? props.fontFamily
    : [props.fontFamily];
  for (const family of families) {
    const typeface = host.matchTypeface({ family });
    if (typeface !== null) {
      return typeface;
    }
  }
  const defaultTypeface = host.matchTypeface({});
  if (defaultTypeface !== null) {
    return defaultTypeface;
  }
  const firstFamily = host.listFamilies()[0];
  if (firstFamily) {
    const fallbackTypeface = host.matchTypeface({ family: firstFamily });
    if (fallbackTypeface !== null) {
      return fallbackTypeface;
    }
  }
  throw new Error('<g2d-glyphs> could not resolve a typeface');
};

const translateGlyphRun = (
  run: ShapedRun,
  x: number,
  y: number,
): TranslatedShapedRun => {
  const positions = new Float32Array(run.positions.length);
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    positions[index * 2] = run.positions[index * 2]! + x;
    positions[index * 2 + 1] = run.positions[index * 2 + 1]! + y;
  }
  positions[run.glyphIDs.length * 2] = run.positions[run.glyphIDs.length * 2]! + x;
  positions[run.glyphIDs.length * 2 + 1] = run.positions[run.glyphIDs.length * 2 + 1]! + y;
  return {
    ...run,
    positions,
  };
};

const getTransformedMaskStrikeScale = (
  transform: readonly [number, number, number, number, number, number],
): number => {
  const scaleX = Math.hypot(transform[0], transform[1]);
  const scaleY = Math.hypot(transform[2], transform[3]);
  const maxScale = Math.max(scaleX, scaleY, 1);
  const axisAlignmentX = scaleX > 0
    ? Math.max(Math.abs(transform[0]), Math.abs(transform[1])) / scaleX
    : 1;
  const axisAlignmentY = scaleY > 0
    ? Math.max(Math.abs(transform[2]), Math.abs(transform[3])) / scaleY
    : 1;
  const axisAlignment = Math.min(axisAlignmentX, axisAlignmentY);
  if (!Number.isFinite(axisAlignment) || axisAlignment <= 0) {
    return Math.min(4, Math.ceil(maxScale));
  }
  const transformedScale = axisAlignment < 0.97
    ? Math.ceil(maxScale / axisAlignment)
    : Math.ceil(maxScale);
  return Math.min(4, Math.max(1, transformedScale));
};

const getGlyphRenderCache = (instance: Glyph2dHostInstance): GlyphRenderCacheState => {
  let cache = glyphRenderCaches.get(instance);
  if (!cache) {
    cache = { selfVersion: -1 };
    glyphRenderCaches.set(instance, cache);
  }
  return cache;
};

const render2dGlyph = (
  instance: Glyph2dHostInstance,
  recorder: DrawingRecorder,
  sceneProps: Reconciler2dSceneProps,
  props: Reconciler2dGlyphProps,
  frameState: FrameState,
): void => {
  const host = resolve2dGlyphTextHost(sceneProps, props, frameState);
  const revisionState = getHostRevisionState(instance);
  const cache = getGlyphRenderCache(instance);
  if (cache.host !== host || cache.selfVersion !== revisionState.selfVersion) {
    const typeface = resolve2dGlyphTypeface(host, props);
    const run = host.shapeText({
      typeface,
      text: props.text,
      size: props.fontSize,
      direction: props.direction,
      language: props.language,
      scriptTag: props.scriptTag,
    });
    cache.host = host;
    cache.selfVersion = revisionState.selfVersion;
    cache.typeface = typeface;
    cache.shapedRun = run;
    cache.translatedRun = undefined;
    cache.directMaskSubRun = undefined;
    cache.transformedMaskSubRun = undefined;
    cache.transformedMaskScale = undefined;
    cache.sdfSubRun = undefined;
    cache.sdfKey = undefined;
    cache.pathRun = undefined;
  }
  const run = cache.shapedRun!;
  const paint = create2dPaint(props);
  if ((props.mode ?? 'a8') === 'path') {
    if (!cache.pathRun) {
      const translatedRun = cache.translatedRun ??= translateGlyphRun(run, props.x, props.y);
      cache.pathRun = {
        typeface: translatedRun.typeface,
        size: translatedRun.size,
        glyphIDs: translatedRun.glyphIDs,
        positions: translatedRun.positions,
        offsets: translatedRun.offsets,
      };
    }
    recordPathFallbackRun(host, recorder, cache.pathRun, paint);
    return;
  }
  const translatedRun = cache.translatedRun ??= translateGlyphRun(run, props.x, props.y);
  if ((props.mode ?? 'a8') === 'transformed-mask') {
    const strikeScale = getTransformedMaskStrikeScale(recorder.state.transform);
    if (
      !cache.transformedMaskSubRun ||
      cache.transformedMaskScale !== strikeScale
    ) {
      cache.transformedMaskSubRun = buildTransformedMaskSubRun(host, translatedRun, strikeScale);
      cache.transformedMaskScale = strikeScale;
    }
    recordTransformedMaskSubRun(recorder, cache.transformedMaskSubRun, paint);
    return;
  }
  if ((props.mode ?? 'a8') === 'sdf') {
    if (!cache.sdfSubRun) {
      cache.sdfSubRun = buildSdfSubRun(host, translatedRun);
      cache.sdfKey = 'graphite-default';
    }
    recordSdfSubRun(
      recorder,
      cache.sdfSubRun,
      paint,
    );
    return;
  }
  if (!cache.directMaskSubRun) {
    cache.directMaskSubRun = buildDirectMaskSubRun(host, translatedRun);
  }
  recordDirectMaskSubRun(recorder, cache.directMaskSubRun, paint);
};

const render2dChild = (
  recorder: DrawingRecorder,
  child: HostChild,
  sceneProps: Reconciler2dSceneProps,
  frameState: FrameState,
): void => {
  switch (child.type) {
    case 'g2d-group':
      saveDrawingRecorder(recorder);
      if (child.props.transform) {
        concatDrawingRecorderTransform(recorder, child.props.transform);
      }
      for (const grandChild of child.children) {
        render2dChild(recorder, grandChild, sceneProps, frameState);
      }
      restoreDrawingRecorder(recorder);
      return;
    case 'g2d-path':
      if (child.children.length > 0) {
        throw new Error('<g2d-path> does not support children');
      }
      recordDrawPath(recorder, child.props.path, create2dPaint(child.props));
      return;
    case 'g2d-rect':
      if (child.children.length > 0) {
        throw new Error('<g2d-rect> does not support children');
      }
      recordDrawShape(
        recorder,
        {
          kind: 'rect',
          rect: createRect(child.props.x, child.props.y, child.props.width, child.props.height),
        },
        create2dPaint(child.props),
      );
      return;
    case 'g2d-circle':
      if (child.children.length > 0) {
        throw new Error('<g2d-circle> does not support children');
      }
      recordDrawPath(
        recorder,
        createCirclePath2d(
          createCircle(child.props.cx, child.props.cy, child.props.radius),
          child.props.segments,
        ),
        create2dPaint(child.props),
      );
      return;
    case 'g2d-glyphs':
      if (child.children.length > 0) {
        throw new Error('<g2d-glyphs> does not support children');
      }
      render2dGlyph(child, recorder, sceneProps, child.props, frameState);
      return;
    case 'g2d-scene':
      throw new Error('nested <g2d-scene> is not supported');
    default:
      throw new Error(`<${child.type}> is not allowed inside <g2d-scene>`);
  }
};

const create2dSceneDraw = (
  props: Reconciler2dSceneProps,
  children: readonly HostChild[],
): React2dScene['draw'] => {
  return (recorder, frameState) => {
    recordClear(recorder, props.clearColor ?? [0, 0, 0, 0]);
    for (const child of children) {
      render2dChild(recorder, child, props, frameState);
    }
  };
};

const create2dSceneDescriptor = (
  props: Reconciler2dSceneProps,
  children: readonly HostChild[],
  revision: number,
  options: Readonly<{
    nested: boolean;
    defaultViewportWidth: number;
    defaultViewportHeight: number;
    defaultTextureWidth: number;
    defaultTextureHeight: number;
  }>,
): React2dScene => ({
  id: props.id,
  textureId: get2dSceneTextureId(props, options.nested),
  usesBindingTextureSize: !options.nested && props.textureWidth === undefined &&
    props.textureHeight === undefined,
  viewportWidth: props.viewportWidth ?? props.textureWidth ?? options.defaultViewportWidth,
  viewportHeight: props.viewportHeight ?? props.textureHeight ?? options.defaultViewportHeight,
  textureWidth: props.textureWidth ?? options.defaultTextureWidth,
  textureHeight: props.textureHeight ?? options.defaultTextureHeight,
  revision,
  draw: create2dSceneDraw(props, children),
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
  revision: number,
): React3dScene => ({
  id: props.id,
  textureId: get3dSceneTextureId(props),
  viewportWidth: props.viewportWidth ?? props.textureWidth ?? default3dSceneTextureSize,
  viewportHeight: props.viewportHeight ?? props.textureHeight ?? default3dSceneTextureSize,
  textureWidth: props.textureWidth ?? default3dSceneTextureSize,
  textureHeight: props.textureHeight ?? default3dSceneTextureSize,
  revision,
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
    throw new Error('@disjukr/goldlight/react reconciler does not support text children');
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
      & HostPropsWithoutChildren<'g2d-group'>
      & HostPropsWithoutChildren<'g2d-path'>
      & HostPropsWithoutChildren<'g2d-rect'>
      & HostPropsWithoutChildren<'g2d-circle'>
      & HostPropsWithoutChildren<'g2d-glyphs'>
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
  throw new Error(`@disjukr/goldlight/react reconciler does not support the <${type}> intrinsic`);
};

const createHostInstance = (
  type: string,
  props: Record<string, unknown>,
): HostInstance => {
  const intrinsicType = assertHostIntrinsicType(type);
  const normalizedProps = extractProps(intrinsicType, props);
  if (intrinsicType === 'g3d-scene') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g3d-scene'>,
      children: [],
    });
  }
  if (intrinsicType === 'g3d-node') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g3d-node'>,
      children: [],
    });
  }
  if (intrinsicType === 'g3d-group') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g3d-group'>,
      children: [],
    });
  }
  if (intrinsicType === 'g2d-scene') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g2d-scene'>,
      children: [],
    });
  }
  if (intrinsicType === 'g2d-group') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g2d-group'>,
      children: [],
    });
  }
  if (intrinsicType === 'g2d-path') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g2d-path'>,
      children: [],
    });
  }
  if (intrinsicType === 'g2d-rect') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g2d-rect'>,
      children: [],
    });
  }
  if (intrinsicType === 'g2d-circle') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g2d-circle'>,
      children: [],
    });
  }
  if (intrinsicType === 'g2d-glyphs') {
    return initializeHostRevisionState({
      type: intrinsicType,
      props: normalizedProps as HostPropsWithoutChildren<'g2d-glyphs'>,
      children: [],
    });
  }
  return initializeHostRevisionState({
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
  } as ResourceHostInstance);
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
      '@disjukr/goldlight/react reconciler root must be a <g3d-scene> or <g2d-scene> element',
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
      const scene3d = create3dSceneDescriptor(
        child.props,
        nestedSnapshot.scene,
        getHostSubtreeRevision(child),
      );
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
      const scene2d = create2dSceneDescriptor(
        child.props,
        child.children,
        getHostSubtreeRevision(child),
        {
          nested: true,
          defaultViewportWidth: default2dSceneTextureSize,
          defaultViewportHeight: default2dSceneTextureSize,
          defaultTextureWidth: default2dSceneTextureSize,
          defaultTextureHeight: default2dSceneTextureSize,
        },
      );
      scenes2d.push(scene2d);
      visitedResourceIds.texture.add(scene2d.textureId);
      upsertG3dSceneDocumentResource(document, {
        kind: 'texture',
        value: create2dSceneTextureRef(child.props),
      });
      return nodeIndex;
    }

    switch (child.type) {
      case 'g2d-group':
      case 'g2d-path':
      case 'g2d-rect':
      case 'g2d-circle':
      case 'g2d-glyphs':
        throw new Error(`<${child.type}> must be placed inside <g2d-scene>`);
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
    container.currentRootViewportWidth = container.runtimeRootViewportWidth;
    container.currentRootViewportHeight = container.runtimeRootViewportHeight;
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
    container.contentTreeRevision = undefined;
    container.contentRevision = 0;
    return;
  }

  if (container.rootChildren.length > 1) {
    throw new Error(
      '@disjukr/goldlight/react reconciler expects a single <g3d-scene> or <g2d-scene> root',
    );
  }

  const previousScene = container.currentScene;
  const rootInstance = container.rootChildren[0];
  const rootSubtreeRevision = syncHostSubtreeRevision(rootInstance);
  if (rootInstance.type === 'g2d-scene') {
    const document = container.document ?? createG3dSceneDocument(rootInstance.props.id);
    container.document = document;
    const scene2d = create2dSceneDescriptor(
      rootInstance.props,
      rootInstance.children,
      rootSubtreeRevision,
      {
        nested: false,
        defaultViewportWidth: container.runtimeRootViewportWidth,
        defaultViewportHeight: container.runtimeRootViewportHeight,
        defaultTextureWidth: container.runtimeRootViewportWidth,
        defaultTextureHeight: container.runtimeRootViewportHeight,
      },
    );
    applyG3dSceneDocumentScene(document, { id: rootInstance.props.id });
    for (const nodeId of [...document.nodes.order].reverse()) {
      removeG3dSceneDocumentNode(document, nodeId);
    }
    sweepUnvisitedResourceIds(document, 'asset', new Set());
    sweepUnvisitedResourceIds(document, 'texture', new Set());
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
    container.currentRootViewportWidth = rootInstance.props.viewportWidth ??
      container.runtimeRootViewportWidth;
    container.currentRootViewportHeight = rootInstance.props.viewportHeight ??
      container.runtimeRootViewportHeight;
    if (container.contentTreeRevision !== rootSubtreeRevision) {
      container.contentTreeRevision = rootSubtreeRevision;
      container.contentRevision += 1;
    }
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
  container.currentRootViewportWidth = rootInstance.props.viewportWidth ??
    container.runtimeRootViewportWidth;
  container.currentRootViewportHeight = rootInstance.props.viewportHeight ??
    container.runtimeRootViewportHeight;
  if (container.contentTreeRevision !== rootSubtreeRevision) {
    container.contentTreeRevision = rootSubtreeRevision;
    container.contentRevision += 1;
  }
  container.revision = commit.revision;

  for (const subscriber of [...container.subscribers]) {
    subscriber(commit);
  }
};

const createRootContainer = (config: CreateReactSceneRootConfig): HostContainer => ({
  rootChildren: [],
  current2dScenes: [],
  current3dScenes: [],
  currentRootClearColor: undefined,
  currentRootViewportWidth: Math.max(1, Math.round(config.rootViewportWidth)),
  currentRootViewportHeight: Math.max(1, Math.round(config.rootViewportHeight)),
  runtimeRootViewportWidth: Math.max(1, Math.round(config.rootViewportWidth)),
  runtimeRootViewportHeight: Math.max(1, Math.round(config.rootViewportHeight)),
  revision: 0,
  contentRevision: 0,
  contentTreeRevision: undefined,
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

export const createReactSceneRoot = (
  config: CreateReactSceneRootConfig,
  initialElement?: ReactNode,
): React3dSceneRoot => {
  const container = createRootContainer(config);
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

  const setRootViewport = (width: number, height: number): void => {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (
      container.runtimeRootViewportWidth === nextWidth &&
      container.runtimeRootViewportHeight === nextHeight
    ) {
      return;
    }
    container.runtimeRootViewportWidth = nextWidth;
    container.runtimeRootViewportHeight = nextHeight;
    const rootInstance = container.rootChildren[0];
    if (!rootInstance) {
      container.currentRootViewportWidth = nextWidth;
      container.currentRootViewportHeight = nextHeight;
      return;
    }
    if (rootInstance.props.viewportWidth === undefined) {
      container.currentRootViewportWidth = nextWidth;
    }
    if (rootInstance.props.viewportHeight === undefined) {
      container.currentRootViewportHeight = nextHeight;
    }
  };

  if (initialElement !== undefined) {
    render(initialElement);
  }

  return {
    render,
    flushUpdates,
    unmount,
    getRootType: () => container.rootChildren[0]?.type,
    getScene: () => container.currentScene,
    get2dScenes: () => container.current2dScenes,
    get3dScenes: () => container.current3dScenes,
    getRootClearColor: () => container.currentRootClearColor,
    getRootViewportWidth: () => container.currentRootViewportWidth,
    getRootViewportHeight: () => container.currentRootViewportHeight,
    setRootViewport,
    getRevision: () => container.revision,
    getContentRevision: () => container.contentRevision,
    subscribe: (subscriber) => {
      container.subscribers.add(subscriber);
      return () => {
        container.subscribers.delete(subscriber);
      };
    },
  };
};

export * from './reconciler_forward.ts';
export * from './reconciler_runtime.ts';
export * from './runtime_driver.ts';
export * from './runtime_forward.ts';
export * from './scene_root.ts';
