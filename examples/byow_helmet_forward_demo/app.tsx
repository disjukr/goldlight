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
import {
  createMaterialRegistry,
  type ForwardDebugView,
  type ForwardEnvironmentMap,
  renderForwardFrame,
} from '@rieul3d/renderer';

const helmetSource = await Deno.readFile(
  new URL('../assets/damaged-helmet/DamagedHelmet.glb', import.meta.url),
);
const environmentSource = await Deno.readFile(
  new URL('../assets/hdri/poly_haven_studio_1k.exr', import.meta.url),
);
const helmetScene = importGltfFromGlb(
  helmetSource,
  'damaged-helmet',
);
const environmentMap: ForwardEnvironmentMap = {
  id: 'poly-haven-studio',
  image: {
    id: 'poly-haven-studio',
    mimeType: 'image/exr',
    bytes: environmentSource,
  },
  intensity: 1.15,
};
const sourceMesh = helmetScene.meshes[0];

if (!sourceMesh) {
  throw new Error('Damaged Helmet mesh failed to load from the vendored GLB asset');
}

const helmetBounds = getMeshBounds(sourceMesh);
const helmetScale = 1.8 / helmetBounds.maxDimension;
const helmetMaterials = helmetScene.materials.map((material): Material => ({
  ...material,
  kind: 'lit',
}));
const helmetRotationDegreesPerSecond = 32;
const maxRotationDeltaMs = 100;

const HelmetScene = () => {
  const [yawDegrees, setYawDegrees] = React.useState(-30);

  React.useEffect(() => {
    let lastUpdateMs = performance.now();
    const timer = setInterval(() => {
      const nowMs = performance.now();
      const deltaMs = Math.min(nowMs - lastUpdateMs, maxRotationDeltaMs);
      lastUpdateMs = nowMs;
      setYawDegrees((value: number) =>
        (value + ((deltaMs / 1000) * helmetRotationDegreesPerSecond)) % 360
      );
    }, 16);
    return () => clearInterval(timer);
  }, []);

  const helmetRotation = createQuaternionFromEulerDegrees(72, yawDegrees, 0);
  return (
    <scene id='byow-helmet-forward-demo' activeCameraId='helmet-forward-camera'>
      {helmetScene.assets.map((asset) => <asset key={asset.id} {...asset} />)}
      {helmetScene.textures.map((texture) => <texture key={texture.id} {...texture} />)}
      {helmetMaterials.map((material) => <material key={material.id} {...material} />)}
      {helmetScene.meshes.map((mesh) => <mesh key={mesh.id} {...mesh} />)}
      <PerspectiveCamera
        id='helmet-forward-camera'
        position={[0.15, 0.2, 3.25]}
        znear={0.05}
        zfar={100}
        yfov={Math.PI / 4.4}
      />
      <DirectionalLight
        id='helmet-forward-key'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={4.8}
        nodeId='helmet-forward-key-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-50, -28, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <DirectionalLight
        id='helmet-forward-fill'
        color={{ x: 0.62, y: 0.7, z: 1 }}
        intensity={1.35}
        nodeId='helmet-forward-fill-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-26, 44, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <DirectionalLight
        id='helmet-forward-rim'
        color={{ x: 0.9, y: 0.96, z: 1 }}
        intensity={2.15}
        nodeId='helmet-forward-rim-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-34, 150, 0);
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
        rotation={[helmetRotation.x, helmetRotation.y, helmetRotation.z, helmetRotation.w]}
        scale={[helmetScale, helmetScale, helmetScale]}
      />
    </scene>
  );
};

export default async (
  { window }: DesktopModuleContext,
): Promise<void | DesktopModuleCleanup> => {
  let normalDebugEnabled = false;
  let selectedDebugView: ForwardDebugView = 'normal-world-mapped';
  const sceneRoot = createReactSceneRoot(<HelmetScene />);
  const target = {
    kind: 'surface' as const,
    width: window.surfaceInfo.width,
    height: window.surfaceInfo.height,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
  };
  const gpuContext = await requestGpuContext({ target });
  gpuContext.device.addEventListener('uncapturederror', (event) => {
    const detail = event as Event & { error?: unknown };
    console.error('[helmet-forward] GPU uncaptured error:', detail.error ?? event);
  });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const residency = createRuntimeResidency();
  const materialRegistry = createMaterialRegistry();
  const forwardRenderer = createSceneRootForwardRenderer(sceneRoot, {
    context: gpuContext,
    binding,
    residency,
    materialRegistry,
    initialTimeMs: performance.now(),
    hooks: {
      renderForwardFrame: (
        context,
        binding,
        residency,
        evaluatedScene,
        materialRegistry,
        postProcessPasses,
      ) =>
        renderForwardFrame(context, binding, residency, evaluatedScene, {
          materialRegistry,
          postProcessPasses,
          extension: {
            environmentMap,
            debugView: normalDebugEnabled ? selectedDebugView : 'none',
          },
        }),
    },
  });

  const handleKeyDown = (event: Event) => {
    const detail = (event as CustomEvent<{ keyCode: number; pressed: boolean }>).detail;
    if (detail.keyCode === 78) {
      normalDebugEnabled = !normalDebugEnabled;
      return;
    }

    if (detail.keyCode === 90) {
      selectedDebugView = 'normal-world-geometric';
      return;
    }
    if (detail.keyCode === 88) {
      selectedDebugView = 'normal-tangent-sampled';
      return;
    }
    if (detail.keyCode === 67) {
      selectedDebugView = 'normal-world-mapped';
      return;
    }
    if (detail.keyCode === 86) {
      selectedDebugView = 'normal-view-mapped';
      return;
    }
    if (detail.keyCode === 65) {
      selectedDebugView = 'tangent-world';
      return;
    }
    if (detail.keyCode === 83) {
      selectedDebugView = 'bitangent-world';
      return;
    }
    if (detail.keyCode === 68) {
      selectedDebugView = 'tangent-handedness';
      return;
    }
    if (detail.keyCode === 70) {
      selectedDebugView = 'normal-tangent-sampled-raw';
      return;
    }
    if (detail.keyCode === 71) {
      selectedDebugView = 'uv';
    }
  };

  window.runtime.addEventListener('keydown', handleKeyDown);

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
    window.runtime.removeEventListener('keydown', handleKeyDown);
    sceneRoot.unmount();
    forwardRenderer.dispose();
  };
};
