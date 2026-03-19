import type {
  DesktopHostSystem,
  DesktopWindowEvent,
  DesktopWindowState,
} from './types.ts';

export type DesktopWorkerSurfaceInfo = Readonly<{
  system: DesktopHostSystem;
  windowHandle: bigint;
  displayHandle: bigint;
  width: number;
  height: number;
  scaleFactor: number;
}>;

export type DesktopWorkerInitMessage = Readonly<{
  kind: 'init';
  module: string;
  windowId: bigint;
  surfaceInfo: DesktopWorkerSurfaceInfo;
  windowState: DesktopWindowState;
}>;

export type DesktopWorkerHostEventMessage = Readonly<{
  kind: 'event';
  event: DesktopWindowEvent;
}>;

export type DesktopWorkerShutdownMessage = Readonly<{
  kind: 'shutdown';
}>;

export type DesktopWorkerInboundMessage =
  | DesktopWorkerInitMessage
  | DesktopWorkerHostEventMessage
  | DesktopWorkerShutdownMessage;

export type DesktopWorkerReadyMessage = Readonly<{
  kind: 'ready';
}>;

export type DesktopWorkerRequestRedrawMessage = Readonly<{
  kind: 'request-redraw';
}>;

export type DesktopWorkerCloseWindowMessage = Readonly<{
  kind: 'close-window';
}>;

export type DesktopWorkerShutdownCompleteMessage = Readonly<{
  kind: 'shutdown-complete';
}>;

export type DesktopWorkerErrorMessage = Readonly<{
  kind: 'error';
  message: string;
  stack?: string;
}>;

export type DesktopWorkerOutboundMessage =
  | DesktopWorkerReadyMessage
  | DesktopWorkerRequestRedrawMessage
  | DesktopWorkerCloseWindowMessage
  | DesktopWorkerShutdownCompleteMessage
  | DesktopWorkerErrorMessage;
