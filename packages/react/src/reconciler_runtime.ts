import React, { type ReactNode } from 'npm:react@19.2.0';

import type {
  AssetJsxProps,
  CameraJsxProps,
  DirectionalLightJsxProps,
  LightJsxProps,
  MaterialJsxProps,
  MeshJsxProps,
  NodeJsxProps,
  OrthographicCameraJsxProps,
  PerspectiveCameraJsxProps,
  SceneJsxProps,
  TextureJsxProps,
} from './authoring.ts';

export type ReconcilerSceneProps = Readonly<
  Omit<SceneJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type ReconcilerNodeProps = Readonly<
  Omit<NodeJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type ReconcilerPerspectiveCameraProps = Readonly<
  Omit<PerspectiveCameraJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type ReconcilerOrthographicCameraProps = Readonly<
  Omit<OrthographicCameraJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type ReconcilerDirectionalLightProps = Readonly<
  Omit<DirectionalLightJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

const hasNodeIntent = (
  props: Pick<
    ReconcilerPerspectiveCameraProps,
    'nodeId' | 'name' | 'transform' | 'position' | 'rotation' | 'scale'
  >,
  children?: ReactNode,
): boolean =>
  props.nodeId !== undefined ||
  props.name !== undefined ||
  props.transform !== undefined ||
  props.position !== undefined ||
  props.rotation !== undefined ||
  props.scale !== undefined ||
  React.Children.toArray(children).length > 0;

export const PerspectiveCamera = (
  props: ReconcilerPerspectiveCameraProps,
): React.ReactElement => {
  const {
    id,
    children,
    nodeId,
    name,
    transform,
    position,
    rotation,
    scale,
    ...cameraProps
  } = props;

  if (!hasNodeIntent({ nodeId, name, transform, position, rotation, scale }, children)) {
    return React.createElement('camera', { id, type: 'perspective', ...cameraProps });
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('camera', { id, type: 'perspective', ...cameraProps }),
    React.createElement(
      'node',
      {
        id: nodeId ?? id,
        name,
        cameraId: id,
        transform,
        position,
        rotation,
        scale,
      },
      children,
    ),
  );
};

export const OrthographicCamera = (
  props: ReconcilerOrthographicCameraProps,
): React.ReactElement => {
  const {
    id,
    children,
    nodeId,
    name,
    transform,
    position,
    rotation,
    scale,
    ...cameraProps
  } = props;

  if (!hasNodeIntent({ nodeId, name, transform, position, rotation, scale }, children)) {
    return React.createElement('camera', { id, type: 'orthographic', ...cameraProps });
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('camera', { id, type: 'orthographic', ...cameraProps }),
    React.createElement(
      'node',
      {
        id: nodeId ?? id,
        name,
        cameraId: id,
        transform,
        position,
        rotation,
        scale,
      },
      children,
    ),
  );
};

export const DirectionalLight = (
  props: ReconcilerDirectionalLightProps,
): React.ReactElement => {
  const {
    id,
    children,
    nodeId,
    name,
    transform,
    position,
    rotation,
    scale,
    ...lightProps
  } = props;

  if (!hasNodeIntent({ nodeId, name, transform, position, rotation, scale }, children)) {
    return React.createElement('light', { id, kind: 'directional', ...lightProps });
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('light', { id, kind: 'directional', ...lightProps }),
    React.createElement(
      'node',
      {
        id: nodeId ?? id,
        name,
        lightId: id,
        transform,
        position,
        rotation,
        scale,
      },
      children,
    ),
  );
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      scene: ReconcilerSceneProps;
      node: ReconcilerNodeProps;
      asset: AssetJsxProps;
      texture: TextureJsxProps;
      material: MaterialJsxProps;
      light: LightJsxProps;
      mesh: MeshJsxProps;
      camera: CameraJsxProps;
    }
  }
}
