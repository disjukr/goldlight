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
  SdfJsxProps,
  TextureJsxProps,
  VolumeJsxProps,
} from './src/authoring.ts';

// deno-lint-ignore no-namespace
export namespace JSX {
  export type Element = import('./src/authoring.ts').AuthoringElement;
  export interface ElementChildrenAttribute {
    children: Record<PropertyKey, never>;
  }
  export interface IntrinsicElements {
    scene: import('./src/authoring.ts').SceneJsxProps;
    group: import('./src/authoring.ts').GroupJsxProps;
    node: import('./src/authoring.ts').NodeJsxProps;
    asset: import('./src/authoring.ts').AssetJsxProps;
    texture: import('./src/authoring.ts').TextureJsxProps;
    material: import('./src/authoring.ts').MaterialJsxProps;
    light: import('./src/authoring.ts').LightJsxProps;
    mesh: import('./src/authoring.ts').MeshJsxProps;
    sdf: import('./src/authoring.ts').SdfJsxProps;
    volume: import('./src/authoring.ts').VolumeJsxProps;
    animationClip: import('./src/authoring.ts').AnimationClipJsxProps;
    camera: import('./src/authoring.ts').CameraJsxProps;
  }
}
