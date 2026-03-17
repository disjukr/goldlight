/** @jsxImportSource @rieul3d/react */
/** @jsxRuntime automatic */

import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { identityTransform } from '@rieul3d/ir';
import { authoringTreeToSceneIr, createAuthoringElement, Fragment } from '@rieul3d/react';

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
