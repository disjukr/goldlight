/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import { createQuaternionFromEulerDegrees, getMeshBounds } from '@rieul3d/core';
import type { DesktopModuleCleanup, DesktopModuleContext } from '@rieul3d/desktop';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@rieul3d/gpu';
import type { Material } from '@rieul3d/ir';
import { importGltfFromGlb } from '@rieul3d/importers';
import {
  createReactSceneRoot,
  createSceneRootForwardRenderer,
  DirectionalLight,
  PerspectiveCamera,
} from '@rieul3d/react/reconciler';
import { createMaterialRegistry } from '@rieul3d/renderer';
import { createBoxMesh } from '@rieul3d/geometry';

const helmetSource = await Deno.readFile(
  new URL('../assets/damaged-helmet/DamagedHelmet.glb', import.meta.url),
);
const helmetScene = importGltfFromGlb(
  helmetSource,
  'damaged-helmet',
);
const sourceMesh = helmetScene.meshes[0];

if (!sourceMesh) {
  throw new Error('Damaged Helmet mesh failed to load from the vendored GLB asset');
}

const helmetBounds = getMeshBounds(sourceMesh);
const helmetScale = 1.8 / helmetBounds.maxDimension;
const floorMesh = createBoxMesh({
  id: 'helmet-forward-floor',
  materialId: 'helmet-forward-floor-material',
  width: 7,
  height: 0.16,
  depth: 7,
});
const helmetMaterials = helmetScene.materials.map((material): Material => ({
  ...material,
  kind: 'lit',
}));

const HelmetScene = () => (
  <scene id='byow-helmet-forward-demo' activeCameraId='helmet-forward-camera'>
    {helmetScene.assets.map((asset) => <asset key={asset.id} {...asset} />)}
    {helmetScene.textures.map((texture) => <texture key={texture.id} {...texture} />)}
    {helmetMaterials.map((material) => <material key={material.id} {...material} />)}
    {helmetScene.meshes.map((mesh) => <mesh key={mesh.id} {...mesh} />)}
    <material
      id='helmet-forward-floor-material'
      kind='lit'
      textures={[]}
      parameters={{
        color: { x: 0.58, y: 0.61, z: 0.66, w: 1 },
        metallicRoughness: { x: 0.05, y: 0.92, z: 1, w: 1 },
        emissive: { x: 0, y: 0, z: 0, w: 1 },
      }}
    />
    <mesh {...floorMesh} />
    <PerspectiveCamera
      id='helmet-forward-camera'
      position={[0.15, 0.2, 3.25]}
      znear={0.05}
      zfar={100}
      yfov={Math.PI / 4.4}
    />
    <DirectionalLight
      id='helmet-forward-key'
      color={{ x: 1, y: 0.94, z: 0.88 }}
      intensity={1.75}
      nodeId='helmet-forward-key-node'
      rotation={(() => {
        const rotation = createQuaternionFromEulerDegrees(-54, -32, 0);
        return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
      })()}
    />
    <DirectionalLight
      id='helmet-forward-fill'
      color={{ x: 0.46, y: 0.58, z: 0.95 }}
      intensity={0.48}
      nodeId='helmet-forward-fill-node'
      rotation={(() => {
        const rotation = createQuaternionFromEulerDegrees(-18, 52, 0);
        return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
      })()}
    />
    <DirectionalLight
      id='helmet-forward-rim'
      color={{ x: 0.74, y: 0.86, z: 1 }}
      intensity={0.82}
      nodeId='helmet-forward-rim-node'
      rotation={(() => {
        const rotation = createQuaternionFromEulerDegrees(-38, 156, 0);
        return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
      })()}
    />
    <node
      id='helmet-forward-node'
      meshId={sourceMesh.id}
      position={[
        -helmetBounds.center.x * helmetScale,
        -(helmetBounds.min.y * helmetScale) - 0.92,
        (-helmetBounds.center.z * helmetScale) - 0.5,
      ]}
      rotation={(() => {
        const rotation = createQuaternionFromEulerDegrees(72, -30, 0);
        return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
      })()}
      scale={[helmetScale, helmetScale, helmetScale]}
    />
    <node
      id='helmet-forward-floor-node'
      meshId='helmet-forward-floor'
      position={[0, -1.06, -0.85]}
    />
  </scene>
);

export default async (
  { window }: DesktopModuleContext,
): Promise<void | DesktopModuleCleanup> => {
  const sceneRoot = createReactSceneRoot(<HelmetScene />);
  const target = {
    kind: 'surface' as const,
    width: window.surfaceInfo.width,
    height: window.surfaceInfo.height,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
  };
  const gpuContext = await requestGpuContext({ target });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const residency = createRuntimeResidency();
  const materialRegistry = createMaterialRegistry();
  const forwardRenderer = createSceneRootForwardRenderer(sceneRoot, {
    context: gpuContext,
    binding,
    residency,
    materialRegistry,
    initialTimeMs: performance.now(),
  });

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  let frameHandle = 0;
  const drawFrame = (timeMs: number) => {
    forwardRenderer.renderFrame(timeMs);
    window.present();
    frameHandle = requestAnimationFrame(drawFrame);
  };

  frameHandle = requestAnimationFrame(drawFrame);

  return () => {
    cancelAnimationFrame(frameHandle);
    sceneRoot.unmount();
    forwardRenderer.dispose();
  };
};
