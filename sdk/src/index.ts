export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  workerEntrypoint?: string;
}

export interface WindowHandle {
  id: number;
}

export function createWindow(_options: WindowOptions = {}): WindowHandle {
  throw new Error(
    'The "goldlight" module is provided by the goldlight runtime at execution time.',
  );
}
