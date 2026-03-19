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
const EmptyFragmentChild = () => <></>;

Deno.test('createReactSceneRoot accepts live JSX alias intrinsics', () => {
  const root = createReactSceneRoot(
    <scene id='live-scene' activeCameraId='camera-main'>
      <perspectiveCamera id='camera-main' yfov={0.8} position={[0, 0, 2]}>
        <group id='camera-child-group'>
          <node id='camera-child' />
        </group>
      </perspectiveCamera>
      <directionalLight
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

Deno.test('reconciler convenience components route through the same live JSX aliases', () => {
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

Deno.test('live alias intrinsics keep bound nodes for composite children without host output', () => {
  const root = createReactSceneRoot(
    <scene id='composite-child-scene' activeCameraId='camera-main'>
      <perspectiveCamera id='camera-main' yfov={0.7}>
        <NullChild />
      </perspectiveCamera>
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 1, z: 1 }}
        intensity={2}
      >
        <EmptyFragmentChild />
      </DirectionalLight>
    </scene>,
  );

  assertEquals(root.getScene()?.nodes.map((node) => node.id), ['camera-main', 'sun']);
  assertEquals(root.getScene()?.nodes.map((node) => node.cameraId ?? node.lightId), [
    'camera-main',
    'sun',
  ]);
});
