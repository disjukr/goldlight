import React, { type ReactNode } from 'npm:react@19.2.0';

import type {
  AnimationClipJsxProps,
  AssetJsxProps,
  CameraJsxProps,
  DirectionalLightJsxProps,
  GroupJsxProps,
  LightJsxProps,
  MaterialJsxProps,
  MeshJsxProps,
  NodeJsxProps,
  OrthographicCameraJsxProps,
  PerspectiveCameraJsxProps,
  SceneJsxProps,
  SdfJsxProps,
  TextureJsxProps,
  VolumeJsxProps,
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

export type ReconcilerGroupProps = Readonly<
  Omit<GroupJsxProps, 'children'> & {
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

const hasChildIntent = (children: ReactNode): boolean => {
  if (Array.isArray(children)) {
    return children.some((child) => hasChildIntent(child));
  }
  return children !== undefined && children !== null && children !== false && children !== true;
};

export const PerspectiveCamera = (
  props: ReconcilerPerspectiveCameraProps,
): React.ReactElement => {
  const { id, children, nodeId, name, transform, position, rotation, scale, ...cameraProps } = props;
  const aliasNodeId = nodeId ?? id;
  const hasNodeIntent = hasChildIntent(children) || nodeId !== undefined || name !== undefined ||
    transform !== undefined || position !== undefined || rotation !== undefined ||
    scale !== undefined;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('camera', { id, type: 'perspective', ...cameraProps }),
    hasNodeIntent
      ? React.createElement(
        'node',
        {
          id: aliasNodeId,
          name,
          transform,
          position,
          rotation,
          scale,
          cameraId: id,
        },
        children,
      )
      : null,
  );
};

export const OrthographicCamera = (
  props: ReconcilerOrthographicCameraProps,
): React.ReactElement => {
  const { id, children, nodeId, name, transform, position, rotation, scale, ...cameraProps } = props;
  const aliasNodeId = nodeId ?? id;
  const hasNodeIntent = hasChildIntent(children) || nodeId !== undefined || name !== undefined ||
    transform !== undefined || position !== undefined || rotation !== undefined ||
    scale !== undefined;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('camera', { id, type: 'orthographic', ...cameraProps }),
    hasNodeIntent
      ? React.createElement(
        'node',
        {
          id: aliasNodeId,
          name,
          transform,
          position,
          rotation,
          scale,
          cameraId: id,
        },
        children,
      )
      : null,
  );
};

export const DirectionalLight = (
  props: ReconcilerDirectionalLightProps,
): React.ReactElement => {
  const { id, children, nodeId, name, transform, position, rotation, scale, ...lightProps } = props;
  const aliasNodeId = nodeId ?? id;
  const hasNodeIntent = hasChildIntent(children) || nodeId !== undefined || name !== undefined ||
    transform !== undefined || position !== undefined || rotation !== undefined ||
    scale !== undefined;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('light', { id, kind: 'directional', ...lightProps }),
    hasNodeIntent
      ? React.createElement(
        'node',
        {
          id: aliasNodeId,
          name,
          transform,
          position,
          rotation,
          scale,
          lightId: id,
        },
        children,
      )
      : null,
  );
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      scene: ReconcilerSceneProps;
      node: ReconcilerNodeProps;
      group: ReconcilerGroupProps;
      asset: AssetJsxProps;
      texture: TextureJsxProps;
      material: MaterialJsxProps;
      light: LightJsxProps;
      mesh: MeshJsxProps;
      sdf: SdfJsxProps;
      volume: VolumeJsxProps;
      animationClip: AnimationClipJsxProps;
      camera: CameraJsxProps;
    }
  }
}
