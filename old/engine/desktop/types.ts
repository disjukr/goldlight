export type DesktopWindowSurfaceInfo = Readonly<{
  width: number;
  height: number;
  scaleFactor: number;
}>;

export type DesktopWindowState = Readonly<{
  width: number;
  height: number;
  focused: boolean;
}>;

export type DesktopResizeEvent = Readonly<{
  kind: 'resized';
  windowId: bigint;
  width: number;
  height: number;
}>;

export type DesktopScaleFactorChangedEvent = Readonly<{
  kind: 'scale-factor-changed';
  windowId: bigint;
  scaleFactor: number;
}>;

export type DesktopCloseRequestedEvent = Readonly<{
  kind: 'close-requested';
  windowId: bigint;
}>;

export type DesktopFocusChangedEvent = Readonly<{
  kind: 'focus-changed';
  windowId: bigint;
  focused: boolean;
}>;

export type DesktopPointerMovedEvent = Readonly<{
  kind: 'pointer-moved';
  windowId: bigint;
  x: number;
  y: number;
}>;

export type DesktopPointerButtonEvent = Readonly<{
  kind: 'pointer-button';
  windowId: bigint;
  button: number;
  pressed: boolean;
}>;

export type DesktopKeyboardEvent = Readonly<{
  kind: 'keyboard';
  windowId: bigint;
  keyCode: number;
  pressed: boolean;
}>;

export type DesktopMessageEnvelopeEvent = Readonly<{
  kind: 'message';
  windowId: bigint;
  messageKind: number;
  messageData: number;
}>;

export type DesktopWindowEvent =
  | DesktopResizeEvent
  | DesktopScaleFactorChangedEvent
  | DesktopCloseRequestedEvent
  | DesktopFocusChangedEvent
  | DesktopPointerMovedEvent
  | DesktopPointerButtonEvent
  | DesktopKeyboardEvent
  | DesktopMessageEnvelopeEvent;

export type DesktopWindowOptions = Readonly<{
  title: string;
  width: number;
  height: number;
  backgroundColor?: readonly [number, number, number, number];
}>;

export type DesktopModuleCleanup = () => void | Promise<void>;

export type DesktopModuleEntry = (
  context: DesktopModuleContext,
) => void | DesktopModuleCleanup | Promise<void | DesktopModuleCleanup>;

export type GoldlightWindowOptions =
  & DesktopWindowOptions
  & Readonly<{
    entry: DesktopModuleEntry;
  }>;

export type DesktopWindow = Readonly<{
  id: bigint;
  runtime: import('./runtime.ts').DesktopWindowRuntime;
  surfaceInfo: DesktopWindowSurfaceInfo;
  canvasContext: GPUCanvasContext;
  compatibleSurface: unknown;
  getState: () => DesktopWindowState;
  requestRedraw: () => void;
  present: () => void;
  resizeSurface: (width: number, height: number) => void;
  close: () => void;
}>;

export type DesktopModuleContext = Readonly<{
  window: DesktopWindow;
}>;
