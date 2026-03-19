/// <reference lib="deno.unstable" />

import { EventType, WindowBuilder } from 'jsr:@divy/sdl2@0.15.0';
import { evaluateScene } from '../../packages/core/mod.ts';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  ensureSceneMeshResidency,
  requestGpuContext,
} from '../../packages/gpu/mod.ts';
import {
  appendCamera,
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '../../packages/ir/mod.ts';
import { createDenoSurfaceTarget } from '../../packages/platform/mod.ts';
import {
  createBoxMesh,
  createCapsuleMesh,
  createCylinderMesh,
  createDodecahedronMesh,
  createHexahedronMesh,
  createIcosahedronMesh,
  createOctahedronMesh,
  createSphereMesh,
  createTetrahedronMesh,
  createTorusMesh,
} from '../../packages/primitives/mod.ts';
import {
  createMaterialRegistry,
  registerWgslMaterial,
  renderForwardFrame,
} from '../../packages/renderer/mod.ts';
import litShader from './lit.wgsl' with { type: 'text' };

const width = 1200;
const height = 720;
const shaderId = 'shader:byow-primitives-lit';
const cameraId = 'byow-primitives-camera';

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

type PrimitiveEntry = Readonly<{
  meshId: string;
  materialId: string;
  color: readonly [number, number, number, number];
  translation: readonly [number, number, number];
  baseRotationDegrees: readonly [number, number, number];
  rotationRateDegrees: readonly [number, number, number];
  scale: readonly [number, number, number];
  mesh: ReturnType<
    | typeof createBoxMesh
    | typeof createSphereMesh
    | typeof createCylinderMesh
    | typeof createCapsuleMesh
    | typeof createTorusMesh
    | typeof createTetrahedronMesh
    | typeof createOctahedronMesh
    | typeof createHexahedronMesh
    | typeof createDodecahedronMesh
    | typeof createIcosahedronMesh
  >;
}>;

const primitiveEntries: readonly PrimitiveEntry[] = [
  {
    meshId: 'box-mesh',
    materialId: 'box-material',
    color: [0.94, 0.37, 0.29, 1],
    translation: [-3.6, 1.8, 0],
    baseRotationDegrees: [18, 24, -10],
    rotationRateDegrees: [18, 42, 12],
    scale: [1, 1, 1],
    mesh: createBoxMesh({ id: 'box-mesh' }),
  },
  {
    meshId: 'sphere-mesh',
    materialId: 'sphere-material',
    color: [0.97, 0.69, 0.24, 1],
    translation: [-1.8, 1.8, 0],
    baseRotationDegrees: [0, 32, 0],
    rotationRateDegrees: [10, 54, 0],
    scale: [1, 1, 1],
    mesh: createSphereMesh({ id: 'sphere-mesh' }),
  },
  {
    meshId: 'cylinder-mesh',
    materialId: 'cylinder-material',
    color: [0.39, 0.75, 0.41, 1],
    translation: [0, 1.8, 0],
    baseRotationDegrees: [24, -18, 0],
    rotationRateDegrees: [30, 28, 14],
    scale: [1, 1, 1],
    mesh: createCylinderMesh({ id: 'cylinder-mesh' }),
  },
  {
    meshId: 'capsule-mesh',
    materialId: 'capsule-material',
    color: [0.19, 0.72, 0.73, 1],
    translation: [1.8, 1.8, 0],
    baseRotationDegrees: [-20, 26, 12],
    rotationRateDegrees: [26, 36, 18],
    scale: [1, 1, 1],
    mesh: createCapsuleMesh({ id: 'capsule-mesh' }),
  },
  {
    meshId: 'torus-mesh',
    materialId: 'torus-material',
    color: [0.23, 0.54, 0.96, 1],
    translation: [3.6, 1.8, 0],
    baseRotationDegrees: [62, 20, 12],
    rotationRateDegrees: [44, 22, 36],
    scale: [1, 1, 1],
    mesh: createTorusMesh({ id: 'torus-mesh' }),
  },
  {
    meshId: 'tetrahedron-mesh',
    materialId: 'tetrahedron-material',
    color: [0.53, 0.44, 0.96, 1],
    translation: [-3.6, -1.8, 0],
    baseRotationDegrees: [18, -28, 16],
    rotationRateDegrees: [34, 40, 26],
    scale: [1, 1, 1],
    mesh: createTetrahedronMesh({ id: 'tetrahedron-mesh' }),
  },
  {
    meshId: 'octahedron-mesh',
    materialId: 'octahedron-material',
    color: [0.78, 0.33, 0.78, 1],
    translation: [-1.8, -1.8, 0],
    baseRotationDegrees: [28, 24, -16],
    rotationRateDegrees: [22, 48, 20],
    scale: [1, 1, 1],
    mesh: createOctahedronMesh({ id: 'octahedron-mesh' }),
  },
  {
    meshId: 'hexahedron-mesh',
    materialId: 'hexahedron-material',
    color: [0.9, 0.36, 0.62, 1],
    translation: [0, -1.8, 0],
    baseRotationDegrees: [26, 30, 18],
    rotationRateDegrees: [20, 32, 24],
    scale: [1, 1, 1],
    mesh: createHexahedronMesh({ id: 'hexahedron-mesh' }),
  },
  {
    meshId: 'dodecahedron-mesh',
    materialId: 'dodecahedron-material',
    color: [0.92, 0.55, 0.26, 1],
    translation: [1.8, -1.8, 0],
    baseRotationDegrees: [24, -24, 0],
    rotationRateDegrees: [16, 38, 22],
    scale: [1, 1, 1],
    mesh: createDodecahedronMesh({ id: 'dodecahedron-mesh' }),
  },
  {
    meshId: 'icosahedron-mesh',
    materialId: 'icosahedron-material',
    color: [0.35, 0.82, 0.57, 1],
    translation: [3.6, -1.8, 0],
    baseRotationDegrees: [-20, 34, -12],
    rotationRateDegrees: [28, 46, 18],
    scale: [1, 1, 1],
    mesh: createIcosahedronMesh({ id: 'icosahedron-mesh' }),
  },
];

const createPrimitiveScene = (timeMs: number) => {
  let scene = createSceneIr('byow-primitives-demo');
  scene = setActiveCamera(
    appendCamera(
      scene,
      createPerspectiveCamera(cameraId, {
        yfov: Math.PI / 3,
        znear: 0.1,
        zfar: 20,
      }),
    ),
    cameraId,
  );
  scene = appendNode(
    scene,
    createNode('byow-primitives-camera-node', {
      cameraId,
      transform: {
        translation: { x: 0, y: 0, z: 7.8 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  const elapsedSeconds = timeMs / 1000;

  for (const entry of primitiveEntries) {
    scene = appendMaterial(scene, {
      id: entry.materialId,
      kind: 'custom',
      shaderId,
      textures: [],
      parameters: {
        color: {
          x: entry.color[0],
          y: entry.color[1],
          z: entry.color[2],
          w: entry.color[3],
        },
      },
    });
    scene = appendMesh(scene, {
      ...entry.mesh,
      materialId: entry.materialId,
    });

    const rotation = createQuatFromEulerDegrees(
      entry.baseRotationDegrees[0] + (entry.rotationRateDegrees[0] * elapsedSeconds),
      entry.baseRotationDegrees[1] + (entry.rotationRateDegrees[1] * elapsedSeconds),
      entry.baseRotationDegrees[2] + (entry.rotationRateDegrees[2] * elapsedSeconds),
    );

    scene = appendNode(
      scene,
      createNode(`${entry.meshId}-node`, {
        meshId: entry.meshId,
        transform: {
          translation: {
            x: entry.translation[0],
            y: entry.translation[1],
            z: entry.translation[2],
          },
          rotation,
          scale: {
            x: entry.scale[0],
            y: entry.scale[1],
            z: entry.scale[2],
          },
        },
      }),
    );
  }

  return scene;
};

const scene = createPrimitiveScene(0);

const window = new WindowBuilder('rieul3d byow primitives demo', width, height).build();
const target = createDenoSurfaceTarget(
  width,
  height,
  navigator.gpu.getPreferredCanvasFormat(),
  'opaque',
);
const gpuContext = await requestGpuContext({ target });
const windowSurface = window.windowSurface(width, height);
const canvasContext = windowSurface.getContext('webgpu');

const surfaceBinding = createSurfaceBinding(
  gpuContext,
  canvasContext as unknown as GPUCanvasContext,
);
const residency = createRuntimeResidency();
const materialRegistry = registerWgslMaterial(createMaterialRegistry(), {
  id: shaderId,
  label: 'BYOW Primitive Lit',
  wgsl: litShader,
  vertexEntryPoint: 'vsMain',
  fragmentEntryPoint: 'fsMain',
  usesMaterialBindings: true,
  usesTransformBindings: true,
  materialBindings: [{ kind: 'uniform', binding: 0 }],
  vertexAttributes: [
    {
      semantic: 'POSITION',
      shaderLocation: 0,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
    {
      semantic: 'NORMAL',
      shaderLocation: 1,
      format: 'float32x3',
      offset: 0,
      arrayStride: 12,
    },
  ],
});
let evaluatedScene = evaluateScene(scene, { timeMs: 0 });
const startTime = performance.now();

ensureSceneMeshResidency(gpuContext, residency, scene, evaluatedScene);

const drawFrame = () => {
  const timeMs = performance.now() - startTime;
  const animatedScene = createPrimitiveScene(timeMs);
  evaluatedScene = evaluateScene(animatedScene, { timeMs });
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
