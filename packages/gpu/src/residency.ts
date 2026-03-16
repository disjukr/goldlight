import type { EvaluatedScene } from '@rieul3d/core';
import type { SceneIr } from '@rieul3d/ir';

export type ImageAsset = Readonly<{
  id: string;
  mimeType: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
}>;

export type AssetSource = Readonly<{
  images: ReadonlyMap<string, ImageAsset>;
}>;

export type TextureResidency = Readonly<{
  textureId: string;
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
}>;

export type GeometryResidency = Readonly<{
  meshId: string;
  vertexBuffer: GPUBuffer;
  indexBuffer?: GPUBuffer;
}>;

export type RuntimeResidency = {
  readonly textures: Map<string, TextureResidency>;
  readonly geometry: Map<string, GeometryResidency>;
  readonly pipelines: Map<string, GPURenderPipeline | GPUComputePipeline>;
};

export const createRuntimeResidency = (): RuntimeResidency => ({
  textures: new Map(),
  geometry: new Map(),
  pipelines: new Map(),
});

export const describeResidencyInputs = (
  scene: SceneIr,
  evaluatedScene: EvaluatedScene,
): Readonly<{
  meshCount: number;
  textureCount: number;
  nodeCount: number;
}> => ({
  meshCount: scene.meshes.length,
  textureCount: scene.textures.length,
  nodeCount: evaluatedScene.nodes.length,
});

export const invalidateResidency = (residency: RuntimeResidency): RuntimeResidency => {
  residency.textures.clear();
  residency.geometry.clear();
  residency.pipelines.clear();
  return residency;
};
