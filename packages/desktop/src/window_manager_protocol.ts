import type {
  DesktopHostOptions,
  DesktopWindowEvent,
  DesktopWindowOptions,
  DesktopWindowState,
} from './types.ts';
import type { DesktopWorkerSurfaceInfo } from './worker_protocol.ts';

export type DesktopWindowManagerInitMessage = Readonly<{
  kind: 'init';
  requestId: number;
  options: DesktopWindowOptions & DesktopHostOptions;
}>;

export type DesktopWindowManagerRequestRedrawMessage = Readonly<{
  kind: 'request-redraw';
  requestId: number;
}>;

export type DesktopWindowManagerShutdownMessage = Readonly<{
  kind: 'shutdown';
}>;

export type DesktopWindowManagerCloseWindowMessage = Readonly<{
  kind: 'close-window';
  requestId: number;
}>;

export type DesktopWindowManagerInboundMessage =
  | DesktopWindowManagerInitMessage
  | DesktopWindowManagerRequestRedrawMessage
  | DesktopWindowManagerShutdownMessage
  | DesktopWindowManagerCloseWindowMessage;

export type DesktopWindowManagerReadyMessage = Readonly<{
  kind: 'ready';
  requestId: number;
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
  requestId: number;
  windowId?: bigint;
  reason?: string;
}>;

export type DesktopWindowManagerErrorMessage = Readonly<{
  kind: 'error';
  requestId?: number;
  message: string;
  stack?: string;
}>;

export type DesktopWindowManagerOutboundMessage =
  | DesktopWindowManagerReadyMessage
  | DesktopWindowManagerEventMessage
  | DesktopWindowManagerExitedMessage
  | DesktopWindowManagerErrorMessage;
