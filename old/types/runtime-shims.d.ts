declare module '*.wgsl' {
  const source: string;
  export default source;
}

declare module '*.node' {
  const nativeModule: unknown;
  export default nativeModule;
}
