export { Fragment, jsxDEV } from './src/authoring.ts';
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
} from './src/authoring.ts';

// deno-lint-ignore no-namespace
export namespace JSX {
  export type Element = import('./src/authoring.ts').AuthoringElement;
  export interface ElementChildrenAttribute {
    children: Record<PropertyKey, never>;
  }
  export interface IntrinsicElements {
    'g3d-scene': import('./src/authoring.ts').SceneJsxProps;
    'g3d-group': import('./src/authoring.ts').GroupJsxProps;
    'g3d-node': import('./src/authoring.ts').NodeJsxProps;
    'g3d-asset': import('./src/authoring.ts').AssetJsxProps;
    'g3d-texture': import('./src/authoring.ts').TextureJsxProps;
    'g3d-material': import('./src/authoring.ts').MaterialJsxProps;
    'g3d-light': import('./src/authoring.ts').LightJsxProps;
    'g3d-mesh': import('./src/authoring.ts').MeshJsxProps;
    'g3d-animation-clip': import('./src/authoring.ts').AnimationClipJsxProps;
    'g3d-camera': import('./src/authoring.ts').CameraJsxProps;
  }
}
