export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  workerEntrypoint?: string;
}

export interface WindowHandle {
  id: number;
}

export interface WindowResizeEvent {
  type: 'resize';
  width: number;
  height: number;
}

export interface WindowAnimationFrameEvent {
  type: 'animationFrame';
  timestampMs: number;
}

export interface WindowCloseRequestedEvent {
  type: 'closeRequested';
}

export type WindowEvent =
  | WindowResizeEvent
  | WindowAnimationFrameEvent
  | WindowCloseRequestedEvent;

export function createWindow(_options: WindowOptions = {}): WindowHandle {
  throw new Error(
    'The "goldlight" module is provided by the goldlight runtime at execution time.',
  );
}

export function requestAnimationFrame(_callback: (timestampMs: number) => void): number {
  throw new Error(
    'The "goldlight" module is provided by the goldlight runtime at execution time.',
  );
}

export function addWindowEventListener(
  _type: WindowEvent['type'],
  _listener: (event: WindowEvent) => void,
): void {
  throw new Error(
    'The "goldlight" module is provided by the goldlight runtime at execution time.',
  );
}
