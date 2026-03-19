/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import React from 'npm:react@19.2.0';
import {
  createReactSceneRoot,
  DirectionalLight,
  PerspectiveCamera,
} from '@rieul3d/react/reconciler';

const NullChild = () => null;
const EmptyChildren = () => [];

Deno.test('createReactSceneRoot accepts live JSX convenience components', () => {
  const root = createReactSceneRoot(
    <scene id='live-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.8} position={[0, 0, 2]}>
        <group id='camera-child-group'>
          <node id='camera-child' />
        </group>
      </PerspectiveCamera>
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.5}
        nodeId='sun-node'
        position={[1, 2, 3]}
      />
      <group id='scene-root'>
        <node id='mesh-node' />
      </group>
    </scene>,
  );

  assertEquals(root.getScene()?.activeCameraId, 'camera-main');
  assertEquals(root.getScene()?.cameras, [{
    id: 'camera-main',
    type: 'perspective',
    yfov: 0.8,
    znear: 0.1,
    zfar: 100,
  }]);
  assertEquals(root.getScene()?.lights, [{
    id: 'sun',
    kind: 'directional',
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  }]);
  assertEquals(
    root.getScene()?.nodes.map((node) => node.id),
    ['camera-main', 'camera-child-group', 'camera-child', 'sun-node', 'scene-root', 'mesh-node'],
  );
});

Deno.test('reconciler convenience components route through primitive scene resources and nodes', () => {
  const root = createReactSceneRoot(
    <scene id='component-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.7} position={[0, 1, 3]} />
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 1, z: 1 }}
        intensity={2}
        position={[2, 3, 4]}
      />
    </scene>,
  );

  assertEquals(root.getScene()?.activeCameraId, 'camera-main');
  assertEquals(root.getScene()?.cameras[0]?.type, 'perspective');
  assertEquals(root.getScene()?.lights[0]?.kind, 'directional');
  assertEquals(root.getScene()?.nodes.map((node) => node.id), ['camera-main', 'sun']);
});

Deno.test('live convenience components keep bound nodes for composite children without host output', () => {
  const root = createReactSceneRoot(
    <scene id='composite-child-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.7}>
        <NullChild />
      </PerspectiveCamera>
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 1, z: 1 }}
        intensity={2}
      >
        <EmptyChildren />
      </DirectionalLight>
    </scene>,
  );

  assertEquals(root.getScene()?.nodes.map((node) => node.id), ['camera-main', 'sun']);
  assertEquals(root.getScene()?.nodes.map((node) => node.cameraId ?? node.lightId), [
    'camera-main',
    'sun',
  ]);
});

Deno.test('createReactSceneRoot accepts live sdf and volume resource intrinsics', () => {
  const root = createReactSceneRoot(
    <scene id='volumetric-scene'>
      <sdf
        id='sdf-sphere'
        op='sphere'
        parameters={{
          radius: { x: 0.5, y: 0, z: 0, w: 0 },
        }}
      />
      <volume
        id='density-volume'
        assetId='volume-asset'
        dimensions={{ x: 4, y: 4, z: 4 }}
        format='density:r8unorm'
      />
      <node id='sdf-node' sdfId='sdf-sphere' />
      <node id='volume-node' volumeId='density-volume' />
    </scene>,
  );

  assertEquals(root.getScene()?.sdfPrimitives, [{
    id: 'sdf-sphere',
    op: 'sphere',
    parameters: {
      radius: { x: 0.5, y: 0, z: 0, w: 0 },
    },
  }]);
  assertEquals(root.getScene()?.volumePrimitives, [{
    id: 'density-volume',
    assetId: 'volume-asset',
    dimensions: { x: 4, y: 4, z: 4 },
    format: 'density:r8unorm',
  }]);
});

Deno.test('createReactSceneRoot accepts live animation clip intrinsics', () => {
  const root = createReactSceneRoot(
    <scene id='animated-scene'>
      <animationClip
        id='spin'
        durationMs={1000}
        channels={[{
          nodeId: 'animated-node',
          property: 'rotation',
          keyframes: [
            {
              timeMs: 0,
              value: { x: 0, y: 0, z: 0, w: 1 },
            },
            {
              timeMs: 1000,
              value: { x: 0, y: 1, z: 0, w: 0 },
            },
          ],
        }]}
      />
      <node id='animated-node' />
    </scene>,
  );

  assertEquals(root.getScene()?.animationClips, [{
    id: 'spin',
    durationMs: 1000,
    channels: [{
      nodeId: 'animated-node',
      property: 'rotation',
      keyframes: [
        {
          timeMs: 0,
          value: { x: 0, y: 0, z: 0, w: 1 },
        },
        {
          timeMs: 1000,
          value: { x: 0, y: 1, z: 0, w: 0 },
        },
      ],
    }],
  }]);
});
