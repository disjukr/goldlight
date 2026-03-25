import type {
  DesktopHostOptions,
  DesktopWindowEvent,
  DesktopWindowOptions,
  DesktopWindowState,
} from './types.ts';
import type { DesktopWorkerSurfaceInfo } from './worker_protocol.ts';

export type DesktopWindowManagerInitMessage = Readonly<{
  kind: 'init';
  options: DesktopWindowOptions & DesktopHostOptions;
}>;

export type DesktopWindowManagerRequestRedrawMessage = Readonly<{
  kind: 'request-redraw';
}>;

export type DesktopWindowManagerShutdownMessage = Readonly<{
  kind: 'shutdown';
}>;

export type DesktopWindowManagerCloseWindowMessage = Readonly<{
  kind: 'close-window';
}>;

export type DesktopWindowManagerInboundMessage =
  | DesktopWindowManagerInitMessage
  | DesktopWindowManagerRequestRedrawMessage
  | DesktopWindowManagerShutdownMessage
  | DesktopWindowManagerCloseWindowMessage;

export type DesktopWindowManagerReadyMessage = Readonly<{
  kind: 'ready';
  windowId: bigint;
  surfaceInfo: DesktopWorkerSurfaceInfo;
  windowState: DesktopWindowState;
}>;

export type DesktopWindowManagerEventMessage = Readonly<{
  kind: 'event';
  event: DesktopWindowEvent;
}>;

export type DesktopWindowManagerExitedMessage = Readonly<{
  kind: 'exited';
  reason?: string;
}>;

export type DesktopWindowManagerErrorMessage = Readonly<{
  kind: 'error';
  message: string;
  stack?: string;
}>;

export type DesktopWindowManagerOutboundMessage =
  | DesktopWindowManagerReadyMessage
  | DesktopWindowManagerEventMessage
  | DesktopWindowManagerExitedMessage
  | DesktopWindowManagerErrorMessage;
