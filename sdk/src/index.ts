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

export type LayoutPosition = 'relative' | 'absolute';

export interface LayoutStyle {
  position?: LayoutPosition;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  display?: 'block' | 'flex';
  flexDirection?: 'row' | 'column';
  justifyContent?: 'start' | 'center' | 'end' | 'spaceBetween';
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  gap?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
}

export interface ComputedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Scene2dInit {
  clearColor?: ColorValue;
}

export interface Scene2dState {
  clearColor: ResolvedColorValue;
}

export interface Group2dInit {}

export interface Group2dState {}

export type Group2dPatch = Partial<Group2dState>;

export interface LayoutGroup2dInit extends LayoutStyle {}

export interface LayoutGroup2dState {}

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

export type Mat4Value = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface Camera3dInit {
  viewProjectionMatrix?: Mat4Value;
}

export interface OrthographicCamera3dInit {
  width?: number;
  height?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  near?: number;
  far?: number;
  position?: [number, number, number];
  target?: [number, number, number];
  up?: [number, number, number];
}

export interface PerspectiveCamera3dInit {
  width: number;
  height: number;
  fovYDegrees?: number;
  near?: number;
  far?: number;
  position?: [number, number, number];
  target?: [number, number, number];
  up?: [number, number, number];
}

export interface Camera3dState {
  viewProjectionMatrix: Mat4Value;
}

export interface Scene3dInit {
  clearColor?: ColorValue;
  camera?: Camera3dInit;
}

export interface Scene3dState {
  clearColor: ResolvedColorValue;
  camera: Camera3dState;
}

export interface Group3dInit {}

export interface Group3dState {}

export type Group3dPatch = Partial<Group3dState>;

export interface LayoutGroup3dInit extends LayoutStyle {}

export interface LayoutGroup3dState {}

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

export interface WindowEventMap {
  resize: WindowResizeEvent;
  animationFrame: WindowAnimationFrameEvent;
  closeRequested: WindowCloseRequestedEvent;
}

const RUNTIME_ONLY_ERROR =
  'The "goldlight" module is provided by the goldlight runtime at execution time.';

export class Group2d {
  constructor(_init: Group2dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Group2dPatch = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Group2dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add<T extends Node2d>(_child: T): T {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class LayoutGroup2d {
  constructor(_init: LayoutGroup2dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: LayoutGroup2dInit = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): LayoutGroup2dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  setLayout(_layout: LayoutStyle = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getLayout(): LayoutStyle {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getComputedLayout(): ComputedLayout {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  flushLayout(): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add<T extends LayoutItem2d | LayoutGroup2d>(_child: T): T {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class LayoutItem2d {
  constructor() {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  setLayout(_layout: LayoutStyle = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getLayout(): LayoutStyle {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getComputedLayout(): ComputedLayout {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  setContent(_content: Node2d): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getContent(): Node2d | null {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export type Node2d = Rect2d | Group2d | LayoutGroup2d | LayoutItem2d;

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

  flushLayout(): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add<T extends Node2d>(_node: T): T {
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

  flushLayout(): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add<T extends Node3d>(_node: T): T {
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

export class Group3d {
  constructor(_init: Group3dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Group3dPatch = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Group3dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add<T extends Node3d>(_child: T): T {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class LayoutGroup3d {
  constructor(_init: LayoutGroup3dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: LayoutGroup3dInit = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): LayoutGroup3dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  setLayout(_layout: LayoutStyle = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getLayout(): LayoutStyle {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getComputedLayout(): ComputedLayout {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  flushLayout(): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  add<T extends LayoutItem3d | LayoutGroup3d>(_child: T): T {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class LayoutItem3d {
  constructor() {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  setLayout(_layout: LayoutStyle = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getLayout(): LayoutStyle {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getComputedLayout(): ComputedLayout {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  setContent(_content: Node3d): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  getContent(): Node3d | null {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export type Node3d = Triangle3d | Group3d | LayoutGroup3d | LayoutItem3d;

export type WindowScene = Scene2d | Scene3d;

export function createOrthographicCamera3d(_init: OrthographicCamera3dInit = {}): Camera3dState {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function createPerspectiveCamera3d(_init: PerspectiveCamera3dInit): Camera3dState {
  throw new Error(RUNTIME_ONLY_ERROR);
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

export function addWindowEventListener<T extends keyof WindowEventMap>(
  _type: T,
  _listener: (event: WindowEventMap[T]) => void,
): void {
  throw new Error(RUNTIME_ONLY_ERROR);
}
