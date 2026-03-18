export { Fragment, jsxDEV } from './src/authoring.ts';
export type {
  AssetJsxProps,
  AuthoringElement,
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
    directionalLight: import('./src/authoring.ts').DirectionalLightJsxProps;
    mesh: import('./src/authoring.ts').MeshJsxProps;
    camera: import('./src/authoring.ts').CameraJsxProps;
    perspectiveCamera: import('./src/authoring.ts').PerspectiveCameraJsxProps;
    orthographicCamera: import('./src/authoring.ts').OrthographicCameraJsxProps;
  }
}
