/** @jsxImportSource @rieul3d/react */
/** @jsxRuntime automatic */

import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { identityTransform } from '@rieul3d/ir';
import {
  authoringTreeToSceneIr,
  commitSummaryNeedsResidencyReset,
  createAuthoringElement,
  createSceneRoot,
  DirectionalLight,
  Fragment,
  OrthographicCamera,
  PerspectiveCamera,
  summarizeSceneRootCommit,
} from '@rieul3d/react';

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

Deno.test('authoringTreeToSceneIr lowers react-style alias intrinsics', () => {
  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <perspectiveCamera id='camera-main' yfov={0.8} position={[0, 0, 2]}>
        <node id='camera-child' />
      </perspectiveCamera>
      <directionalLight
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

Deno.test('react-style aliases stay resource-only without node intent', () => {
  const cameraProps = {
    type: 'orthographic' as const,
    yfov: 0.8,
  };
  const lightProps = {
    kind: 'point' as const,
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  };

  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <perspectiveCamera id='camera-main' {...cameraProps} />
      <directionalLight id='sun' {...lightProps} />
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

Deno.test('react-style aliases preserve their fixed resource kinds when props are spread in', () => {
  const cameraProps = {
    type: 'orthographic' as const,
    yfov: 0.8,
  };
  const lightProps = {
    kind: 'point' as const,
    color: { x: 1, y: 0.95, z: 0.9 },
    intensity: 1.5,
  };

  const scene = authoringTreeToSceneIr(
    <scene id='jsx-scene' activeCameraId='camera-main'>
      <perspectiveCamera id='camera-main' {...cameraProps} />
      <directionalLight id='sun' {...lightProps} />
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
