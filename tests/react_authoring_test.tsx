/** @jsxImportSource @rieul3d/react */
/** @jsxRuntime automatic */

import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { identityTransform } from '@rieul3d/ir';
import React from 'npm:react@19.2.0';
import {
  authoringTreeToSceneIr,
  commitSummaryNeedsResidencyReset,
  createAuthoringElement,
  createSceneRoot,
  DirectionalLight,
  Fragment,
  OrthographicCamera,
  PerspectiveCamera,
  planSceneRootCommitUpdates,
  summarizeSceneRootCommit,
} from '@rieul3d/react';
import {
  createReactSceneRoot,
  DirectionalLight as ReconcilerDirectionalLight,
  flushReactSceneUpdates,
  PerspectiveCamera as ReconcilerPerspectiveCamera,
} from '@rieul3d/react/reconciler';
import {
  createSceneDocument,
  removeSceneDocumentNode,
  sceneDocumentToSceneIr,
  upsertSceneDocumentNode,
} from '../packages/react/src/scene_document.ts';
import { authoringTreeToSceneDocument } from '../packages/react/src/authoring.ts';

Deno.test('authoringTreeToSceneIr lowers declarative nodes into scene ir', () => {
  const scene = authoringTreeToSceneIr(
    createAuthoringElement('scene', 'authoring-scene', {}, [
      createAuthoringElement('node', 'root', {}, [
        createAuthoringElement('node', 'child'),
      ]),
    ]),
  );

  assertEquals(scene.rootNodeIds, ['root']);
  assertEquals(scene.nodes.find((node) => node.id === 'child')?.parentId, 'root');
});

Deno.test('authoringTreeToSceneIr preserves supported node props', () => {
  const transform = identityTransform();
  const scene = authoringTreeToSceneIr(
    createAuthoringElement('scene', 'authoring-scene', {}, [
      createAuthoringElement('node', 'mesh-node', {
        name: 'Mesh Node',
        meshId: 'triangle',
        transform,
      }),
    ]),
  );

  assertEquals(scene.nodes, [{
    id: 'mesh-node',
    name: 'Mesh Node',
    parentId: undefined,
    meshId: 'triangle',
    transform,
  }]);
});

Deno.test('authoringTreeToSceneIr normalizes node transform shorthands', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene'>
      <group
        id='root'
        position={[1, 2, 3]}
        rotation={[0, 0, 0, 1]}
        scale={{ x: 2, y: 3, z: 4 }}
      />
    </scene>,
  );

  assertEquals(scene.nodes[0]?.transform, {
    translation: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 2, y: 3, z: 4 },
  });
});

Deno.test('node transform shorthands override matching fields on transform', () => {
  const scene = authoringTreeToSceneIr(
    createAuthoringElement('scene', 'authoring-scene', {}, [
      createAuthoringElement('node', 'mesh-node', {
        transform: {
          translation: { x: 5, y: 6, z: 7 },
          rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
          scale: { x: 1, y: 1, z: 1 },
        },
        position: [1, 2, 3],
      }),
    ]),
  );

  assertEquals(scene.nodes[0]?.transform, {
    translation: { x: 1, y: 2, z: 3 },
    rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    scale: { x: 1, y: 1, z: 1 },
  });
});

Deno.test('node transform shorthands reject invalid tuple lengths', () => {
  assertThrows(
    () =>
      authoringTreeToSceneIr(
        <scene id='jsx-scene'>
          <group
            id='bad-rotation'
            rotation={[0, 0, 1] as unknown as [number, number, number, number]}
          />
        </scene>,
      ),
    Error,
    'rotation shorthand must contain exactly 4 numbers',
  );

  assertThrows(
    () =>
      authoringTreeToSceneIr(
        <scene id='jsx-scene'>
          <group id='bad-position' position={[1, 2] as unknown as [number, number, number]} />
        </scene>,
      ),
    Error,
    'position/scale shorthand must contain exactly 3 numbers',
  );
});

Deno.test('authoringTreeToSceneIr lowers JSX-authored trees with component and fragment composition', () => {
  const transform = identityTransform();
  const MeshNode = (props: Readonly<{ id: string; name: string }>) => (
    <node id={props.id} name={props.name} meshId='triangle' />
  );

  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene'>
      <node id='root'>
        <Fragment>
          <MeshNode id='mesh-child' name='JSX Mesh' />
        </Fragment>
      </node>
    </scene>,
  );

  assertEquals(scene.rootNodeIds, ['root']);
  assertEquals(scene.nodes, [
    {
      id: 'root',
      parentId: undefined,
      transform,
    },
    {
      id: 'mesh-child',
      name: 'JSX Mesh',
      parentId: 'root',
      meshId: 'triangle',
      transform,
    },
  ]);
});

Deno.test('jsx function components receive absent children as undefined', () => {
  let capturedChildren: unknown = Symbol('unset');

  const ChildProbe = (props: Readonly<{ id: string; children?: unknown }>) => {
    capturedChildren = props.children;
    return <node id={props.id} />;
  };

  authoringTreeToSceneIr(
    <scene id='jsx-scene'>
      <ChildProbe id='root' />
    </scene>,
  );

  assertEquals(capturedChildren, undefined);
});

Deno.test('jsx function components receive boolean and null children before lowering', () => {
  let capturedChildren: unknown = Symbol('unset');

  const ChildProbe = (props: Readonly<{ id: string; children?: unknown }>) => {
    capturedChildren = props.children;
    return <node id={props.id}>{props.children as never}</node>;
  };

  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene'>
      <ChildProbe id='root'>
        {false}
        {null}
        <node id='child' />
      </ChildProbe>
    </scene>,
  );

  assertEquals(capturedChildren, [false, null, createAuthoringElement('node', 'child', {}, [])]);
  assertEquals(scene.rootNodeIds, ['root']);
  assertEquals(scene.nodes.find((node) => node.id === 'child')?.parentId, 'root');
});

Deno.test('authoringTreeToSceneIr lowers scene resources authored in JSX', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <camera id='camera-main' type='perspective' yfov={0.9} />
      <asset id='texture-asset' uri='./checker.png' mimeType='image/png' />
      <texture
        id='base-color'
        assetId='texture-asset'
        semantic='baseColor'
        colorSpace='srgb'
        sampler='linear-repeat'
      />
      <material
        id='material-unlit'
        kind='unlit'
        textures={[{
          id: 'base-color',
          assetId: 'texture-asset',
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'linear-repeat',
        }]}
        parameters={{
          color: { x: 0.8, y: 0.7, z: 0.6, w: 1 },
        }}
      />
      <mesh
        id='triangle'
        materialId='material-unlit'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <light
        id='sun'
        kind='directional'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.5}
      />
      <node id='camera-node' cameraId='camera-main' />
      <node id='light-node' lightId='sun' />
      <node id='mesh-node' meshId='triangle' />
    </scene>,
  );

  assertEquals(scene.activeCameraId, 'camera-main');
  assertEquals(scene.cameras, [{
    id: 'camera-main',
    type: 'perspective',
    yfov: 0.9,
    znear: 0.1,
    zfar: 100,
  }]);
  assertEquals(scene.assets, [{
    id: 'texture-asset',
    uri: './checker.png',
    mimeType: 'image/png',
  }]);
  assertEquals(scene.textures, [{
    id: 'base-color',
    assetId: 'texture-asset',
    semantic: 'baseColor',
    colorSpace: 'srgb',
    sampler: 'linear-repeat',
  }]);
  assertEquals(scene.materials[0]?.id, 'material-unlit');
  assertEquals(scene.meshes[0]?.id, 'triangle');
  assertEquals(scene.lights[0]?.id, 'sun');
  assertEquals(scene.nodes.map((node) => node.id), ['camera-node', 'light-node', 'mesh-node']);
});

Deno.test('authoringTreeToSceneIr lowers sdf and volume primitives authored in JSX', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene'>
      <sdf
        id='sdf-sphere'
        op='sphere'
        parameters={{
          radius: { x: 0.75, y: 0, z: 0, w: 0 },
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

  assertEquals(scene.sdfPrimitives, [{
    id: 'sdf-sphere',
    op: 'sphere',
    parameters: {
      radius: { x: 0.75, y: 0, z: 0, w: 0 },
    },
  }]);
  assertEquals(scene.volumePrimitives, [{
    id: 'density-volume',
    assetId: 'volume-asset',
    dimensions: { x: 4, y: 4, z: 4 },
    format: 'density:r8unorm',
  }]);
  assertEquals(scene.nodes.map((node) => [node.id, node.sdfId ?? node.volumeId]), [
    ['sdf-node', 'sdf-sphere'],
    ['volume-node', 'density-volume'],
  ]);
});

Deno.test('createAuthoringElement mirrors ids into programmatic scene resources', () => {
  const scene = authoringTreeToSceneIr(
    createAuthoringElement('scene', 'programmatic-scene', { activeCameraId: 'camera-main' }, [
      createAuthoringElement('camera', 'camera-main', { type: 'perspective', yfov: 0.9 }),
      createAuthoringElement('asset', 'texture-asset', {
        uri: './checker.png',
        mimeType: 'image/png',
      }),
      createAuthoringElement('texture', 'base-color', {
        assetId: 'texture-asset',
        semantic: 'baseColor',
        colorSpace: 'srgb',
        sampler: 'linear-repeat',
      }),
      createAuthoringElement('material', 'material-unlit', {
        kind: 'unlit',
        textures: [],
        parameters: {
          color: { x: 0.8, y: 0.7, z: 0.6, w: 1 },
        },
      }),
      createAuthoringElement('mesh', 'triangle', {
        materialId: 'material-unlit',
        attributes: [{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }],
      }),
      createAuthoringElement('light', 'sun', {
        kind: 'directional',
        color: { x: 1, y: 0.95, z: 0.9 },
        intensity: 1.5,
      }),
    ]),
  );

  assertEquals(scene.activeCameraId, 'camera-main');
  assertEquals(scene.cameras[0]?.id, 'camera-main');
  assertEquals(scene.assets[0]?.id, 'texture-asset');
  assertEquals(scene.textures[0]?.id, 'base-color');
  assertEquals(scene.materials[0]?.id, 'material-unlit');
  assertEquals(scene.meshes[0]?.id, 'triangle');
  assertEquals(scene.lights[0]?.id, 'sun');
});

Deno.test('authoringTreeToSceneIr lowers camera/light convenience components', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.8} position={[0, 0, 2]}>
        <node id='camera-child' />
      </PerspectiveCamera>
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.5}
        nodeId='sun-node'
        position={[1, 2, 3]}
      />
    </scene>,
  );

  assertEquals(scene.activeCameraId, 'camera-main');
  assertEquals(scene.cameras[0], {
    id: 'camera-main',
    type: 'perspective',
    yfov: 0.8,
    znear: 0.1,
    zfar: 100,
  });
  assertEquals(scene.lights[0], {
    id: 'sun',
    kind: 'directional',
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  });
  assertEquals(scene.rootNodeIds, ['camera-main', 'sun-node']);
  assertEquals(scene.nodes.map((node) => node.id), ['camera-main', 'camera-child', 'sun-node']);
  assertEquals(scene.nodes.find((node) => node.id === 'camera-main'), {
    id: 'camera-main',
    name: undefined,
    parentId: undefined,
    cameraId: 'camera-main',
    transform: {
      translation: { x: 0, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  assertEquals(scene.nodes.find((node) => node.id === 'camera-child')?.parentId, 'camera-main');
  assertEquals(scene.nodes.find((node) => node.id === 'sun-node'), {
    id: 'sun-node',
    name: undefined,
    parentId: undefined,
    lightId: 'sun',
    transform: {
      translation: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
});

Deno.test('authoringTreeToSceneIr lowers exported convenience components through primitives', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.8} position={[0, 0, 2]}>
        <node id='camera-child' />
      </PerspectiveCamera>
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.5}
        nodeId='sun-node'
        position={[1, 2, 3]}
      />
      <OrthographicCamera id='camera-close' xmag={0.8} ymag={0.8} />
    </scene>,
  );

  assertEquals(scene.activeCameraId, 'camera-main');
  assertEquals(scene.cameras, [
    {
      id: 'camera-main',
      type: 'perspective',
      yfov: 0.8,
      znear: 0.1,
      zfar: 100,
    },
    {
      id: 'camera-close',
      type: 'orthographic',
      xmag: 0.8,
      ymag: 0.8,
      znear: 0,
      zfar: 100,
    },
  ]);
  assertEquals(scene.lights[0], {
    id: 'sun',
    kind: 'directional',
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  });
  assertEquals(scene.rootNodeIds, ['camera-main', 'sun-node']);
  assertEquals(scene.nodes.map((node) => node.id), ['camera-main', 'camera-child', 'sun-node']);
});

Deno.test('camera/light convenience components stay resource-only without node intent', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.8} />
      <DirectionalLight id='sun' color={{ x: 1, y: 0.95, z: 0.9 }} intensity={1.5} />
    </scene>,
  );

  assertEquals(scene.cameras[0], {
    id: 'camera-main',
    type: 'perspective',
    yfov: 0.8,
    znear: 0.1,
    zfar: 100,
  });
  assertEquals(scene.lights[0], {
    id: 'sun',
    kind: 'directional',
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  });
  assertEquals(scene.nodes, []);
});

Deno.test('camera/light convenience components preserve their fixed resource kinds', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.8} />
      <DirectionalLight id='sun' color={{ x: 1, y: 0.95, z: 0.9 }} intensity={1.5} />
    </scene>,
  );

  assertEquals(scene.cameras[0]?.type, 'perspective');
  assertEquals(scene.lights[0]?.kind, 'directional');
  assertEquals(scene.nodes, []);
});

Deno.test('convenience components stay resource-only without node intent', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' yfov={0.8} />
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.5}
      />
    </scene>,
  );

  assertEquals(scene.cameras[0]?.type, 'perspective');
  assertEquals(scene.lights[0]?.kind, 'directional');
  assertEquals(scene.nodes, []);
});

Deno.test('createSceneRoot publishes committed scene snapshots', () => {
  const root = createSceneRoot();
  const commits: Array<{
    sceneId: string;
    previousSceneId?: string;
    revision: number;
  }> = [];

  root.subscribe((commit) => {
    commits.push({
      sceneId: commit.scene.id,
      previousSceneId: commit.previousScene?.id,
      revision: commit.revision,
    });
  });

  const firstScene = root.render(
    <scene id='jsx-scene'>
      <group id='root' />
    </scene>,
  );
  const secondScene = root.render(
    <scene id='jsx-scene-next'>
      <group id='root' position={[1, 2, 3]} />
    </scene>,
  );

  assertEquals(root.getScene(), secondScene);
  assertEquals(root.getRevision(), 2);
  assertEquals(commits, [
    {
      sceneId: firstScene.id,
      previousSceneId: undefined,
      revision: 1,
    },
    {
      sceneId: secondScene.id,
      previousSceneId: firstScene.id,
      revision: 2,
    },
  ]);
});

Deno.test('createReactSceneRoot rejects unsupported intrinsic tags', () => {
  const root = createReactSceneRoot();

  assertThrows(
    () =>
      root.render(
        React.createElement(
          'scene',
          { id: 'jsx-scene' },
          React.createElement('spotLight', {
            id: 'sun',
          }),
        ),
      ),
    Error,
    '@rieul3d/react reconciler does not support the <spotLight> intrinsic',
  );
});

Deno.test('createReactSceneRoot rejects non-scene roots', () => {
  const root = createReactSceneRoot();

  assertThrows(
    () => root.render(React.createElement('node', { id: 'root' })),
    Error,
    '@rieul3d/react reconciler root must be a <scene> element',
  );
});

Deno.test('authoringTreeToSceneDocument reuses stable node and resource instances across renders', () => {
  const document = createSceneDocument('jsx-scene');

  authoringTreeToSceneDocument(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' position={[0, 0, 2]} />
      <group id='root'>
        <node id='mesh-node' name='Before' />
      </group>
    </scene>,
    document,
  );

  const firstCamera = document.cameras.byId.get('camera-main');
  const firstRoot = document.nodes.byId.get('root');
  const firstMeshNode = document.nodes.byId.get('mesh-node');

  authoringTreeToSceneDocument(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <PerspectiveCamera id='camera-main' position={[1, 2, 3]} />
      <group id='root' position={[4, 5, 6]}>
        <node id='mesh-node' name='After' />
      </group>
    </scene>,
    document,
  );

  assertEquals(document.cameras.byId.get('camera-main') === firstCamera, true);
  assertEquals(document.nodes.byId.get('root') === firstRoot, true);
  assertEquals(document.nodes.byId.get('mesh-node') === firstMeshNode, true);
  assertEquals(document.nodes.byId.get('root')?.props.transform, {
    translation: { x: 4, y: 5, z: 6 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  assertEquals(document.nodes.byId.get('mesh-node')?.props.name, 'After');
});

Deno.test('authoringTreeToSceneDocument removes stale resources and node subtrees', () => {
  const document = createSceneDocument('jsx-scene');

  authoringTreeToSceneDocument(
    <scene id='jsx-scene'>
      <mesh
        id='triangle'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <group id='root'>
        <node id='parent'>
          <node id='child' meshId='triangle' />
        </node>
      </group>
    </scene>,
    document,
  );

  authoringTreeToSceneDocument(
    <scene id='jsx-scene'>
      <group id='root' />
    </scene>,
    document,
  );

  assertEquals(document.meshes.order, []);
  assertEquals(document.nodes.order, ['root']);
  assertEquals(document.nodes.byId.has('parent'), false);
  assertEquals(document.nodes.byId.has('child'), false);
});

Deno.test('scene document helpers preserve node identity through reparenting and recursive removal', () => {
  const document = createSceneDocument('scene-doc');

  upsertSceneDocumentNode(document, { id: 'parent-a', index: 0 });
  upsertSceneDocumentNode(document, { id: 'parent-b', index: 1 });
  const child = upsertSceneDocumentNode(document, {
    id: 'child',
    parentId: 'parent-a',
    index: 0,
    props: { name: 'Child' },
  });
  upsertSceneDocumentNode(document, {
    id: 'grandchild',
    parentId: 'child',
    index: 0,
  });

  upsertSceneDocumentNode(document, {
    id: 'child',
    parentId: 'parent-b',
    index: 0,
    props: { name: 'Child Moved' },
  });

  assertEquals(document.nodes.byId.get('child') === child, true);
  assertEquals(document.nodes.byId.get('parent-a')?.childIds, []);
  assertEquals(document.nodes.byId.get('parent-b')?.childIds, ['child']);
  assertEquals(document.nodes.byId.get('child')?.props.name, 'Child Moved');

  removeSceneDocumentNode(document, 'parent-b');

  assertEquals(document.nodes.rootNodeIds, ['parent-a']);
  assertEquals(document.nodes.byId.has('parent-b'), false);
  assertEquals(document.nodes.byId.has('child'), false);
  assertEquals(document.nodes.byId.has('grandchild'), false);
  assertEquals(sceneDocumentToSceneIr(document).nodes.map((node) => node.id), ['parent-a']);
});

Deno.test('summarizeSceneRootCommit reports first-commit additions', () => {
  const root = createSceneRoot();
  let summary:
    | ReturnType<typeof summarizeSceneRootCommit>
    | undefined;

  root.subscribe((commit) => {
    summary = summarizeSceneRootCommit(commit);
  });

  root.render(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <material
        id='triangle-material'
        kind='unlit'
        textures={[]}
        parameters={{
          color: { x: 0.19, y: 0.62, z: 0.97, w: 1 },
        }}
      />
      <mesh
        id='triangle'
        materialId='triangle-material'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <PerspectiveCamera id='camera-main' position={[0, 0, 2]} />
      <group id='scene-root'>
        <node id='triangle-node' meshId='triangle' />
      </group>
    </scene>,
  );

  assertEquals(summary, {
    sceneIdChanged: true,
    activeCameraChanged: true,
    rootNodeIdsChanged: true,
    assets: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    textures: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    materials: {
      addedIds: ['triangle-material'],
      removedIds: [],
      updatedIds: [],
      unchangedIds: [],
    },
    lights: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    meshes: { addedIds: ['triangle'], removedIds: [], updatedIds: [], unchangedIds: [] },
    cameras: { addedIds: ['camera-main'], removedIds: [], updatedIds: [], unchangedIds: [] },
    sdfPrimitives: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    volumePrimitives: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    nodes: {
      addedIds: ['camera-main', 'scene-root', 'triangle-node'],
      removedIds: [],
      updatedIds: [],
      unchangedIds: [],
    },
    animationClips: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
  });
});

Deno.test('summarizeSceneRootCommit distinguishes added removed and updated stable ids', () => {
  const root = createSceneRoot();
  const summaries: ReturnType<typeof summarizeSceneRootCommit>[] = [];

  root.subscribe((commit) => {
    summaries.push(summarizeSceneRootCommit(commit));
  });

  root.render(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <material
        id='triangle-material'
        kind='unlit'
        textures={[]}
        parameters={{
          color: { x: 0.19, y: 0.62, z: 0.97, w: 1 },
        }}
      />
      <mesh
        id='triangle'
        materialId='triangle-material'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <DirectionalLight
        id='sun'
        color={{ x: 1, y: 0.95, z: 0.9 }}
        intensity={1.5}
      />
      <PerspectiveCamera id='camera-main' position={[0, 0, 2]} />
      <group id='scene-root'>
        <node id='triangle-node' meshId='triangle' />
      </group>
    </scene>,
  );

  root.render(
    <scene id='jsx-scene' activeCameraId='camera-close'>
      <material
        id='triangle-material'
        kind='unlit'
        textures={[]}
        parameters={{
          color: { x: 0.93, y: 0.48, z: 0.24, w: 1 },
        }}
      />
      <mesh
        id='triangle'
        materialId='triangle-material'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.9, 0, -0.8, -0.8, 0, 0.8, -0.8, 0],
        }]}
      />
      <PerspectiveCamera id='camera-main' position={[0, 0, 1.5]} />
      <OrthographicCamera id='camera-close' xmag={0.8} ymag={0.8} />
      <group id='scene-root' position={[1, 2, 3]}>
        <node id='triangle-node' meshId='triangle' />
      </group>
    </scene>,
  );

  assertEquals(summaries[1], {
    sceneIdChanged: false,
    activeCameraChanged: true,
    rootNodeIdsChanged: false,
    assets: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    textures: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    materials: {
      addedIds: [],
      removedIds: [],
      updatedIds: ['triangle-material'],
      unchangedIds: [],
    },
    lights: {
      addedIds: [],
      removedIds: ['sun'],
      updatedIds: [],
      unchangedIds: [],
    },
    meshes: {
      addedIds: [],
      removedIds: [],
      updatedIds: ['triangle'],
      unchangedIds: [],
    },
    cameras: {
      addedIds: ['camera-close'],
      removedIds: [],
      updatedIds: [],
      unchangedIds: ['camera-main'],
    },
    sdfPrimitives: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    volumePrimitives: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
    nodes: {
      addedIds: [],
      removedIds: [],
      updatedIds: ['camera-main', 'scene-root'],
      unchangedIds: ['triangle-node'],
    },
    animationClips: { addedIds: [], removedIds: [], updatedIds: [], unchangedIds: [] },
  });
});

Deno.test('commitSummaryNeedsResidencyReset stays true for node-only topology changes', () => {
  const root = createSceneRoot();
  const resets: boolean[] = [];

  root.subscribe((commit) => {
    resets.push(commitSummaryNeedsResidencyReset(summarizeSceneRootCommit(commit)));
  });

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='triangle'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <group id='scene-root'>
        <node id='triangle-node' meshId='triangle' />
      </group>
    </scene>,
  );

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='triangle'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <group id='scene-root'>
        <node id='triangle-node-next' meshId='triangle' />
      </group>
    </scene>,
  );

  assertEquals(resets, [true, true]);
});

Deno.test('planSceneRootCommitUpdates classifies node mutations by update kind', () => {
  const root = createSceneRoot();
  const plans: ReturnType<typeof planSceneRootCommitUpdates>[] = [];

  root.subscribe((commit) => {
    plans.push(planSceneRootCommitUpdates(commit));
  });

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='triangle-a'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <mesh
        id='triangle-b'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.9, 0, -0.8, -0.8, 0, 0.8, -0.8, 0],
        }]}
      />
      <group id='scene-root'>
        <node id='transform-node' position={[0, 0, 0]} />
        <node id='binding-node' meshId='triangle-a' />
        <node id='metadata-node' name='Before' />
        <node id='parent-a'>
          <node id='reparent-target'>
            <node id='reparent-child' />
          </node>
        </node>
        <node id='parent-b' />
        <node id='transform-parent' position={[0, 0, 0]}>
          <node id='transform-child' />
        </node>
      </group>
    </scene>,
  );

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='triangle-a'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <mesh
        id='triangle-b'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.9, 0, -0.8, -0.8, 0, 0.8, -0.8, 0],
        }]}
      />
      <group id='scene-root'>
        <node id='transform-node' position={[1, 2, 3]} />
        <node id='binding-node' meshId='triangle-b' />
        <node id='metadata-node' name='After' />
        <node id='parent-a' />
        <node id='parent-b'>
          <node id='reparent-target'>
            <node id='reparent-child' />
          </node>
        </node>
        <node id='transform-parent' position={[4, 5, 6]}>
          <node id='transform-child' />
        </node>
      </group>
    </scene>,
  );

  assertEquals(plans[1]?.nodes, {
    addedIds: [],
    removedIds: [],
    updatedIds: [
      'transform-node',
      'binding-node',
      'metadata-node',
      'reparent-target',
      'transform-parent',
    ],
    unchangedIds: [
      'scene-root',
      'parent-a',
      'reparent-child',
      'parent-b',
      'transform-child',
    ],
    transformIds: [
      'transform-node',
      'transform-parent',
      'reparent-target',
      'transform-child',
      'reparent-child',
    ],
    transformOnlyIds: ['transform-node', 'transform-parent', 'transform-child', 'reparent-child'],
    parentingIds: ['reparent-target'],
    resourceBindingIds: ['binding-node'],
    metadataIds: ['metadata-node'],
    otherUpdatedIds: [],
  });
});

Deno.test('planSceneRootCommitUpdates propagates ancestor transform changes to unchanged descendants', () => {
  const root = createSceneRoot();
  const plans: ReturnType<typeof planSceneRootCommitUpdates>[] = [];

  root.subscribe((commit) => {
    plans.push(planSceneRootCommitUpdates(commit));
  });

  root.render(
    <scene id='jsx-scene'>
      <group id='scene-root'>
        <node id='ancestor' position={[0, 0, 0]}>
          <node id='child'>
            <node id='grandchild' />
          </node>
        </node>
      </group>
    </scene>,
  );

  root.render(
    <scene id='jsx-scene'>
      <group id='scene-root'>
        <node id='ancestor' position={[1, 2, 3]}>
          <node id='child'>
            <node id='grandchild' />
          </node>
        </node>
      </group>
    </scene>,
  );

  assertEquals(plans[1]?.nodes.updatedIds, ['ancestor']);
  assertEquals(plans[1]?.nodes.transformIds, ['ancestor', 'child', 'grandchild']);
  assertEquals(plans[1]?.nodes.transformOnlyIds, ['ancestor', 'child', 'grandchild']);
});

Deno.test('planSceneRootCommitUpdates keeps transform-only ids separate from binding updates', () => {
  const root = createSceneRoot();
  const plans: ReturnType<typeof planSceneRootCommitUpdates>[] = [];

  root.subscribe((commit) => {
    plans.push(planSceneRootCommitUpdates(commit));
  });

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='triangle-a'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <mesh
        id='triangle-b'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.9, 0, -0.8, -0.8, 0, 0.8, -0.8, 0],
        }]}
      />
      <group id='scene-root'>
        <node id='mixed-node' meshId='triangle-a' position={[0, 0, 0]} />
      </group>
    </scene>,
  );

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='triangle-a'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.7, 0, -0.7, -0.7, 0, 0.7, -0.7, 0],
        }]}
      />
      <mesh
        id='triangle-b'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 3,
          values: [0, 0.9, 0, -0.8, -0.8, 0, 0.8, -0.8, 0],
        }]}
      />
      <group id='scene-root'>
        <node id='mixed-node' meshId='triangle-b' position={[1, 0, 0]} />
      </group>
    </scene>,
  );

  assertEquals(plans[1]?.nodes.transformIds, ['mixed-node']);
  assertEquals(plans[1]?.nodes.resourceBindingIds, ['mixed-node']);
  assertEquals(plans[1]?.nodes.transformOnlyIds, []);
});

Deno.test('summarizeSceneRootCommit keeps unchanged large mesh payloads stable', () => {
  const root = createSceneRoot();
  const summaries: ReturnType<typeof summarizeSceneRootCommit>[] = [];
  const largeAttributeValues = Array.from({ length: 4096 }, (_, index) => index / 10);

  root.subscribe((commit) => {
    summaries.push(summarizeSceneRootCommit(commit));
  });

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='large-mesh'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 4,
          values: largeAttributeValues,
        }]}
      />
      <group id='scene-root'>
        <node id='mesh-node' meshId='large-mesh' />
      </group>
    </scene>,
  );

  root.render(
    <scene id='jsx-scene'>
      <mesh
        id='large-mesh'
        attributes={[{
          semantic: 'POSITION',
          itemSize: 4,
          values: [...largeAttributeValues],
        }]}
      />
      <group id='scene-root'>
        <node id='mesh-node' meshId='large-mesh' />
      </group>
    </scene>,
  );

  assertEquals(summaries[1]?.meshes, {
    addedIds: [],
    removedIds: [],
    updatedIds: [],
    unchangedIds: ['large-mesh'],
  });
});

Deno.test('createSceneRoot allows subscribers to unsubscribe', () => {
  const root = createSceneRoot(
    <scene id='initial-scene'>
      <group id='root' />
    </scene>,
  );
  const revisions: number[] = [];

  const unsubscribe = root.subscribe((commit) => {
    revisions.push(commit.revision);
  });

  root.render(
    <scene id='next-scene'>
      <group id='root' />
    </scene>,
  );
  unsubscribe();
  root.render(
    <scene id='final-scene'>
      <group id='root' />
    </scene>,
  );

  assertEquals(root.getScene()?.id, 'final-scene');
  assertEquals(root.getRevision(), 3);
  assertEquals(revisions, [2]);
});

Deno.test('createSceneRoot does not let mid-dispatch subscriber changes reorder a commit', () => {
  const root = createSceneRoot();
  const events: string[] = [];

  root.subscribe((commit) => {
    events.push(`first:${commit.revision}`);
    if (commit.revision === 1) {
      root.subscribe((nestedCommit) => {
        events.push(`late:${nestedCommit.revision}`);
      });
      root.render(
        <scene id='second-scene'>
          <group id='root' position={[1, 2, 3]} />
        </scene>,
      );
    }
  });
  root.subscribe((commit) => {
    events.push(`second:${commit.revision}`);
  });

  root.render(
    <scene id='first-scene'>
      <group id='root' />
    </scene>,
  );

  assertEquals(events, [
    'first:1',
    'first:2',
    'second:2',
    'late:2',
    'second:1',
  ]);
});

Deno.test('createReactSceneRoot applies React state updates to the scene document', () => {
  let setOffset: React.Dispatch<React.SetStateAction<number>> | undefined;
  const revisions: Array<readonly [number, number]> = [];
  const root = createReactSceneRoot();

  root.subscribe((commit) => {
    const node = commit.scene.nodes.find((candidate) => candidate.id === 'animated-node');
    revisions.push([commit.revision, node?.transform.translation.x ?? -1]);
  });

  const AnimatedNode = () => {
    const [offset, updateOffset] = React.useState(0);
    setOffset = updateOffset;
    return React.createElement('node', {
      id: 'animated-node',
      position: [offset, 0, 0],
    });
  };

  root.render(
    React.createElement(
      'scene',
      { id: 'react-scene' },
      React.createElement(AnimatedNode),
    ),
  );

  flushReactSceneUpdates(() => setOffset?.(3));

  assertEquals(
    root.getScene()?.nodes.find((node) => node.id === 'animated-node')?.transform.translation.x,
    3,
  );
  assertEquals(revisions, [[1, 0], [2, 3]]);
});

Deno.test('createReactSceneRoot flushes layout-effect updates through React lifecycle', () => {
  const revisions: Array<readonly [number, number]> = [];
  const root = createReactSceneRoot();

  root.subscribe((commit) => {
    const node = commit.scene.nodes.find((candidate) => candidate.id === 'effect-node');
    revisions.push([commit.revision, node?.transform.translation.z ?? -1]);
  });

  const EffectScene = () => {
    const [depth, setDepth] = React.useState(1);
    React.useLayoutEffect(() => {
      setDepth(2);
    }, []);

    return React.createElement(
      'scene',
      { id: 'effect-scene' },
      React.createElement('node', {
        id: 'effect-node',
        position: [0, 0, depth],
      }),
    );
  };

  root.render(React.createElement(EffectScene));

  assertEquals(
    root.getScene()?.nodes.find((node) => node.id === 'effect-node')?.transform.translation.z,
    2,
  );
  assertEquals(revisions, [[1, 1], [2, 2]]);
});

Deno.test('createReactSceneRoot unmount clears the published scene', () => {
  const root = createReactSceneRoot(
    React.createElement(
      'scene',
      { id: 'mounted-scene' },
      React.createElement('node', { id: 'root-node' }),
    ),
  );

  assertEquals(root.getScene()?.nodes.map((node) => node.id), ['root-node']);

  root.unmount();

  assertEquals(root.getScene(), undefined);
});

Deno.test('createReactSceneRoot unmount publishes a terminal empty-scene commit', () => {
  const root = createReactSceneRoot(
    React.createElement(
      'scene',
      { id: 'mounted-scene' },
      React.createElement('node', { id: 'root-node' }),
    ),
  );
  const commits: Array<{
    sceneId: string;
    nodeIds: string[];
    previousSceneId?: string;
    revision: number;
  }> = [];

  root.subscribe((commit) => {
    commits.push({
      sceneId: commit.scene.id,
      nodeIds: commit.scene.nodes.map((node) => node.id),
      previousSceneId: commit.previousScene?.id,
      revision: commit.revision,
    });
  });

  root.unmount();

  assertEquals(commits, [{
    sceneId: 'mounted-scene',
    nodeIds: [],
    previousSceneId: 'mounted-scene',
    revision: 2,
  }]);
});

Deno.test('flushReactSceneUpdates surfaces pending reconciler errors from later updates', () => {
  let setInvalid: React.Dispatch<React.SetStateAction<boolean>> | undefined;
  const root = createReactSceneRoot();

  const FaultyScene = () => {
    const [invalid, updateInvalid] = React.useState(false);
    setInvalid = updateInvalid;

    return React.createElement(
      'scene',
      { id: 'faulty-scene' },
      invalid
        ? React.createElement('spotLight', { id: 'unsupported-light' })
        : React.createElement('node', { id: 'safe-node' }),
    );
  };

  root.render(React.createElement(FaultyScene));

  assertThrows(
    () => flushReactSceneUpdates(() => setInvalid?.(true)),
    Error,
    '@rieul3d/react reconciler does not support the <spotLight> intrinsic',
  );
});

Deno.test('reconciler convenience components compose primitive scene resources and nodes', () => {
  const root = createReactSceneRoot();

  root.render(
    React.createElement(
      'scene',
      { id: 'reconciler-components', activeCameraId: 'camera-main' },
      React.createElement(ReconcilerPerspectiveCamera, {
        id: 'camera-main',
        yfov: 0.8,
        position: [0, 0, 2],
      }),
      React.createElement(ReconcilerDirectionalLight, {
        id: 'sun',
        color: { x: 1, y: 0.95, z: 0.9 },
        intensity: 1.5,
        nodeId: 'sun-node',
        position: [1, 2, 3],
      }),
    ),
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
  assertEquals(root.getScene()?.nodes.map((node) => node.id), ['camera-main', 'sun-node']);
});
