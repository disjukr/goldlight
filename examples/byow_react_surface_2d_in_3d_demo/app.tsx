/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import { createQuaternionFromEulerDegrees } from '@goldlight/core';
import { initializeWindow, useSetTimeMs, useTimeMs, useWindowMetrics } from '@goldlight/desktop';
import {
  createBoxMesh,
  createPath2d,
  createTranslationMatrix2d,
  multiplyMatrix2d,
  type Path2d,
} from '@goldlight/geometry';
import { G3dDirectionalLight, G3dPerspectiveCamera } from '@goldlight/react/reconciler';

const DemoScene = () => (
  <g3d-scene
    id='byow-react-surface2d-demo'
    activeCameraId='camera-main'
    msaaSampleCount={1}
    clearColor={[0.08, 0.19, 0.26, 1]}
  >
    <DemoFrameDriver />
    <StaticSceneResources />
    <StaticSceneRig />
    <AnimatedRoomBox />
    <StatusPanelScene />
    <AnimatedPanelNode />
  </g3d-scene>
);

export default initializeWindow(DemoScene);

const panelViewportWidth = 384;
const panelViewportHeight = 384;
const panelCenterX = panelViewportWidth / 2;
const panelCenterY = panelViewportHeight / 2;
const outerGlowPath = createStarPath(74, 182, 5);
const starPath = createStarPath(88, 156, 5);
const innerCutPath = createStarPath(28, 62, 5);

const boxMesh = createBoxMesh({
  id: 'box-mesh',
  width: 2.6,
  height: 1.6,
  depth: 0.8,
});

const panelMeshAttributes = [
  {
    semantic: 'POSITION' as const,
    itemSize: 3,
    values: [
      -1.175,
      1.175,
      0,
      -1.175,
      -1.175,
      0,
      1.175,
      -1.175,
      0,
      1.175,
      1.175,
      0,
    ],
  },
  {
    semantic: 'TEXCOORD_0' as const,
    itemSize: 2,
    values: [0, 0, 0, 1, 1, 1, 1, 0],
  },
];

const roomKeyLightRotation = (() => {
  const rotation = createQuaternionFromEulerDegrees(-42, -34, 0);
  return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
})();

const roomFillLightRotation = (() => {
  const rotation = createQuaternionFromEulerDegrees(-24, 56, 0);
  return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
})();

function createStarPath(
  innerRadius: number,
  outerRadius: number,
  points: number,
): Path2d {
  const commands: Array<{ kind: 'moveTo' | 'lineTo'; to: [number, number] } | { kind: 'close' }> =
    [];

  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI * index) / points;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    commands.push(index === 0 ? { kind: 'moveTo', to: [x, y] } : { kind: 'lineTo', to: [x, y] });
  }

  commands.push({ kind: 'close' });
  return createPath2d(...commands);
}

function createRotationMatrix2d(radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0] as const;
}

function createCenteredRotationTransform(radians: number) {
  return multiplyMatrix2d(
    createTranslationMatrix2d(panelCenterX, panelCenterY),
    createRotationMatrix2d(radians),
  );
}

const DemoFrameDriver = () => {
  const setTimeMs = useSetTimeMs();

  React.useEffect(() => {
    const startMs = performance.now();
    let handle = 0;

    const tick = (nowMs: number) => {
      setTimeMs(nowMs - startMs);
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [setTimeMs]);

  return null;
};

const StaticSceneResources = React.memo(() => (
  <>
    <g3d-material
      id='box-material'
      kind='lit'
      textures={[]}
      parameters={{
        color: { x: 0.16, y: 0.24, z: 0.32, w: 1 },
        emissive: { x: 0.03, y: 0.05, z: 0.07, w: 1 },
        metallicRoughness: { x: 0.05, y: 0.7, z: 1, w: 1 },
      }}
    />
    <g3d-mesh {...boxMesh} materialId='box-material' />
    <g3d-material
      id='panel-material'
      kind='unlit'
      alphaMode='blend'
      depthWrite={false}
      doubleSided
      textures={[{
        id: 'status-panel-texture',
        semantic: 'baseColor',
        colorSpace: 'srgb',
        sampler: 'linear',
      }]}
      parameters={{
        color: { x: 1, y: 1, z: 1, w: 1 },
      }}
    />
    <g3d-mesh
      id='panel-mesh'
      materialId='panel-material'
      attributes={panelMeshAttributes}
      indices={[0, 1, 2, 0, 2, 3]}
    />
  </>
));

const StaticSceneRig = React.memo(() => (
  <>
    <G3dPerspectiveCamera id='camera-main' position={[0, 0, 5.8]} znear={0.05} zfar={30} />
    <G3dDirectionalLight
      id='room-key-light'
      color={{ x: 1, y: 0.95, z: 0.9 }}
      intensity={4.1}
      nodeId='room-key-light-node'
      rotation={roomKeyLightRotation}
    />
    <G3dDirectionalLight
      id='room-fill-light'
      color={{ x: 0.58, y: 0.76, z: 1 }}
      intensity={1.9}
      nodeId='room-fill-light-node'
      rotation={roomFillLightRotation}
    />
  </>
));

const AnimatedRoomBox = () => {
  const timeMs = useTimeMs();
  const t = timeMs / 1000;
  const liveRoomRotation = createQuaternionFromEulerDegrees(
    16 + (Math.sin(t * 0.55) * 9),
    26 + (t * 24),
    Math.sin(t * 0.8) * 5,
  );

  return (
    <g3d-node
      id='room-box'
      meshId='box-mesh'
      position={[0, Math.sin(t * 0.82) * 0.12, 0]}
      rotation={[liveRoomRotation.x, liveRoomRotation.y, liveRoomRotation.z, liveRoomRotation.w]}
    />
  );
};

const AnimatedPanelNode = () => {
  const timeMs = useTimeMs();
  const t = timeMs / 1000;
  const livePanelRotation = createQuaternionFromEulerDegrees(
    -10 + (Math.sin(t * 0.85) * 6),
    -24 + (Math.cos(t * 0.95) * 10),
    Math.sin(t * 1.35) * 4,
  );
  const panelOffsetX = -0.9 + (Math.sin(t * 0.95) * 0.92);
  const panelOffsetY = 0.44 + (Math.cos(t * 1.15) * 0.16);
  const panelOffsetZ = 0.56 + (Math.sin(t * 0.75) * 0.14);

  return (
    <g3d-node
      id='status-panel-node'
      meshId='panel-mesh'
      position={[panelOffsetX, panelOffsetY, panelOffsetZ]}
      rotation={[
        livePanelRotation.x,
        livePanelRotation.y,
        livePanelRotation.z,
        livePanelRotation.w,
      ]}
    />
  );
};

const AnimatedPanelArtwork = () => {
  const timeMs = useTimeMs();
  const t = timeMs / 1000;
  const starRotation = t * 1.7;
  const glow = 0.5 + (Math.sin(t * 2.2) * 0.5);
  const pulse = 0.5 + (Math.sin(t * 3.4) * 0.5);

  return (
    <>
      <g2d-group
        transform={createCenteredRotationTransform((-starRotation * 0.72) - 0.2)}
      >
        <g2d-path
          path={outerGlowPath}
          style='fill'
          color={[0.9, 0.28 + (glow * 0.14), 0.5 + (glow * 0.1), 0.24 + (glow * 0.12)]}
        />
      </g2d-group>
      <g2d-group transform={createCenteredRotationTransform(starRotation)}>
        <g2d-path
          path={starPath}
          style='fill'
          color={[0.98, 0.78, 0.2, 1]}
        />
        <g2d-path
          path={starPath}
          style='stroke'
          strokeWidth={14}
          strokeJoin='round'
          strokeCap='round'
          color={[1, 0.96, 0.88, 1]}
        />
      </g2d-group>
      <g2d-group transform={createCenteredRotationTransform(-starRotation * 1.3)}>
        <g2d-path
          path={innerCutPath}
          style='fill'
          color={[0.08, 0.14, 0.22, 0.72]}
        />
      </g2d-group>
      <g2d-circle
        cx={panelCenterX}
        cy={panelCenterY}
        radius={18 + (pulse * 28)}
        style='fill'
        color={[1, 0.98, 0.86, 0.68 + (pulse * 0.28)]}
      />
      <g2d-circle
        cx={panelCenterX}
        cy={panelCenterY}
        radius={36 + (pulse * 34)}
        style='stroke'
        strokeWidth={10 + (pulse * 8)}
        color={[1, 0.9, 0.48, 0.18 + (pulse * 0.18)]}
      />
    </>
  );
};

const StatusPanelScene = () => {
  const { scaleFactor } = useWindowMetrics();
  const panelTextureWidth = Math.max(1, Math.round(panelViewportWidth * scaleFactor));
  const panelTextureHeight = Math.max(1, Math.round(panelViewportHeight * scaleFactor));

  return (
    <g2d-scene
      id='status-panel'
      outputTextureId='status-panel-texture'
      viewportWidth={panelViewportWidth}
      viewportHeight={panelViewportHeight}
      textureWidth={panelTextureWidth}
      textureHeight={panelTextureHeight}
    >
      <AnimatedPanelArtwork />
    </g2d-scene>
  );
};
