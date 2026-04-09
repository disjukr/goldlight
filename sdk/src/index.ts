export interface WindowInit {
  title?: string;
  width?: number;
  height?: number;
  workerEntrypoint?: string;
}

export interface WindowHandle {
  id: number;
}

export interface ColorValue {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface ResolvedColorValue {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Scene2dInit {
  clearColor?: ColorValue;
}

export interface Scene2dState {
  clearColor: ResolvedColorValue;
}

export interface Rect2dInit {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: ColorValue;
}

export interface Rect2dState {
  x: number;
  y: number;
  width: number;
  height: number;
  color: ResolvedColorValue;
}

export type Rect2dPatch = Partial<Rect2dState>;

export interface Camera3dInit {
  position?: [number, number, number];
  target?: [number, number, number];
  up?: [number, number, number];
  fovYDegrees?: number;
  near?: number;
  far?: number;
}

export interface Camera3dState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovYDegrees: number;
  near: number;
  far: number;
}

export interface Scene3dInit {
  clearColor?: ColorValue;
  camera?: Camera3dInit;
}

export interface Scene3dState {
  clearColor: ResolvedColorValue;
  camera: Camera3dState;
}

export interface Triangle3dInit {
  positions?: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  color?: ColorValue;
}

export interface Triangle3dState {
  positions: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  color: ResolvedColorValue;
}

export type Triangle3dPatch = Partial<Triangle3dState>;

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

export type WindowScene = Scene2d | Scene3d;

const RUNTIME_ONLY_ERROR =
  'The "goldlight" module is provided by the goldlight runtime at execution time.';

export class Scene2d {
  readonly id!: number;

  constructor(_init: Scene2dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Scene2dInit = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Scene2dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add(_node: Rect2d): Rect2d {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class Rect2d {
  readonly id!: number | null;

  constructor(_init: Rect2dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Rect2dPatch = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Rect2dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class Scene3d {
  readonly id!: number;

  constructor(_init: Scene3dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Scene3dInit = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Scene3dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add(_node: Triangle3d): Triangle3d {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class Triangle3d {
  readonly id!: number | null;

  constructor(_init: Triangle3dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Triangle3dPatch = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Triangle3dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export function createWindow(_init: WindowInit = {}): WindowHandle {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function setWindowScene<T extends WindowScene>(_scene: T): T {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function requestAnimationFrame(_callback: (timestampMs: number) => void): number {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function addWindowEventListener(
  _type: WindowEvent['type'],
  _listener: (event: WindowEvent) => void,
): void {
  throw new Error(RUNTIME_ONLY_ERROR);
}
