// This file is generated from BDL IR.
// Run `deno task generate:ir` to regenerate it.

export type Id = string;

export type Scalar = number;

export type Boolean = boolean;

export type Vec2 = Readonly<{
  x: Scalar;
  y: Scalar;
}>;

export type Vec3 = Readonly<{
  x: Scalar;
  y: Scalar;
  z: Scalar;
}>;

export type Vec4 = Readonly<{
  x: Scalar;
  y: Scalar;
  z: Scalar;
  w: Scalar;
}>;

export type Quat = Readonly<{
  x: Scalar;
  y: Scalar;
  z: Scalar;
  w: Scalar;
}>;

export type Transform = Readonly<{
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
}>;

export type AssetRef = Readonly<{
  id: Id;
  kind?: string;
  uri?: string;
  mimeType?: string;
}>;

export type InlineImageAsset = Readonly<{
  mimeType: string;
  bytes: readonly number[];
  width?: number;
  height?: number;
  pixelFormat?: string;
  bytesPerRow?: number;
  rowsPerImage?: number;
}>;

export type TextureSourceInline = Readonly<{
  'type': 'inline';
  image: InlineImageAsset;
}>;

export type TextureSourceAsset = Readonly<{
  'type': 'asset';
  assetId: Id;
}>;

export type TextureSource =
  | TextureSourceInline
  | TextureSourceAsset;

export type TextureRef = Readonly<{
  id: Id;
  assetId?: Id;
  source?: TextureSource;
  semantic: string;
  colorSpace: string;
  sampler: string;
}>;

export type Material = Readonly<{
  id: Id;
  kind: string;
  shaderId?: Id;
  alphaMode?: string;
  alphaCutoff?: Scalar;
  depthWrite?: Boolean;
  doubleSided?: Boolean;
  renderQueue?: string;
  textures: readonly TextureRef[];
  parameters: Readonly<Record<string, Vec4>>;
}>;

export type Light = Readonly<{
  id: Id;
  kind: string;
  color: Vec3;
  intensity: Scalar;
}>;

export type MeshAttribute = Readonly<{
  semantic: string;
  itemSize: number;
  values: readonly Scalar[];
}>;

export type MeshSourceInline = Readonly<{
  'type': 'inline';
  attributes: readonly MeshAttribute[];
  indices?: readonly number[];
}>;

export type MeshSourceAsset = Readonly<{
  'type': 'asset';
  assetId: Id;
  format?: string;
}>;

export type MeshSource =
  | MeshSourceInline
  | MeshSourceAsset;

export type MeshPrimitive = Readonly<{
  id: Id;
  attributes: readonly MeshAttribute[];
  indices?: readonly number[];
  source?: MeshSource;
  materialId?: Id;
}>;

export type CameraPerspective = Readonly<{
  'type': 'perspective';
  id: Id;
  yfov?: Scalar;
  znear: Scalar;
  zfar: Scalar;
}>;

export type CameraOrthographic = Readonly<{
  'type': 'orthographic';
  id: Id;
  xmag?: Scalar;
  ymag?: Scalar;
  znear: Scalar;
  zfar: Scalar;
}>;

export type Camera =
  | CameraPerspective
  | CameraOrthographic;

export type Node = Readonly<{
  id: Id;
  name?: string;
  parentId?: Id;
  transform: Transform;
  meshId?: Id;
  cameraId?: Id;
  lightId?: Id;
}>;

export type AnimationKeyframe = Readonly<{
  timeMs: Scalar;
  value: Vec4;
}>;

export type AnimationChannel = Readonly<{
  nodeId: Id;
  property: string;
  keyframes: readonly AnimationKeyframe[];
}>;

export type AnimationClip = Readonly<{
  id: Id;
  name?: string;
  durationMs: Scalar;
  channels: readonly AnimationChannel[];
}>;

export type SceneIr = Readonly<{
  id: Id;
  assets: readonly AssetRef[];
  textures: readonly TextureRef[];
  materials: readonly Material[];
  lights: readonly Light[];
  meshes: readonly MeshPrimitive[];
  cameras: readonly Camera[];
  activeCameraId?: Id;
  nodes: readonly Node[];
  rootNodeIds: readonly Id[];
  animationClips: readonly AnimationClip[];
}>;
