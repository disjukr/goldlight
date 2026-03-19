import React, { type ReactNode } from 'npm:react@19.2.0';

import type {
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

export const PerspectiveCamera = (
  props: ReconcilerPerspectiveCameraProps,
): React.ReactElement => React.createElement('perspectiveCamera', props);

export const OrthographicCamera = (
  props: ReconcilerOrthographicCameraProps,
): React.ReactElement => React.createElement('orthographicCamera', props);

export const DirectionalLight = (
  props: ReconcilerDirectionalLightProps,
): React.ReactElement => React.createElement('directionalLight', props);

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
      camera: CameraJsxProps;
      perspectiveCamera: ReconcilerPerspectiveCameraProps;
      orthographicCamera: ReconcilerOrthographicCameraProps;
      directionalLight: ReconcilerDirectionalLightProps;
    }
  }
}
