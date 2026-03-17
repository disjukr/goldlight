export { Fragment, jsx, jsxs } from './src/authoring.ts';
export type { AuthoringElement, NodeJsxProps, SceneJsxProps } from './src/authoring.ts';

// deno-lint-ignore no-namespace
export namespace JSX {
  export type Element = import('./src/authoring.ts').AuthoringElement;
  export interface ElementChildrenAttribute {
    children: Record<PropertyKey, never>;
  }
  export interface IntrinsicElements {
    scene: import('./src/authoring.ts').SceneJsxProps;
    node: import('./src/authoring.ts').NodeJsxProps;
  }
}
