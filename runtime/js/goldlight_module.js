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
  const { r = 0.1, g = 0.12, b = 0.16, a = 1 } = color;
  return { r, g, b, a };
}

function normalizeCameraInit(init = {}) {
  return {
    position: init.position ? [...init.position] : [0, 0, 3],
    target: init.target ? [...init.target] : [0, 0, 0],
    up: init.up ? [...init.up] : [0, 1, 0],
    fovYDegrees: init.fovYDegrees ?? 50,
    near: init.near ?? 0.1,
    far: init.far ?? 100,
  };
}

function cloneColor(color) {
  return { ...color };
}

function cloneCamera(camera = {}) {
  return {
    position: [...camera.position],
    target: [...camera.target],
    up: [...camera.up],
    fovYDegrees: camera.fovYDegrees,
    near: camera.near,
    far: camera.far,
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
    width: init.width ?? 120,
    height: init.height ?? 120,
    color: init.color
      ? normalizeColor(init.color)
      : { r: 0.25, g: 0.65, b: 0.95, a: 1 },
  };
}

function normalizeTriangleInit(init = {}) {
  return {
    positions: init.positions
      ? init.positions.map((position) => [...position])
      : [
          [-0.7, -0.6, 0],
          [0.7, -0.6, 0],
          [0, 0.7, 0],
        ],
    color: init.color
      ? normalizeColor(init.color)
      : { r: 0.95, g: 0.45, b: 0.25, a: 1 },
  };
}

function ensureFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} expects a function`);
  }
}

function ensureSceneNode(node, expectedType, sceneType) {
  if (!(node instanceof expectedType)) {
    throw new TypeError(`Scene${sceneType}.add expects a ${expectedType.name}`);
  }
}

function ensureScene(value) {
  if (!(value instanceof Scene2d) && !(value instanceof Scene3d)) {
    throw new TypeError("setWindowScene expects a Scene2d or Scene3d");
  }
}

export function createWindow(init = {}) {
  return Deno.core.ops.op_goldlight_create_window(normalizeWindowInit(init));
}

export function setWindowScene(scene) {
  ensureScene(scene);
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
    const handle = Deno.core.ops.op_goldlight_create_scene_2d({
      clearColor: this._state.clearColor,
    });
    this.id = handle.id;
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
    ensureSceneNode(node, Rect2d, "2d");
    node._attachToScene(this.id);
    return node;
  }

}

export class Rect2d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
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
    const handle = Deno.core.ops.op_goldlight_create_scene_3d({
      clearColor: this._state.clearColor,
      camera: this._state.camera,
    });
    this.id = handle.id;
  }

  set(patch = {}) {
    if (patch.clearColor !== undefined) {
      this._state.clearColor = normalizeColor(patch.clearColor);
      Deno.core.ops.op_goldlight_scene_3d_set_clear_color(this.id, {
        color: this._state.clearColor,
      });
    }
    if (patch.camera !== undefined) {
      this._state.camera = {
        ...this._state.camera,
        ...normalizeCameraInit(patch.camera),
      };
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
    ensureSceneNode(node, Triangle3d, "3d");
    node._attachToScene(this.id);
    return node;
  }

}

export class Triangle3d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
    this._state = normalizeTriangleInit(init);
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
    }
    if (patch.color !== undefined) this._state.color = normalizeColor(patch.color);

    if (this.id !== null) {
      Deno.core.ops.op_goldlight_triangle_3d_update(this.id, this._state);
    }
    return this;
  }

  get() {
    return cloneTriangleState(this._state);
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
