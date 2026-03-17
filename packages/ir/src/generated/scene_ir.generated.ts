// This file is generated from BDL IR.
// Run `deno task generate:ir` to regenerate it.

export type Id = string;

export type Scalar = number;

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
  uri?: string;
  mimeType?: string;
}>;

export type TextureRef = Readonly<{
  id: Id;
  assetId?: Id;
  semantic: string;
  colorSpace: string;
  sampler: string;
}>;

export type Material = Readonly<{
  id: Id;
  kind: string;
  shaderId?: Id;
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

export type MeshPrimitive = Readonly<{
  id: Id;
  attributes: readonly MeshAttribute[];
  indices?: readonly number[];
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

export type SdfPrimitive = Readonly<{
  id: Id;
  op: string;
  parameters: Readonly<Record<string, Vec4>>;
}>;

export type VolumePrimitive = Readonly<{
  id: Id;
  assetId?: Id;
  dimensions: Vec3;
  format: string;
}>;

export type Node = Readonly<{
  id: Id;
  name?: string;
  parentId?: Id;
  transform: Transform;
  meshId?: Id;
  cameraId?: Id;
  sdfId?: Id;
  volumeId?: Id;
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
  sdfPrimitives: readonly SdfPrimitive[];
  volumePrimitives: readonly VolumePrimitive[];
  nodes: readonly Node[];
  rootNodeIds: readonly Id[];
  animationClips: readonly AnimationClip[];
}>;
