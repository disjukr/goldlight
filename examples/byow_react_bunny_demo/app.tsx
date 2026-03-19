/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />

import React from 'npm:react@19.2.0';
import {
  createMeshNormalsAttribute,
  createQuaternionFromEulerDegrees,
  getMeshBounds,
} from '@rieul3d/core';
import type { DesktopModuleCleanup, DesktopModuleContext } from '@rieul3d/desktop';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@rieul3d/gpu';
import type { MeshPrimitive } from '@rieul3d/ir';
import { loadPlyFromText } from '@rieul3d/importers';
import {
  createReactSceneRoot,
  createSceneRootForwardRenderer,
  DirectionalLight,
  PerspectiveCamera,
} from '@rieul3d/react/reconciler';
import { createMaterialRegistry } from '@rieul3d/renderer';

const bunnySource = await Deno.readTextFile(
  new URL('../assets/stanford-bunny/bun_zipper.ply', import.meta.url),
);
const bunnyScene = loadPlyFromText(bunnySource, 'stanford-bunny');
const bunnyMesh = bunnyScene.meshes[0];

if (!bunnyMesh) {
  throw new Error('Stanford Bunny mesh failed to load from the vendored PLY asset');
}

const bunnyMeshWithNormals: MeshPrimitive = {
  ...bunnyMesh,
  id: 'stanford-bunny-mesh',
  materialId: 'stanford-bunny-material',
  attributes: [
    ...bunnyMesh.attributes,
    createMeshNormalsAttribute(bunnyMesh),
  ],
};
const bunnyBounds = getMeshBounds(bunnyMesh);
const bunnyScale = 1.6 / bunnyBounds.maxDimension;
const lightRotation = createQuaternionFromEulerDegrees(-42, -36, 0);
const bunnyRotationDegreesPerSecond = 60;
const maxRotationDeltaMs = 100;

const BunnyScene = () => {
  const [yawDegrees, setYawDegrees] = React.useState(22);

  React.useEffect(() => {
    let lastUpdateMs = performance.now();
    const timer = setInterval(() => {
      const nowMs = performance.now();
      const deltaMs = Math.min(nowMs - lastUpdateMs, maxRotationDeltaMs);
      lastUpdateMs = nowMs;
      setYawDegrees((value: number) =>
        (value + ((deltaMs / 1000) * bunnyRotationDegreesPerSecond)) % 360
      );
    }, 16);
    return () => clearInterval(timer);
  }, []);

  const bunnyRotation = createQuaternionFromEulerDegrees(0, yawDegrees, 0);
  return (
    <scene id='byow-react-bunny' activeCameraId='camera-main'>
      <material
        id='stanford-bunny-material'
        kind='lit'
        textures={[]}
        parameters={{
          color: { x: 0.82, y: 0.84, z: 0.88, w: 1 },
        }}
      />
      <mesh {...bunnyMeshWithNormals} />
      <PerspectiveCamera
        id='camera-main'
        position={[0, 0.28, 3.1]}
        znear={0.05}
        zfar={20}
        yfov={Math.PI / 3}
      />
      <DirectionalLight
        id='key-light'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.7}
        nodeId='key-light-node'
        rotation={[lightRotation.x, lightRotation.y, lightRotation.z, lightRotation.w]}
      />
      <node
        id='bunny-root'
        rotation={[bunnyRotation.x, bunnyRotation.y, bunnyRotation.z, bunnyRotation.w]}
      >
        <node
          id='stanford-bunny-node'
          meshId='stanford-bunny-mesh'
          position={[
            -bunnyBounds.center.x * bunnyScale,
            -bunnyBounds.center.y * bunnyScale,
            -bunnyBounds.center.z * bunnyScale,
          ]}
          scale={[bunnyScale, bunnyScale, bunnyScale]}
        />
      </node>
    </scene>
  );
};

export default async (
  { window }: DesktopModuleContext,
): Promise<void | DesktopModuleCleanup> => {
  const sceneRoot = createReactSceneRoot(<BunnyScene />);
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
