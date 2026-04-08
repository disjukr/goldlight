// @ts-nocheck
import type { DesktopModuleContext } from '@disjukr/goldlight/desktop';
import { evaluateScene } from '@disjukr/goldlight/renderer';
import {
  createRuntimeResidency,
  createSurfaceBinding,
  ensureSceneMaterialResidency,
  ensureSceneMeshResidency,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@disjukr/goldlight/gpu';
import {
  appendCamera,
  appendLight,
  appendMaterial,
  appendMesh,
  appendNode,
  createNode,
  createPerspectiveCamera,
  createSceneIr,
  setActiveCamera,
} from '@disjukr/goldlight/ir';
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
} from '@disjukr/goldlight/geometry';
import { createMaterialRegistry, renderForwardFrame } from '@disjukr/goldlight/renderer';

const cameraId = 'byow-primitives-camera';
const lightId = 'byow-primitives-key-light';

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
  scene = appendLight(scene, {
    id: lightId,
    kind: 'directional',
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.7,
  });
  scene = appendNode(
    scene,
    createNode('byow-primitives-light-node', {
      lightId,
      transform: {
        translation: { x: 0, y: 0, z: 0 },
        rotation: createQuatFromEulerDegrees(-42, -36, 0),
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  );

  const elapsedSeconds = timeMs / 1000;

  for (const entry of primitiveEntries) {
    scene = appendMaterial(scene, {
      id: entry.materialId,
      kind: 'lit',
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

export default async ({ window }: DesktopModuleContext): Promise<() => void> => {
  const target = {
    kind: 'surface' as const,
    width: window.surfaceInfo.width,
    height: window.surfaceInfo.height,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
  };
  const gpuContext = await requestGpuContext({ target, compatibleSurface: window.compatibleSurface });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const residency = createRuntimeResidency();
  const materialRegistry = createMaterialRegistry();
  const initialScene = createPrimitiveScene(0);
  const initialEvaluatedScene = evaluateScene(initialScene, { timeMs: 0 });
  ensureSceneMeshResidency(
    gpuContext,
    residency,
    initialScene,
    initialEvaluatedScene,
  );
  ensureSceneMaterialResidency(gpuContext, residency, initialEvaluatedScene);

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  const startTime = performance.now();
  let frameHandle = 0;
  const drawFrame = () => {
    const timeMs = performance.now() - startTime;
    const animatedScene = createPrimitiveScene(timeMs);
    const evaluatedScene = evaluateScene(animatedScene, { timeMs });
    ensureSceneMaterialResidency(gpuContext, residency, evaluatedScene);
    renderForwardFrame(
      gpuContext,
      binding,
      residency,
      { timeMs },
      evaluatedScene,
      materialRegistry,
    );
    window.present();
    frameHandle = window.runtime.requestAnimationFrame(drawFrame);
  };

  frameHandle = window.runtime.requestAnimationFrame(drawFrame);

  return () => {
    window.runtime.cancelAnimationFrame(frameHandle);
  };
};



