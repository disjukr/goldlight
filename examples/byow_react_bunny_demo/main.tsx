/** @jsxImportSource @rieul3d/react */
/** @jsxRuntime automatic */
/// <reference lib="deno.unstable" />

import { EventType, WindowBuilder } from 'jsr:@divy/sdl2@0.15.0';
import { evaluateScene } from '../../packages/core/mod.ts';
import {
  configureSurfaceContext,
  createRuntimeResidency,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import type { MeshAttribute, MeshPrimitive } from '../../packages/ir/mod.ts';
import { loadPlyFromText } from '../../packages/loaders/mod.ts';
import { createDenoSurfaceTarget } from '../../packages/platform/mod.ts';
import { createSceneRoot, DirectionalLight, PerspectiveCamera } from '../../packages/react/mod.ts';
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

const createQuatFromEulerDegrees = (
  xDegrees: number,
  yDegrees: number,
  zDegrees: number,
) => {
  const x = (xDegrees * Math.PI) / 180;
  const y = (yDegrees * Math.PI) / 180;
  const z = (zDegrees * Math.PI) / 180;
  const sx = Math.sin(x / 2);
  const cx = Math.cos(x / 2);
  const sy = Math.sin(y / 2);
  const cy = Math.cos(y / 2);
  const sz = Math.sin(z / 2);
  const cz = Math.cos(z / 2);

  return {
    x: (sx * cy * cz) - (cx * sy * sz),
    y: (cx * sy * cz) + (sx * cy * sz),
    z: (cx * cy * sz) - (sx * sy * cz),
    w: (cx * cy * cz) + (sx * sy * sz),
  };
};

const createNormalsAttribute = (mesh: MeshPrimitive): MeshAttribute => {
  const positions = mesh.attributes.find((attribute) => attribute.semantic === 'POSITION')?.values;
  if (!positions) {
    throw new Error(`Mesh "${mesh.id}" is missing POSITION data`);
  }

  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  const indices = mesh.indices;

  const accumulateFaceNormal = (aIndex: number, bIndex: number, cIndex: number) => {
    const ax = positions[aIndex * 3];
    const ay = positions[(aIndex * 3) + 1];
    const az = positions[(aIndex * 3) + 2];
    const bx = positions[bIndex * 3];
    const by = positions[(bIndex * 3) + 1];
    const bz = positions[(bIndex * 3) + 2];
    const cx = positions[cIndex * 3];
    const cy = positions[(cIndex * 3) + 1];
    const cz = positions[(cIndex * 3) + 2];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = (aby * acz) - (abz * acy);
    const ny = (abz * acx) - (abx * acz);
    const nz = (abx * acy) - (aby * acx);

    normals[aIndex * 3] += nx;
    normals[(aIndex * 3) + 1] += ny;
    normals[(aIndex * 3) + 2] += nz;
    normals[bIndex * 3] += nx;
    normals[(bIndex * 3) + 1] += ny;
    normals[(bIndex * 3) + 2] += nz;
    normals[cIndex * 3] += nx;
    normals[(cIndex * 3) + 1] += ny;
    normals[(cIndex * 3) + 2] += nz;
  };

  if (indices && indices.length >= 3) {
    for (let index = 0; index < indices.length; index += 3) {
      accumulateFaceNormal(indices[index], indices[index + 1], indices[index + 2]);
    }
  } else {
    for (let index = 0; index < vertexCount; index += 3) {
      accumulateFaceNormal(index, index + 1, index + 2);
    }
  }

  for (let index = 0; index < vertexCount; index += 1) {
    const x = normals[index * 3];
    const y = normals[(index * 3) + 1];
    const z = normals[(index * 3) + 2];
    const length = Math.hypot(x, y, z) || 1;
    normals[index * 3] = x / length;
    normals[(index * 3) + 1] = y / length;
    normals[(index * 3) + 2] = z / length;
  }

  return {
    semantic: 'NORMAL',
    itemSize: 3,
    values: Array.from(normals),
  };
};

const getMeshBounds = (mesh: MeshPrimitive) => {
  const positions = mesh.attributes.find((attribute) => attribute.semantic === 'POSITION')?.values;
  if (!positions) {
    throw new Error(`Mesh "${mesh.id}" is missing POSITION data`);
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    center: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ] as const,
    maxDimension: Math.max(maxX - minX, maxY - minY, maxZ - minZ),
  };
};

const bunnyMeshWithNormals: MeshPrimitive = {
  ...bunnyMesh,
  id: 'stanford-bunny-mesh',
  materialId: 'stanford-bunny-material',
  attributes: [
    ...bunnyMesh.attributes,
    createNormalsAttribute(bunnyMesh),
  ],
};
const bunnyBounds = getMeshBounds(bunnyMesh);
const bunnyScale = 1.6 / bunnyBounds.maxDimension;
const lightRotation = createQuatFromEulerDegrees(-42, -36, 0);

const BunnyScene = () => (
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
      nodeId='key-light-node'
      color={{ x: 1, y: 0.95, z: 0.9 }}
      intensity={1.7}
      rotation={[lightRotation.x, lightRotation.y, lightRotation.z, lightRotation.w]}
    />
    <group id='bunny-root'>
      <node
        id='stanford-bunny-node'
        meshId='stanford-bunny-mesh'
        position={[
          -bunnyBounds.center[0] * bunnyScale,
          -bunnyBounds.center[1] * bunnyScale,
          -bunnyBounds.center[2] * bunnyScale,
        ]}
        scale={[bunnyScale, bunnyScale, bunnyScale]}
      />
    </group>
  </scene>
);

const sceneRoot = createSceneRoot(<BunnyScene />);
const scene = sceneRoot.getScene();

if (!scene) {
  throw new Error('Scene root did not publish the initial Stanford Bunny scene');
}

const applyAnimatedBunnyRotation = (baseScene: typeof scene, timeMs: number) => {
  const bunnyRotation = createQuatFromEulerDegrees(0, 22 + ((timeMs / 1000) * 16), 0);
  return {
    ...baseScene,
    nodes: baseScene.nodes.map((node) =>
      node.id === 'bunny-root'
        ? {
          ...node,
          transform: {
            ...node.transform,
            rotation: bunnyRotation,
          },
        }
        : node
    ),
  };
};

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
const startTime = performance.now();

const drawFrame = () => {
  const timeMs = performance.now() - startTime;
  const animatedScene = applyAnimatedBunnyRotation(scene, timeMs);
  const evaluatedScene = evaluateScene(animatedScene, { timeMs });
  ensureSceneMeshResidency(gpuContext, residency, animatedScene, evaluatedScene);
  renderForwardFrame(gpuContext, surfaceBinding, residency, evaluatedScene, materialRegistry);
  windowSurface.present();
};

for await (const event of window.events()) {
  switch (event.type) {
    case EventType.Draw:
      drawFrame();
      break;
    case EventType.Quit:
      Deno.exit(0);
      break;
  }
}
