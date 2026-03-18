export { Fragment, jsx, jsxs } from './src/authoring.ts';
export type {
  AssetJsxProps,
  AuthoringElement,
  CameraJsxProps,
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
    scene: import('./src/authoring.ts').SceneJsxProps;
    node: import('./src/authoring.ts').NodeJsxProps;
    asset: import('./src/authoring.ts').AssetJsxProps;
    texture: import('./src/authoring.ts').TextureJsxProps;
    material: import('./src/authoring.ts').MaterialJsxProps;
    light: import('./src/authoring.ts').LightJsxProps;
    mesh: import('./src/authoring.ts').MeshJsxProps;
    camera: import('./src/authoring.ts').CameraJsxProps;
  }
}
