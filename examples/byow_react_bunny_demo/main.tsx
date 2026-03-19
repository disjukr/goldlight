/// <reference lib="deno.unstable" />

import { EventType, WindowBuilder } from 'jsr:@divy/sdl2@0.15.0';
import React from 'npm:react@19.2.0';
import {
  createMeshNormalsAttribute,
  createQuaternionFromEulerDegrees,
  evaluateScene,
  getMeshBounds,
} from '../../packages/core/mod.ts';
import {
  configureSurfaceContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import type { MeshPrimitive } from '../../packages/ir/mod.ts';
import { loadPlyFromText } from '../../packages/loaders/mod.ts';
import { createDenoSurfaceTarget } from '../../packages/platform/mod.ts';
import {
  createReactSceneRoot,
  DirectionalLight,
  flushReactSceneUpdates,
  PerspectiveCamera,
} from '../../packages/react/reconciler.ts';
import { createMaterialRegistry, renderForwardFrame } from '../../packages/renderer/mod.ts';

const width = 1280;
const height = 720;
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

const BunnyScene = () => {
  const [yawDegrees, setYawDegrees] = React.useState(22);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setYawDegrees((value: number) => value + 1);
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

const sceneRoot = createReactSceneRoot(<BunnyScene />);
let scene = sceneRoot.getScene();

if (!scene) {
  throw new Error('Scene root did not publish the initial Stanford Bunny scene');
}
sceneRoot.subscribe((commit) => {
  scene = commit.scene;
});

const window = new WindowBuilder('rieul3d byow react bunny demo', width, height).build();
const target = createDenoSurfaceTarget(
  width,
  height,
  navigator.gpu.getPreferredCanvasFormat(),
  'opaque',
);
const gpuContext = await requestGpuContext({ target });
const windowSurface = window.windowSurface(width, height);
const canvasContext = windowSurface.getContext('webgpu');

const surfaceBinding = configureSurfaceContext(
  gpuContext,
  canvasContext as unknown as GPUCanvasContext,
);
const residency = createRuntimeResidency();
const materialRegistry = createMaterialRegistry();

const drawFrame = () => {
  flushReactSceneUpdates();
  const currentScene = scene;
  if (!currentScene) {
    throw new Error('React scene root stopped publishing Stanford Bunny snapshots');
  }
  const timeMs = performance.now();
  const evaluatedScene = evaluateScene(currentScene, { timeMs });
  ensureSceneMeshResidency(gpuContext, residency, currentScene, evaluatedScene);
  renderForwardFrame(gpuContext, surfaceBinding, residency, evaluatedScene, materialRegistry);
  windowSurface.present();
};

for await (const event of window.events()) {
  switch (event.type) {
    case EventType.Draw:
      drawFrame();
      await new Promise((resolve) => setTimeout(resolve, 0));
      break;
    case EventType.Quit:
      Deno.exit(0);
      break;
  }
}
