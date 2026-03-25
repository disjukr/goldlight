/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import { createQuaternionFromEulerDegrees } from '@goldlight/core';
import { initializeWindow } from '@goldlight/desktop';
import { createBoxMesh, createPath2d, type Path2d } from '@goldlight/geometry';
import { G3dDirectionalLight, G3dPerspectiveCamera } from '@goldlight/react/reconciler';

const createStarPath = (
  innerRadius: number,
  outerRadius: number,
  points: number,
  rotationRadians: number,
): Path2d => {
  const commands: Array<{ kind: 'moveTo' | 'lineTo'; to: [number, number] } | { kind: 'close' }> =
    [];

  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotationRadians + ((Math.PI * index) / points);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    commands.push(index === 0 ? { kind: 'moveTo', to: [x, y] } : { kind: 'lineTo', to: [x, y] });
  }

  commands.push({ kind: 'close' });
  return createPath2d(...commands);
};

type DemoSceneProps = Readonly<{
  timeMs: number;
}>;

const DemoScene = ({ timeMs }: DemoSceneProps) => {
  const t = timeMs / 1000;
  const starRotation = t * 1.7;
  const glow = 0.5 + (Math.sin(t * 2.2) * 0.5);
  const pulse = 0.5 + (Math.sin(t * 3.4) * 0.5);
  const liveRoomRotation = createQuaternionFromEulerDegrees(
    16 + (Math.sin(t * 0.55) * 9),
    26 + (t * 24),
    Math.sin(t * 0.8) * 5,
  );
  const livePanelRotation = createQuaternionFromEulerDegrees(
    -10 + (Math.sin(t * 0.85) * 6),
    -24 + (Math.cos(t * 0.95) * 10),
    Math.sin(t * 1.35) * 4,
  );
  const panelOffsetX = -0.9 + (Math.sin(t * 0.95) * 0.92);
  const panelOffsetY = 0.44 + (Math.cos(t * 1.15) * 0.16);
  const panelOffsetZ = 0.56 + (Math.sin(t * 0.75) * 0.14);
  const outerGlow = createStarPath(74, 182, 5, (-starRotation * 0.72) - 0.2);
  const starPath = createStarPath(88, 156, 5, starRotation);
  const innerCut = createStarPath(28, 62, 5, -starRotation * 1.3);

  return (
    <g3d-scene
      id='byow-react-surface2d-demo'
      activeCameraId='camera-main'
      clearColor={[0.08, 0.19, 0.26, 1]}
    >
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
      <g3d-mesh
        {...createBoxMesh({
          id: 'box-mesh',
          width: 2.6,
          height: 1.6,
          depth: 0.8,
        })}
        materialId='box-material'
      />
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
        attributes={[
          {
            semantic: 'POSITION',
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
            semantic: 'TEXCOORD_0',
            itemSize: 2,
            values: [0, 0, 0, 1, 1, 1, 1, 0],
          },
        ]}
        indices={[0, 1, 2, 0, 2, 3]}
      />
      <G3dPerspectiveCamera id='camera-main' position={[0, 0, 5.8]} znear={0.05} zfar={30} />
      <G3dDirectionalLight
        id='room-key-light'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={4.1}
        nodeId='room-key-light-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-42, -34, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <G3dDirectionalLight
        id='room-fill-light'
        color={{ x: 0.58, y: 0.76, z: 1 }}
        intensity={1.9}
        nodeId='room-fill-light-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-24, 56, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <g3d-node
        id='room-box'
        meshId='box-mesh'
        position={[0, Math.sin(t * 0.82) * 0.12, 0]}
        rotation={[liveRoomRotation.x, liveRoomRotation.y, liveRoomRotation.z, liveRoomRotation.w]}
      />
      <g2d-scene
        id='status-panel'
        outputTextureId='status-panel-texture'
        textureWidth={512}
        textureHeight={512}
      >
        <g2d-group translation={[256, 256]}>
          <g2d-path
            path={outerGlow}
            style='fill'
            color={[0.9, 0.28 + (glow * 0.14), 0.5 + (glow * 0.1), 0.24 + (glow * 0.12)]}
          />
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
          <g2d-path
            path={innerCut}
            style='fill'
            color={[0.08, 0.14, 0.22, 0.72]}
          />
          <g2d-circle
            cx={0}
            cy={0}
            radius={18 + (pulse * 28)}
            style='fill'
            color={[1, 0.98, 0.86, 0.68 + (pulse * 0.28)]}
          />
          <g2d-circle
            cx={0}
            cy={0}
            radius={36 + (pulse * 34)}
            style='stroke'
            strokeWidth={10 + (pulse * 8)}
            color={[1, 0.9, 0.48, 0.18 + (pulse * 0.18)]}
          />
        </g2d-group>
      </g2d-scene>
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
    </g3d-scene>
  );
};

export default initializeWindow(DemoScene);
