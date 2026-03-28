import React, { type ReactNode } from 'npm:react@19.2.0';
import type { DrawingBlendMode } from '@disjukr/goldlight/drawing';
import type { Matrix2d, Path2d } from '@disjukr/goldlight/geometry';
import type { TextDirection, TextHost } from '@disjukr/goldlight/text';

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
  TextureJsxProps,
} from './authoring.ts';

export type Reconciler3dSceneProps = Readonly<
  Omit<SceneJsxProps, 'children'> & {
    outputTextureId?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    textureWidth?: number;
    textureHeight?: number;
    children?: ReactNode;
  }
>;

export type Reconciler3dNodeProps = Readonly<
  Omit<NodeJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type Reconciler3dGroupProps = Readonly<
  Omit<GroupJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type Reconciler3dPerspectiveCameraProps = Readonly<
  Omit<PerspectiveCameraJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type Reconciler3dOrthographicCameraProps = Readonly<
  Omit<OrthographicCameraJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type Reconciler3dDirectionalLightProps = Readonly<
  Omit<DirectionalLightJsxProps, 'children'> & {
    children?: ReactNode;
  }
>;

export type Reconciler2dSceneProps = Readonly<{
  id: string;
  viewportWidth?: number;
  viewportHeight?: number;
  textureWidth?: number;
  textureHeight?: number;
  outputTextureId?: string;
  clearColor?: readonly [number, number, number, number];
  textHost?: TextHost;
  children?: ReactNode;
}>;

export type Reconciler2dGroupProps = Readonly<{
  transform?: Matrix2d;
  children?: ReactNode;
}>;

type Reconciler2dPaintProps = Readonly<{
  color?: readonly [number, number, number, number];
  blendMode?: DrawingBlendMode;
  style?: 'fill' | 'stroke';
  strokeWidth?: number;
  strokeJoin?: 'miter' | 'bevel' | 'round';
  strokeCap?: 'butt' | 'square' | 'round';
  miterLimit?: number;
  dashArray?: readonly number[];
  dashOffset?: number;
}>;

export type Reconciler2dPathProps = Readonly<
  {
    path: Path2d;
  } & Reconciler2dPaintProps
>;

export type Reconciler2dRectProps = Readonly<
  {
    x: number;
    y: number;
    width: number;
    height: number;
  } & Reconciler2dPaintProps
>;

export type Reconciler2dCircleProps = Readonly<
  {
    cx: number;
    cy: number;
    radius: number;
    segments?: number;
  } & Reconciler2dPaintProps
>;

export type Reconciler2dGlyphMode = 'a8' | 'transformed-mask' | 'sdf' | 'path';

export type Reconciler2dGlyphProps = Readonly<
  {
    text: string;
    x: number;
    y: number;
    fontSize: number;
    fontFamily?: string | readonly string[];
    direction?: TextDirection;
    language?: string;
    scriptTag?: string;
    mode?: Reconciler2dGlyphMode;
    textHost?: TextHost;
  } & Reconciler2dPaintProps
>;

type WithJsxKey<TProps> = TProps & { key?: React.Key };

const hasChildIntent = (children: ReactNode): boolean => {
  if (Array.isArray(children)) {
    return children.some((child) => hasChildIntent(child));
  }
  return children !== undefined && children !== null && children !== false && children !== true;
};

export const G3dPerspectiveCamera = (
  props: Reconciler3dPerspectiveCameraProps,
): React.ReactElement => {
  const { id, children, nodeId, name, transform, position, rotation, scale, ...cameraProps } =
    props;
  const aliasNodeId = nodeId ?? id;
  const hasNodeIntent = hasChildIntent(children) || nodeId !== undefined || name !== undefined ||
    transform !== undefined || position !== undefined || rotation !== undefined ||
    scale !== undefined;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('g3d-camera', { id, type: 'perspective', ...cameraProps }),
    hasNodeIntent
      ? React.createElement(
        'g3d-node',
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

export const G3dOrthographicCamera = (
  props: Reconciler3dOrthographicCameraProps,
): React.ReactElement => {
  const { id, children, nodeId, name, transform, position, rotation, scale, ...cameraProps } =
    props;
  const aliasNodeId = nodeId ?? id;
  const hasNodeIntent = hasChildIntent(children) || nodeId !== undefined || name !== undefined ||
    transform !== undefined || position !== undefined || rotation !== undefined ||
    scale !== undefined;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('g3d-camera', { id, type: 'orthographic', ...cameraProps }),
    hasNodeIntent
      ? React.createElement(
        'g3d-node',
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

export const G3dDirectionalLight = (
  props: Reconciler3dDirectionalLightProps,
): React.ReactElement => {
  const { id, children, nodeId, name, transform, position, rotation, scale, ...lightProps } = props;
  const aliasNodeId = nodeId ?? id;
  const hasNodeIntent = hasChildIntent(children) || nodeId !== undefined || name !== undefined ||
    transform !== undefined || position !== undefined || rotation !== undefined ||
    scale !== undefined;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('g3d-light', { id, kind: 'directional', ...lightProps }),
    hasNodeIntent
      ? React.createElement(
        'g3d-node',
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
    interface IntrinsicAttributes {
      key?: React.Key;
    }

    interface IntrinsicElements {
      'g3d-scene': WithJsxKey<Reconciler3dSceneProps>;
      'g3d-node': WithJsxKey<Reconciler3dNodeProps>;
      'g3d-group': WithJsxKey<Reconciler3dGroupProps>;
      'g3d-asset': WithJsxKey<AssetJsxProps>;
      'g3d-texture': WithJsxKey<TextureJsxProps>;
      'g3d-material': WithJsxKey<MaterialJsxProps>;
      'g3d-light': WithJsxKey<LightJsxProps>;
      'g3d-mesh': WithJsxKey<MeshJsxProps>;
      'g3d-animation-clip': WithJsxKey<AnimationClipJsxProps>;
      'g3d-camera': WithJsxKey<CameraJsxProps>;
      'g2d-scene': WithJsxKey<Reconciler2dSceneProps>;
      'g2d-group': WithJsxKey<Reconciler2dGroupProps>;
      'g2d-path': WithJsxKey<Reconciler2dPathProps>;
      'g2d-rect': WithJsxKey<Reconciler2dRectProps>;
      'g2d-circle': WithJsxKey<Reconciler2dCircleProps>;
      'g2d-glyphs': WithJsxKey<Reconciler2dGlyphProps>;
    }
  }
}
