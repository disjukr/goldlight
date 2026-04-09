interface ImportMetaHotData {
  [key: string]: unknown;
}

interface ImportMetaHot {
  readonly data: ImportMetaHotData;
  accept(callback?: (module: unknown) => void): void;
  accept(deps: string, callback?: (module: unknown) => void): void;
  accept(deps: readonly string[], callback?: (modules: unknown[]) => void): void;
  acceptExports(exports: readonly string[], callback?: (module: unknown) => void): void;
  dispose(callback: (data: ImportMetaHotData) => void): void;
  prune(callback: (data: ImportMetaHotData) => void): void;
  invalidate(message?: string): void;
  on(event: string, callback: (payload: unknown) => void): void;
  off(event: string, callback: (payload: unknown) => void): void;
  send(event: string, data?: unknown): void;
}

interface ImportMeta {
  readonly hot?: ImportMetaHot;
}
