/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import { createQuaternionFromEulerDegrees } from '@goldlight/core';
import {
  initializeWindow,
  useFrameState,
  useSetFrameState,
  useWindowMetrics,
} from '@goldlight/desktop';
import { createBoxMesh } from '@goldlight/geometry';
import { G3dDirectionalLight, G3dPerspectiveCamera } from '@goldlight/react/reconciler';

type DemoFrameState = Readonly<{
  timeMs: number;
}>;

const DemoFrameDriver = () => {
  const setFrameState = useSetFrameState();

  React.useEffect(() => {
    const startMs = performance.now();
    let frameIndex = 0;
    let lastTimeMs = 0;
    let handle = 0;

    const tick = (nowMs: number) => {
      const timeMs = nowMs - startMs;
      setFrameState({
        timeMs,
        deltaTimeMs: timeMs - lastTimeMs,
        frameIndex,
      });
      lastTimeMs = timeMs;
      frameIndex += 1;
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [setFrameState]);

  return null;
};

const DemoScene = () => {
  const { timeMs = 0 } = useFrameState<DemoFrameState>();
  const { scaleFactor } = useWindowMetrics();
  const t = timeMs / 1000;
  const inspectorTextureSize = Math.max(1, Math.round(640 * scaleFactor));
  const screenOffsetX = -0.92 + (Math.sin(t * 0.9) * 0.9);
  const screenOffsetY = 0.38 + (Math.cos(t * 1.1) * 0.18);
  const screenOffsetZ = 0.52 + (Math.sin(t * 0.7) * 0.16);
  const liveScreenRotation = createQuaternionFromEulerDegrees(
    -10 + (Math.sin(t * 0.8) * 6),
    -24 + (Math.cos(t * 0.9) * 10),
    Math.sin(t * 1.3) * 4,
  );
  const liveRoomRotation = createQuaternionFromEulerDegrees(
    14 + (Math.sin(t * 0.45) * 8),
    28 + (t * 22),
    Math.sin(t * 0.7) * 6,
  );
  const liveCubeRotation = createQuaternionFromEulerDegrees(
    24 + (t * 55),
    38 + (t * 70),
    Math.sin(t * 1.7) * 18,
  );
  const livePlinthRotation = createQuaternionFromEulerDegrees(
    0,
    24 + (t * 24),
    0,
  );

  return (
    <g3d-scene
      id='byow-react-scene3d-in-3d-demo'
      activeCameraId='camera-main'
      clearColor={[0.08, 0.2, 0.26, 1]}
    >
      <DemoFrameDriver />
      <g3d-material
        id='room-material'
        kind='lit'
        textures={[]}
        parameters={{
          color: { x: 0.12, y: 0.28, z: 0.36, w: 1 },
          emissive: { x: 0.03, y: 0.06, z: 0.08, w: 1 },
          metallicRoughness: { x: 0.04, y: 0.68, z: 1, w: 1 },
        }}
      />
      <g3d-mesh
        {...createBoxMesh({
          id: 'room-mesh',
          width: 2.6,
          height: 1.6,
          depth: 0.8,
        })}
        materialId='room-material'
      />
      <g3d-material
        id='screen-material'
        kind='unlit'
        doubleSided
        textures={[{
          id: 'inspector-scene-texture',
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'linear',
        }]}
        parameters={{
          color: { x: 1, y: 1, z: 1, w: 1 },
        }}
      />
      <g3d-mesh
        id='screen-mesh'
        materialId='screen-material'
        attributes={[
          {
            semantic: 'POSITION',
            itemSize: 3,
            values: [
              -1.1,
              1.1,
              0,
              -1.1,
              -1.1,
              0,
              1.1,
              -1.1,
              0,
              1.1,
              1.1,
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
        intensity={4.2}
        nodeId='room-key-light-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-42, -36, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <G3dDirectionalLight
        id='room-fill-light'
        color={{ x: 0.58, y: 0.74, z: 1 }}
        intensity={1.8}
        nodeId='room-fill-light-node'
        rotation={(() => {
          const rotation = createQuaternionFromEulerDegrees(-24, 54, 0);
          return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
        })()}
      />
      <g3d-node
        id='room-node'
        meshId='room-mesh'
        position={[0, Math.sin(t * 0.8) * 0.12, 0]}
        rotation={[liveRoomRotation.x, liveRoomRotation.y, liveRoomRotation.z, liveRoomRotation.w]}
      />
      <g3d-scene
        id='inspector-scene'
        activeCameraId='inspector-camera'
        outputTextureId='inspector-scene-texture'
        textureWidth={inspectorTextureSize}
        textureHeight={inspectorTextureSize}
        clearColor={[0.72, 0.62, 0.44, 1]}
      >
        <g3d-material
          id='inspector-background-material'
          kind='unlit'
          textures={[]}
          parameters={{
            color: { x: 0.66, y: 0.56, z: 0.38, w: 1 },
          }}
        />
        <g3d-material
          id='inspector-cube-material'
          kind='lit'
          textures={[]}
          parameters={{
            color: { x: 0.23, y: 0.5, z: 0.92, w: 1 },
            emissive: { x: 0.03, y: 0.05, z: 0.08, w: 1 },
            metallicRoughness: { x: 0.08, y: 0.42, z: 1, w: 1 },
          }}
        />
        <g3d-mesh
          {...createBoxMesh({
            id: 'inspector-cube-mesh',
            width: 1.2,
            height: 1.2,
            depth: 1.2,
          })}
          materialId='inspector-cube-material'
        />
        <g3d-material
          id='inspector-plinth-material'
          kind='lit'
          textures={[]}
          parameters={{
            color: { x: 0.12, y: 0.12, z: 0.16, w: 1 },
            emissive: { x: 0.015, y: 0.015, z: 0.02, w: 1 },
            metallicRoughness: { x: 0.02, y: 0.88, z: 1, w: 1 },
          }}
        />
        <g3d-mesh
          {...createBoxMesh({
            id: 'inspector-plinth-mesh',
            width: 1.8,
            height: 0.34,
            depth: 1.8,
          })}
          materialId='inspector-plinth-material'
        />
        <G3dPerspectiveCamera
          id='inspector-camera'
          position={[0, 1.3, 4.8]}
          znear={0.05}
          zfar={20}
        />
        <G3dDirectionalLight
          id='inspector-key-light'
          color={{ x: 1, y: 0.94, z: 0.88 }}
          intensity={4.8}
          nodeId='inspector-key-light-node'
          rotation={(() => {
            const rotation = createQuaternionFromEulerDegrees(-50, -28, 0);
            return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
          })()}
        />
        <G3dDirectionalLight
          id='inspector-rim-light'
          color={{ x: 0.66, y: 0.78, z: 1 }}
          intensity={2.2}
          nodeId='inspector-rim-light-node'
          rotation={(() => {
            const rotation = createQuaternionFromEulerDegrees(-30, 138, 0);
            return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
          })()}
        />
        <g3d-node
          id='inspector-cube-node'
          meshId='inspector-cube-mesh'
          position={[0, 0.4, 0]}
          rotation={[
            liveCubeRotation.x,
            liveCubeRotation.y,
            liveCubeRotation.z,
            liveCubeRotation.w,
          ]}
        />
        <g3d-node
          id='inspector-plinth-node'
          meshId='inspector-plinth-mesh'
          position={[0, -0.4, 0]}
          rotation={[
            livePlinthRotation.x,
            livePlinthRotation.y,
            livePlinthRotation.z,
            livePlinthRotation.w,
          ]}
        />
      </g3d-scene>
      <g3d-node
        id='screen-node'
        meshId='screen-mesh'
        position={[screenOffsetX, screenOffsetY, screenOffsetZ]}
        rotation={[
          liveScreenRotation.x,
          liveScreenRotation.y,
          liveScreenRotation.z,
          liveScreenRotation.w,
        ]}
      />
    </g3d-scene>
  );
};

export default initializeWindow(DemoScene);
