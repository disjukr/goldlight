function normalizeWindowInit(init = {}) {
  const {
    title = "untitled",
    width = 640,
    height = 480,
    workerEntrypoint = undefined,
  } = init;

  return { title, width, height, workerEntrypoint };
}

function normalizeColor(color = {}) {
  const { r = 0, g = 0, b = 0, a = 1 } = color;
  return { r, g, b, a };
}

function normalizeCameraInit(init = {}) {
  return {
    viewProjectionMatrix: init.viewProjectionMatrix
      ? [...init.viewProjectionMatrix]
      : [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
  };
}

function cloneColor(color) {
  return { ...color };
}

function cloneCamera(camera = {}) {
  return {
    viewProjectionMatrix: [...camera.viewProjectionMatrix],
  };
}

function normalizeVec3(value, fallback) {
  return value ? [...value] : [...fallback];
}

function subtractVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dotVec3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalizeVec3Length(value) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

function multiplyMat4(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function createLookAtMatrix({ position, target, up }) {
  const eye = normalizeVec3(position, [0, 0, 1]);
  const center = normalizeVec3(target, [0, 0, 0]);
  const upVector = normalizeVec3(up, [0, 1, 0]);

  const forward = normalizeVec3Length(subtractVec3(center, eye));
  const side = normalizeVec3Length(crossVec3(forward, upVector));
  const realUp = crossVec3(side, forward);

  return [
    side[0], realUp[0], -forward[0], 0,
    side[1], realUp[1], -forward[1], 0,
    side[2], realUp[2], -forward[2], 0,
    -dotVec3(side, eye), -dotVec3(realUp, eye), dotVec3(forward, eye), 1,
  ];
}

function createOrthographicProjectionMatrix({
  left = 0,
  right,
  top = 0,
  bottom,
  near = -1000,
  far = 1000,
}) {
  if (right === undefined || bottom === undefined) {
    throw new TypeError("createOrthographicCamera3d requires right/bottom or width/height");
  }
  const width = right - left;
  const height = bottom - top;
  const depth = far - near;
  return [
    2 / width, 0, 0, 0,
    0, -2 / height, 0, 0,
    0, 0, -1 / depth, 0,
    -(right + left) / width, (bottom + top) / height, -near / depth, 1,
  ];
}

function createPerspectiveProjectionMatrix({
  width,
  height,
  fovYDegrees = 50,
  near = 0.1,
  far = 100,
}) {
  const aspect = width / height;
  const f = 1 / Math.tan((fovYDegrees * Math.PI) / 360);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ];
}

export function createOrthographicCamera3d(init = {}) {
  const width = init.width ?? ((init.right ?? 640) - (init.left ?? 0));
  const height = init.height ?? ((init.bottom ?? 480) - (init.top ?? 0));
  const left = init.left ?? 0;
  const top = init.top ?? 0;
  const right = init.right ?? (left + width);
  const bottom = init.bottom ?? (top + height);
  const projection = createOrthographicProjectionMatrix({
    left,
    right,
    top,
    bottom,
    near: init.near ?? -1000,
    far: init.far ?? 1000,
  });
  const view = createLookAtMatrix({
    position: init.position ?? [0, 0, 1],
    target: init.target ?? [0, 0, 0],
    up: init.up ?? [0, 1, 0],
  });
  return {
    viewProjectionMatrix: multiplyMat4(projection, view),
  };
}

export function createPerspectiveCamera3d(init = {}) {
  if (init.width === undefined || init.height === undefined) {
    throw new TypeError("createPerspectiveCamera3d requires width and height");
  }
  const projection = createPerspectiveProjectionMatrix({
    width: init.width,
    height: init.height,
    fovYDegrees: init.fovYDegrees ?? 50,
    near: init.near ?? 0.1,
    far: init.far ?? 100,
  });
  const view = createLookAtMatrix({
    position: init.position ?? [0, 0, 3],
    target: init.target ?? [0, 0, 0],
    up: init.up ?? [0, 1, 0],
  });
  return {
    viewProjectionMatrix: multiplyMat4(projection, view),
  };
}

function cloneRectState(state) {
  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    color: cloneColor(state.color),
  };
}

function cloneTriangleState(state) {
  return {
    positions: state.positions.map((position) => [...position]),
    color: cloneColor(state.color),
  };
}

function normalizeRectInit(init = {}) {
  return {
    x: init.x ?? 0,
    y: init.y ?? 0,
    width: init.width ?? 100,
    height: init.height ?? 100,
    color: init.color
      ? normalizeColor(init.color)
      : { r: 1, g: 1, b: 1, a: 1 },
  };
}

function normalizeTriangleInit(init = {}) {
  return {
    positions: init.positions
      ? init.positions.map((position) => [...position])
      : [
          [0, 100, 0],
          [100, 100, 0],
          [50, 0, 0],
        ],
    color: init.color
      ? normalizeColor(init.color)
      : { r: 1, g: 1, b: 1, a: 1 },
  };
}

function ensureFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} expects a function`);
  }
}

function cloneLayout(layout = {}) {
  return {
    ...layout,
  };
}

function computeLayout(layout = {}) {
  return {
    x: layout.x ?? 0,
    y: layout.y ?? 0,
    width: layout.width ?? 0,
    height: layout.height ?? 0,
  };
}

let nextLayoutNodeId = 1;
const dirtyLayoutScenes = new Set();

function isLayoutNode(node) {
  return (
    node instanceof LayoutGroup2d ||
    node instanceof LayoutItem2d ||
    node instanceof LayoutGroup3d ||
    node instanceof LayoutItem3d
  );
}

function ensureNode2d(node) {
  if (
    !(node instanceof Rect2d) &&
    !(node instanceof Group2d) &&
    !(node instanceof LayoutGroup2d) &&
    !(node instanceof LayoutItem2d)
  ) {
    throw new TypeError("Scene2d.add expects a Rect2d, Group2d, LayoutGroup2d, or LayoutItem2d");
  }
}

function ensureNode3d(node) {
  if (
    !(node instanceof Triangle3d) &&
    !(node instanceof Group3d) &&
    !(node instanceof LayoutGroup3d) &&
    !(node instanceof LayoutItem3d)
  ) {
    throw new TypeError("Scene3d.add expects a Triangle3d, Group3d, LayoutGroup3d, or LayoutItem3d");
  }
}

function ensureScene(value) {
  if (!(value instanceof Scene2d) && !(value instanceof Scene3d)) {
    throw new TypeError("setWindowScene expects a Scene2d or Scene3d");
  }
}

function isLayoutNode2d(node) {
  return node instanceof LayoutGroup2d || node instanceof LayoutItem2d;
}

function isLayoutNode3d(node) {
  return node instanceof LayoutGroup3d || node instanceof LayoutItem3d;
}

function collectLayoutRoots2d(nodes, roots = []) {
  for (const node of nodes) {
    if (isLayoutNode2d(node)) {
      roots.push(node);
      continue;
    }
    if (node instanceof Group2d) {
      collectLayoutRoots2d(node._children, roots);
    }
  }
  return roots;
}

function collectLayoutRoots3d(nodes, roots = []) {
  for (const node of nodes) {
    if (isLayoutNode3d(node)) {
      roots.push(node);
      continue;
    }
    if (node instanceof Group3d) {
      collectLayoutRoots3d(node._children, roots);
    }
  }
  return roots;
}

function buildLayoutTree(node) {
  if (node instanceof LayoutGroup2d || node instanceof LayoutGroup3d) {
    return {
      id: node._layoutNodeId,
      style: cloneLayout(node._layout),
      children: node._children.map((child) => buildLayoutTree(child)),
    };
  }
  if (node instanceof LayoutItem2d || node instanceof LayoutItem3d) {
    return {
      id: node._layoutNodeId,
      style: cloneLayout(node._layout),
      children: [],
    };
  }
  throw new TypeError("buildLayoutTree expects a layout node");
}

function computeLayouts(root) {
  const results = Deno.core.ops.op_goldlight_compute_layout(buildLayoutTree(root));
  const computedLayouts = new Map();
  for (const result of results) {
    computedLayouts.set(result.id, result);
  }
  return computedLayouts;
}

function markSceneLayoutDirty(scene) {
  if (!scene) {
    return;
  }
  scene._layoutDirty = true;
  dirtyLayoutScenes.add(scene);
  Deno.core.ops.op_goldlight_worker_request_animation_frame();
}

function markLayoutNodeDirty(node) {
  let current = node;
  while (current !== null) {
    current._layoutSubtreeDirty = true;
    current = current._layoutParent;
  }
  if (node._scene) {
    markSceneLayoutDirty(node._scene);
  }
}

function clearLayoutNodeDirty(node) {
  node._layoutSubtreeDirty = false;
  if (node instanceof LayoutGroup2d || node instanceof LayoutGroup3d) {
    for (const child of node._children) {
      clearLayoutNodeDirty(child);
    }
  }
}

function hasDirtyLayoutRoots(roots) {
  return roots.some((root) => root._layoutSubtreeDirty);
}

function flushDirtyLayouts() {
  if (dirtyLayoutScenes.size === 0) {
    return;
  }
  const scenes = Array.from(dirtyLayoutScenes);
  dirtyLayoutScenes.clear();
  for (const scene of scenes) {
    scene.flushLayout();
  }
}

globalThis.__goldlightFlushLayout = function () {
  flushDirtyLayouts();
};

function applyOffsetToNode2d(node, offsetX, offsetY) {
  if (node instanceof Rect2d) {
    const current = node.get();
    node._applyLayoutState({
      ...current,
      x: offsetX,
      y: offsetY,
    });
    return;
  }

  if (node instanceof Group2d) {
    for (const child of node._children) {
      applyOffsetToNode2d(child, offsetX, offsetY);
    }
    return;
  }

  if (node instanceof LayoutGroup2d) {
    node._applyComputedLayouts(offsetX, offsetY);
    return;
  }

  if (node instanceof LayoutItem2d && node._content !== null) {
    node._applyComputedLayouts(offsetX, offsetY);
  }
}

function applyOffsetToNode3d(node, offsetX, offsetY) {
  if (node instanceof Triangle3d) {
    node._applyLayoutOffset(offsetX, offsetY);
    return;
  }

  if (node instanceof Group3d) {
    for (const child of node._children) {
      applyOffsetToNode3d(child, offsetX, offsetY);
    }
    return;
  }

  if (node instanceof LayoutGroup3d) {
    node._applyComputedLayouts(offsetX, offsetY);
    return;
  }

  if (node instanceof LayoutItem3d && node._content !== null) {
    node._applyComputedLayouts(offsetX, offsetY);
  }
}

function attachNodeToScene2d(scene, node) {
  node._scene = scene;

  if (node instanceof Rect2d) {
    node._attachToScene(scene.id);
    return;
  }

  if (node instanceof Group2d || node instanceof LayoutGroup2d) {
    node._sceneId = scene.id;
    for (const child of node._children) {
      attachNodeToScene2d(scene, child);
    }
    return;
  }

  if (node instanceof LayoutItem2d) {
    node._sceneId = scene.id;
    if (node._content !== null) {
      attachNodeToScene2d(scene, node._content);
      node._applyComputedLayouts(0, 0);
    }
    return;
  }
}

function attachNodeToScene3d(scene, node) {
  node._scene = scene;

  if (node instanceof Triangle3d) {
    node._attachToScene(scene.id);
    return;
  }

  if (node instanceof Group3d || node instanceof LayoutGroup3d) {
    node._sceneId = scene.id;
    for (const child of node._children) {
      attachNodeToScene3d(scene, child);
    }
    return;
  }

  if (node instanceof LayoutItem3d) {
    node._sceneId = scene.id;
    if (node._content !== null) {
      attachNodeToScene3d(scene, node._content);
      node._applyComputedLayouts(0, 0);
    }
  }
}

export function createWindow(init = {}) {
  return Deno.core.ops.op_goldlight_create_window(normalizeWindowInit(init));
}

export function setWindowScene(scene) {
  ensureScene(scene);
  markSceneLayoutDirty(scene);
  if (scene instanceof Scene2d) {
    Deno.core.ops.op_goldlight_present_scene_2d(scene.id);
    return scene;
  }
  Deno.core.ops.op_goldlight_present_scene_3d(scene.id);
  return scene;
}

export class Scene2d {
  constructor(init = {}) {
    this._state = {
      clearColor: normalizeColor(init.clearColor),
    };
    this._children = [];
    const handle = Deno.core.ops.op_goldlight_create_scene_2d({
      clearColor: this._state.clearColor,
    });
    this.id = handle.id;
    this._layoutDirty = false;
  }

  set(patch = {}) {
    if (patch.clearColor !== undefined) {
      this._state.clearColor = normalizeColor(patch.clearColor);
    }
    Deno.core.ops.op_goldlight_scene_2d_set_clear_color(this.id, {
      color: this._state.clearColor,
    });
    return this;
  }

  get() {
    return {
      clearColor: cloneColor(this._state.clearColor),
    };
  }

  add(node) {
    ensureNode2d(node);
    if (isLayoutNode(node)) {
      node._layoutParent = null;
    }
    this._children.push(node);
    attachNodeToScene2d(this, node);
    markSceneLayoutDirty(this);
    return node;
  }

  _flushLayoutRoot(root) {
    if (!root._layoutSubtreeDirty) {
      return;
    }
    const computedLayouts = computeLayouts(root);
    root._setComputedLayouts(computedLayouts);
    root._applyComputedLayouts(0, 0);
    clearLayoutNodeDirty(root);
  }

  flushLayout() {
    if (!this._layoutDirty) {
      return this;
    }
    const roots = collectLayoutRoots2d(this._children);
    for (const root of roots) {
      this._flushLayoutRoot(root);
    }
    this._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._layoutDirty) {
      dirtyLayoutScenes.add(this);
    }
    return this;
  }
}

export class Group2d {
  constructor(_init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._state = {};
  }

  set(_patch = {}) {
    return this;
  }

  get() {
    return {};
  }

  add(child) {
    ensureNode2d(child);
    if (isLayoutNode(child)) {
      child._layoutParent = null;
    }
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene2d(this._scene, child);
      markSceneLayoutDirty(this._scene);
    }
    return child;
  }
}

export class LayoutGroup2d {
  constructor(init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._state = {};
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = cloneLayout(init);
    this._computedLayout = computeLayout(this._layout);
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
  }

  set(_patch = {}) {
    return this;
  }

  get() {
    return {};
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  add(child) {
    if (!(child instanceof LayoutItem2d) && !(child instanceof LayoutGroup2d)) {
      throw new TypeError("LayoutGroup2d.add expects a LayoutItem2d or LayoutGroup2d");
    }
    child._layoutParent = this;
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene2d(this._scene, child);
    }
    markLayoutNodeDirty(this);
    return child;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
    for (const child of this._children) {
      child._setComputedLayouts(computedLayouts);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    const baseX = offsetX + this._computedLayout.x;
    const baseY = offsetY + this._computedLayout.y;
    for (const child of this._children) {
      child._applyComputedLayouts(baseX, baseY);
    }
  }

  flushLayout() {
    if (!this._scene) {
      return this;
    }
    let root = this;
    while (root._layoutParent !== null) {
      root = root._layoutParent;
    }
    this._scene._flushLayoutRoot(root);
    const roots = collectLayoutRoots2d(this._scene._children);
    this._scene._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._scene._layoutDirty) {
      dirtyLayoutScenes.add(this._scene);
    }
    return this;
  }
}

export class LayoutItem2d {
  constructor() {
    this._sceneId = null;
    this._scene = null;
    this._content = null;
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = {};
    this._computedLayout = computeLayout();
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  setContent(content) {
    ensureNode2d(content);
    this._content = content;
    if (this._scene) {
      attachNodeToScene2d(this._scene, content);
    }
    markLayoutNodeDirty(this);
    return this;
  }

  getContent() {
    return this._content;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    if (this._content === null) {
      return;
    }
    const x = offsetX + this._computedLayout.x;
    const y = offsetY + this._computedLayout.y;
    if (this._content instanceof Rect2d) {
      const current = this._content.get();
      this._content._applyLayoutState({
        ...current,
        x,
        y,
        width: this._computedLayout.width || current.width,
        height: this._computedLayout.height || current.height,
      });
      return;
    }
    applyOffsetToNode2d(this._content, x, y);
  }
}

export class Rect2d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
    this._scene = null;
    this._state = normalizeRectInit(init);
  }

  _attachToScene(sceneId) {
    if (this.id !== null) {
      return;
    }
    const handle = Deno.core.ops.op_goldlight_scene_2d_create_rect(sceneId, this._state);
    this.id = handle.id;
    this._sceneId = sceneId;
  }

  set(patch = {}) {
    if (patch.x !== undefined) this._state.x = patch.x;
    if (patch.y !== undefined) this._state.y = patch.y;
    if (patch.width !== undefined) this._state.width = patch.width;
    if (patch.height !== undefined) this._state.height = patch.height;
    if (patch.color !== undefined) this._state.color = normalizeColor(patch.color);

    if (this.id !== null) {
      Deno.core.ops.op_goldlight_rect_2d_update(this.id, this._state);
    }
    return this;
  }

  _applyLayoutState(state) {
    this._state = {
      ...state,
      color: normalizeColor(state.color),
    };
    if (this.id !== null) {
      Deno.core.ops.op_goldlight_rect_2d_update(this.id, this._state);
    }
  }

  get() {
    return cloneRectState(this._state);
  }
}

export class Scene3d {
  constructor(init = {}) {
    this._state = {
      clearColor: normalizeColor(init.clearColor),
      camera: normalizeCameraInit(init.camera),
    };
    this._children = [];
    const handle = Deno.core.ops.op_goldlight_create_scene_3d({
      clearColor: this._state.clearColor,
      camera: this._state.camera,
    });
    this.id = handle.id;
    this._layoutDirty = false;
  }

  set(patch = {}) {
    if (patch.clearColor !== undefined) {
      this._state.clearColor = normalizeColor(patch.clearColor);
      Deno.core.ops.op_goldlight_scene_3d_set_clear_color(this.id, {
        color: this._state.clearColor,
      });
    }
    if (patch.camera !== undefined) {
      this._state.camera = normalizeCameraInit(patch.camera);
      Deno.core.ops.op_goldlight_scene_3d_set_camera(this.id, this._state.camera);
    }
    return this;
  }

  get() {
    return {
      clearColor: cloneColor(this._state.clearColor),
      camera: cloneCamera(this._state.camera),
    };
  }

  add(node) {
    ensureNode3d(node);
    if (isLayoutNode(node)) {
      node._layoutParent = null;
    }
    this._children.push(node);
    attachNodeToScene3d(this, node);
    markSceneLayoutDirty(this);
    return node;
  }

  _flushLayoutRoot(root) {
    if (!root._layoutSubtreeDirty) {
      return;
    }
    const computedLayouts = computeLayouts(root);
    root._setComputedLayouts(computedLayouts);
    root._applyComputedLayouts(0, 0);
    clearLayoutNodeDirty(root);
  }

  flushLayout() {
    if (!this._layoutDirty) {
      return this;
    }
    const roots = collectLayoutRoots3d(this._children);
    for (const root of roots) {
      this._flushLayoutRoot(root);
    }
    this._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._layoutDirty) {
      dirtyLayoutScenes.add(this);
    }
    return this;
  }
}

export class Triangle3d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
    this._scene = null;
    this._state = normalizeTriangleInit(init);
    this._baseLayoutState = cloneTriangleState(this._state);
  }

  _attachToScene(sceneId) {
    if (this.id !== null) {
      return;
    }
    const handle = Deno.core.ops.op_goldlight_scene_3d_create_triangle(sceneId, this._state);
    this.id = handle.id;
    this._sceneId = sceneId;
  }

  set(patch = {}) {
    if (patch.positions !== undefined) {
      this._state.positions = patch.positions.map((position) => [...position]);
      this._baseLayoutState.positions = patch.positions.map((position) => [...position]);
    }
    if (patch.color !== undefined) {
      this._state.color = normalizeColor(patch.color);
      this._baseLayoutState.color = normalizeColor(patch.color);
    }

    if (this.id !== null) {
      Deno.core.ops.op_goldlight_triangle_3d_update(this.id, this._state);
    }
    return this;
  }

  get() {
    return cloneTriangleState(this._state);
  }

  _applyLayoutOffset(offsetX, offsetY) {
    const positions = this._baseLayoutState.positions;
    const bounds = positions.reduce((acc, [x, y]) => ({
      minX: Math.min(acc.minX, x),
      maxX: Math.max(acc.maxX, x),
      minY: Math.min(acc.minY, y),
      maxY: Math.max(acc.maxY, y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const translated = positions.map(([x, y, z]) => [
      x - bounds.minX + offsetX,
      y - bounds.minY + offsetY,
      z,
    ]);
    this._state.positions = translated;
    if (this.id !== null) {
      Deno.core.ops.op_goldlight_triangle_3d_update(this.id, {
        positions: translated,
        color: this._state.color,
      });
    }
  }
}

export class Group3d {
  constructor(_init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._state = {};
  }

  set(_patch = {}) {
    return this;
  }

  get() {
    return {};
  }

  add(child) {
    ensureNode3d(child);
    if (isLayoutNode(child)) {
      child._layoutParent = null;
    }
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene3d(this._scene, child);
      markSceneLayoutDirty(this._scene);
    }
    return child;
  }
}

export class LayoutGroup3d {
  constructor(init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._state = {};
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = cloneLayout(init);
    this._computedLayout = computeLayout(this._layout);
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
  }

  set(_patch = {}) {
    return this;
  }

  get() {
    return {};
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  add(child) {
    if (!(child instanceof LayoutItem3d) && !(child instanceof LayoutGroup3d)) {
      throw new TypeError("LayoutGroup3d.add expects a LayoutItem3d or LayoutGroup3d");
    }
    child._layoutParent = this;
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene3d(this._scene, child);
    }
    markLayoutNodeDirty(this);
    return child;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
    for (const child of this._children) {
      child._setComputedLayouts(computedLayouts);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    const baseX = offsetX + this._computedLayout.x;
    const baseY = offsetY + this._computedLayout.y;
    for (const child of this._children) {
      child._applyComputedLayouts(baseX, baseY);
    }
  }

  flushLayout() {
    if (!this._scene) {
      return this;
    }
    let root = this;
    while (root._layoutParent !== null) {
      root = root._layoutParent;
    }
    this._scene._flushLayoutRoot(root);
    const roots = collectLayoutRoots3d(this._scene._children);
    this._scene._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._scene._layoutDirty) {
      dirtyLayoutScenes.add(this._scene);
    }
    return this;
  }
}

export class LayoutItem3d {
  constructor() {
    this._sceneId = null;
    this._scene = null;
    this._content = null;
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = {};
    this._computedLayout = computeLayout();
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  setContent(content) {
    ensureNode3d(content);
    this._content = content;
    if (this._scene) {
      attachNodeToScene3d(this._scene, content);
    }
    markLayoutNodeDirty(this);
    return this;
  }

  getContent() {
    return this._content;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    if (this._content === null) {
      return;
    }
    const x = offsetX + this._computedLayout.x;
    const y = offsetY + this._computedLayout.y;
    applyOffsetToNode3d(this._content, x, y);
  }
}

const windowEventListeners = new Map();
let animationFrameCallbacks = [];
let nextAnimationFrameHandle = 1;

export function requestAnimationFrame(callback) {
  ensureFunction(callback, "requestAnimationFrame");
  const handle = nextAnimationFrameHandle++;
  animationFrameCallbacks.push({ handle, callback });
  Deno.core.ops.op_goldlight_worker_request_animation_frame();
  return handle;
}

export function addWindowEventListener(type, listener) {
  ensureFunction(listener, "addWindowEventListener");
  const listeners = windowEventListeners.get(type) ?? [];
  listeners.push(listener);
  windowEventListeners.set(type, listeners);
}

function dispatchWindowEvent(event) {
  if (event.type === "animationFrame") {
    const callbacks = animationFrameCallbacks;
    animationFrameCallbacks = [];
    for (const { callback } of callbacks) {
      callback(event.timestampMs);
    }
  }

  const listeners = windowEventListeners.get(event.type) ?? [];
  for (const listener of listeners) {
    listener(event);
  }
}

globalThis.__goldlightPump = function () {
  const events = Deno.core.ops.op_goldlight_worker_drain_events();
  for (const event of events) {
    dispatchWindowEvent(event);
  }
};
