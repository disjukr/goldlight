import type { DesktopHostOptions, DesktopWindowOptions } from './types.ts';

export type DesktopWindowManagerInitMessage = Readonly<{
  kind: 'init';
  options: DesktopWindowOptions & DesktopHostOptions;
  module: string;
}>;

export type DesktopWindowManagerShutdownMessage = Readonly<{
  kind: 'shutdown';
}>;

export type DesktopWindowManagerInboundMessage =
  | DesktopWindowManagerInitMessage
  | DesktopWindowManagerShutdownMessage;

export type DesktopWindowManagerReadyMessage = Readonly<{
  kind: 'ready';
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
  | DesktopWindowManagerExitedMessage
  | DesktopWindowManagerErrorMessage;
