/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import { createQuaternionFromEulerDegrees, getMeshBounds } from '@goldlight/core';
import type { DesktopModuleCleanup, DesktopModuleContext } from '@goldlight/desktop';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@goldlight/gpu';
import type { Material } from '@goldlight/ir';
import { importGltfFromGlb } from '@goldlight/importers';
import {
  createReactSceneRoot,
  createSceneRootForwardRenderer,
  G3dDirectionalLight,
  G3dPerspectiveCamera,
} from '@goldlight/react/reconciler';
import {
  createMaterialRegistry,
  type ForwardDebugView,
  type ForwardEnvironmentMap,
  renderForwardFrame,
} from '@goldlight/renderer';

const helmetSource = await Deno.readFile(
  new URL('../assets/damaged-helmet/DamagedHelmet.glb', import.meta.url),
);
const polyHavenStudioSource = await Deno.readFile(
  new URL('../assets/hdri/poly_haven_studio_1k.exr', import.meta.url),
);
const ferndaleStudioSource = await Deno.readFile(
  new URL('../assets/hdri/ferndale_studio_08_1k.exr', import.meta.url),
);
const pavStudioSource = await Deno.readFile(
  new URL('../assets/hdri/pav_studio_01_1k.exr', import.meta.url),
);
const helmetScene = importGltfFromGlb(
  helmetSource,
  'damaged-helmet',
);
const environmentMaps: readonly ForwardEnvironmentMap[] = [
  {
    id: 'poly-haven-studio',
    image: {
      id: 'poly-haven-studio',
      mimeType: 'image/exr',
      bytes: polyHavenStudioSource,
    },
    intensity: 1.15,
  },
  {
    id: 'ferndale-studio-08',
    image: {
      id: 'ferndale-studio-08',
      mimeType: 'image/exr',
      bytes: ferndaleStudioSource,
    },
    intensity: 1.05,
  },
  {
    id: 'pav-studio-01',
    image: {
      id: 'pav-studio-01',
      mimeType: 'image/exr',
      bytes: pavStudioSource,
    },
    intensity: 0.95,
  },
];
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
    <g3d-scene id='byow-helmet-forward-demo' activeCameraId='helmet-forward-camera'>
      {helmetScene.assets.map((asset) => <g3d-asset key={asset.id} {...asset} />)}
      {helmetScene.textures.map((texture) => <g3d-texture key={texture.id} {...texture} />)}
      {helmetMaterials.map((material) => <g3d-material key={material.id} {...material} />)}
      {helmetScene.meshes.map((mesh) => <g3d-mesh key={mesh.id} {...mesh} />)}
      <G3dPerspectiveCamera
        id='helmet-forward-camera'
        position={[0, 0.18, 2.35]}
        znear={0.05}
        zfar={100}
        yfov={Math.PI / 3}
      />
      <G3dDirectionalLight
        id='helmet-forward-key'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={4.8}
        nodeId='helmet-forward-key-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-50, -28, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <G3dDirectionalLight
        id='helmet-forward-fill'
        color={{ x: 0.62, y: 0.7, z: 1 }}
        intensity={1.35}
        nodeId='helmet-forward-fill-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-26, 44, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <G3dDirectionalLight
        id='helmet-forward-rim'
        color={{ x: 0.9, y: 0.96, z: 1 }}
        intensity={2.15}
        nodeId='helmet-forward-rim-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-34, 150, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <g3d-node
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
    </g3d-scene>
  );
};

export default async (
  { window }: DesktopModuleContext,
): Promise<void | DesktopModuleCleanup> => {
  let normalDebugEnabled = false;
  let selectedDebugView: ForwardDebugView = 'normal-world-mapped';
  let selectedEnvironmentMap: ForwardEnvironmentMap = environmentMaps[0]!;
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
        renderForwardFrame(context, binding, residency, {}, evaluatedScene, {
          materialRegistry,
          postProcessPasses,
          extension: {
            environmentMap: selectedEnvironmentMap,
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
      return;
    }

    if (detail.keyCode === 49) {
      selectedEnvironmentMap = environmentMaps[0];
      return;
    }
    if (detail.keyCode === 50) {
      selectedEnvironmentMap = environmentMaps[1];
      return;
    }
    if (detail.keyCode === 51) {
      selectedEnvironmentMap = environmentMaps[2];
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
    forwardRenderer.renderFrame({ timeMs });
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
