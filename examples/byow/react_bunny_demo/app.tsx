/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="dom" />

import { readFile } from 'node:fs/promises';

import React from 'react';
import { createMeshNormalsAttribute, getMeshBounds } from '@disjukr/goldlight/geometry';
import { createQuaternionFromEulerDegrees } from '@disjukr/goldlight/math';
import { initializeWindow } from '@disjukr/goldlight/desktop';
import type { MeshPrimitive } from '@disjukr/goldlight/ir';
import { importPlyFromText } from '@disjukr/goldlight/importers';
import { G3dDirectionalLight, G3dPerspectiveCamera } from '@disjukr/goldlight/react/reconciler';

const bunnySource = await readFile(
  new URL('../../assets/stanford-bunny/bun_zipper.ply', import.meta.url),
  'utf8',
);
const bunnyScene = importPlyFromText(bunnySource, 'stanford-bunny');
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
    <g3d-scene id='byow-react-bunny' activeCameraId='camera-main'>
      <g3d-material
        id='stanford-bunny-material'
        kind='lit'
        textures={[]}
        parameters={{
          color: { x: 0.82, y: 0.84, z: 0.88, w: 1 },
        }}
      />
      <g3d-mesh {...bunnyMeshWithNormals} />
      <G3dPerspectiveCamera
        id='camera-main'
        position={[0, 0.28, 3.1]}
        znear={0.05}
        zfar={20}
        yfov={Math.PI / 3}
      />
      <G3dDirectionalLight
        id='key-light'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.7}
        nodeId='key-light-node'
        rotation={[lightRotation.x, lightRotation.y, lightRotation.z, lightRotation.w]}
      />
      <g3d-node
        id='bunny-root'
        rotation={[bunnyRotation.x, bunnyRotation.y, bunnyRotation.z, bunnyRotation.w]}
      >
        <g3d-node
          id='stanford-bunny-node'
          meshId='stanford-bunny-mesh'
          position={[
            -bunnyBounds.center.x * bunnyScale,
            -bunnyBounds.center.y * bunnyScale,
            -bunnyBounds.center.z * bunnyScale,
          ]}
          scale={[bunnyScale, bunnyScale, bunnyScale]}
        />
      </g3d-node>
    </g3d-scene>
  );
};

export default initializeWindow(BunnyScene);

