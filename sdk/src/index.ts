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

export type WindowShowPolicy =
  | 'immediate'
  | 'after-initial-clear'
  | 'after-first-paint';

export type WindowStyle =
  | 'default'
  | 'custom-titlebar'
  | 'frameless'
  | 'fullscreen';

export interface WindowInit {
  title?: string;
  width?: number;
  height?: number;
  resizable?: boolean;
  style?: WindowStyle;
  initialClearColor?: ColorValue;
  showPolicy?: WindowShowPolicy;
  workerEntrypoint?: string;
}

export interface WindowHandle {
  id: number;
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

export type Transform2d = [number, number, number, number, number, number];

export interface Group2dInit {
  transform?: Transform2d;
  cacheAsRaster?: boolean;
}

export interface Group2dState {
  transform: Transform2d;
  cacheAsRaster: boolean;
}

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

export type Point2d = [number, number];

export type GradientTileMode2d = 'clamp' | 'repeat' | 'mirror' | 'decal';

export interface GradientStop2d {
  offset: number;
  color: ColorValue;
}

export interface ResolvedGradientStop2d {
  offset: number;
  color: ResolvedColorValue;
}

export type PathShader2d =
  | {
    kind: 'linear-gradient';
    start: Point2d;
    end: Point2d;
    stops: GradientStop2d[];
    tileMode?: GradientTileMode2d;
  }
  | {
    kind: 'radial-gradient';
    center: Point2d;
    radius: number;
    stops: GradientStop2d[];
    tileMode?: GradientTileMode2d;
  }
  | {
    kind: 'two-point-conical-gradient';
    startCenter: Point2d;
    startRadius: number;
    endCenter: Point2d;
    endRadius: number;
    stops: GradientStop2d[];
    tileMode?: GradientTileMode2d;
  }
  | {
    kind: 'sweep-gradient';
    center: Point2d;
    startAngle: number;
    endAngle?: number;
    stops: GradientStop2d[];
    tileMode?: GradientTileMode2d;
  };

export type ResolvedPathShader2d =
  | {
    kind: 'linear-gradient';
    start: Point2d;
    end: Point2d;
    stops: ResolvedGradientStop2d[];
    tileMode: GradientTileMode2d;
  }
  | {
    kind: 'radial-gradient';
    center: Point2d;
    radius: number;
    stops: ResolvedGradientStop2d[];
    tileMode: GradientTileMode2d;
  }
  | {
    kind: 'two-point-conical-gradient';
    startCenter: Point2d;
    startRadius: number;
    endCenter: Point2d;
    endRadius: number;
    stops: ResolvedGradientStop2d[];
    tileMode: GradientTileMode2d;
  }
  | {
    kind: 'sweep-gradient';
    center: Point2d;
    startAngle: number;
    endAngle: number;
    stops: ResolvedGradientStop2d[];
    tileMode: GradientTileMode2d;
  };

export type PathFillRule2d = 'nonzero' | 'evenodd';

export type PathStrokeJoin2d = 'miter' | 'bevel' | 'round';

export type PathStrokeCap2d = 'butt' | 'square' | 'round';

export type PathVerb2d =
  | { kind: 'moveTo'; to: Point2d }
  | { kind: 'lineTo'; to: Point2d }
  | { kind: 'quadTo'; control: Point2d; to: Point2d }
  | { kind: 'conicTo'; control: Point2d; to: Point2d; weight: number }
  | { kind: 'cubicTo'; control1: Point2d; control2: Point2d; to: Point2d }
  | {
    kind: 'arcTo';
    center: Point2d;
    radius: number;
    startAngle: number;
    endAngle: number;
    counterClockwise?: boolean;
  }
  | { kind: 'close' };

export interface Path2dInit {
  x?: number;
  y?: number;
  verbs?: PathVerb2d[];
  fillRule?: PathFillRule2d;
  style?: 'fill' | 'stroke';
  color?: ColorValue;
  shader?: PathShader2d;
  strokeWidth?: number;
  strokeJoin?: PathStrokeJoin2d;
  strokeCap?: PathStrokeCap2d;
  dashArray?: number[];
  dashOffset?: number;
}

export interface Path2dState {
  x: number;
  y: number;
  verbs: PathVerb2d[];
  fillRule: PathFillRule2d;
  style: 'fill' | 'stroke';
  color: ResolvedColorValue;
  shader?: ResolvedPathShader2d;
  strokeWidth: number;
  strokeJoin: PathStrokeJoin2d;
  strokeCap: PathStrokeCap2d;
  dashArray: number[];
  dashOffset: number;
}

export type Path2dPatch = Partial<Path2dState>;

export interface FontQuery {
  family?: string;
}

export type TypefaceHandle = bigint;

export type TextDirection = 'ltr' | 'rtl';

export interface ShapeTextInput {
  typeface: TypefaceHandle;
  text: string;
  size: number;
  direction?: TextDirection;
  language?: string;
  scriptTag?: string;
}

export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  xHeight: number;
  capHeight: number;
  underlinePosition: number;
  underlineThickness: number;
  strikeoutPosition: number;
  strikeoutThickness: number;
}

export interface GlyphMask {
  cacheKey: string;
  width: number;
  height: number;
  stride: number;
  format: 'a8';
  offsetX: number;
  offsetY: number;
  pixels: Uint8Array;
}

export interface GlyphSubpixelOffset {
  x: number;
  y: number;
}

export interface ShapedRun {
  typeface: TypefaceHandle;
  text: string;
  size: number;
  direction: TextDirection;
  bidiLevel: number;
  scriptTag: string;
  language: string;
  glyphIDs: Uint32Array;
  positions: Float32Array;
  offsets: Float32Array;
  clusterIndices: Uint32Array;
  advanceX: number;
  advanceY: number;
  utf8RangeStart: number;
  utf8RangeEnd: number;
}

export interface GlyphCluster {
  textStart: number;
  textEnd: number;
  glyphStart: number;
  glyphEnd: number;
  advanceX: number;
  advanceY: number;
}

export interface DirectMaskGlyph {
  glyphId: number;
  x: number;
  y: number;
  mask: GlyphMask | null;
}

export interface DirectMaskSubRun {
  typeface: TypefaceHandle;
  size: number;
  glyphs: DirectMaskGlyph[];
}

export interface TransformedMaskGlyph {
  glyphId: number;
  x: number;
  y: number;
  mask: GlyphMask | null;
  strikeToSourceScale: number;
}

export interface TransformedMaskSubRun {
  typeface: TypefaceHandle;
  size: number;
  glyphs: TransformedMaskGlyph[];
  strikeScale: number;
}

export interface SdfGlyph {
  glyphId: number;
  x: number;
  y: number;
  mask: GlyphMask | null;
  sdf: GlyphMask | null;
  sdfInset: number;
  sdfRadius: number;
  strikeToSourceScale: number;
}

export interface PathTextGlyph {
  glyphId: number;
  x: number;
  y: number;
  verbs: PathVerb2d[];
}

export interface SdfSubRun {
  typeface: TypefaceHandle;
  size: number;
  glyphs: SdfGlyph[];
  sdfInset: number;
  sdfRadius: number;
  strikeSize?: number;
}

export type AutoTextMode = 'direct-mask' | 'transformed-mask' | 'sdf' | 'path';

export interface AutoTextSelection {
  mode: AutoTextMode;
  approximateDeviceTextSize: number;
  sdfStrikeSize?: number | null;
  sdfStrikeToSourceScale?: number | null;
}

export interface TextHost {
  listFamilies(): string[];
  matchTypeface(query: FontQuery): TypefaceHandle | null;
  getFontMetrics(typeface: TypefaceHandle, size: number): FontMetrics | null;
  shapeText(input: ShapeTextInput): ShapedRun | null;
  getGlyphPath(typeface: TypefaceHandle, glyphID: number, size: number): PathVerb2d[] | null;
  getGlyphMask(
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
    subpixelOffset?: GlyphSubpixelOffset,
  ): GlyphMask | null;
  getGlyphSdf(
    typeface: TypefaceHandle,
    glyphID: number,
    size: number,
    inset?: number,
    radius?: number,
  ): GlyphMask | null;
  close(): void;
}

export interface ParsedSvgScene {
  size: {
    width: number;
    height: number;
  };
  paths: Path2dState[];
}

export type Text2dInit =
  | {
    kind: 'direct-mask';
    x?: number;
    y?: number;
    color?: ColorValue;
    glyphs?: DirectMaskGlyph[];
  }
  | {
    kind: 'transformed-mask';
    x?: number;
    y?: number;
    color?: ColorValue;
    glyphs?: TransformedMaskGlyph[];
  }
  | {
    kind: 'sdf';
    x?: number;
    y?: number;
    color?: ColorValue;
    glyphs?: SdfGlyph[];
  }
  | {
    kind: 'path';
    x?: number;
    y?: number;
    color?: ColorValue;
    glyphs?: PathTextGlyph[];
  }
  | {
    kind: 'auto';
    x?: number;
    y?: number;
    color?: ColorValue;
    host: TextHost;
    run: ShapedRun;
    useSdfForSmallText?: boolean;
  };

export type Text2dState = Text2dInit & { color: ResolvedColorValue; x: number; y: number };

export type Text2dPatch = Partial<Text2dState>;

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
  // Resize values are reported in CSS pixels.
  width: number;
  height: number;
  // device pixels per CSS pixel for the window's current display scale.
  devicePixelRatio: number;
}

export interface WindowMoveEvent {
  type: 'move';
  x: number;
  y: number;
}

export interface WindowInfo {
  x: number | null;
  y: number | null;
  // Window size exposed to app code is expressed in CSS pixels.
  width: number;
  height: number;
  // device pixels per CSS pixel for the window's current display scale.
  devicePixelRatio: number;
  title: string;
  resizable: boolean;
  style: WindowStyle;
  initialClearColor: ResolvedColorValue;
}

export interface WindowInfoPatch {
  x?: number;
  y?: number;
  title?: string;
  width?: number;
  height?: number;
  resizable?: boolean;
  style?: WindowStyle;
  initialClearColor?: ColorValue;
}

export const DOM_KEY_LOCATION_STANDARD = 0;
export const DOM_KEY_LOCATION_LEFT = 1;
export const DOM_KEY_LOCATION_RIGHT = 2;
export const DOM_KEY_LOCATION_NUMPAD = 3;

export type WindowKeyLocation =
  | typeof DOM_KEY_LOCATION_STANDARD
  | typeof DOM_KEY_LOCATION_LEFT
  | typeof DOM_KEY_LOCATION_RIGHT
  | typeof DOM_KEY_LOCATION_NUMPAD;

export interface WindowKeyboardEventBase {
  code: string;
  key: string;
  location: WindowKeyLocation;
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface WindowKeyDownEvent extends WindowKeyboardEventBase {
  type: 'keydown';
}

export interface WindowKeyUpEvent extends WindowKeyboardEventBase {
  type: 'keyup';
}

export interface WindowAnimationFrameEvent {
  type: 'animationFrame';
  timestampMs: number;
}

export interface WindowCloseRequestedEvent {
  type: 'closeRequested';
}

export type WindowEvent =
  | WindowMoveEvent
  | WindowResizeEvent
  | WindowKeyDownEvent
  | WindowKeyUpEvent
  | WindowAnimationFrameEvent
  | WindowCloseRequestedEvent;

export interface WindowEventMap {
  move: WindowMoveEvent;
  resize: WindowResizeEvent;
  keydown: WindowKeyDownEvent;
  keyup: WindowKeyUpEvent;
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

export class Path2d {
  readonly id!: number | null;

  constructor(_init: Path2dInit = {}) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Path2dPatch = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Path2dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export class Text2d {
  readonly id!: number | null;

  constructor(_init: Text2dInit) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  set(_patch: Text2dPatch = {}): this {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  get(): Text2dState {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export type Node2d = Rect2d | Path2d | Text2d | Group2d | LayoutGroup2d | LayoutItem2d;

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

export function createTextHost(): TextHost {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function parseSvgPaths(_source: string): ParsedSvgScene {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export class TextShaper {
  constructor(_host: TextHost) {
    throw new Error(RUNTIME_ONLY_ERROR);
  }

  shapeText(_input: ShapeTextInput): ShapedRun | null {
    throw new Error(RUNTIME_ONLY_ERROR);
  }
}

export function buildGlyphClusters(_run: ShapedRun): GlyphCluster[] {
  throw new Error(RUNTIME_ONLY_ERROR);
}

// Glyph mask/SDF strike generation is sized against the current window's
// devicePixelRatio so CSS-pixel text stays sharp on high-density displays.
export function buildDirectMaskSubRun(
  _host: TextHost,
  _run: ShapedRun,
  _transform?: [number, number, number, number, number, number],
): DirectMaskSubRun {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function buildTransformedMaskSubRun(
  _host: TextHost,
  _run: ShapedRun,
  _strikeScale: number,
): TransformedMaskSubRun {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function buildSdfSubRun(
  _host: TextHost,
  _run: ShapedRun,
  _strikeSize?: number,
): SdfSubRun {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function inspectAutoTextSelection(
  _run: ShapedRun,
  _transform: Transform2d = [1, 0, 0, 1, 0, 0],
  _options: { useSdfForSmallText?: boolean } = {},
): AutoTextSelection {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function requestAnimationFrame(_callback: (timestampMs: number) => void): number {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function cancelAnimationFrame(_handle: number): void {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function addWindowEventListener<T extends keyof WindowEventMap>(
  _type: T,
  _listener: (event: WindowEventMap[T]) => void,
): void {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function getWindowInfo(): WindowInfo {
  throw new Error(RUNTIME_ONLY_ERROR);
}

export function setWindowInfo(_patch: WindowInfoPatch = {}): void {
  throw new Error(RUNTIME_ONLY_ERROR);
}
