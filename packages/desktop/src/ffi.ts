/// <reference lib="deno.unstable" />

import { dirname, fromFileUrl, join } from '@std/path';

import type {
  DesktopHostOptions,
  DesktopHostSystem,
  DesktopWindowEvent,
  DesktopWindowOptions,
  DesktopWindowState,
  DesktopWindowSurfaceInfo,
} from './types.ts';

const hostInitResultOk = 1;
const popEventResultOk = 1;
const getSurfaceInfoResultOk = 1;
const getWindowStateResultOk = 1;
const destroyWindowResultOk = 1;
const requestRedrawResultOk = 1;
const ffiEventBufferSize = 48;
const ffiSurfaceInfoBufferSize = 40;
const ffiWindowStateBufferSize = 16;

const desktopHostSystems = {
  win32: 1,
  cocoa: 2,
  x11: 3,
  wayland: 4,
} as const;

const desktopEventKinds = {
  frame: 1,
  resized: 2,
  closeRequested: 3,
  focusChanged: 4,
  pointerMoved: 5,
  pointerButton: 6,
  keyboard: 7,
  message: 8,
  scaleFactorChanged: 9,
} as const;

type DesktopHostLibrary = Deno.DynamicLibrary<{
  desktop_host_init: {
    parameters: [];
    result: 'u8';
  };
  desktop_host_shutdown: {
    parameters: [];
    result: 'void';
  };
  desktop_host_create_window: {
    parameters: ['buffer', 'usize', 'u32', 'u32', 'u32'];
    result: 'u64';
  };
  desktop_host_destroy_window: {
    parameters: ['u64'];
    result: 'u8';
  };
  desktop_host_show_window: {
    parameters: ['u64'];
    result: 'u8';
  };
  desktop_host_request_redraw: {
    parameters: ['u64'];
    result: 'u8';
  };
  desktop_host_poll_events: {
    parameters: ['u32'];
    result: 'u32';
  };
  desktop_host_next_event: {
    parameters: ['buffer'];
    result: 'u8';
  };
  desktop_host_get_window_surface_info: {
    parameters: ['u64', 'buffer'];
    result: 'u8';
  };
  desktop_host_get_window_state: {
    parameters: ['u64', 'buffer'];
    result: 'u8';
  };
}>;

export type DesktopHost = Readonly<{
  createWindow: (options: DesktopWindowOptions) => bigint;
  destroyWindow: (windowId: bigint) => void;
  showWindow: (windowId: bigint) => void;
  requestRedraw: (windowId: bigint) => void;
  pollEvents: (timeoutMs?: number) => readonly DesktopWindowEvent[];
  getWindowSurfaceInfo: (windowId: bigint) => DesktopWindowSurfaceInfo;
  getWindowState: (windowId: bigint) => DesktopWindowState;
  close: () => void;
}>;

const desktopHostSystemByCode = new Map<number, DesktopHostSystem>([
  [desktopHostSystems.win32, 'win32'],
  [desktopHostSystems.cocoa, 'cocoa'],
  [desktopHostSystems.x11, 'x11'],
  [desktopHostSystems.wayland, 'wayland'],
]);

const repoRoot = join(dirname(fromFileUrl(import.meta.url)), '..', '..', '..');

const getDefaultDesktopHostLibraryPath = (): string => {
  const extension = Deno.build.os === 'windows'
    ? 'dll'
    : Deno.build.os === 'darwin'
    ? 'dylib'
    : 'so';
  const fileName = Deno.build.os === 'windows'
    ? 'goldlight_desktop_host.dll'
    : `libgoldlight_desktop_host.${extension}`;

  return join(repoRoot, 'packages', 'desktop', 'native', 'target', 'debug', fileName);
};

const decodeHostSystem = (code: number): DesktopHostSystem => {
  const system = desktopHostSystemByCode.get(code);
  if (!system) {
    throw new Error(`Unsupported desktop host window system code: ${code}`);
  }

  return system;
};

const decodePointerValue = (value: bigint): Deno.PointerValue<unknown> =>
  value === 0n ? null : Deno.UnsafePointer.create(value);

const decodeEvent = (bytes: Uint8Array): DesktopWindowEvent => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = view.getUint32(0, true);
  const windowId = view.getBigUint64(8, true);
  const arg0 = view.getBigInt64(16, true);
  const arg1 = view.getBigInt64(24, true);

  switch (kind) {
    case desktopEventKinds.frame:
      return {
        kind: 'frame',
        windowId,
        timeMs: Number(arg0) / 1000,
      };
    case desktopEventKinds.resized:
      return {
        kind: 'resized',
        windowId,
        width: Number(arg0),
        height: Number(arg1),
      };
    case desktopEventKinds.closeRequested:
      return {
        kind: 'close-requested',
        windowId,
      };
    case desktopEventKinds.focusChanged:
      return {
        kind: 'focus-changed',
        windowId,
        focused: arg0 !== 0n,
      };
    case desktopEventKinds.pointerMoved:
      return {
        kind: 'pointer-moved',
        windowId,
        x: Number(arg0),
        y: Number(arg1),
      };
    case desktopEventKinds.pointerButton:
      return {
        kind: 'pointer-button',
        windowId,
        button: Number(arg0),
        pressed: arg1 !== 0n,
      };
    case desktopEventKinds.keyboard:
      return {
        kind: 'keyboard',
        windowId,
        keyCode: Number(arg0),
        pressed: arg1 !== 0n,
      };
    case desktopEventKinds.message:
      return {
        kind: 'message',
        windowId,
        messageKind: Number(arg0),
        messageData: Number(arg1),
      };
    case desktopEventKinds.scaleFactorChanged:
      return {
        kind: 'scale-factor-changed',
        windowId,
        scaleFactor: Number(arg0) / 1000,
      };
    default:
      throw new Error(`Unsupported desktop host event kind: ${kind}`);
  }
};

export const createDesktopHost = (options: DesktopHostOptions = {}): DesktopHost => {
  const libraryPath = options.libraryPath ?? getDefaultDesktopHostLibraryPath();
  const library = Deno.dlopen(libraryPath, {
    desktop_host_init: {
      parameters: [],
      result: 'u8',
    },
    desktop_host_shutdown: {
      parameters: [],
      result: 'void',
    },
    desktop_host_create_window: {
      parameters: ['buffer', 'usize', 'u32', 'u32', 'u32'],
      result: 'u64',
    },
    desktop_host_destroy_window: {
      parameters: ['u64'],
      result: 'u8',
    },
    desktop_host_show_window: {
      parameters: ['u64'],
      result: 'u8',
    },
    desktop_host_request_redraw: {
      parameters: ['u64'],
      result: 'u8',
    },
    desktop_host_poll_events: {
      parameters: ['u32'],
      result: 'u32',
    },
    desktop_host_next_event: {
      parameters: ['buffer'],
      result: 'u8',
    },
    desktop_host_get_window_surface_info: {
      parameters: ['u64', 'buffer'],
      result: 'u8',
    },
    desktop_host_get_window_state: {
      parameters: ['u64', 'buffer'],
      result: 'u8',
    },
  }) as DesktopHostLibrary;

  if (library.symbols.desktop_host_init() !== hostInitResultOk) {
    library.close();
    throw new Error('Failed to initialize the goldlight desktop host');
  }

  const encodeBackgroundColor = (
    backgroundColor: DesktopWindowOptions['backgroundColor'],
  ): number => {
    if (!backgroundColor) {
      return 0;
    }

    const [red, green, blue, alpha] = backgroundColor;
    const encodeChannel = (value: number): number =>
      Math.max(0, Math.min(255, Math.round(value * 255)));

    return (
      encodeChannel(red) |
      (encodeChannel(green) << 8) |
      (encodeChannel(blue) << 16) |
      (encodeChannel(alpha) << 24)
    ) >>> 0;
  };

  const createWindow = (windowOptions: DesktopWindowOptions): bigint => {
    const titleBytes = new TextEncoder().encode(windowOptions.title);
    const titleBuffer = new Uint8Array(titleBytes.byteLength + 1);
    titleBuffer.set(titleBytes);
    const windowId = library.symbols.desktop_host_create_window(
      titleBuffer,
      BigInt(titleBytes.byteLength),
      windowOptions.width,
      windowOptions.height,
      encodeBackgroundColor(windowOptions.backgroundColor),
    );
    if (windowId === 0n) {
      throw new Error(`Desktop host failed to create window "${windowOptions.title}"`);
    }

    return windowId;
  };

  const destroyWindow = (windowId: bigint): void => {
    if (library.symbols.desktop_host_destroy_window(windowId) !== destroyWindowResultOk) {
      throw new Error(`Desktop host failed to destroy window ${windowId.toString()}`);
    }
  };

  const showWindow = (windowId: bigint): void => {
    if (library.symbols.desktop_host_show_window(windowId) !== hostInitResultOk) {
      throw new Error(`Desktop host failed to show window ${windowId.toString()}`);
    }
  };

  const requestRedraw = (windowId: bigint): void => {
    if (library.symbols.desktop_host_request_redraw(windowId) !== requestRedrawResultOk) {
      throw new Error(`Desktop host failed to request redraw for window ${windowId.toString()}`);
    }
  };

  const pollEvents = (timeoutMs = 16): readonly DesktopWindowEvent[] => {
    const queuedEventCount = library.symbols.desktop_host_poll_events(timeoutMs);
    if (queuedEventCount === 0) {
      return [];
    }

    const events: DesktopWindowEvent[] = [];
    for (let index = 0; index < queuedEventCount; index += 1) {
      const eventBytes = new Uint8Array(ffiEventBufferSize);
      if (library.symbols.desktop_host_next_event(eventBytes) !== popEventResultOk) {
        break;
      }
      events.push(decodeEvent(eventBytes));
    }

    return events;
  };

  const getWindowSurfaceInfo = (windowId: bigint): DesktopWindowSurfaceInfo => {
    const bytes = new Uint8Array(ffiSurfaceInfoBufferSize);
    if (
      library.symbols.desktop_host_get_window_surface_info(windowId, bytes) !==
        getSurfaceInfoResultOk
    ) {
      throw new Error(
        `Desktop host failed to resolve surface information for window ${windowId.toString()}`,
      );
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      system: decodeHostSystem(view.getUint32(0, true)),
      windowHandle: decodePointerValue(view.getBigUint64(8, true)),
      displayHandle: decodePointerValue(view.getBigUint64(16, true)),
      width: view.getUint32(24, true),
      height: view.getUint32(28, true),
      scaleFactor: view.getFloat64(32, true),
    };
  };

  const getWindowState = (windowId: bigint): DesktopWindowState => {
    const bytes = new Uint8Array(ffiWindowStateBufferSize);
    if (library.symbols.desktop_host_get_window_state(windowId, bytes) !== getWindowStateResultOk) {
      throw new Error(`Desktop host failed to resolve window state for ${windowId.toString()}`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint32(0, true),
      height: view.getUint32(4, true),
      focused: view.getUint32(8, true) !== 0,
    };
  };

  const close = (): void => {
    library.symbols.desktop_host_shutdown();
    library.close();
  };

  return {
    createWindow,
    destroyWindow,
    showWindow,
    requestRedraw,
    pollEvents,
    getWindowSurfaceInfo,
    getWindowState,
    close,
  };
};
