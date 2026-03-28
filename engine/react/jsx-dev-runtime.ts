export { Fragment, jsxDEV } from './authoring.ts';
export type {
  AnimationClipJsxProps,
  AssetJsxProps,
  AuthoringElement,
  CameraJsxProps,
  GroupJsxProps,
  LightJsxProps,
  MaterialJsxProps,
  MeshJsxProps,
  NodeJsxProps,
  SceneJsxProps,
  TextureJsxProps,
} from './authoring.ts';

// deno-lint-ignore no-namespace
export namespace JSX {
  export type Element = import('./authoring.ts').AuthoringElement;
  export interface ElementChildrenAttribute {
    children: Record<PropertyKey, never>;
  }
  export interface IntrinsicElements {
    'g3d-scene': import('./authoring.ts').SceneJsxProps;
    'g3d-group': import('./authoring.ts').GroupJsxProps;
    'g3d-node': import('./authoring.ts').NodeJsxProps;
    'g3d-asset': import('./authoring.ts').AssetJsxProps;
    'g3d-texture': import('./authoring.ts').TextureJsxProps;
    'g3d-material': import('./authoring.ts').MaterialJsxProps;
    'g3d-light': import('./authoring.ts').LightJsxProps;
    'g3d-mesh': import('./authoring.ts').MeshJsxProps;
    'g3d-animation-clip': import('./authoring.ts').AnimationClipJsxProps;
    'g3d-camera': import('./authoring.ts').CameraJsxProps;
  }
}
